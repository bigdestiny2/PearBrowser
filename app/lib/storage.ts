/**
 * Persistent storage for bookmarks, history, settings, tabs, and session state.
 *
 * This module exposes a swappable `Storage` interface. The default backend
 * is `AsyncStorageBackend` (device-local, survives restarts). Phase 1 of the
 * Holepunch alignment plan will introduce `HyperbeeBackend` which syncs the
 * same data across the user's devices via a user-scoped Hyperbee — callers
 * of this module won't need to change, they'll just start seeing synced data.
 *
 * See: docs/HOLEPUNCH_ALIGNMENT_PLAN.md (Phase 0 ticket 1 + Phase 1 ticket 2)
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

// --- Types ---

export type Bookmark = {
  url: string
  title: string
  addedAt: number
}

export type HistoryEntry = {
  url: string
  title: string
  visitedAt: number
}

export type Tab = {
  id: string
  url: string
  title: string
}

export type Settings = {
  catalogUrl: string
  catalogList: string[]
  theme: 'dark' | 'light'
  defaultTab: 'home' | 'store' | 'browse' | 'more'
  privateMode: boolean
}

export type SessionState = {
  activeTab: 'home' | 'explore' | 'browse' | 'more'
  lastBrowseUrl: string | null
  browserTabs?: Tab[]
  activeBrowserTabId?: string | null
}

// --- Storage backend interface ---
// Any backend must implement read/write for these primitive keys. Each
// higher-level API (getBookmarks, addBookmark, etc.) is built on top.

export interface StorageBackend {
  /** Read a JSON value by key. Returns null if not found or parse fails. */
  read<T>(key: string): Promise<T | null>

  /** Write a JSON value. */
  write<T>(key: string, value: T): Promise<void>

  /** Remove a set of keys. */
  remove(keys: string[]): Promise<void>

  /** Human name for diagnostics. */
  readonly name: string
}

const KEYS = {
  BOOKMARKS: 'pearbrowser_bookmarks',
  HISTORY: 'pearbrowser_history',
  SETTINGS: 'pearbrowser_settings',
  TABS: 'pearbrowser_tabs',
  SESSION: 'pearbrowser_session',
} as const

const ALL_KEYS: string[] = Object.values(KEYS)

const MAX_HISTORY = 200

// --- Hyperbee backend (Phase 1 ticket 2) ---
// Talks to the worklet's UserData module via RPC. All reads/writes go
// through the Hyperbee living inside the user's Corestore, so data
// replicates automatically across all devices sharing the user's
// identity seed.

type MinimalRpc = {
  userDataListBookmarks(): Promise<{ bookmarks: Bookmark[] }>
  userDataAddBookmark(url: string, title: string): Promise<unknown>
  userDataRemoveBookmark(url: string): Promise<unknown>
  userDataListHistory(limit?: number): Promise<{ history: HistoryEntry[] }>
  userDataAddHistory(url: string, title: string): Promise<unknown>
  userDataClearHistory(): Promise<unknown>
  userDataGetSettings(): Promise<{ settings: Record<string, unknown> }>
  userDataSetSettings(updates: Record<string, unknown>): Promise<unknown>
  userDataGetSession(): Promise<{ session: Record<string, unknown> | null }>
  userDataSaveSession(state: Record<string, unknown>): Promise<unknown>
  userDataImport(dump: Record<string, unknown>): Promise<unknown>
}

export class HyperbeeBackend implements StorageBackend {
  readonly name = 'Hyperbee'
  constructor (private rpc: MinimalRpc) {}

  async privateModeForSession(): Promise<boolean> {
    // Session privacy cannot use read(), which deliberately masks RPC errors.
    const { settings } = await this.rpc.userDataGetSettings()
    if (!settings || typeof settings !== 'object') throw new Error('Privacy settings unavailable')
    return settings.privateMode === true
  }

  async readSessionStrict(): Promise<SessionState | null> {
    const result = await this.rpc.userDataGetSession()
    if (!result || !('session' in result)) throw new Error('Session unavailable')
    return result.session as SessionState | null
  }

  async clearLegacyTabs(): Promise<void> {
    // Older releases used the separate Hyperbee tabs/current record. Current
    // browserTabs live in session/current, but the old URLs still replicate.
    await this.rpc.userDataImport({ tabs: [] })
  }

  async readSettingsStrict(): Promise<Settings | null> {
    const result = await this.rpc.userDataGetSettings()
    if (!result || !result.settings || typeof result.settings !== 'object') {
      throw new Error('Privacy settings unavailable')
    }
    return Object.keys(result.settings).length > 0 ? result.settings as Settings : null
  }

