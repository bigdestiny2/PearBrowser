/**
 * SwarmBridge — page-scoped Hyperswarm channels for `window.pear.swarm.v1`.
 *
 * See docs/SWARM-V1.md for the full design. Short version:
 *
 *   Pages call:        page → POST /api/swarm/join { topicHex, protocol, ... }
 *                      page → GET  /api/swarm/events?channelId=… (SSE stream)
 *                      page → POST /api/swarm/send { channelId, peerId, data }
 *
 *   Worklet does:      tracks one Channel per (token,channelId), multiplexes
 *                      Hyperswarm peer events back over the SSE stream. Pages
 *                      never hold raw socket FDs or private keys.
 *
 * Topic policy (mirrors §4 of the spec):
 *   Tier A — drive-derived `sha256("pear.swarm.v1:" + driveKey + subtopic)`:
 *            no consent prompt, always allowed. This is convenience
 *            scoping only — drive keys are public, so the namespace is
 *            not provably private to the drive (see deriveTierATopic).
 *   Tier B — autobase / mint-then-rejoin: persisted grant, no prompt.
 *   Tier C — arbitrary topic: requires user consent via EVT_SWARM_REQUEST.
 *
 * Rate limits (defaults — overridable from boot config):
 *   - 8 simultaneous channels per app
 *   - 10 topic joins per minute per app
 *   - 1 MB/s outbound per peer
 *   - 64 peers per channel (newest-wins)
 *   - 1 pending consent sheet at a time
 */

const crypto = require('hypercore-crypto')
const hashCrypto = require('bare-crypto')
const b4a = require('b4a')
const Protomux = require('protomux')
const c = require('compact-encoding')

const TIER_A_PREFIX = 'pear.swarm.v1:'
// Protomux protocol namespace. Each page-chosen `protocol` is suffixed onto
// this so two apps that pick the same user-facing protocol name still share
// the swarm.v1 envelope, while the (protocol,id) pair Protomux pairs on stays
// `('pear.swarm.v1/'+userProtocol, topicBuffer)`.
const MUX_PROTOCOL_PREFIX = 'pear.swarm.v1/'
const DEFAULT_LIMITS = {
  maxChannelsPerApp: 8,
  maxJoinsPerMinute: 10,
  maxBytesPerSecondPerPeer: 1024 * 1024,
  maxPeersPerChannel: 64,
  maxPendingConsents: 1
}

/**
 * sha256(TIER_A_PREFIX || driveKeyHex || subtopic) — the Tier A topic
 * derivation. Pages can always join these without a consent prompt.
 *
 * NOTE: this is a *convenience* scoping, not a security boundary. Drive
 * keys are public, so any peer who knows a drive key can re-derive this
 * topic and join the same namespace. The no-consent policy just spares
 * the page's own owner a prompt for their own drive's topics — it does
 * NOT prove the topic is private to that drive. Pages that need
 * authenticated peers must run their own handshake on top.
 */
function deriveTierATopic (driveKeyHex, subtopic) {
  const h = hashCrypto.createHash('sha256')
  h.update(TIER_A_PREFIX)
  h.update(driveKeyHex)
  if (subtopic) h.update(String(subtopic))
  return h.digest('hex')
}

class SwarmBridge {
  /**
   * @param {Hyperswarm} swarm — the worklet's existing swarm
   * @param {object} ctx
   * @param {object} ctx.identity — Identity instance (for sub-key handshake verification)
   * @param {object} ctx.swarmGrants — SwarmGrants Hyperbee wrapper (Tier B/C persistence)
   * @param {Function} ctx.requestConsent — async ({driveKey, appName, reason, topicHex, protocol}) → bool
   * @param {object} [opts] — limits override
   */
  constructor (swarm, ctx, opts = {}) {
    if (!swarm) throw new Error('SwarmBridge requires a Hyperswarm')
    this.swarm = swarm
    this.identity = ctx.identity || null
    this.grants = ctx.swarmGrants || null
    this.requestConsent = ctx.requestConsent || null
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits }

