/**
 * Persistent storage for bookmarks, history, settings, and tabs.
 * Uses AsyncStorage (survives app restarts).
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

const KEYS = {
  BOOKMARKS: 'pearbrowser_bookmarks',
  HISTORY: 'pearbrowser_history',
  SETTINGS: 'pearbrowser_settings',
  TABS: 'pearbrowser_tabs',
  SESSION: 'pearbrowser_session',
}

const MAX_HISTORY = 200

// --- Bookmarks ---

export async function getBookmarks(): Promise<Bookmark[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.BOOKMARKS)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export async function addBookmark(url: string, title: string): Promise<Bookmark[]> {
  const bookmarks = await getBookmarks()
  // Don't duplicate
  if (bookmarks.some(b => b.url === url)) return bookmarks
  bookmarks.unshift({ url, title, addedAt: Date.now() })
  await AsyncStorage.setItem(KEYS.BOOKMARKS, JSON.stringify(bookmarks))
  return bookmarks
}

export async function removeBookmark(url: string): Promise<Bookmark[]> {
  let bookmarks = await getBookmarks()
  bookmarks = bookmarks.filter(b => b.url !== url)
  await AsyncStorage.setItem(KEYS.BOOKMARKS, JSON.stringify(bookmarks))
  return bookmarks
}

// --- History ---

export async function getHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.HISTORY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export async function addToHistory(url: string, title: string): Promise<void> {
  const history = await getHistory()
  // Remove duplicate if exists
  const filtered = history.filter(h => h.url !== url)
  filtered.unshift({ url, title, visitedAt: Date.now() })
  // Cap at MAX_HISTORY
  if (filtered.length > MAX_HISTORY) filtered.length = MAX_HISTORY
  await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify(filtered))
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify([]))
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
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch { return DEFAULT_SETTINGS }
}

export async function updateSettings(updates: Partial<Settings>): Promise<Settings> {
  const settings = await getSettings()
  const updated = { ...settings, ...updates }
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(updated))
  return updated
}

// --- Tabs ---

export async function getTabs(): Promise<Tab[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.TABS)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export async function saveTabs(tabs: Tab[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.TABS, JSON.stringify(tabs))
}

// --- Catalog list (multiple Explore directories) ---

export async function addCatalog(url: string): Promise<Settings> {
  const settings = await getSettings()
  const clean = url.trim()
  if (!clean) return settings
  // Normalize (strip trailing slash)
  const normalized = clean.replace(/\/+$/, '')
  // De-dupe
  if (settings.catalogList.includes(normalized)) return settings
  const next = [...settings.catalogList, normalized]
  return updateSettings({ catalogList: next })
}

export async function removeCatalog(url: string): Promise<Settings> {
  const settings = await getSettings()
  const next = settings.catalogList.filter(u => u !== url)
  // Ensure at least one catalog remains
  const finalList = next.length > 0 ? next : DEFAULT_SETTINGS.catalogList
  // If we just deleted the primary, fall back to first remaining
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
  try {
    const raw = await AsyncStorage.getItem(KEYS.SESSION)
    return raw ? { ...DEFAULT_SESSION, ...JSON.parse(raw) } : DEFAULT_SESSION
  } catch { return DEFAULT_SESSION }
}

export async function saveSession(state: Partial<SessionState>): Promise<void> {
  try {
    const current = await getSession()
    const next = { ...current, ...state }
    await AsyncStorage.setItem(KEYS.SESSION, JSON.stringify(next))
  } catch (err) {
    console.warn('[storage] saveSession failed:', err)
  }
}

// --- Clear all ---

export async function clearAllData(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS.BOOKMARKS, KEYS.HISTORY, KEYS.SETTINGS, KEYS.TABS, KEYS.SESSION])
}
