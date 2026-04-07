import React, { useState, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Share,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { colors } from '../lib/theme'
import type { PearRPC } from '../lib/rpc'

type Block = {
  id: string
  type: 'heading' | 'text' | 'divider' | 'code' | 'quote' | 'link' | 'list' | 'image'
  text?: string
  level?: number
  href?: string
  items?: string[]
  src?: string
  alt?: string
}

type Theme = {
  primaryColor: string
  backgroundColor: string
  textColor: string
  fontFamily?: string
}

type Props = {
  rpc: PearRPC | null
  siteId: string
  siteName?: string
  initialBlocks?: Block[]
  initialTheme?: Theme
  onBack: () => void
  onPreview: (url: string) => void
}

const THEME_PRESETS = [
  { name: 'Pear', primaryColor: '#ff9500', backgroundColor: '#0a0a0a', textColor: '#e0e0e0' },
  { name: 'Ocean', primaryColor: '#4dabf7', backgroundColor: '#0a1628', textColor: '#d0e0f0' },
  { name: 'Forest', primaryColor: '#4ade80', backgroundColor: '#0a1a0a', textColor: '#d0e8d0' },
  { name: 'Sunset', primaryColor: '#f472b6', backgroundColor: '#1a0a14', textColor: '#f0d0e0' },
  { name: 'Light', primaryColor: '#ff9500', backgroundColor: '#fafafa', textColor: '#1a1a1a' },
]

let nextBlockId = 100

export function SiteEditorScreen({ rpc, siteId, siteName, initialBlocks, initialTheme, onBack, onPreview }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks || [
    { id: 'b' + nextBlockId++, type: 'heading', text: siteName || 'My Website', level: 1 },
    { id: 'b' + nextBlockId++, type: 'text', text: 'Welcome to my P2P website.' },
  ])
  const [theme, setTheme] = useState<Theme>(initialTheme || THEME_PRESETS[0])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showThemePicker, setShowThemePicker] = useState(false)

  const addBlock = useCallback((type: Block['type']) => {
    const block: Block = {
      id: 'b' + nextBlockId++,
      type,
      text: type === 'divider' ? '' : '',
      level: type === 'heading' ? 2 : undefined,
      items: type === 'list' ? ['Item 1'] : undefined,
      src: type === 'image' ? '' : undefined,
      alt: type === 'image' ? '' : undefined,
    }
    setBlocks(prev => [...prev, block])
  }, [])

  const updateBlock = useCallback((id: string, updates: Partial<Block>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b))
  }, [])

  const removeBlock = useCallback((id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id))
  }, [])

  const moveBlock = useCallback((id: string, direction: 'up' | 'down') => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id)
      if (idx < 0) return prev
      const newIdx = direction === 'up' ? idx - 1 : idx + 1
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const copy = [...prev]
      const temp = copy[idx]
      copy[idx] = copy[newIdx]
      copy[newIdx] = temp
      return copy
    })
  }, [])

  const addListItem = useCallback((blockId: string) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b
      return { ...b, items: [...(b.items || []), ''] }
    }))
  }, [])

  const updateListItem = useCallback((blockId: string, index: number, value: string) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b
      const items = [...(b.items || [])]
      items[index] = value
      return { ...b, items }
    }))
  }, [])

  const removeListItem = useCallback((blockId: string, index: number) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b
      const items = [...(b.items || [])]
      items.splice(index, 1)
      return { ...b, items }
    }))
  }, [])

  const handleSave = useCallback(async () => {
    if (!rpc) return
    setSaving(true)
    try {
      await rpc.updateSite(siteId, blocks, theme)
      Alert.alert('Saved', 'Site updated')
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
    setSaving(false)
  }, [rpc, siteId, blocks, theme])

  const handlePublish = useCallback(async () => {
    if (!rpc) return
    setPublishing(true)
    try {
      await rpc.updateSite(siteId, blocks, theme)
      const result = await rpc.publishSite(siteId)
      const key = result.keyHex
      Alert.alert('Published!', `Your site is live at:\nhyper://${key.slice(0, 20)}...`, [
        { text: 'Preview', onPress: () => onPreview(`hyper://${key}`) },
        {
          text: 'Share', onPress: () => {
            Share.share({ message: `Check out my P2P site: hyper://${key}`, url: `hyper://${key}` })
          }
        },
        { text: 'OK' },
      ])
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
    setPublishing(false)
  }, [rpc, siteId, blocks, theme, onPreview])

  // Generate preview HTML
  const previewHtml = generatePreviewHtml(blocks, theme, siteName || 'My Site')

  // --- Preview mode ---
  if (showPreview) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setShowPreview(false)} style={styles.backBtn}>
            <Text style={styles.backText}>{'< Edit'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Preview</Text>
          <TouchableOpacity onPress={handlePublish} style={styles.publishBtn} disabled={publishing}>
            <Text style={styles.publishBtnText}>{publishing ? '...' : 'Publish'}</Text>
          </TouchableOpacity>
        </View>
        <WebView
          source={{ html: previewHtml }}
          style={{ flex: 1, backgroundColor: theme.backgroundColor }}
          scrollEnabled
        />
      </View>
    )
  }

  // --- Theme picker ---
  if (showThemePicker) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setShowThemePicker(false)} style={styles.backBtn}>
            <Text style={styles.backText}>{'< Back'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Theme</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          {THEME_PRESETS.map((preset) => (
            <TouchableOpacity
              key={preset.name}
              style={[styles.themeCard, { borderColor: theme.primaryColor === preset.primaryColor ? preset.primaryColor : colors.border }]}
              onPress={() => { setTheme(preset); setShowThemePicker(false) }}
              activeOpacity={0.7}
            >
              <View style={[styles.themePreview, { backgroundColor: preset.backgroundColor }]}>
                <Text style={{ color: preset.primaryColor, fontSize: 18, fontWeight: '700' }}>Aa</Text>
                <Text style={{ color: preset.textColor, fontSize: 12, marginTop: 4 }}>Body text</Text>
              </View>
              <Text style={styles.themeName}>{preset.name}</Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.customLabel}>Custom Primary Color</Text>
          <View style={styles.colorRow}>
            {['#ff9500', '#4dabf7', '#4ade80', '#f472b6', '#facc15', '#ef4444', '#8b5cf6', '#ffffff'].map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.colorDot, { backgroundColor: c, borderWidth: theme.primaryColor === c ? 3 : 0, borderColor: '#fff' }]}
                onPress={() => setTheme(prev => ({ ...prev, primaryColor: c }))}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    )
  }

  // --- Editor mode ---
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Site</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleSave} style={styles.saveBtn} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? '...' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handlePublish} style={styles.publishBtn} disabled={publishing}>
            <Text style={styles.publishBtnText}>{publishing ? '...' : 'Publish'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Mode toggle + theme */}
      <View style={styles.modeBar}>
        <TouchableOpacity onPress={() => setShowPreview(true)} style={styles.modeBtn}>
          <Text style={styles.modeBtnText}>Preview</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowThemePicker(true)} style={styles.modeBtn}>
          <View style={[styles.themeIndicator, { backgroundColor: theme.primaryColor }]} />
          <Text style={styles.modeBtnText}>Theme</Text>
        </TouchableOpacity>
      </View>

      {/* Block editor */}
      <ScrollView style={styles.editor} contentContainerStyle={styles.editorContent}>
        {blocks.map((block, idx) => (
          <View key={block.id} style={styles.blockContainer}>
            <View style={styles.blockControls}>
              <Text style={styles.blockType}>{block.type}</Text>
              <View style={styles.blockActions}>
                {idx > 0 && (
                  <TouchableOpacity onPress={() => moveBlock(block.id, 'up')} style={styles.moveBtn}>
                    <Text style={styles.moveBtnText}>^</Text>
                  </TouchableOpacity>
                )}
                {idx < blocks.length - 1 && (
                  <TouchableOpacity onPress={() => moveBlock(block.id, 'down')} style={styles.moveBtn}>
                    <Text style={styles.moveBtnText}>v</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => removeBlock(block.id)} style={styles.deleteBtn}>
                  <Text style={styles.deleteBtnText}>x</Text>
                </TouchableOpacity>
              </View>
            </View>

            {block.type === 'divider' ? (
              <View style={styles.dividerBlock} />
            ) : block.type === 'heading' ? (
              <TextInput
                style={[styles.blockInput, styles.headingInput]}
                value={block.text}
                onChangeText={(text) => updateBlock(block.id, { text })}
                placeholder="Heading..."
                placeholderTextColor={colors.textMuted}
                multiline
              />
            ) : block.type === 'code' ? (
              <TextInput
                style={[styles.blockInput, styles.codeInput]}
                value={block.text}
                onChangeText={(text) => updateBlock(block.id, { text })}
                placeholder="Code..."
                placeholderTextColor={colors.textMuted}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : block.type === 'quote' ? (
              <TextInput
                style={[styles.blockInput, styles.quoteInput]}
                value={block.text}
                onChangeText={(text) => updateBlock(block.id, { text })}
                placeholder="Quote..."
                placeholderTextColor={colors.textMuted}
                multiline
              />
            ) : block.type === 'link' ? (
              <View>
                <TextInput
                  style={styles.blockInput}
                  value={block.text}
                  onChangeText={(text) => updateBlock(block.id, { text })}
                  placeholder="Link text..."
                  placeholderTextColor={colors.textMuted}
                />
                <TextInput
                  style={[styles.blockInput, { marginTop: 2, fontFamily: 'monospace', fontSize: 13 }]}
                  value={block.href}
                  onChangeText={(href) => updateBlock(block.id, { href })}
                  placeholder="URL..."
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
              </View>
            ) : block.type === 'image' ? (
              <View>
                <TextInput
                  style={[styles.blockInput, { fontFamily: 'monospace', fontSize: 13 }]}
                  value={block.src}
                  onChangeText={(src) => updateBlock(block.id, { src })}
                  placeholder="Image URL..."
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.blockInput, { marginTop: 2, fontSize: 13 }]}
                  value={block.alt}
                  onChangeText={(alt) => updateBlock(block.id, { alt })}
                  placeholder="Alt text..."
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            ) : block.type === 'list' ? (
              <View style={{ padding: 8 }}>
                {(block.items || []).map((item, i) => (
                  <View key={i} style={styles.listItemRow}>
                    <Text style={styles.listBullet}>{'\u2022'}</Text>
                    <TextInput
                      style={styles.listItemInput}
                      value={item}
                      onChangeText={(val) => updateListItem(block.id, i, val)}
                      placeholder="List item..."
                      placeholderTextColor={colors.textMuted}
                    />
                    <TouchableOpacity onPress={() => removeListItem(block.id, i)} style={{ padding: 4 }}>
                      <Text style={{ color: colors.error, fontSize: 14 }}>x</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity onPress={() => addListItem(block.id)} style={styles.addItemBtn}>
                  <Text style={styles.addItemText}>+ Add item</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TextInput
                style={styles.blockInput}
                value={block.text}
                onChangeText={(text) => updateBlock(block.id, { text })}
                placeholder="Text..."
                placeholderTextColor={colors.textMuted}
                multiline
              />
            )}
          </View>
        ))}
      </ScrollView>

      {/* Add block toolbar */}
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarContent}>
          <ToolbarBtn label="H" hint="Heading" onPress={() => addBlock('heading')} />
          <ToolbarBtn label="T" hint="Text" onPress={() => addBlock('text')} />
          <ToolbarBtn label="=" hint="List" onPress={() => addBlock('list')} />
          <ToolbarBtn label="--" hint="Divider" onPress={() => addBlock('divider')} />
          <ToolbarBtn label="{}" hint="Code" onPress={() => addBlock('code')} />
          <ToolbarBtn label="''" hint="Quote" onPress={() => addBlock('quote')} />
          <ToolbarBtn label="@" hint="Link" onPress={() => addBlock('link')} />
          <ToolbarBtn label="Img" hint="Image" onPress={() => addBlock('image')} />
        </ScrollView>
      </View>
    </View>
  )
}