    /** Map<channelId, Channel> — every active page channel. */
    this.channels = new Map()
    /** Map<topicHex, { count, channels: Set<channelId> }> — refcount per topic. */
    this.topicRefs = new Map()
    /** Map<driveKeyHex, { joinsInWindow: number, windowStart: number, pending: number }> — per-app rate limits */
    this.appState = new Map()
    /** Map<conn, { conn, mux, info }> — every live swarm connection the bridge sees. */
    this._conns = new Map()

    // ONE swarm-level 'connection' listener for the whole bridge. Each peer
    // connection carries a single Protomux instance (Protomux.from is
    // idempotent — it stashes itself on conn.userData and reuses it). Every
    // local Channel opens its own muxed sub-channel on that connection, keyed
    // by ('pear.swarm.v1/'+protocol, topicBuffer). Protomux only PAIRS the
    // sub-channels the remote also opened with the exact same (protocol, id),
    // so:
    //   - the topic/protocol match (not info.topics) is what attributes a
    //     peer to a channel — this fixes server-role peers (whose info.topics
    //     is empty) and removes cross-delivery between channels on a shared
    //     topic, since each channel only sees frames for its own sub-channel;
    //   - two logical channels (different topics, same protocol) can share one
    //     connection without crossing wires.
    // Protomux also length-frames the byte stream for us, so no manual framing
    // is needed on top of @hyperswarm/secret-stream. This mirrors how
    // hypercore replication muxes over a single connection.
    this._onConnection = (conn, info) => this._addConnection(conn, info)
    this.swarm.on('connection', this._onConnection)
  }

  // ---- Public API (called by http-bridge.js) ----

  /**
   * Join a swarm topic. Returns the channel descriptor or throws.
   *
   * @param {object} args
   * @param {string} args.driveKeyHex — page's drive key (from the page's API token)
   * @param {string} args.appName — display name for consent UI
   * @param {string} args.topicHex — 64-hex topic, OR null for tierA-derived
   * @param {string} [args.subtopic] — UTF-8 subtopic if using Tier A derivation
   * @param {string} args.protocol — page-chosen protocol name (default 'pear.swarm.v1')
   * @param {number} args.version — page-chosen protocol version (default 1)
   * @param {boolean} args.server — hyperswarm role
   * @param {boolean} args.client
   * @param {string} [args.reason] — human-readable, shown on consent sheet for Tier C
   */
  async join (args) {
    const driveKeyHex = String(args.driveKeyHex || '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(driveKeyHex)) {
      throw new Error('SwarmBridge: invalid driveKeyHex')
    }
    // Check both budgets BEFORE we touch anything, but do NOT reserve either
    // yet. A denied consent prompt (or any throw below) must not permanently
    // burn a channel slot — otherwise ~8 denials lock the app out of swarm —
    // and must not silently eat the per-minute join budget either. Both are
    // committed only once the Channel is actually live.
    this._enforceChannelCount(driveKeyHex)
    this._enforceJoinRate(driveKeyHex)

    const { topicHex, tier } = await this._resolveTopic(driveKeyHex, args)

    const protocol = String(args.protocol || 'pear.swarm.v1')
    const version = Number.isFinite(args.version) ? args.version : 1
    const channelId = 'ch-' + crypto.randomBytes(8).toString('hex')

    const channel = new Channel({
      bridge: this,
      channelId,
      driveKeyHex,
      topicHex,
      tier,
      protocol,
      version,
      server: !!args.server,
      client: args.client !== false
    })

    // Commit the channel, then count both budgets. If joining the swarm
    // throws, roll everything back so neither budget is leaked.
    this.channels.set(channelId, channel)
    this._incrementChannelCount(driveKeyHex)
    this._commitJoinRate(driveKeyHex)
    this._refTopic(topicHex, channelId)
    try {
      await channel._joinSwarm()
    } catch (err) {
      this.channels.delete(channelId)
      this._unrefTopic(topicHex, channelId)
      this._decrementChannelCount(driveKeyHex)
      throw err
    }

    return {
      channelId,
      topicHex,
      protocol,
      version,
      tier
    }
  }

  /** Page detached from the WebSocket OR called channel.destroy(). */
  async leave (channelId) {
    const channel = this.channels.get(channelId)
    if (!channel) return
    this.channels.delete(channelId)
    await channel._leaveSwarm()
    this._unrefTopic(channel.topicHex, channelId)
  }

  /**
   * Page wired up its event stream — start emitting peer events to it.
   *
   * `stream` is a transport-agnostic writer. Two methods:
   *   send(eventObj)   — push one event to the page (object will be JSON.stringified)
   *   close()          — close the underlying stream
   * Plus one wire-up: stream.onClose(fn) — fn called once when page detaches.
   *
   * We use SSE for v0.3.0; WebSocket can drop in later by exposing the
   * same shape.
   */
  attachStream (channelId, stream) {
    const channel = this.channels.get(channelId)
    if (!channel) {
      try { stream.send({ type: 'error', message: 'unknown channelId' }); stream.close() } catch {}
      return false
    }
    channel._attachStream(stream)
    return true
  }

  /** Page is sending to a peer over the channel. */
  send (channelId, peerId, data) {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error('unknown channelId')
    channel._sendToPeer(peerId, data)
  }

  /** Tear down all channels — used by the global teardown path. */
  async destroy () {
    if (this._onConnection) {
      try { this.swarm.off('connection', this._onConnection) } catch {}
      this._onConnection = null
    }
    const all = [...this.channels.values()]
    this.channels.clear()
    this.topicRefs.clear()
    for (const ch of all) {
      try { await ch._leaveSwarm() } catch {}
    }
    this._conns.clear()
  }

  // ---- Internal ----

  async _resolveTopic (driveKeyHex, args) {
    // Tier A: page asked for a subtopic — derive deterministically.
    if (args.subtopic !== undefined && args.subtopic !== null) {
      const topicHex = deriveTierATopic(driveKeyHex, args.subtopic)
      return { topicHex, tier: 'A' }
    }

    const topicHex = String(args.topicHex || '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(topicHex)) {
      throw new Error('SwarmBridge: topicHex must be 64-hex (or pass subtopic for Tier A derivation)')
    }

    // Tier A check: was this the page's own driveKey-derived topic?
    if (this._isTierATopic(driveKeyHex, topicHex)) {
      return { topicHex, tier: 'A' }
    }

    // Tier B/C: check persisted grant.
    if (this.grants) {
      const granted = await this.grants.has(driveKeyHex, topicHex).catch(() => false)
      if (granted) {
        this.grants.touch(driveKeyHex, topicHex).catch(() => {})
        return { topicHex, tier: 'B' }
      }
    }

    // Tier C: must request consent.
    if (!this.requestConsent) {
      throw new Error('SwarmBridge: arbitrary topics require consent but no requestConsent hook is wired')
    }
    const state = this._appStateFor(driveKeyHex)
    if (state.pending >= this.limits.maxPendingConsents) {
      throw new Error('consent-pending')
    }
    state.pending += 1
    let approved = false
    try {
      approved = await this.requestConsent({
        driveKeyHex,
        appName: args.appName || null,
        reason: args.reason || null,
        topicHex,
        protocol: args.protocol || null
      })
    } finally {
      state.pending = Math.max(0, state.pending - 1)
    }
    if (!approved) throw new Error('consent-denied')

    if (this.grants) {
      try { await this.grants.add(driveKeyHex, topicHex, { protocol: args.protocol || null, appName: args.appName || null }) }
      catch (err) { console.warn('[SwarmBridge] could not persist grant:', err && err.message) }
    }
    return { topicHex, tier: 'C' }
  }

  _isTierATopic (driveKeyHex, topicHex) {
    // We can't reverse the hash, and Tier A is only a convenience-scoping
    // marker anyway (the derivation is from a *public* drive key, so it is
    // not a security boundary). We only mark Tier A when the page passes a
    // `subtopic` and we derive the topic ourselves. A raw topicHex without a
    // subtopic is never assumed to be Tier A. So return false here.
    return false
  }

  _appStateFor (driveKeyHex) {
    let s = this.appState.get(driveKeyHex)
    if (!s) {
      s = { joinsInWindow: 0, windowStart: Date.now(), pending: 0, channelCount: 0 }
      this.appState.set(driveKeyHex, s)
    }
    return s
  }

  // Pure check (also rolls the sliding window). Does NOT consume a token —
  // a denied consent or a later failure shouldn't burn the join budget.
  // The token is consumed via _commitJoinRate once the channel is live.
  _enforceJoinRate (driveKeyHex) {
    const s = this._appStateFor(driveKeyHex)
    const now = Date.now()
    if (now - s.windowStart > 60_000) {
      s.windowStart = now
      s.joinsInWindow = 0
    }
    if (s.joinsInWindow + 1 > this.limits.maxJoinsPerMinute) {
      throw new Error(`rate-limited: max ${this.limits.maxJoinsPerMinute} swarm joins per minute`)
    }
  }

  _commitJoinRate (driveKeyHex) {
    const s = this._appStateFor(driveKeyHex)
    s.joinsInWindow += 1
  }

  // Pure check — does NOT reserve a slot. The slot is only committed via
  // _incrementChannelCount once the Channel is actually created, so denied
  // consent prompts and other throws can't permanently burn a slot.
  _enforceChannelCount (driveKeyHex) {
    const s = this._appStateFor(driveKeyHex)
    if (s.channelCount + 1 > this.limits.maxChannelsPerApp) {
      throw new Error(`rate-limited: max ${this.limits.maxChannelsPerApp} simultaneous swarm channels per app`)
    }
  }

  _incrementChannelCount (driveKeyHex) {
    const s = this._appStateFor(driveKeyHex)
    s.channelCount += 1
  }

  _refTopic (topicHex, channelId) {
    let entry = this.topicRefs.get(topicHex)
    if (!entry) {
      entry = { count: 0, channels: new Set() }
      this.topicRefs.set(topicHex, entry)
    }
    entry.channels.add(channelId)
    entry.count = entry.channels.size
  }

  _unrefTopic (topicHex, channelId) {
    const entry = this.topicRefs.get(topicHex)
    if (!entry) return
    entry.channels.delete(channelId)
    entry.count = entry.channels.size
    if (entry.count === 0) this.topicRefs.delete(topicHex)
  }

  _decrementChannelCount (driveKeyHex) {
    const s = this.appState.get(driveKeyHex)
    if (s) s.channelCount = Math.max(0, s.channelCount - 1)
  }

  /**
   * A new swarm connection arrived. Build (or reuse) its Protomux, remember
   * it, and have every live Channel open its muxed sub-channel on it. We do
   * NOT inspect info.topics — Protomux pairing is the topic filter: only the
   * sub-channels whose (protocol, id) the remote also opened will fire onopen.
   * This is what makes server-role peers work (their info.topics is empty) and
   * what lets two channels share one connection without cross-delivery.
   */
  _addConnection (conn, info) {
    if (this._conns.has(conn)) return
    const mux = Protomux.from(conn)
    const entry = { conn, mux, info: info || null }
    this._conns.set(conn, entry)

    // Drop the connection from our live set when it closes, so new channels
    // don't try to open sub-channels on a dead mux. (Protomux already closes
    // its sub-channels on the conn 'close' event, which drives each Channel's
    // onclose → peer-leave.)
    const onClose = () => this._removeConnection(conn)
    conn.once('close', onClose)
    conn.once('error', onClose)

    for (const ch of this.channels.values()) {
      if (ch._destroyed) continue
      ch._openOnConnection(entry)
    }
  }

  _removeConnection (conn) {
    this._conns.delete(conn)
  }
}

