const b4a = require('b4a')
const z32 = require('z32')

const HEX64_RE = /^[0-9a-f]{64}$/i
const Z32_RE = /^[13-9a-km-uw-z]{52}$/i

function normalizeDriveKey (raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return ''
  if (HEX64_RE.test(value)) return value.toLowerCase()
  if (Z32_RE.test(value)) {
    try {
      const decoded = z32.decode(value.toLowerCase())
      return decoded && decoded.length === 32 ? b4a.toString(decoded, 'hex') : ''
    } catch {
      return ''
    }
  }
  return ''
}

function parseHyperUrl (input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('hyper:// URL required')
  }

  let parsed
  try {
    parsed = new URL(input.trim())
  } catch {
    throw new Error('Invalid hyper:// URL')
  }

  if (parsed.protocol !== 'hyper:') {
    throw new Error('Only hyper:// URLs can be opened through CMD_NAVIGATE')
  }

  const key = normalizeDriveKey(parsed.hostname)
  if (!HEX64_RE.test(key)) {
    throw new Error('Invalid hyper:// drive key')
  }

  return {
    key,
    path: parsed.pathname || '/',
    search: parsed.search || '',
    hash: parsed.hash || '',
  }
}

function buildNavigateResponse ({ url, proxyPort, issueApiToken }) {
  if (!Number.isInteger(proxyPort) || proxyPort <= 0 || proxyPort > 65535) {
    throw new Error('Proxy not running')
  }
  const parsed = parseHyperUrl(url)
  const apiToken = typeof issueApiToken === 'function' ? issueApiToken(parsed.key) : null
  if (typeof apiToken !== 'string' || apiToken.length === 0) {
    throw new Error('Could not issue page API token')
  }

  const localPath = `/hyper/${parsed.key}${parsed.path}${parsed.search}${parsed.hash}`
  return {
    localUrl: `http://127.0.0.1:${proxyPort}${localPath}`,
    key: parsed.key,
    path: parsed.path,
    proxyPort,
    apiToken,
  }
}

module.exports = {
  buildNavigateResponse,
  normalizeDriveKey,
  parseHyperUrl,
}
