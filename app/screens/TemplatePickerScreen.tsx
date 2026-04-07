import React from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../lib/theme'

type Template = {
  id: string
  name: string
  description: string
  preview: string
  blocks: any[]
  theme: any
}

const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Start from scratch',
    preview: '{ }',
    blocks: [
      { type: 'heading', text: 'My Website', level: 1 },
      { type: 'text', text: '' },
    ],
    theme: { primaryColor: '#ff9500', backgroundColor: '#0a0a0a', textColor: '#e0e0e0', fontFamily: '-apple-system, sans-serif' }
  },
  {
    id: 'personal',
    name: 'Personal',
    description: 'About me page with bio and links',
    preview: '@',
    blocks: [
      { type: 'heading', text: 'Your Name', level: 1 },
      { type: 'text', text: 'A short bio about yourself. What you do, what you care about.' },
      { type: 'divider' },
      { type: 'heading', text: 'Links', level: 2 },
      { type: 'link', text: 'GitHub', href: 'https://github.com/you' },
      { type: 'link', text: 'Twitter', href: 'https://twitter.com/you' },
      { type: 'link', text: 'Email', href: 'mailto:you@example.com' },
    ],
    theme: { primaryColor: '#4dabf7', backgroundColor: '#0a0a0a', textColor: '#e0e0e0', fontFamily: '-apple-system, sans-serif' }
  },
  {
    id: 'blog',
    name: 'Blog',
    description: 'Blog post with title, date, and content',
    preview: 'B',
    blocks: [
      { type: 'heading', text: 'Blog Post Title', level: 1 },
      { type: 'text', text: 'Published on April 2026' },
      { type: 'divider' },
      { type: 'text', text: 'Your blog post content goes here. Write about anything.' },
      { type: 'text', text: 'You can add more paragraphs, headings, quotes, and code blocks.' },
      { type: 'quote', text: 'A meaningful quote that supports your argument.' },
      { type: 'text', text: 'Wrap up your post with a conclusion.' },
    ],
    theme: { primaryColor: '#ff9500', backgroundColor: '#0a0a0a', textColor: '#e0e0e0', fontFamily: 'Georgia, serif' }
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Showcase your work with sections',
    preview: 'P',
    blocks: [
      { type: 'heading', text: 'Your Name — Portfolio', level: 1 },
      { type: 'text', text: 'Designer / Developer / Creator' },
      { type: 'divider' },
      { type: 'heading', text: 'Project 1', level: 2 },
      { type: 'text', text: 'Description of your first project. What it does, why it matters.' },
      { type: 'link', text: 'View Project', href: 'https://example.com' },
      { type: 'divider' },
      { type: 'heading', text: 'Project 2', level: 2 },
      { type: 'text', text: 'Description of your second project.' },
      { type: 'link', text: 'View Project', href: 'https://example.com' },
      { type: 'divider' },
      { type: 'heading', text: 'Contact', level: 2 },
      { type: 'text', text: 'Get in touch for collaborations.' },
      { type: 'link', text: 'Email me', href: 'mailto:you@example.com' },
    ],
    theme: { primaryColor: '#4ade80', backgroundColor: '#0a0a0a', textColor: '#e0e0e0', fontFamily: '-apple-system, sans-serif' }
  },
  {
    id: 'landing',
    name: 'Landing Page',
    description: 'Product or project landing page',
    preview: 'L',
    blocks: [
      { type: 'heading', text: 'Product Name', level: 1 },
      { type: 'text', text: 'One line that describes your product and why people should care.' },
      { type: 'divider' },
      { type: 'heading', text: 'Features', level: 2 },
      { type: 'list', items: ['Feature one — what it does', 'Feature two — why it matters', 'Feature three — how it works'] },
      { type: 'divider' },
      { type: 'heading', text: 'How It Works', level: 2 },
      { type: 'text', text: 'Step 1: Describe the first step.' },
      { type: 'text', text: 'Step 2: Describe the second step.' },
      { type: 'text', text: 'Step 3: Describe the result.' },
      { type: 'divider' },
      { type: 'heading', text: 'Get Started', level: 2 },
      { type: 'link', text: 'Try it now', href: 'https://example.com' },
    ],
    theme: { primaryColor: '#ff9500', backgroundColor: '#0a0a0a', textColor: '#e0e0e0', fontFamily: '-apple-system, sans-serif' }
  },
]

type Props = {
  onSelect: (template: Template) => void
  onBack: () => void
}

export function TemplatePickerScreen({ onSelect, onBack }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose Template</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Text style={styles.subtitle}>Pick a starting point for your site</Text>

        {TEMPLATES.map((template) => (
          <TouchableOpacity
            key={template.id}
            style={styles.templateCard}
            onPress={() => onSelect(template)}
            activeOpacity={0.7}
          >
            <View style={[styles.templateIcon, { borderColor: template.theme.primaryColor }]}>
              <Text style={[styles.templateIconText, { color: template.theme.primaryColor }]}>
                {template.preview}
              </Text>
            </View>
            <View style={styles.templateInfo}>
              <Text style={styles.templateName}>{template.name}</Text>
              <Text style={styles.templateDesc}>{template.description}</Text>
              <Text style={styles.templateBlocks}>{template.blocks.length} blocks</Text>
            </View>
            <Text style={styles.arrow}>{'>'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

export { TEMPLATES }
export type { Template }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { paddingVertical: 4, width: 60 },
  backText: { color: colors.accent, fontSize: 16 },
  headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 80 },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginBottom: 20 },
  templateCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12,
    padding: 16, marginBottom: 10,
  },
  templateIcon: {
    width: 48, height: 48, borderRadius: 12,
    borderWidth: 2, justifyContent: 'center', alignItems: 'center',
    marginRight: 14,
  },
  templateIconText: { fontSize: 20, fontWeight: '700', fontFamily: 'monospace' },
  templateInfo: { flex: 1 },
  templateName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  templateDesc: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  templateBlocks: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  arrow: { color: colors.textMuted, fontSize: 18, marginLeft: 8 },
})