/**
 * One Channel = one (page, topic, protocol) tuple. Owns the page-side WS
 * and the worklet-side hyperswarm topic-discovery handle. Multiplexes
 * peer connections that arrive on the topic into JSON frames the page
 * can consume.
 *
 * Important: multiple Channels can share the same hyperswarm topic
 * (different protocols, or two pages from the same drive). The bridge's
 * topicRefs counts how many channels use a topic; only the last leaver
 * actually calls swarm.leave.
 */
class Channel {
  constructor (opts) {
    this.bridge = opts.bridge
    this.channelId = opts.channelId
    this.driveKeyHex = opts.driveKeyHex
    this.topicHex = opts.topicHex
    this.tier = opts.tier
    this.protocol = opts.protocol
    this.version = opts.version
    this.serverRole = opts.server
    this.clientRole = opts.client

    /** Map<peerId, { conn, ch, msg, lastSendBytes, lastSendWindowStart }> — one per paired remote. */
    this.peers = new Map()
    /** Map<conn, mux Channel> — the muxed sub-channel this Channel opened on each live conn. */
    this._muxChannels = new Map()
    this._peerSeq = 0
    this._topicBuffer = b4a.from(this.topicHex, 'hex')
    // The Protomux protocol string both sides must agree on for pairing.
    this._muxProtocol = MUX_PROTOCOL_PREFIX + this.protocol
    /** Belt-and-braces buffer: events emitted before the page attaches its stream. */
    this._eventBuffer = []
    this._stream = null
    this._discovery = null
    this._destroyed = false

    // Per-peer 1s rate-limit window.
    this._rateLimit = opts.bridge.limits.maxBytesPerSecondPerPeer
  }

