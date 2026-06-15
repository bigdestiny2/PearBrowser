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

const TIER_A_PREFIX = 'pear.swarm.v1:'
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
    /** Set<conn> — connections this bridge has already attributed to a channel. */
    this._claimedConns = new WeakSet()

    // ONE swarm-level 'connection' listener for the whole bridge (not one
    // per Channel). Hyperswarm fires 'connection' once per peer regardless of
    // how many topics that peer overlaps; registering per-channel made every
    // channel on a shared topic attach its own 'data' listener to the same
    // socket and re-broadcast the peer's frames into every channel
    // (cross-delivery). With a single handler we attribute each connection to
    // exactly one Channel, so channels no longer see each other's frames.
    //
    // TODO(swarm.v1): the fully canonical fix is to build a Protomux per
    // connection and have each Channel open a muxed sub-channel
    //   mux.createChannel({ protocol: 'pear.swarm.v1/' + protocol, id: topicBuffer })
    // Protomux length-frames and namespaces by (protocol, topic) for free,
    // which would also let two channels share one socket on different topics.
    // That is the planned next step; protomux is already in the dep tree
    // (used by hypercore replication).
    this._onConnection = (conn, info) => this._routeConnection(conn, info)
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
   * Route one swarm-level 'connection' to the single Channel it belongs to.
   *
   * Attribution rules:
   *   - Outbound (client) peers: Hyperswarm populates info.topics with the
   *     topic(s) that discovered the peer, so we match a channel by topic.
   *   - Inbound (server) peers: info.topics is EMPTY for server-accepted
   *     connections (Hyperswarm builds the PeerInfo from the remote key, not
   *     from a topic). The previous code branched on info.topics and so
   *     dropped EVERY peer for announced/server channels. Instead we
   *     attribute inbound peers to a channel that joined a topic with
   *     server:true.
   *
   * Each connection is claimed by exactly one channel. Without protocol/topic
   * negotiation on the wire we cannot tell two server channels apart, so the
   * first eligible server channel wins (single-attribution avoids the
   * cross-delivery the old per-channel broadcast caused). The full Protomux
   * fix (see constructor TODO) would make this precise.
   */
  _routeConnection (conn, info) {
    if (this._claimedConns.has(conn)) return

    const topics = info && info.topics
    const isClient = !!(info && info.client)
    let target = null

    if (topics && topics.length > 0) {
      // Outbound / discovered peer — attribute by topic membership.
      for (const ch of this.channels.values()) {
        if (ch._destroyed) continue
        if (topics.some((t) => b4a.equals(t, ch._topicBuffer))) { target = ch; break }
      }
    }

    if (!target && !isClient) {
      // Inbound / server-accepted peer with no topic on the PeerInfo —
      // hand it to a channel that announced itself (joined server:true).
      for (const ch of this.channels.values()) {
        if (ch._destroyed) continue
        if (ch.serverRole) { target = ch; break }
      }
    }

    if (!target) return
    this._claimedConns.add(conn)
    target._adoptConnection(conn, info)
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

    /** Map<peerId, { conn, lastSendBytes, lastSendWindowStart }> */
    this.peers = new Map()
    this._peerSeq = 0
    this._topicBuffer = b4a.from(this.topicHex, 'hex')
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
    // (see SwarmBridge constructor / _routeConnection), which attributes each
    // peer to exactly one channel. We no longer register a per-channel
    // listener here — doing so made channels on a shared topic cross-deliver.
    this._discovery = this.bridge.swarm.join(this._topicBuffer, {
      server: this.serverRole,
      client: this.clientRole
    })
    // Best-effort flush — Hyperswarm may already have peers on this topic.
    try { await this._discovery.flushed?.() } catch {}
  }

  async _leaveSwarm () {
    this._destroyed = true
    // Detach all peer conns owned by this channel (don't destroy them — the
    // hyperswarm conn may be shared across multiple channels on overlapping
    // topics; let hyperswarm GC it when no one refs it).
    for (const [peerId, peer] of this.peers) {
      try { peer.conn.removeListener?.('data', peer._onData) } catch {}
    }
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

  // Called by the bridge once a connection has been attributed to THIS
  // channel (see SwarmBridge._routeConnection). The topic/role filtering
  // already happened there, so we just wire the peer up.
  _adoptConnection (conn, info) {
    if (this._destroyed) return

    if (this.peers.size >= this.bridge.limits.maxPeersPerChannel) {
      // newest-wins: drop the oldest peer
      const oldestId = this.peers.keys().next().value
      const oldest = this.peers.get(oldestId)
      if (oldest) {
        try { oldest.conn.destroy?.() } catch {}
        this.peers.delete(oldestId)
        this._emit({ type: 'peer-leave', peerId: oldestId })
      }
    }

    const peerId = 'peer-' + (++this._peerSeq) + '-' + crypto.randomBytes(4).toString('hex')
    const peer = {
      conn,
      lastSendBytes: 0,
      lastSendWindowStart: Date.now(),
      _onData: null
    }
    peer._onData = (data) => {
      this._emit({
        type: 'message',
        peerId,
        data: b4a.toString(b4a.from(data), 'base64')
      })
    }
    conn.on('data', peer._onData)
    conn.once('close', () => {
      if (this.peers.delete(peerId)) {
        this._emit({ type: 'peer-leave', peerId })
      }
    })
    conn.once('error', () => {
      if (this.peers.delete(peerId)) {
        this._emit({ type: 'peer-leave', peerId })
      }
    })

    this.peers.set(peerId, peer)
    this._emit({
      type: 'peer',
      peerId,
      // Pubkey is null until handshake — pages can implement their own
      // ed25519 handshake on top using window.pear's identity-sign API.
      pubkey: null,
      info: { client: !!info?.client, server: !!info?.server }
    })
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
    try { peer.conn.write(buf) } catch (err) {
      this._emit({ type: 'error', message: 'send failed: ' + (err && err.message), peerId })
    }
  }
}

module.exports = { SwarmBridge, deriveTierATopic, DEFAULT_LIMITS }
