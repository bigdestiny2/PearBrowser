/**
 * RPC Client — React Native side
 *
 * Mirrors the WorkletRPC protocol: length-prefixed JSON messages.
 * Handles both request/reply and push events from the worklet.
 */

import { CMD, EVT } from './constants'

type EventCallback = (data: any) => void
type ConnectionState = 'connected' | 'disconnecting' | 'disconnected'

interface PendingRequest {
  resolve: Function
  reject: Function
  timer: ReturnType<typeof setTimeout>
  msg: any
  retryCount: number
}

export class PearRPC {
  private ipc: any
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private eventListeners = new Map<number, EventCallback[]>()
  private buffer = ''
  private connectionState: ConnectionState = 'connected'
  private eventHandlers = new Map<string, ((data: any) => void)[]>()

  // Retry configuration
  private readonly MAX_RETRIES = 3
  private readonly RETRY_BASE_DELAY = 1000

  constructor(ipc: any) {
    this.ipc = ipc
    ipc.on('data', (data: Uint8Array) => this.onData(data))
    ipc.on('close', () => this.setConnectionState('disconnected'))
    ipc.on('error', (err: any) => {
      console.error('RPC IPC error:', err)
      this.emit('error', { type: 'ipc-error', message: err.message, error: err })
    })
  }

  // --- Connection State ---

  getState(): ConnectionState {
    return this.connectionState
  }

  private setConnectionState(state: ConnectionState) {
    const prevState = this.connectionState
    this.connectionState = state
    this.emit('state-change', { prevState, currentState: state })
  }

  // --- Event Emitter ---

  private emit(event: string, data: any) {
    const handlers = this.eventHandlers.get(event) || []
    for (const handler of handlers) {
      try {
        handler(data)
      } catch (err) {
        console.error(`Error in event handler for '${event}':`, err)
      }
    }
  }

  onEvent(event: string, handler: (data: any) => void): () => void {
    const list = this.eventHandlers.get(event) || []
    list.push(handler)
    this.eventHandlers.set(event, list)
    return () => {
      const idx = list.indexOf(handler)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  // --- Request/Reply ---

  async request(cmd: number, data: any = {}, timeout = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const msg = { id, cmd, data }

      const timer = setTimeout(() => {
        const pendingReq = this.pending.get(id)
        if (pendingReq) {
          this.pending.delete(id)
          reject(new Error(`RPC timeout: cmd ${cmd}`))
        }
      }, timeout)

      this.pending.set(id, { resolve, reject, timer, msg, retryCount: 0 })
      this.send(msg)
    })
  }

  // --- Typed helpers ---

  navigate(url: string) {
    return this.request(CMD.NAVIGATE, { url })
  }

  getStatus() {
    return this.request(CMD.GET_STATUS)
  }

  loadCatalog(keyHex: string) {
    return this.request(CMD.LOAD_CATALOG, { keyHex }, 60000)
  }

  installApp(appInfo: any) {
    return this.request(CMD.INSTALL_APP, appInfo, 120000)
  }

  uninstallApp(id: string) {
    return this.request(CMD.UNINSTALL_APP, { id })
  }

  launchApp(id: string) {
    return this.request(CMD.LAUNCH_APP, { id }, 60000)
  }

  listInstalled() {
    return this.request(CMD.LIST_INSTALLED)
  }

  createSite(name: string) {
    return this.request(CMD.CREATE_SITE, { name })
  }

  updateSite(siteId: string, blocks: any[], theme?: any) {
    return this.request(CMD.UPDATE_SITE, { siteId, blocks, theme })
  }

  publishSite(siteId: string) {
    return this.request(CMD.PUBLISH_SITE, { siteId })
  }

  listSites() {
    return this.request(CMD.LIST_SITES)
  }

  deleteSite(siteId: string) {
    return this.request(CMD.DELETE_SITE, { siteId })
  }

  clearCache() {
    return this.request(CMD.CLEAR_CACHE)
  }

  // --- Events ---