  async _joinSwarm () {
    if (this._destroyed) return
    // Hyperswarm.join returns a discovery handle. Connections themselves are
    // delivered through the bridge's SINGLE swarm-level 'connection' listener
    // (see SwarmBridge constructor / _addConnection). Each connection carries a
    // Protomux; this channel opens its own muxed sub-channel on every one.
    this._discovery = this.bridge.swarm.join(this._topicBuffer, {
      server: this.serverRole,
      client: this.clientRole
    })
    // A connection may already be live (joined before this channel, or shared
    // with another channel on an overlapping topic). Open our muxed sub-channel
    // on every existing connection now; brand-new connections get it via
    // SwarmBridge._addConnection.
    for (const entry of this.bridge._conns.values()) {
      this._openOnConnection(entry)
    }
    // Best-effort flush — Hyperswarm may already have peers on this topic.
    try { await this._discovery.flushed?.() } catch {}
  }

  async _leaveSwarm () {
    this._destroyed = true
    // Close every muxed sub-channel this channel opened. ch.close() tears down
    // only our (protocol, topic) sub-channel on the shared connection — it does
    // NOT destroy the underlying socket, so other channels sharing the same
    // hyperswarm conn (overlapping topics / other protocols) keep working.
    // hyperswarm GCs the socket when no channel refs it.
    for (const ch of this._muxChannels.values()) {
      try { ch.close() } catch {}
    }
    this._muxChannels.clear()
    this.peers.clear()
    if (this._discovery) {
      try { await this._discovery.destroy?.() } catch {}
      this._discovery = null
    }
    this.bridge._decrementChannelCount(this.driveKeyHex)
    if (this._stream) {
      try { this._stream.send({ type: 'closed' }) } catch {}
      try { this._stream.close() } catch {}
      this._stream = null
    }
  }