  async read<T>(key: string): Promise<T | null> {
    try {
      switch (key) {
        case KEYS.BOOKMARKS: {
          const { bookmarks } = await this.rpc.userDataListBookmarks()
          return (bookmarks as unknown) as T
        }
        case KEYS.HISTORY: {
          const { history } = await this.rpc.userDataListHistory(MAX_HISTORY)
          return (history as unknown) as T
        }
        case KEYS.SETTINGS: {
          const { settings } = await this.rpc.userDataGetSettings()
          // Settings object keys are the full Settings shape
          return Object.keys(settings).length > 0 ? (settings as unknown) as T : null
        }
        case KEYS.SESSION: {
          const { session } = await this.rpc.userDataGetSession()
          return (session as unknown as T) ?? null
        }
        case KEYS.TABS: {
          const { session } = await this.rpc.userDataGetSession()
          return Array.isArray(session?.browserTabs) ? (session.browserTabs as T) : null
        }
        default:
          return null
      }
    } catch (err) {
      console.warn(`[storage:${this.name}] read(${key}) failed:`, err)
      return null
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    switch (key) {
      case KEYS.BOOKMARKS: {
        // Incremental write: diff against existing list (this method is
        // called with the whole bookmarks array). We treat it as source
        // of truth and sync minimal changes.
        const next = (value as unknown) as Bookmark[]
        const { bookmarks: current } = await this.rpc.userDataListBookmarks()
        const currentSet = new Set(current.map((b) => b.url))
        const nextSet = new Set(next.map((b) => b.url))
        // Remove ones no longer in list
        for (const b of current) {
          if (!nextSet.has(b.url)) await this.rpc.userDataRemoveBookmark(b.url)
        }
        // Add new ones
        for (const b of next) {
          if (!currentSet.has(b.url)) await this.rpc.userDataAddBookmark(b.url, b.title)
        }
        return
      }
      case KEYS.HISTORY: {
        const list = (value as unknown) as HistoryEntry[]
        // Most callers call addToHistory() → write(KEYS.HISTORY, filtered).
        // We take the newest entry (head of the list) as the one to add.
        if (list.length > 0) {
          const head = list[0]
          await this.rpc.userDataAddHistory(head.url, head.title)
        } else {
          // Empty list == clear
          await this.rpc.userDataClearHistory()
        }
        return
      }
      case KEYS.SETTINGS:
        await this.rpc.userDataSetSettings((value as unknown) as Record<string, unknown>)
        return
      case KEYS.SESSION:
        await this.rpc.userDataSaveSession((value as unknown) as Record<string, unknown>)
        return
      case KEYS.TABS: {
        const { session } = await this.rpc.userDataGetSession()
        await this.rpc.userDataSaveSession({
          ...(session || {}),
          browserTabs: value,
        })
        return
      }
      default:
        return
    }
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.includes(KEYS.HISTORY)) await this.rpc.userDataClearHistory()
    if (keys.includes(KEYS.SETTINGS)) await this.rpc.userDataSetSettings({})
    if (keys.includes(KEYS.BOOKMARKS)) {
      const { bookmarks } = await this.rpc.userDataListBookmarks()
      for (const b of bookmarks) await this.rpc.userDataRemoveBookmark(b.url)
    }
    // Session and Tabs intentionally left
  }
}

// --- AsyncStorage backend (default) ---

class AsyncStorageBackend implements StorageBackend {
  readonly name = 'AsyncStorage'

  async privateModeForSession(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS)
    if (!raw) return false
    const settings = JSON.parse(raw)
    if (!settings || typeof settings !== 'object') throw new Error('Privacy settings unavailable')
    return settings.privateMode === true
  }

  async readSessionStrict(): Promise<SessionState | null> {
    const raw = await AsyncStorage.getItem(KEYS.SESSION)
    return raw ? JSON.parse(raw) as SessionState : null
  }

  async readSettingsStrict(): Promise<Settings | null> {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS)
    return raw ? JSON.parse(raw) as Settings : null
  }

  async read<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch (err) {
      console.warn(`[storage:${this.name}] read(${key}) failed:`, err)
      return null
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value))
    } catch (err) {
      console.warn(`[storage:${this.name}] write(${key}) failed:`, err)
      throw err
    }
  }

  async remove(keys: string[]): Promise<void> {
    try {
      await AsyncStorage.multiRemove(keys)
    } catch (err) {
      console.warn(`[storage:${this.name}] remove failed:`, err)
      throw err
    }
  }
}

