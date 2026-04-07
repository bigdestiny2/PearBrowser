/**
 * Simple RPC over IPC
 *
 * Uses length-prefixed JSON messages over the raw IPC stream.
 * Each message is: { id, cmd, data } for requests, { id, result/error } for replies,
 * or { event, data } for push events.
 *
 * This is a lightweight alternative to hrpc that works without
 * code generation or schema compilation — suitable for the MVP.
 * Can be upgraded to hrpc + hyperschema later for performance.
 */

const EventEmitter = require('bare-events')

class WorkletRPC extends EventEmitter {
  constructor (ipc) {
    super()
    this._ipc = ipc
    this._nextId = 1
    this._pending = new Map() // id → { resolve, reject, timer }
    this._handlers = new Map() // cmd → handler fn
    this._buffer = ''

    ipc.on('data', (data) => this._onData(data))
  }

  /**
   * Register a command handler
   */
  handle (cmd, fn) {
    this._handlers.set(cmd, fn)
  }

  /**
   * Send a request and wait for reply
   */
  request (cmd, data, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++
      const timer = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error(`RPC timeout: cmd ${cmd}`))
      }, timeout)

      this._pending.set(id, { resolve, reject, timer })
      this._send({ id, cmd, data })
    })
  }

  /**
   * Send a push event (no reply expected)
   */
  event (evt, data) {
    this._send({ event: evt, data })
  }

  /**
   * Reply to an incoming request
   */
  _reply (id, result, error) {
    if (error) {
      this._send({ id, error: typeof error === 'string' ? error : error.message })
    } else {
      this._send({ id, result })
    }
  }

  _send (msg) {
    try {
      const json = JSON.stringify(msg)
      const buf = Buffer.from(json.length.toString(16).padStart(8, '0') + json)
      this._ipc.write(buf)
    } catch {}
  }

  _onData (chunk) {
    this._buffer += chunk.toString()

    // Prevent buffer from growing unbounded
    if (this._buffer.length > 20_000_000) {
      this._buffer = ''
      return
    }

    while (this._buffer.length >= 8) {
      const lenHex = this._buffer.slice(0, 8)
      const len = parseInt(lenHex, 16)
      if (isNaN(len) || len <= 0 || len > 10_000_000) {
        this._buffer = ''
        return
      }

      if (this._buffer.length < 8 + len) break // Incomplete message

      const json = this._buffer.slice(8, 8 + len)
      this._buffer = this._buffer.slice(8 + len)

      let msg
      try {
        msg = JSON.parse(json)
      } catch {
        continue
      }

      this._processMessage(msg)
    }
  }

  async _processMessage (msg) {
    // It's a reply to our request
    if (msg.id && (msg.result !== undefined || msg.error)) {
      const pending = this._pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this._pending.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(msg.error))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }

    // It's a push event
    if (msg.event !== undefined) {
      this.emit('event', msg.event, msg.data)
      this.emit(`event:${msg.event}`, msg.data)
      return
    }

    // It's an incoming request
    if (msg.id && msg.cmd !== undefined) {
      const handler = this._handlers.get(msg.cmd)
      if (handler) {
        try {
          const result = await handler(msg.data)
          this._reply(msg.id, result)
        } catch (err) {
          this._reply(msg.id, null, err)
        }
      } else {
        this._reply(msg.id, null, `Unknown command: ${msg.cmd}`)
      }
    }
  }
}

module.exports = { WorkletRPC }