  // Open this channel's muxed sub-channel on one live connection. Called by
  // the bridge for every (conn, channel) pair — both when a connection arrives
  // (SwarmBridge._addConnection) and when this channel joins (over existing
  // conns in _joinSwarm). Idempotent per conn.
  //
  // The sub-channel is keyed by (this._muxProtocol, this._topicBuffer).
  // Protomux only pairs it with a remote sub-channel that opened the SAME
  // (protocol, id) — that pairing (not info.topics) is what decides whether a
  // peer belongs to this channel. A connection where the remote never opens a
  // matching sub-channel simply never fires onopen here, so no peer is emitted.
  _openOnConnection (entry) {
    if (this._destroyed) return
    const { conn, mux, info } = entry
    if (this._muxChannels.has(conn)) return
    if (conn.destroyed) return

    // createChannel returns null if a sub-channel with this exact (protocol,id)
    // already exists on the mux (e.g. two of our channels on the same topic AND
    // protocol — Protomux can only pair one) or the remote already closed it.
    // msg is declared before createChannel so the onopen closure never reads it
    // in a temporal dead zone. Protomux fires onopen only ASYNCHRONOUSLY (after
    // both ends open + pair), by which point msg is assigned — but we don't lean
    // on that for correctness: msg starts null and is set below before open().
    let msg = null
    const ch = mux.createChannel({
      protocol: this._muxProtocol,
      id: this._topicBuffer,
      unique: true,
      onopen: () => this._onMuxOpen(conn, ch, msg, info),
      onclose: () => this._onMuxClose(conn),
      ondestroy: () => this._onMuxClose(conn)
    })
    if (ch === null) return

    msg = ch.addMessage({
      encoding: c.raw,
      onmessage: (payload) => this._onMuxMessage(conn, payload)
    })

    this._muxChannels.set(conn, ch)
    // Both sides createChannel + open; Protomux pairs them and fires onopen on
    // both ends. Until then there is no peer for this conn on this channel.
    try { ch.open() } catch {}
  }

