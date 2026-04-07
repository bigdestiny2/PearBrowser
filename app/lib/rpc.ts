/**
 * RPC Client — React Native side
 *
 * Mirrors the WorkletRPC protocol: length-prefixed JSON messages.
 * Handles both request/reply and push events from the worklet.
 */

import b4a from 'b4a'
import { CMD, EVT } from './constants'

type EventCallback = (data: any) => void

export class PearRPC {
  private ipc: any
  private nextId = 1
  private pending = new Map<number, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }>()
  private eventListeners = new Map<number, EventCallback[]>()
  private buffer = ''

  constructor(ipc: any) {
    this.ipc = ipc
    ipc.on('data', (data: Uint8Array) => this.onData(data))
  }

  // --- Request/Reply ---

  async request(cmd: number, data: any = {}, timeout = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: cmd ${cmd}`))
      }, timeout)

      this.pending.set(id, { resolve, reject, timer })
      this.send({ id, cmd, data })
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

  // --- Wire protocol ---

  private send(msg: any) {
    try {
      const json = JSON.stringify(msg)
      const buf = b4a.from(json.length.toString(16).padStart(8, '0') + json)
      this.ipc.write(buf)
    } catch {}
  }

  private onData(chunk: Uint8Array) {
    this.buffer += b4a.toString(chunk)

    if (this.buffer.length > 20_000_000) {
      this.buffer = ''
      return
    }

    while (this.buffer.length >= 8) {
      const lenHex = this.buffer.slice(0, 8)
      const len = parseInt(lenHex, 16)
      if (isNaN(len) || len <= 0 || len > 10_000_000) {
        this.buffer = ''
        return
      }
      if (this.buffer.length < 8 + len) break

      const json = this.buffer.slice(8, 8 + len)
      this.buffer = this.buffer.slice(8 + len)

      try {
        const msg = JSON.parse(json)
        this.processMessage(msg)
      } catch {}
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
      for (const cb of listeners) cb(msg.data)
    }
  }
}
