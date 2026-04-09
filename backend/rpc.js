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
    this._pending = new Map() // id → { resolve, reject, timer, msg, retryCount }
    this._handlers = new Map() // cmd → handler fn
    this._buffer = ''
    this._connectionState = 'connected'
    this._eventHandlers = new Map()

    // Retry configuration
    this._MAX_RETRIES = 3
    this._RETRY_BASE_DELAY = 1000

    ipc.on('data', (data) => this._onData(data))
    ipc.on('close', () => this._setConnectionState('disconnected'))
    ipc.on('error', (err) => {
      console.error('RPC IPC error:', err)
      this.emit('error', { type: 'ipc-error', message: err.message, error: err })
    })
  }

  /**
   * Get current connection state
   */
  getState () {
    return this._connectionState
  }

  /**
   * Set connection state and emit event
   */
  _setConnectionState (state) {
    const prevState = this._connectionState
    this._connectionState = state
    this.emit('state-change', { prevState, currentState: state })
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
      const msg = { id, cmd, data }

      const timer = setTimeout(() => {
        const pendingReq = this._pending.get(id)
        if (pendingReq) {
          this._pending.delete(id)
          reject(new Error(`RPC timeout: cmd ${cmd}`))
        }
      }, timeout)

      this._pending.set(id, { resolve, reject, timer, msg, retryCount: 0 })
      this._send(msg)
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

  _send (msg, retryCount = 0) {
    try {
      if (this._connectionState === 'disconnected') {
        throw new Error('IPC connection is disconnected')
      }

      const json = JSON.stringify(msg)
      const buf = Buffer.from(json.length.toString(16).padStart(8, '0') + json)
      this._ipc.write(buf)
    } catch (err) {
      console.error('RPC send failed:', err)

      // Retry logic with exponential backoff
      if (retryCount < this._MAX_RETRIES) {
        const delay = this._RETRY_BASE_DELAY * Math.pow(2, retryCount)
        console.log(`Retrying send in ${delay}ms (attempt ${retryCount + 1}/${this._MAX_RETRIES})...`)

        setTimeout(() => {
          this._send(msg, retryCount + 1)
        }, delay)
        return
      }

      // Max retries reached, emit error
      this.emit('error', { type: 'send-failed', message: err.message, msg, retries: retryCount })

      // If this was a request with a pending promise, reject it
      if (msg.id && this._pending.has(msg.id)) {
        const pending = this._pending.get(msg.id)
        if (pending) {
          clearTimeout(pending.timer)
          this._pending.delete(msg.id)
          pending.reject(new Error(`RPC send failed after ${retryCount} retries: ${err.message}`))
        }
      }
    }
  }

  _onData (chunk) {
    this._buffer += chunk.toString()

    // Prevent buffer from growing unbounded - only clear corrupted portion
    if (this._buffer.length > 20_000_000) {
      console.error('RPC buffer overflow: buffer exceeds 20MB, clearing corrupted portion')
      this.emit('error', { type: 'buffer-overflow', message: 'Buffer exceeded 20MB limit' })

      // Try to find and preserve valid messages at the end
      // Look for a valid length prefix (8 hex digits) followed by data
      let preserved = ''
      for (let i = Math.max(0, this._buffer.length - 10_000_000); i < this._buffer.length; i++) {
        if (i + 8 <= this._buffer.length) {
          const lenHex = this._buffer.slice(i, i + 8)
          const len = parseInt(lenHex, 16)
          if (!isNaN(len) && len > 0 && len <= 10_000_000) {
            if (this._buffer.length >= i + 8 + len) {
              // Found a complete message, preserve from here
              preserved = this._buffer.slice(i)
              break
            }
          }
        }
      }

      this._buffer = preserved
      if (!preserved) {
        return
      }
    }

    while (this._buffer.length >= 8) {
      const lenHex = this._buffer.slice(0, 8)
      const len = parseInt(lenHex, 16)
      if (isNaN(len) || len <= 0 || len > 10_000_000) {
        console.error('RPC protocol error: invalid message length', { lenHex, len })
        this.emit('error', { type: 'protocol-error', message: `Invalid message length: ${len}` })

        // Only clear the corrupted portion, not entire buffer
        // Try to find the next valid length prefix
        let nextValid = -1
        for (let i = 2; i < Math.min(this._buffer.length, 100); i += 2) {
          const tryHex = this._buffer.slice(i, i + 8)
          const tryLen = parseInt(tryHex, 16)
          if (!isNaN(tryLen) && tryLen > 0 && tryLen <= 10_000_000) {
            nextValid = i
            break
          }
        }

        if (nextValid > 0) {
          console.log(`Attempting recovery: discarding ${nextValid} bytes and continuing`)
          this._buffer = this._buffer.slice(nextValid)
          continue
        } else {
          this._buffer = ''
          return
        }
      }

      if (this._buffer.length < 8 + len) break // Incomplete message

      const json = this._buffer.slice(8, 8 + len)
      this._buffer = this._buffer.slice(8 + len)

      let msg
      try {
        msg = JSON.parse(json)
      } catch (err) {
        console.error('RPC JSON parse error:', err, 'JSON:', json.substring(0, 200))
        this.emit('error', { type: 'json-parse-error', message: err.message, json: json.substring(0, 500) })
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

  /**
   * Close the connection and cleanup
   */
  close () {
    this._setConnectionState('disconnecting')

    // Reject all pending requests
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('RPC connection closed'))
    }
    this._pending.clear()

    this._handlers.clear()
    this._eventHandlers.clear()
    this._buffer = ''

    if (this._ipc && typeof this._ipc.end === 'function') {
      this._ipc.end()
    }

    this._setConnectionState('disconnected')
  }
}

module.exports = { WorkletRPC }
