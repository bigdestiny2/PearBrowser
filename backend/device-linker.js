// DeviceLinker — secure root-seed transfer to a NEW device via blind-pairing.
//
// Adopted from hyper-identity (pear-git's identity backend) and HARDENED. The
// upstream version auto-ships the raw mnemonic to anyone who joins with the
// invite; here the seed is never revealed until the SOURCE device explicitly
// approves the specific candidate (autoAccept or an async onRequest callback).
//
// Transport: blind-pairing gives a mutually-authenticated, encrypted channel
// keyed off a single-use invite (a bearer secret — deliver it over a trusted
// channel, e.g. a QR shown on the source device). Our v2 identity entropy is
// exactly 32 bytes, which is precisely the payload blind-pairing's invite
// carries, so the root seed transfers natively with no extra framing.
//
// CommonJS (backend is type:commonjs). Dependencies are injected so it is
// testable against a hyperdht testnet with two real Hyperswarms.

const BlindPairing = require('blind-pairing')
const b4a = require('b4a')

function safeJSON (buf) {
  try { return JSON.parse(b4a.toString(b4a.from(buf))) } catch { return null }
}

class DeviceLinker {
  /**
   * @param {Hyperswarm} swarm   the worklet's existing Hyperswarm
   * @param {object} opts
   * @param {Identity} opts.identity   the backend Identity (getEntropy / restoreFromMnemonic)
   * @param {function} [opts.onRequest] async (candidateInfo) => boolean — approve a link
   * @param {boolean} [opts.autoAccept] skip approval (tests / trusted flows only)
   * @param {number}  [opts.poll]       blind-pairing poll interval (ms)
   */
  constructor (swarm, { identity, onRequest, autoAccept = false, poll = 5000, log } = {}) {
    if (!swarm) throw new Error('DeviceLinker requires a Hyperswarm')
    if (!identity) throw new Error('DeviceLinker requires an identity')
    this.swarm = swarm
    this.identity = identity
    this.onRequest = typeof onRequest === 'function' ? onRequest : null
    this.autoAccept = !!autoAccept
    this.poll = poll
    this.log = typeof log === 'function' ? log : () => {}
    // BlindPairing attaches to the swarm eagerly, so create it lazily — a linker
    // can be constructed (and its approval gate unit-tested) without a swarm.
    this._bp = null
    this._member = null
    this._candidate = null
  }

  _pairing () {
    if (!this._bp) this._bp = new BlindPairing(this.swarm, { poll: this.poll })
    return this._bp
  }

  // The seed-transfer gate: reveal the root seed ONLY when the source device
  // approves. Fails CLOSED — with no autoAccept and no onRequest callback the
  // answer is false, so a bare linker never leaks the seed.
  async _shouldApprove (info) {
    if (this.autoAccept) return true
    if (this.onRequest) return (await this.onRequest(info)) === true
    return false
  }

  /**
   * SOURCE device — mint a single-use invite. The root entropy is NOT sent when
   * a candidate connects; it is revealed via candidate.confirm() ONLY after the
   * link is approved. Returns { invite (hex), discoveryKey (hex), done }, where
   * `done` resolves once a device has been approved and the seed transferred.
   */
  async createInvite () {
    const entropy = this.identity.getEntropy()
    if (entropy.length !== 32) {
      throw new Error('device linking requires a 32-byte (v2 / 24-word) identity')
    }
    const { invite, publicKey, discoveryKey } = BlindPairing.createInvite(entropy)

    let resolveDone, rejectDone
    const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej })

    this._member = this._pairing().addMember({
      discoveryKey,
      onadd: async (candidate) => {
        try {
          candidate.open(publicKey)
          const info = safeJSON(candidate.userData)
          const approved = await this._shouldApprove(info)
          if (!approved) {
            this.log('[link] request denied for ' + ((info && info.device) || 'device'))
            return
          }
          // reveal the seed to the approved device only
          candidate.confirm({ key: entropy })
          this.log('[link] seed transferred to ' + ((info && info.device) || 'device'))
          resolveDone({ linked: true, device: info })
        } catch (err) { rejectDone(err) }
      }
    })
    await this._member.flushed()
    return {
      invite: b4a.toString(invite, 'hex'),
      discoveryKey: b4a.toString(discoveryKey, 'hex'),
      done
    }
  }

  /**
   * TARGET device — join with an invite, receive the seed, adopt it as the local
   * identity. Returns { mnemonic, restartRequired:true } — the caller MUST
   * restart the worklet so every store re-opens under the linked identity.
   */
  async joinWithInvite (inviteHex, { device = 'new device' } = {}) {
    const invite = b4a.from(inviteHex, 'hex')
    const userData = b4a.from(JSON.stringify({ device }))

    let resolveKey, rejectKey
    const gotKey = new Promise((res, rej) => { resolveKey = res; rejectKey = rej })

    this._candidate = this._pairing().addCandidate({
      invite,
      userData,
      onadd: async (result) => {
        try { resolveKey(result && result.key ? b4a.from(result.key) : null) } catch (err) { rejectKey(err) }
      }
    })
    await this._candidate.pairing
    const entropy = await gotKey
    if (!entropy || entropy.length !== 32) throw new Error('device link failed: no seed received')

    // reconstruct the phrase from the transferred entropy and adopt it. Use
    // bip39-mnemonic directly (Node-testable) rather than identity.js, whose
    // Bare-only deps can't load outside the worklet.
    const mnemonic = require('bip39-mnemonic').entropyToMnemonic(b4a.from(entropy))
    await this.identity.restoreFromMnemonic(mnemonic)
    return { mnemonic, restartRequired: true }
  }

  async close () {
    try { if (this._member && this._member.close) await this._member.close() } catch (_) {}
    try { if (this._candidate && this._candidate.close) await this._candidate.close() } catch (_) {}
    try { if (this._bp && this._bp.close) await this._bp.close() } catch (_) {}
  }
}

module.exports = { DeviceLinker }