  _onMuxOpen (conn, ch, msg, info) {
    if (this._destroyed) return

    if (this.peers.size >= this.bridge.limits.maxPeersPerChannel) {
      // newest-wins: drop the oldest peer (close its sub-channel, not the socket).
      const oldestId = this.peers.keys().next().value
      const oldest = this.peers.get(oldestId)
      if (oldest) {
        this.peers.delete(oldestId)
        if (oldest.conn !== conn) this._muxChannels.delete(oldest.conn)
        try { oldest.ch.close() } catch {}
        this._emit({ type: 'peer-leave', peerId: oldestId })
      }
    }

    const peerId = 'peer-' + (++this._peerSeq) + '-' + crypto.randomBytes(4).toString('hex')
    this.peers.set(peerId, {
      conn,
      ch,
      msg,
      lastSendBytes: 0,
      lastSendWindowStart: Date.now()
    })
    this._emit({
      type: 'peer',
      peerId,
      // Pubkey is null until handshake — pages can implement their own
      // ed25519 handshake on top using window.pear's identity-sign API.
      pubkey: null,
      info: { client: !!info?.client, server: !!info?.server }
    })
  }

  _onMuxMessage (conn, payload) {
    if (this._destroyed) return
    const peerId = this._peerIdForConn(conn)
    if (!peerId) return
    this._emit({
      type: 'message',
      peerId,
      data: b4a.toString(b4a.from(payload), 'base64')
    })
  }

  _onMuxClose (conn) {
    this._muxChannels.delete(conn)
    if (this._destroyed) return
    const peerId = this._peerIdForConn(conn)
    if (peerId && this.peers.delete(peerId)) {
      this._emit({ type: 'peer-leave', peerId })
    }
  }

  _peerIdForConn (conn) {
    for (const [peerId, peer] of this.peers) {
      if (peer.conn === conn) return peerId
    }
    return null
  }

  _attachStream (stream) {
    if (this._destroyed) {
      try { stream.send({ type: 'closed' }); stream.close() } catch {}
      return
    }
    this._stream = stream
    // Flush buffered events that arrived before the page attached.
    for (const ev of this._eventBuffer) {
      try { stream.send(ev) } catch {}
    }
    this._eventBuffer.length = 0
    if (typeof stream.onClose === 'function') {
      stream.onClose(() => {
        // Page detached. Tear the channel down — pages get a fresh
        // channelId on reconnect. (No reconnection semantics in v1.)
        this.bridge.leave(this.channelId).catch(() => {})
      })
    }
  }

  _emit (event) {
    if (this._destroyed) return
    if (this._stream) {
      try { this._stream.send(event) } catch {}
    } else {
      // Pre-stream buffer — bounded.
      if (this._eventBuffer.length >= 256) this._eventBuffer.shift()
      this._eventBuffer.push(event)
    }
  }

  _sendToPeer (peerId, data) {
    if (this._destroyed) throw new Error('channel destroyed')
    const peer = this.peers.get(peerId)
    if (!peer) throw new Error('unknown peerId')
    const buf = typeof data === 'string'
      ? b4a.from(data, 'base64')
      : b4a.from(data)
    // Per-peer rate limit, sliding 1s window.
    const now = Date.now()
    if (now - peer.lastSendWindowStart > 1000) {
      peer.lastSendWindowStart = now
      peer.lastSendBytes = 0
    }
    if (peer.lastSendBytes + buf.length > this._rateLimit) {
      this._emit({ type: 'error', message: 'rate-limited: outbound 1MB/s/peer exceeded', peerId })
      return
    }
    peer.lastSendBytes += buf.length
    // msg.send frames the payload over the muxed sub-channel; it returns false
    // on backpressure (we don't pause the page here — the SSE/relay side owns
    // page→worklet backpressure). Raw encoding sends the bytes verbatim, so the
    // remote's onmessage payload equals `buf`.
    try { peer.msg.send(buf) } catch (err) {
      this._emit({ type: 'error', message: 'send failed: ' + (err && err.message), peerId })
    }
  }
}

module.exports = { SwarmBridge, deriveTierATopic, DEFAULT_LIMITS }