// --- Active backend (swappable) ---

let backend: StorageBackend = new AsyncStorageBackend()

/**
 * Swap the active storage backend. Phase 1 will call this after the worklet
 * boots to switch over to a Hyperbee-backed implementation. Existing callers
 * of the higher-level functions below don't need to change.
 */
export function setStorageBackend(b: StorageBackend): void {
  console.log(`[storage] backend → ${b.name}`)
  backend = b
}

export function getStorageBackend(): StorageBackend {
  return backend
}

async function privateModeForSession(): Promise<boolean> {
  if (backend instanceof HyperbeeBackend || backend instanceof AsyncStorageBackend) {
    return backend.privateModeForSession()
  }
  // Unknown storage implementations cannot prove that Private Mode is off.
  throw new Error('Privacy settings unavailable for the active storage backend')
}

async function readSessionStrict(): Promise<SessionState | null> {
  if (backend instanceof HyperbeeBackend || backend instanceof AsyncStorageBackend) {
    return backend.readSessionStrict()
  }
  throw new Error('Session unavailable for the active storage backend')
}

async function readSettingsStrict(): Promise<Settings> {
  if (backend instanceof HyperbeeBackend || backend instanceof AsyncStorageBackend) {
    const raw = await backend.readSettingsStrict()
    return raw ? { ...DEFAULT_SETTINGS, ...raw } : DEFAULT_SETTINGS
  }
  throw new Error('Privacy settings unavailable for the active storage backend')
}

// --- Bookmarks ---

export async function getBookmarks(): Promise<Bookmark[]> {
  return (await backend.read<Bookmark[]>(KEYS.BOOKMARKS)) ?? []
}

export async function addBookmark(url: string, title: string): Promise<Bookmark[]> {
  const bookmarks = await getBookmarks()
  if (bookmarks.some(b => b.url === url)) return bookmarks
  bookmarks.unshift({ url, title, addedAt: Date.now() })
  await backend.write(KEYS.BOOKMARKS, bookmarks)
  return bookmarks
}

export async function removeBookmark(url: string): Promise<Bookmark[]> {
  const bookmarks = (await getBookmarks()).filter(b => b.url !== url)
  await backend.write(KEYS.BOOKMARKS, bookmarks)
  return bookmarks
}

// --- History ---

export async function getHistory(): Promise<HistoryEntry[]> {
  return (await backend.read<HistoryEntry[]>(KEYS.HISTORY)) ?? []
}

export async function addToHistory(url: string, title: string): Promise<void> {
  const history = await getHistory()
  const filtered = history.filter(h => h.url !== url)
  filtered.unshift({ url, title, visitedAt: Date.now() })
  if (filtered.length > MAX_HISTORY) filtered.length = MAX_HISTORY
  await backend.write(KEYS.HISTORY, filtered)
}

export async function clearHistory(): Promise<void> {
  await backend.write(KEYS.HISTORY, [])
}

// --- Settings ---

const DEFAULT_SETTINGS: Settings = {
  catalogUrl: 'https://relay-us.p2phiverelay.xyz',
  catalogList: ['https://relay-us.p2phiverelay.xyz', 'https://relay-sg.p2phiverelay.xyz'],
  theme: 'dark',
  defaultTab: 'home',
  privateMode: false,
}

export async function getSettings(): Promise<Settings> {
  const raw = await backend.read<Settings>(KEYS.SETTINGS)
  return raw ? { ...DEFAULT_SETTINGS, ...raw } : DEFAULT_SETTINGS
}

export async function updateSettings(updates: Partial<Settings>): Promise<Settings> {
  const settings = await readSettingsStrict()
  const updated = { ...settings, ...updates }
  if (updates.privateMode !== undefined && updates.privateMode !== settings.privateMode) {
    // Serialize the transition with browser session writes. Scrub the shared
    // session before committing the new mode, then let later writes recheck
    // the committed privacy setting.
    await enqueueSessionWrite(async () => {
      await scrubBrowserSessionDirect()
      if (backend instanceof HyperbeeBackend) {
        // If the worklet falls back to device storage later, it must not
        // restore old URLs or treat a private shared profile as normal.
        const local = new AsyncStorageBackend()
        await local.write(KEYS.SESSION, PRIVATE_SESSION)
        await local.write(KEYS.TABS, [])
        if (updates.privateMode === true) {
          const localSettings = await local.readSettingsStrict()
          await local.write(KEYS.SETTINGS, { ...DEFAULT_SETTINGS, ...localSettings, privateMode: true })
        }
      }
      await backend.write(KEYS.SETTINGS, updated)
      if (backend instanceof HyperbeeBackend && updates.privateMode === false) {
        // A failed local write here leaves the fallback conservatively private.
        try {
          const local = new AsyncStorageBackend()
          const localSettings = await local.readSettingsStrict()
          await local.write(KEYS.SETTINGS, { ...DEFAULT_SETTINGS, ...localSettings, privateMode: false })
        } catch (err) {
          console.warn('[storage] local fallback settings update failed:', err)
        }
      }
    })
  } else {
    await backend.write(KEYS.SETTINGS, updated)
  }
  return updated
}