function ToolbarBtn({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={tbStyles.btn} activeOpacity={0.6}>
      <Text style={tbStyles.label}>{label}</Text>
      <Text style={tbStyles.hint}>{hint}</Text>
    </TouchableOpacity>
  )
}

function generatePreviewHtml(blocks: Block[], theme: Theme, title: string): string {
  const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const body = blocks.map(b => {
    switch (b.type) {
      case 'heading': return `<h${b.level || 1}>${esc(b.text || '')}</h${b.level || 1}>`
      case 'text': return `<p>${esc(b.text || '')}</p>`
      case 'divider': return '<hr>'
      case 'code': return `<pre><code>${esc(b.text || '')}</code></pre>`
      case 'quote': return `<blockquote>${esc(b.text || '')}</blockquote>`
      case 'link': return `<a href="${esc(b.href || '#')}">${esc(b.text || b.href || 'Link')}</a>`
      case 'image': return b.src ? `<img src="${esc(b.src)}" alt="${esc(b.alt || '')}">` : ''
      case 'list': return `<ul>${(b.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
      default: return ''
    }
  }).join('\n')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--p:${theme.primaryColor};--bg:${theme.backgroundColor};--t:${theme.textColor};--f:${theme.fontFamily || '-apple-system,sans-serif'}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--f);background:var(--bg);color:var(--t);line-height:1.6;padding:24px 16px}
main{max-width:640px;margin:0 auto}
h1,h2,h3{color:var(--p);margin:20px 0 10px}
h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}
p{margin:12px 0}
a{color:var(--p);text-decoration:underline}
img{max-width:100%;border-radius:8px;margin:16px 0}
hr{border:none;border-top:1px solid #333;margin:24px 0}
pre{background:#111;padding:16px;border-radius:8px;overflow-x:auto;margin:16px 0}
code{font-family:monospace;font-size:14px}
blockquote{border-left:3px solid var(--p);padding-left:16px;color:#888;margin:16px 0;font-style:italic}
ul{padding-left:24px;margin:12px 0}
li{margin:6px 0}
</style></head><body><main>${body}</main></body></html>`
}

const tbStyles = StyleSheet.create({
  btn: {
    minWidth: 52, height: 48, borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
    paddingHorizontal: 8,
  },
  label: { color: colors.accent, fontSize: 16, fontWeight: '600', fontFamily: 'monospace' },
  hint: { color: colors.textMuted, fontSize: 9, marginTop: 1 },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { paddingVertical: 4, minWidth: 60 },
  backText: { color: colors.accent, fontSize: 16 },
  headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 8 },
  saveBtn: {
    backgroundColor: colors.surfaceElevated, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  saveBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  publishBtn: {
    backgroundColor: colors.accent, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  publishBtnText: { color: colors.bg, fontSize: 14, fontWeight: '600' },
  modeBar: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8,
    gap: 8, backgroundColor: colors.bg,
  },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  modeBtnText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  themeIndicator: { width: 12, height: 12, borderRadius: 6, marginRight: 6 },
  editor: { flex: 1 },
  editorContent: { padding: 16, paddingBottom: 80 },
  blockContainer: {
    backgroundColor: colors.surface, borderRadius: 10,
    marginBottom: 8, overflow: 'hidden',
  },
  blockControls: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: colors.surfaceElevated,
  },
  blockType: { color: colors.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },
  blockActions: { flexDirection: 'row', gap: 6 },
  moveBtn: { padding: 4 },
  moveBtnText: { color: colors.textMuted, fontSize: 14 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { color: colors.error, fontSize: 14 },
  blockInput: {
    color: colors.textPrimary, fontSize: 16, lineHeight: 24,
    paddingHorizontal: 12, paddingVertical: 10, minHeight: 44,
  },
  headingInput: { fontSize: 22, fontWeight: '600', color: colors.accent },
  codeInput: { fontFamily: 'monospace', fontSize: 13, backgroundColor: '#111' },
  quoteInput: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 16, fontStyle: 'italic' },
  dividerBlock: { height: 1, backgroundColor: colors.border, marginVertical: 12, marginHorizontal: 12 },
  listItemRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 4 },
  listBullet: { color: colors.accent, fontSize: 18, marginRight: 8 },
  listItemInput: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 6 },
  addItemBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  addItemText: { color: colors.accent, fontSize: 13 },
  toolbar: {
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
    paddingVertical: 8, paddingBottom: 28,
  },
  toolbarContent: { paddingHorizontal: 16 },
  themeCard: {
    backgroundColor: colors.surface, borderRadius: 12, borderWidth: 2,
    padding: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center',
  },
  themePreview: {
    width: 60, height: 48, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  themeName: { color: colors.textPrimary, fontSize: 16, fontWeight: '500' },
  customLabel: { color: colors.textSecondary, fontSize: 13, marginTop: 20, marginBottom: 10 },
  colorRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
})
