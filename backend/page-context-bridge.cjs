'use strict'

// Mobile port (Mission B4b): copied verbatim from pearbrowser-desktop
// backend/page-context-bridge.cjs — dependency-free CJS, and the shim body is
// unchanged so PAGE_CONTEXT_SHIM_HASH stays valid.

// Browser-owned, request-only bridge for extracting bounded context from a
// sandboxed page. The parent must authenticate each MessageChannel request
// with the random token injected beside this script. A page can still control
// its own DOM and therefore its returned text; callers must treat every field
// as untrusted page content.

const PAGE_CONTEXT_META_NAME = 'pear-page-context-token'
const PAGE_CONTEXT_TOKEN_RE = /^[0-9a-f]{64}$/i

const PAGE_CONTEXT_SHIM_BODY = `(function () {
  'use strict'
  if (window.__pearBrowserPageContextBridge) return
  window.__pearBrowserPageContextBridge = true

  var REQUEST_TYPE = 'pearbrowser:context-request'
  var RESPONSE_TYPE = 'pearbrowser:context-response'
  var META_NAME = 'pear-page-context-token'
  var MAX_TOTAL_BYTES = 24 * 1024
  var MAX_TITLE_BYTES = 512
  var MAX_SELECTION_BYTES = 8 * 1024
  var MAX_BODY_BYTES = 20 * 1024
  var MAX_TEXT_NODES = 5000
  var EXCLUDED_SELECTOR = 'script,style,noscript,template,input,textarea,select,option,[hidden],[aria-hidden="true"]'
  var encoder = new TextEncoder()
  var decoder = new TextDecoder()

  function truncateUtf8 (value, maxBytes) {
    var text = typeof value === 'string' ? value : String(value || '')
    var bytes = encoder.encode(text)
    if (bytes.byteLength <= maxBytes) {
      return { text: text, bytes: bytes.byteLength, truncated: false }
    }
    var end = Math.max(0, maxBytes)
    while (end > 0 && (bytes[end] & 192) === 128) end--
    var result = decoder.decode(bytes.subarray(0, end))
    return { text: result, bytes: end, truncated: true }
  }

  function normalizeText (value) {
    return String(value || '')
      .replace(/\\r\\n?/g, '\\n')
      .replace(/[\\t\\f\\v ]+/g, ' ')
      .replace(/ *\\n */g, '\\n')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim()
  }

  function isVisibleTextNode (node) {
    var element = node && node.parentElement
    if (!element) return false
    try {
      if (element.closest && element.closest(EXCLUDED_SELECTOR)) return false
    } catch (_) {
      return false
    }
    try {
      if (typeof element.checkVisibility === 'function') {
        return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      }
      if (typeof window.getComputedStyle === 'function') {
        var style = window.getComputedStyle(element)
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0)) return false
      }
    } catch (_) {
      return false
    }
    return true
  }

  function extractBody (maxBytes) {
    var output = ''
    var usedBytes = 0
    var visited = 0
    var truncated = false
    var nodeLimitReached = false
    if (!document.body || maxBytes <= 0) {
      return { text: '', bytes: 0, truncated: maxBytes <= 0, nodeLimitReached: false }
    }

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    var node
    while ((node = walker.nextNode())) {
      if (visited >= MAX_TEXT_NODES) {
        nodeLimitReached = true
        truncated = true
        break
      }
      visited++
      if (!isVisibleTextNode(node)) continue
      var chunk = normalizeText(node.data || node.nodeValue || '')
      if (!chunk) continue
      var prefix = output ? '\\n' : ''
      var remaining = maxBytes - usedBytes
      if (remaining <= 0) {
        truncated = true
        break
      }
      var piece = truncateUtf8(prefix + chunk, remaining)
      output += piece.text
      usedBytes += piece.bytes
      if (piece.truncated) {
        truncated = true
        break
      }
    }
    return {
      text: output,
      bytes: usedBytes,
      truncated: truncated,
      nodeLimitReached: nodeLimitReached
    }
  }

  function extractContext () {
    var title = truncateUtf8(normalizeText(document.title || ''), MAX_TITLE_BYTES)
    var selected = ''
    try {
      var selection = window.getSelection && window.getSelection()
      selected = selection ? selection.toString() : ''
    } catch (_) {}
    var selectionResult = truncateUtf8(normalizeText(selected), MAX_SELECTION_BYTES)
    var remaining = Math.max(0, MAX_TOTAL_BYTES - title.bytes - selectionResult.bytes)
    var bodyResult = extractBody(Math.min(MAX_BODY_BYTES, remaining))
    var wasTruncated = title.truncated || selectionResult.truncated || bodyResult.truncated
    return {
      context: {
        title: title.text,
        selection: selectionResult.text,
        body: bodyResult.text
      },
      bytes: {
        title: title.bytes,
        selection: selectionResult.bytes,
        body: bodyResult.bytes,
        total: title.bytes + selectionResult.bytes + bodyResult.bytes
      },
      flags: {
        truncated: wasTruncated,
        titleTruncated: title.truncated,
        selectionTruncated: selectionResult.truncated,
        bodyTruncated: bodyResult.truncated,
        nodeLimitReached: bodyResult.nodeLimitReached
      }
    }
  }

  function closePort (port) {
    try { port.close() } catch (_) {}
  }

  window.addEventListener('message', function (event) {
    var data = event && event.data
    if (!data || data.type !== REQUEST_TYPE || data.v !== 1) return
    if (event.source !== window.parent) return
    if (!event.ports || event.ports.length !== 1) return
    var port = event.ports[0]
    if (!port || typeof port.postMessage !== 'function') return

    var requestId = typeof data.requestId === 'string' ? data.requestId : ''
    var requestedToken = typeof data.contextToken === 'string' ? data.contextToken : ''
    var tokenMeta = document.querySelector('meta[name="' + META_NAME + '"]')
    var expectedToken = tokenMeta && typeof tokenMeta.content === 'string' ? tokenMeta.content : ''
    if (!requestId || requestId.length > 128 || !expectedToken || requestedToken !== expectedToken) {
      closePort(port)
      return
    }

    try {
      var result = extractContext()
      port.postMessage({
        type: RESPONSE_TYPE,
        v: 1,
        requestId: requestId,
        context: result.context,
        bytes: result.bytes,
        flags: result.flags
      })
    } catch (_) {
      try {
        port.postMessage({
          type: RESPONSE_TYPE,
          v: 1,
          requestId: requestId,
          error: 'context-unavailable'
        })
      } catch (_) {}
    } finally {
      closePort(port)
    }
  }, true)
})()`

const PAGE_CONTEXT_SHIM = `<script>${PAGE_CONTEXT_SHIM_BODY}</script>`

// SHA-256(base64) of PAGE_CONTEXT_SHIM_BODY. Kept dependency-free for Bare;
// the Node test recomputes it so any source edit must update this value.
const PAGE_CONTEXT_SHIM_HASH = 'Ezsg1K1z6HgITs7nybkuhSs36nhUJs78Cv7riGX9PpU='

function pageContextMeta (token) {
  const normalized = String(token || '').trim().toLowerCase()
  if (!PAGE_CONTEXT_TOKEN_RE.test(normalized)) {
    throw new TypeError('Page context token must be 32 bytes of hexadecimal')
  }
  return `<meta name="${PAGE_CONTEXT_META_NAME}" content="${normalized}">`
}

module.exports = {
  PAGE_CONTEXT_META_NAME,
  PAGE_CONTEXT_SHIM_BODY,
  PAGE_CONTEXT_SHIM,
  PAGE_CONTEXT_SHIM_HASH,
  pageContextMeta
}