// --- Tabs ---

export async function getTabs(): Promise<Tab[]> {
  const session = await getSession()
  return Array.isArray(session.browserTabs)
    ? session.browserTabs
    : (await backend.read<Tab[]>(KEYS.TABS)) ?? []
}

export async function saveTabs(tabs: Tab[]): Promise<void> {
  await enqueueSessionWrite(async () => {
    const privateMode = await privateModeForSession()
    const safeTabs = privateMode ? [] : tabs
    const current = privateMode ? PRIVATE_SESSION : await getSession()
    await backend.write(KEYS.SESSION, { ...current, browserTabs: safeTabs })
    if (backend.name === 'AsyncStorage') await backend.write(KEYS.TABS, safeTabs)
  })
}

// --- Catalog list (multiple Explore directories) ---

export async function addCatalog(url: string): Promise<Settings> {
  const settings = await getSettings()
  const clean = url.trim()
  if (!clean) return settings
  const normalized = clean.replace(/\/+$/, '')
  if (settings.catalogList.includes(normalized)) return settings
  const next = [...settings.catalogList, normalized]
  return updateSettings({ catalogList: next })
}

export async function removeCatalog(url: string): Promise<Settings> {
  const settings = await getSettings()
  const next = settings.catalogList.filter(u => u !== url)
  const finalList = next.length > 0 ? next : DEFAULT_SETTINGS.catalogList
  const updates: Partial<Settings> = { catalogList: finalList }
  if (settings.catalogUrl === url) updates.catalogUrl = finalList[0]
  return updateSettings(updates)
}

// --- Session state (survives restart) ---

const DEFAULT_SESSION: SessionState = {
  activeTab: 'home',
  lastBrowseUrl: null,
}

const PRIVATE_SESSION: SessionState = {
  activeTab: 'home',
  lastBrowseUrl: null,
  browserTabs: [],
  activeBrowserTabId: null,
}

async function scrubBrowserSessionDirect(): Promise<void> {
  await backend.write(KEYS.SESSION, PRIVATE_SESSION)
  if (backend instanceof HyperbeeBackend) await backend.clearLegacyTabs()
  if (backend.name === 'AsyncStorage') await backend.write(KEYS.TABS, [])
}

export function scrubBrowserSession(): Promise<void> {
  return enqueueSessionWrite(scrubBrowserSessionDirect)
}

export async function getSession(): Promise<SessionState> {
  if (await privateModeForSession()) return { ...PRIVATE_SESSION, browserTabs: [] }
  const raw = await readSessionStrict()
  return raw ? { ...DEFAULT_SESSION, ...raw } : DEFAULT_SESSION
}

let sessionWriteQueue: Promise<void> = Promise.resolve()

function enqueueSessionWrite<T>(task: () => Promise<T>): Promise<T> {
  const write = sessionWriteQueue.then(task)
  sessionWriteQueue = write.then(() => undefined, () => undefined)
  return write
}

export function getPrivateModeStrict(): Promise<boolean> {
  // Serialize observations with this shell's settings transitions so a late
  // reply cannot undo a just-completed Private Mode toggle.
  return enqueueSessionWrite(() => privateModeForSession())
}

export async function saveSession(state: Partial<SessionState>): Promise<void> {
  try {
    await enqueueSessionWrite(async () => {
      const privateMode = await privateModeForSession()
      const current = privateMode ? PRIVATE_SESSION : await getSession()
      await backend.write(KEYS.SESSION, privateMode
        ? { ...PRIVATE_SESSION, browserTabs: [] }
        : { ...current, ...state })
    })
  } catch (err) {
    console.warn('[storage] saveSession failed:', err)
    throw err
  }
}

// --- Clear all ---

export async function clearAllData(): Promise<void> {
  await backend.remove(ALL_KEYS)
}

// Exports for Phase 1 migration (copy data from one backend to another)

