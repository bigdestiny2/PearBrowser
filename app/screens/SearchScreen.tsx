import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'
import { colors } from '../lib/theme'
import type {
  PearRPC, PearSearchFederatedEvent, PearSearchResult,
} from '../lib/rpc'

type Props = {
  rpc: PearRPC | null
  initialQuery?: string
  onOpen: (url: string) => void
  onBack: () => void
  onOpenSettings?: () => void
}

const KEY_RE = /^(?:[0-9a-f]{64}|[13-9a-km-uw-z]{52})$/i

export function searchResultUrl(result: PearSearchResult): string | null {
  const link = String(result.link || '').trim()
  if (link) {
    const match = /^hyper:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(link)
    return match && KEY_RE.test(match[1]) ? link : null
  }
  const rawKey = String(result.driveKey || '').trim()
  if (/^hyper:\/\//i.test(rawKey)) {
    const match = /^hyper:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(rawKey)
    return match && KEY_RE.test(match[1]) ? rawKey : null
  }
  if (!KEY_RE.test(rawKey)) return null
  const path = String(result.path || '/')
  const safePath = path.startsWith('/') && !/[\u0000-\u001f]/.test(path) ? path : '/'
  return 'hyper://' + rawKey + safePath
}

function sourceLabel(result: PearSearchResult): string {
  if (!result.tier || result.tier === 'self') return 'On this device'
  if (result.tier === 'followed') return 'Trusted peer · hop ' + (result.trustHop ?? 1)
  return 'Peer source: ' + result.tier
}

