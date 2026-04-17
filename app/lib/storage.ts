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

// --- AsyncStorage backend (default) ---

class AsyncStorageBackend implements StorageBackend {
  readonly name = 'AsyncStorage'

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
  const settings = await getSettings()
  const updated = { ...settings, ...updates }
  await backend.write(KEYS.SETTINGS, updated)
  return updated
}

// --- Tabs ---

export async function getTabs(): Promise<Tab[]> {
  return (await backend.read<Tab[]>(KEYS.TABS)) ?? []
}

export async function saveTabs(tabs: Tab[]): Promise<void> {
  await backend.write(KEYS.TABS, tabs)
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

export async function getSession(): Promise<SessionState> {
  const raw = await backend.read<SessionState>(KEYS.SESSION)
  return raw ? { ...DEFAULT_SESSION, ...raw } : DEFAULT_SESSION
}

export async function saveSession(state: Partial<SessionState>): Promise<void> {
  const current = await getSession()
  const next = { ...current, ...state }
  try {
    await backend.write(KEYS.SESSION, next)
  } catch (err) {
    console.warn('[storage] saveSession failed:', err)
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
