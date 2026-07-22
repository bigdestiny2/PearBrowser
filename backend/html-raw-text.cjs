'use strict'

// HTML treats <style> contents as raw text and closes the element on a literal
// "</style", regardless of CSS tokenization. Encode every less-than sign as a
// CSS code point before embedding third-party CSS at any HTML injection sink.
function escapeStyleText (css) {
  if (typeof css !== 'string') return ''
  return css.replace(/</g, '\\3c ')
}

// --- B3: proxy-side page-text extraction for the local search index ---------
//
// On the desktop, the UI extracts index text from the loaded page with a real
// DOM (doc.title + doc.body.innerText, 200 KB cap). The mobile backend serves
// pages through the hyper-proxy and has no DOM, so the indexing hook extracts
// from the raw HTML instead. This is a deliberately small, fail-closed
// extractor — NOT a parser: it drops non-content blocks, strips tags, decodes
// the common entities, and collapses whitespace. Search-core's tokenizer does
// the authoritative NFKC/stopword work downstream, so approximate text here
// only costs recall, never correctness or safety.

const MAX_INDEX_TEXT = 200000 // mirrors the desktop UI's 200 KB innerText cap

// Blocks whose contents are never page text. Non-greedy + case-insensitive;
// a missing close tag degrades to "rest of document dropped" for that block,
// which is acceptable (best-effort indexing) and never throws.
const DROP_BLOCK_RE = /<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi
const TAG_RE = /<[^>]*>/g
const WS_RE = /\s+/g

function decodeBasicEntities (text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d{1,7});/g, (_, n) => {
      const cp = Number(n)
      try { return (cp > 0 && cp <= 0x10ffff) ? String.fromCodePoint(cp) : ' ' } catch { return ' ' }
    })
}

// Extract the <title> text (first match, entity-decoded, length-capped).
function extractTitle (html) {
  if (typeof html !== 'string' || !html) return ''
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i)
  if (!m) return ''
  return decodeBasicEntities(m[1].replace(TAG_RE, ' ')).replace(WS_RE, ' ').trim().slice(0, 200)
}

// Extract approximate body text for indexing, capped at MAX_INDEX_TEXT chars.
function htmlToIndexText (html) {
  if (typeof html !== 'string' || !html) return ''
  const noBlocks = html.replace(DROP_BLOCK_RE, ' ')
  const noTags = noBlocks.replace(TAG_RE, ' ')
  return decodeBasicEntities(noTags).replace(WS_RE, ' ').trim().slice(0, MAX_INDEX_TEXT)
}

// One call for the indexing hook: { title, text } from raw HTML.
function extractIndexContent (html) {
  return { title: extractTitle(html), text: htmlToIndexText(html) }
}

module.exports = { escapeStyleText, extractTitle, htmlToIndexText, extractIndexContent, MAX_INDEX_TEXT }
