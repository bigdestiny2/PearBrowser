import React, { useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { colors } from '../lib/theme'
import type { PearRPC } from '../lib/rpc'

type Block = {
  id: string
  type: 'heading' | 'text' | 'divider' | 'code' | 'quote' | 'link'
  text?: string
  level?: number
  href?: string
}

type Props = {
  rpc: PearRPC | null
  siteId: string
  onBack: () => void
  onPreview: (url: string) => void
}

let nextBlockId = 1

export function SiteEditorScreen({ rpc, siteId, onBack, onPreview }: Props) {
  const [blocks, setBlocks] = useState<Block[]>([
    { id: 'b' + nextBlockId++, type: 'heading', text: 'My Website', level: 1 },
    { id: 'b' + nextBlockId++, type: 'text', text: 'Welcome to my P2P website.' },
  ])
  const [theme, setTheme] = useState({
    primaryColor: '#ff9500',
    backgroundColor: '#0a0a0a',
    textColor: '#e0e0e0',
  })
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const addBlock = useCallback((type: Block['type']) => {
    const block: Block = {
      id: 'b' + nextBlockId++,
      type,
      text: type === 'divider' ? '' : '',
      level: type === 'heading' ? 2 : undefined,
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

  const handleSave = useCallback(async () => {
    if (!rpc) return
    setSaving(true)
    try {
      await rpc.updateSite(siteId, blocks, theme)
      Alert.alert('Saved', 'Site updated successfully')
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
      Alert.alert('Published!', `Your site is live at:\n\nhyper://${result.keyHex.slice(0, 20)}...`, [
        { text: 'Preview', onPress: () => onPreview(`hyper://${result.keyHex}`) },
        { text: 'OK' },
      ])
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
    setPublishing(false)
  }, [rpc, siteId, blocks, theme, onPreview])

  return (
    <View style={styles.container}>
      {/* Header */}
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

      {/* Block editor */}
      <ScrollView style={styles.editor} contentContainerStyle={styles.editorContent}>
        {blocks.map((block, idx) => (
          <View key={block.id} style={styles.blockContainer}>
            {/* Block controls */}
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

            {/* Block content */}
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
                  style={[styles.blockInput, { marginTop: 4, fontFamily: 'monospace', fontSize: 13 }]}
                  value={block.href}
                  onChangeText={(href) => updateBlock(block.id, { href })}
                  placeholder="URL..."
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
              </View>
            ) : (
              <TextInput
                style={[styles.blockInput, block.type === 'quote' && styles.quoteInput]}
                value={block.text}
                onChangeText={(text) => updateBlock(block.id, { text })}
                placeholder={block.type === 'quote' ? 'Quote...' : 'Text...'}
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
          <ToolbarBtn label="H" onPress={() => addBlock('heading')} />
          <ToolbarBtn label="T" onPress={() => addBlock('text')} />
          <ToolbarBtn label="—" onPress={() => addBlock('divider')} />
          <ToolbarBtn label="{ }" onPress={() => addBlock('code')} />
          <ToolbarBtn label='"' onPress={() => addBlock('quote')} />
          <ToolbarBtn label="@" onPress={() => addBlock('link')} />
        </ScrollView>
      </View>
    </View>
  )
}

function ToolbarBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={tbStyles.btn} activeOpacity={0.6}>
      <Text style={tbStyles.label}>{label}</Text>
    </TouchableOpacity>
  )
}

const tbStyles = StyleSheet.create({
  btn: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
  },
  label: { color: colors.accent, fontSize: 18, fontWeight: '600', fontFamily: 'monospace' },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { paddingVertical: 4 },
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
  codeInput: { fontFamily: 'monospace', fontSize: 13, backgroundColor: '#111', borderRadius: 0 },
  quoteInput: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 16 },
  dividerBlock: { height: 1, backgroundColor: colors.border, marginVertical: 12, marginHorizontal: 12 },
  toolbar: {
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
    paddingVertical: 8, paddingBottom: 28,
  },
  toolbarContent: { paddingHorizontal: 16 },
})