export function SearchScreen({ rpc, initialQuery = '', onOpen, onBack, onOpenSettings }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<PearSearchResult[] | null>(null)
  const [indexedDocs, setIndexedDocs] = useState(0)
  const [searching, setSearching] = useState(false)
  const [indexEnabled, setIndexEnabled] = useState(false)
  const [privacyChecked, setPrivacyChecked] = useState(false)
  const [federated, setFederated] = useState(false)
  const [federating, setFederating] = useState(false)
  const [enrichment, setEnrichment] = useState<PearSearchFederatedEvent | null>(null)
  const [error, setError] = useState('')
  const requestRef = useRef(0)
  const queryIdRef = useRef<number | null>(null)
  const pendingEventRef = useRef<PearSearchFederatedEvent | null>(null)
  const localResultsRef = useRef<PearSearchResult[]>([])
  const allowFederatedRef = useRef(false)

  useEffect(() => {
    if (!rpc) {
      setPrivacyChecked(false)
      return
    }
    let active = true
    rpc.getPrivacyStatus()
      .then((status) => {
        if (!active) return
        setIndexEnabled(status.privacy.searchIndexEnabled === true)
        setPrivacyChecked(true)
      })
      .catch(() => {
        if (active) setPrivacyChecked(false)
      })
    return () => { active = false }
  }, [rpc])

  const applyEnrichment = useCallback((event: PearSearchFederatedEvent) => {
    if (!allowFederatedRef.current || event.queryId !== queryIdRef.current) return
    setResults(Array.isArray(event.results) ? event.results : [])
    setEnrichment(event)
    setFederating(false)
  }, [])

  useEffect(() => {
    if (!rpc) return
    return rpc.onSearchFederated((event) => {
      if (!allowFederatedRef.current) return
      if (queryIdRef.current === null) {
        pendingEventRef.current = event
        return
      }
      applyEnrichment(event)
    })
  }, [rpc, applyEnrichment])

  const executeSearch = useCallback(async (text: string, includePeers: boolean) => {
    const term = text.trim().slice(0, 512)
    if (!term) {
      setResults(null)
      setError('')
      setFederating(false)
      return
    }
    if (!rpc) {
      setError('P2P engine is not connected yet.')
      return
    }
    const request = ++requestRef.current
    queryIdRef.current = null
    pendingEventRef.current = null
    allowFederatedRef.current = includePeers
    setSearching(true)
    setFederating(false)
    setEnrichment(null)
    setError('')
    try {
      const reply = await rpc.search(term, { limit: 50, federated: includePeers })
      if (request !== requestRef.current) return
      queryIdRef.current = reply.queryId
      localResultsRef.current = Array.isArray(reply.results) ? reply.results : []
      setResults(localResultsRef.current)
      setIndexedDocs(Number(reply.stats?.docs) || 0)
      setFederating(includePeers && reply.federating === true)
      const early = pendingEventRef.current as PearSearchFederatedEvent | null
      pendingEventRef.current = null
      if (early && early.queryId === reply.queryId) applyEnrichment(early)
    } catch (err: any) {
      if (request === requestRef.current) {
        setError(err?.message || 'Search failed.')
        setFederating(false)
      }
    } finally {
      if (request === requestRef.current) setSearching(false)
    }
  }, [rpc, applyEnrichment])

  useEffect(() => {
    if (initialQuery.trim() && rpc) {
      setQuery(initialQuery)
      setFederated(false)
      executeSearch(initialQuery, false)
    }
  }, [initialQuery, rpc, executeSearch])

  const changeQuery = useCallback((value: string) => {
    requestRef.current++
    queryIdRef.current = null
    allowFederatedRef.current = false
    localResultsRef.current = []
    setQuery(value)
    setResults(null)
    setEnrichment(null)
    setFederating(false)
    setSearching(false)
  }, [])

  const changeFederated = useCallback((enabled: boolean) => {
    setFederated(enabled)
    if (enabled) {
      if (query.trim()) executeSearch(query, true)
      return
    }
    requestRef.current++
    queryIdRef.current = null
    pendingEventRef.current = null
    allowFederatedRef.current = false
    setResults(localResultsRef.current)
    setEnrichment(null)
    setFederating(false)
    setSearching(false)
  }, [query, executeSearch])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Search</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Search pages saved in your local index. Local searches stay on this device.
        </Text>
        {!indexEnabled && privacyChecked && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Page indexing is off. Turn it on in Settings to add pages you browse. Existing indexed pages can still appear here.
            </Text>
            {onOpenSettings && (
              <TouchableOpacity onPress={onOpenSettings}>
                <Text style={styles.noticeLink}>Open Settings</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={changeQuery}
            onSubmitEditing={() => executeSearch(query, federated)}
            placeholder="Search P2P pages"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <TouchableOpacity
            onPress={() => executeSearch(query, federated)}
            disabled={!query.trim() || searching || !rpc}
            style={[styles.searchButton, (!query.trim() || searching || !rpc) && styles.disabled]}
          >
            <Text style={styles.searchButtonText}>Search</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.peerRow}>
          <View style={styles.peerCopy}>
            <Text style={styles.peerTitle}>Include trusted peers</Text>
            <Text style={styles.peerHint}>Off by default. Searching peers may connect to their indexes.</Text>
          </View>
          <Switch
            value={federated}
            onValueChange={changeFederated}
            trackColor={{ true: colors.accent, false: colors.surfaceElevated }}
          />
        </View>
        {federating && <Text style={styles.progress}>Searching trusted peers…</Text>}
        {enrichment && (
          <Text style={styles.provenance}>
            {'Trusted-peer results · ' +
              (enrichment.partial ? 'partial' : 'complete') +
              (enrichment.provenance
                ? ' · ' + (enrichment.provenance.pulledPeers || 0) + '/' +
                  (enrichment.provenance.plannedPeers || 0) + ' peers checked'
                : '') +
              (enrichment.verifyBudgetExhausted ? ' · verification limit reached' : '')}
          </Text>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {searching && results === null && <ActivityIndicator color={colors.accent} style={styles.spinner} />}
        {results !== null && (
          <>
            <Text style={styles.resultCount}>
              {results.length + ' result' + (results.length === 1 ? '' : 's') +
                ' · ' + indexedDocs + ' local page' + (indexedDocs === 1 ? '' : 's') + ' indexed'}
            </Text>
            {results.length === 0 && (
              <Text style={styles.empty}>
                {indexedDocs === 0
                  ? 'No pages indexed yet. Enable indexing, then browse hyper:// pages.'
                  : 'No matches found.'}
              </Text>
            )}
            {results.map((result, index) => {
              const url = searchResultUrl(result)
              return (
                <TouchableOpacity
                  key={result.docId || (url || 'unavailable') + index}
                  style={styles.result}
                  onPress={() => { if (url) onOpen(url) }}
                  disabled={!url}
                >
                  <Text style={styles.resultTitle} numberOfLines={2}>{result.title || url || 'Unavailable page'}</Text>
                  <Text style={styles.resultUrl} numberOfLines={1}>{url || 'Cannot open this result on mobile'}</Text>
                  <Text style={styles.resultSource}>{sourceLabel(result)}</Text>
                </TouchableOpacity>
              )
            })}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backButton: { width: 70, paddingVertical: 4 },
  backText: { color: colors.accent, fontSize: 15 },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  headerSpacer: { width: 70 },
  content: { padding: 16, paddingBottom: 100 },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 14 },
  notice: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 14 },
  noticeText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  noticeLink: { color: colors.accent, fontSize: 13, fontWeight: '600', marginTop: 8 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: 12, paddingHorizontal: 12,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 12 },
  searchButton: { paddingVertical: 8, paddingHorizontal: 10 },
  searchButtonText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  peerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 10 },
  peerCopy: { flex: 1, paddingRight: 12 },
  peerTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  peerHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  progress: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  provenance: { color: colors.warning, fontSize: 12, marginBottom: 10 },
  error: { color: colors.error, fontSize: 12, marginVertical: 10 },
  spinner: { marginVertical: 20 },
  resultCount: { color: colors.textSecondary, fontSize: 12, marginVertical: 14 },
  empty: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  result: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 8,
  },
  resultTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  resultUrl: { color: colors.textMuted, fontSize: 11, marginBottom: 5 },
  resultSource: { color: colors.accent, fontSize: 11 },
})
