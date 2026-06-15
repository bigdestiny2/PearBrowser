/**
 * Test helpers for exercising the Protomux-multiplexed swarm.v1 bridge.
 *
 * In production each swarm peer connection is a @hyperswarm/secret-stream — a
 * raw byte Duplex. SwarmBridge runs `Protomux.from(conn)` directly on it and
 * opens one muxed sub-channel per (protocol, topic). Protomux length-frames
 * over the byte stream itself, so for tests we only need a *plain connected
 * byte Duplex pair*: bytes written to end A arrive at end B (and vice-versa),
 * in order, in byte mode. No extra framing wrapper is required.
 */

const { Duplex } = require('streamx')
const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')

/**
 * A plain connected byte Duplex pair. Returns [a, b]; bytes written to `a`
 * surface as 'data' on `b` and vice-versa, FIFO, in byte mode (Buffers).
 * Closing/erroring one end ends the other. This is the minimal stand-in for a
 * secret-stream connection that Protomux can run over.
 */
function duplexPair () {
  let a = null
  let b = null

  a = new Duplex({
    write (data, cb) { b.push(b4a.from(data)); cb() },
    final (cb) { try { b.push(null) } catch {} ; cb() }
  })
  b = new Duplex({
    write (data, cb) { a.push(b4a.from(data)); cb() },
    final (cb) { try { a.push(null) } catch {} ; cb() }
  })

  // Mirror destroy so closing one side tears down the other (drives the
  // bridge's conn 'close'/'error' → mux sub-channel close → peer-leave path).
  a.once('close', () => { if (!b.destroyed) b.destroy() })
  b.once('close', () => { if (!a.destroyed) a.destroy() })

  return [a, b]
}

/**
 * A fake remote peer that speaks Protomux on its end of a connection. Mirrors
 * what a second PearBrowser worklet (or any swarm.v1 participant) would do:
 * open a muxed sub-channel keyed by (protocol, topic) and send/receive raw
 * bytes over it.
 */
class MockPeer {
  /**
   * @param {Duplex} conn — this peer's end of a duplexPair()
   */
  constructor (conn) {
    this.conn = conn
    this.mux = Protomux.from(conn)
    /** Map<key, { ch, msg, received: Buffer[] }> */
    this.channels = new Map()
  }

  static key (protocol, id) {
    return protocol + '##' + b4a.toString(b4a.from(id), 'hex')
  }

  /**
   * Open a muxed sub-channel matching the bridge's
   * ('pear.swarm.v1/'+protocol, topicBuffer). Returns a small handle with
   * send() + received[] + an onmessage hook.
   *
   * @param {object} opts
   * @param {string} opts.protocol — full mux protocol, e.g. 'pear.swarm.v1/pear.echo-peer.v1'
   * @param {Buffer|string} opts.id — topic buffer (or hex string)
   * @param {Function} [opts.onopen]
   * @param {Function} [opts.onmessage] — (Buffer) => void
   * @param {Function} [opts.onclose]
   */
  openChannel ({ protocol, id, onopen, onmessage, onclose }) {
    const idBuf = b4a.from(id)
    const entry = { ch: null, msg: null, received: [], opened: false }
    const key = MockPeer.key(protocol, idBuf)

    const ch = this.mux.createChannel({
      protocol,
      id: idBuf,
      unique: true,
      onopen: () => { entry.opened = true; if (onopen) onopen() },
      onclose: () => { if (onclose) onclose() },
      ondestroy: () => {}
    })
    if (ch === null) throw new Error('MockPeer: duplicate channel for ' + key)

    const msg = ch.addMessage({
      encoding: c.raw,
      onmessage: (payload) => {
        const buf = b4a.from(payload)
        entry.received.push(buf)
        if (onmessage) onmessage(buf)
      }
    })

    entry.ch = ch
    entry.msg = msg
    entry.send = (data) => msg.send(b4a.from(data))
    entry.close = () => { try { ch.close() } catch {} }
    this.channels.set(key, entry)

    ch.open()
    return entry
  }

  destroy () {
    try { this.conn.destroy() } catch {}
  }
}

module.exports = { duplexPair, MockPeer }