export async function exportAll(from: StorageBackend): Promise<Record<string, unknown>> {
  const dump: Record<string, unknown> = {}
  for (const key of ALL_KEYS) {
    dump[key] = await from.read(key)
  }
  return dump
}

export async function importAll(to: StorageBackend, dump: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(dump)) {
    if (value !== null && value !== undefined) {
      await to.write(key, value)
    }
  }
}

export { KEYS, AsyncStorageBackend }

// --- Bootstrap helper for the Phase 1 migration ---
//
// Call this once after the worklet reports READY. If there's AsyncStorage
// data from a previous version, we copy it into the Hyperbee (one-time
// migration) and then swap the active backend so all future reads/writes
// go through the worklet. If the worklet never becomes available (demo
// mode, boot failure) we stay on AsyncStorage transparently.

const MIGRATION_FLAG_KEY = 'pearbrowser_hyperbee_migration_v1'

export async function bootstrapHyperbeeStorage (rpc: MinimalRpc): Promise<{
  migrated: boolean
  reason?: string
}> {
  const local = new AsyncStorageBackend()
  const remote = new HyperbeeBackend(rpc)

  try {
    const marker = await local.read<{ at: number }>(MIGRATION_FLAG_KEY)
    if (!marker) {
      // First run of the Hyperbee backend — copy local → Hyperbee
      const dump: Record<string, unknown> = {}
      const bookmarks = await local.read<Bookmark[]>(KEYS.BOOKMARKS)
      const history = await local.read<HistoryEntry[]>(KEYS.HISTORY)
      const settings = await local.read<Settings>(KEYS.SETTINGS)
      const session = await local.read<SessionState>(KEYS.SESSION)
      const tabs = await local.read<Tab[]>(KEYS.TABS)
      if (bookmarks) dump.bookmarks = bookmarks
      if (history) dump.history = history
      // A native shell may already own this user's settings and session.
      const { session: existingSession } = await rpc.userDataGetSession()
      const { settings: remoteSettings } = await rpc.userDataGetSettings()
      const remoteHasSettings = !!remoteSettings && Object.keys(remoteSettings).length > 0
      const privateMode = !!settings?.privateMode || !!remoteSettings?.privateMode
      if (privateMode) {
        // Clear both the current session and the separate tabs/current record
        // used by older releases before a local private choice is committed.
        await local.write(KEYS.SESSION, PRIVATE_SESSION)
        await local.write(KEYS.TABS, [])
        if (remoteSettings?.privateMode === true) {
          await local.write(KEYS.SETTINGS, { ...DEFAULT_SETTINGS, ...settings, privateMode: true })
        }
        await rpc.userDataSaveSession(PRIVATE_SESSION)
        await rpc.userDataImport({ tabs: [] })
      }
      if (settings && !remoteHasSettings) dump.settings = settings
      if (settings?.privateMode && remoteHasSettings && !remoteSettings.privateMode) {
        // Preserve unrelated native settings while keeping the conservative
        // privacy choice when the older RN profile was private.
        await rpc.userDataSetSettings({ privateMode: true })
      }
      if (!privateMode && !existingSession && (session || tabs)) {
        dump.session = tabs && !Array.isArray(session?.browserTabs)
          ? { ...(session || DEFAULT_SESSION), browserTabs: tabs }
          : session
      }
      // browserTabs is now the only tab store; do not seed tabs/current again.
      if (Object.keys(dump).length > 0) {
        await rpc.userDataImport(dump)
        console.log('[storage] migrated AsyncStorage → Hyperbee:', Object.keys(dump).join(', '))
      }
      await local.write(MIGRATION_FLAG_KEY, { at: Date.now() })
    } else {
      // Existing profiles may predate the privacy scrub. Repeat the small
      // cleanup on private startup because tabs/current has no read RPC.
      const { settings: remoteSettings } = await rpc.userDataGetSettings()
      if (remoteSettings?.privateMode === true) {
        await local.write(KEYS.SESSION, PRIVATE_SESSION)
        await local.write(KEYS.TABS, [])
        const localSettings = await local.readSettingsStrict()
        await local.write(KEYS.SETTINGS, { ...DEFAULT_SETTINGS, ...localSettings, privateMode: true })
        await rpc.userDataSaveSession(PRIVATE_SESSION)
        await rpc.userDataImport({ tabs: [] })
      }
    }
    setStorageBackend(remote)
    return { migrated: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[storage] Hyperbee bootstrap failed, staying on AsyncStorage:', msg)
    return { migrated: false, reason: msg }
  }
}