  on(event: number, cb: EventCallback) {
    const list = this.eventListeners.get(event) || []
    list.push(cb)
    this.eventListeners.set(event, list)
    return () => {
      const idx = list.indexOf(cb)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  onReady(cb: (port: number) => void) {
    return this.on(EVT.READY, (data) => cb(data.port))
  }

  onPeerCount(cb: (count: number) => void) {
    return this.on(EVT.PEER_COUNT, (data) => cb(data.peerCount))
  }

  onError(cb: (error: any) => void) {
    return this.on(EVT.ERROR, cb)
  }

  onInstallProgress(cb: (data: { appId: string; progress: number }) => void) {
    return this.on(EVT.INSTALL_PROGRESS, cb)
  }

  onBootProgress(cb: (data: { stage: string; message: string; error?: string }) => void) {
    return this.on(EVT.BOOT_PROGRESS, cb)
  }

  // --- Wire protocol ---

  private send(msg: any, retryCount = 0) {
    try {
      if (this.connectionState === 'disconnected') {
        throw new Error('IPC connection is disconnected')
      }

      const json = JSON.stringify(msg)
      const header = json.length.toString(16).padStart(8, '0')
      const fullStr = header + json
      
      // Use plain Uint8Array for native bridge compatibility (Hermes)
      const buf = new Uint8Array(fullStr.length)
      for (let i = 0; i < fullStr.length; i++) {
        buf[i] = fullStr.charCodeAt(i)
      }
      this.ipc.write(buf)
    } catch (err: any) {
      console.error('RPC send failed:', err)

      // Retry logic with exponential backoff
      if (retryCount < this.MAX_RETRIES) {
        const delay = this.RETRY_BASE_DELAY * Math.pow(2, retryCount)
        console.log(`Retrying send in ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRIES})...`)

        setTimeout(() => {
          this.send(msg, retryCount + 1)
        }, delay)
        return
      }

      // Max retries reached, emit error and reject pending request
      this.emit('error', { type: 'send-failed', message: err.message, msg, retries: retryCount })

      // If this was a request with a pending promise, reject it
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(msg.id)
          pending.reject(new Error(`RPC send failed after ${retryCount} retries: ${err.message}`))
        }
      }
    }
  }

  private onData(chunk: Uint8Array) {
    // Convert Uint8Array to string without b4a for Hermes compatibility
    let str = ''
    for (let i = 0; i < chunk.length; i++) {
      str += String.fromCharCode(chunk[i])
    }
    this.buffer += str

    // Prevent buffer from growing unbounded - only clear corrupted portion
    if (this.buffer.length > 20_000_000) {
      console.error('RPC buffer overflow: buffer exceeds 20MB, clearing corrupted portion')
      this.emit('error', { type: 'buffer-overflow', message: 'Buffer exceeded 20MB limit' })

      // Try to find and preserve valid messages at the end
      // Look for a valid length prefix (8 hex digits) followed by data
      let preserved = ''
      for (let i = Math.max(0, this.buffer.length - 10_000_000); i < this.buffer.length; i++) {
        if (i + 8 <= this.buffer.length) {
          const lenHex = this.buffer.slice(i, i + 8)
          const len = parseInt(lenHex, 16)
          if (!isNaN(len) && len > 0 && len <= 10_000_000) {
            if (this.buffer.length >= i + 8 + len) {
              // Found a complete message, preserve from here
              preserved = this.buffer.slice(i)
              break
            }
          }
        }
      }

      this.buffer = preserved
      if (!preserved) {
        return
      }
    }

    while (this.buffer.length >= 8) {
      const lenHex = this.buffer.slice(0, 8)
      const len = parseInt(lenHex, 16)
      if (isNaN(len) || len <= 0 || len > 10_000_000) {
        console.error('RPC protocol error: invalid message length', { lenHex, len })
        this.emit('error', { type: 'protocol-error', message: `Invalid message length: ${len}` })

        // Only clear the corrupted portion, not entire buffer
        // Try to find the next valid length prefix
        let nextValid = -1
        for (let i = 2; i < Math.min(this.buffer.length, 100); i += 2) {
          const tryHex = this.buffer.slice(i, i + 8)
          const tryLen = parseInt(tryHex, 16)
          if (!isNaN(tryLen) && tryLen > 0 && tryLen <= 10_000_000) {
            nextValid = i
            break
          }
        }

        if (nextValid > 0) {
          console.log(`Attempting recovery: discarding ${nextValid} bytes and continuing`)
          this.buffer = this.buffer.slice(nextValid)
          continue
        } else {
          this.buffer = ''
          return
        }
      }
      if (this.buffer.length < 8 + len) break

      const json = this.buffer.slice(8, 8 + len)
      this.buffer = this.buffer.slice(8 + len)

      try {
        const msg = JSON.parse(json)
        this.processMessage(msg)
      } catch (err: any) {
        console.error('RPC JSON parse error:', err, 'JSON:', json.substring(0, 200))
        this.emit('error', { type: 'json-parse-error', message: err.message, json: json.substring(0, 500) })
      }
    }
  }

  private processMessage(msg: any) {
    // Reply to our request
    if (msg.id && (msg.result !== undefined || msg.error)) {
      const pending = this.pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(new Error(msg.error))
        else pending.resolve(msg.result)
      }
      return
    }

    // Push event from worklet
    if (msg.event !== undefined) {
      const listeners = this.eventListeners.get(msg.event) || []
      for (const cb of listeners) {
        try {
          cb(msg.data)
        } catch (err) {
          console.error('Error in event listener:', err)
        }
      }
    }
  }

  // --- Cleanup ---

  close() {
    this.setConnectionState('disconnecting')

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('RPC connection closed'))
    }
    this.pending.clear()

    this.eventListeners.clear()
    this.eventHandlers.clear()
    this.buffer = ''

    if (this.ipc && typeof this.ipc.end === 'function') {
      this.ipc.end()
    }

    this.setConnectionState('disconnected')
  }
}
