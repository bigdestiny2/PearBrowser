'use strict'

/**
 * Content Shield ↔ hyper-proxy chokepoint tests — adapted from
 * pearbrowser-desktop/test/content-shield-proxy.test.js to the mobile proxy:
 * the block decision happens inside `_handle` before any cache/P2P/relay
 * work, and cosmetic/scriptlet/strict-CSP injection happens in
 * `_serveHtmlWithBridge` (the mobile counterpart of the desktop's
 * `_injectHtmlHead`).
 *
 * Mobile adaptation vs the desktop suite: hash authorization is asserted on
 * the response-header CSP (the mobile proxy's CSP surface) instead of only
 * on page meta CSP rewriting. Plugin style/script inject tests landed with
 * Mission B4a (PLUGIN_* RPC + the plugin registry/loader/catalogue).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

require('./_stubs')

const { HyperProxy, sha256ScriptBody, escapeStyleText } = require('../backend/hyper-proxy.js')
const { ContentShield } = require('../backend/content-shield.cjs')

const DRIVE = 'a'.repeat(64)
const DRIVE_B = 'b'.repeat(64)

function makeProxy (shield) {
  const fetches = []
  const proxy = new HyperProxy(async () => null, () => {})
  proxy._port = 9876
  proxy.issueApiToken = () => 'test-token'
  proxy._hybridFetch = async (driveKeyHex, filePath) => {
    fetches.push(`${driveKeyHex}:${filePath}`)
    return { content: Buffer.from('served-bytes'), contentType: 'text/plain', source: 'test' }
  }
  if (shield) proxy.setContentShield(shield)
  return { proxy, fetches }
}

function makeReq (method, path) {
  const req = new EventEmitter()
  req.method = method
  req.url = path
  req.headers = { host: '127.0.0.1:9876' }
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}

function makeRes () {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    setHeader (name, value) { this.headers[name.toLowerCase()] = value },
    write (chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)) },
    end (chunk) {
      if (chunk) this.chunks.push(Buffer.from(chunk))
      this.body = Buffer.concat(this.chunks).toString('utf8')
      this.ended = true
    }
  }
}

function serveHtml (proxy, driveKey, html = '<html><head></head><body>hi</body></html>') {
  const res = makeRes()
  proxy._serveHtmlWithBridge(
    makeReq('GET', `/hyper/${driveKey}/index.html`),
    res,
    `/hyper/${driveKey}/index.html`,
    driveKey,
    Buffer.from(html)
  )
  return res
}

test('a blocked subresource is refused before any P2P/relay fetch', async () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', '||doubleclick.net^')
  const { proxy, fetches } = makeProxy(shield)

  const res = makeRes()
  await proxy._handle(makeReq('GET', `/hyper/${DRIVE}/vendor/doubleclick.net/ad.js`), res)

  assert.equal(res.statusCode, 403)
  assert.equal(res.headers['x-pear-shield'], 'blocked')
  assert.match(res.body, /Blocked by PearBrowser Shield/)
  assert.deepEqual(fetches, [])
  assert.equal(shield.stats().blocked, 1)
})

test('an ordinary request passes the shield and reaches the fetch path', async () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', '||doubleclick.net^')
  const { proxy, fetches } = makeProxy(shield)

  const res = makeRes()
  await proxy._handle(makeReq('GET', `/hyper/${DRIVE}/app.js`), res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body, 'served-bytes')
  assert.deepEqual(fetches, [`${DRIVE}:/app.js`])
})

test('a disabled shield restores pass-through behavior', async () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', '||doubleclick.net^')
  shield.setEnabled(false)
  const { proxy, fetches } = makeProxy(shield)

  const res = makeRes()
  await proxy._handle(makeReq('GET', `/hyper/${DRIVE}/vendor/doubleclick.net/ad.js`), res)

  assert.equal(res.statusCode, 200)
  assert.equal(fetches.length, 1)
})

test('HTML injection carries the cosmetic style block only when enabled', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', '##.ad-banner')
  const { proxy } = makeProxy(shield)

  const injected = serveHtml(proxy, DRIVE)
  assert.match(injected.body, /<style data-pear-shield>/)
  assert.match(injected.body, /\.ad-banner \{ display: none !important; \}/)

  shield.setEnabled(false)
  const clean = serveHtml(proxy, DRIVE)
  assert.doesNotMatch(clean.body, /data-pear-shield/)
})

test('a proxy without a shield behaves exactly as before', async () => {
  const { proxy, fetches } = makeProxy(null)

  const res = makeRes()
  await proxy._handle(makeReq('GET', `/hyper/${DRIVE}/vendor/doubleclick.net/ad.js`), res)
  assert.equal(res.statusCode, 200)
  assert.equal(fetches.length, 1)

  const served = serveHtml(proxy, DRIVE)
  assert.doesNotMatch(served.body, /data-pear-shield/)
  // No injected scripts → the response CSP keeps the pre-shield shape.
  assert.match(served.headers['content-security-policy'], /script-src 'self'/)
  assert.doesNotMatch(served.headers['content-security-policy'], /sha256-/)
})

test('allowlisted drive restores pass-through; other drives still block', async () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', '||doubleclick.net^')
  shield.allowlistDrive(DRIVE)
  const { proxy, fetches } = makeProxy(shield)

  const allowRes = makeRes()
  await proxy._handle(makeReq('GET', `/hyper/${DRIVE}/vendor/doubleclick.net/ad.js`), allowRes)
  assert.equal(allowRes.statusCode, 200)
  assert.equal(allowRes.headers['x-pear-shield'], 'allowlisted')
  assert.equal(fetches.length, 1)

  // Same rule on a non-allowlisted drive still 403s before fetch
  const blockRes = makeRes()
  const before = fetches.length
  await proxy._handle(makeReq('GET', `/hyper/${DRIVE_B}/vendor/doubleclick.net/ad.js`), blockRes)
  assert.equal(blockRes.statusCode, 403)
  assert.equal(blockRes.headers['x-pear-shield'], 'blocked')
  assert.equal(fetches.length, before)
})

test('strict mode injects confining CSP meta; non-strict drives omit it', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.setStrictDrive(DRIVE, true)
  const { proxy } = makeProxy(shield)

  const strictHtml = serveHtml(proxy, DRIVE).body
  assert.match(strictHtml, /data-pear-shield-strict="1"/)
  assert.match(strictHtml, /Content-Security-Policy/)
  assert.match(strictHtml, /default-src 'self'/)
  assert.match(strictHtml, /connect-src 'self'/)

  const openHtml = serveHtml(proxy, DRIVE_B).body
  assert.doesNotMatch(openHtml, /data-pear-shield-strict/)
})

test('scriptlets ride the hash-authorized inject path', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('s', '##+js(set-constant, ads.enabled, false)')
  const { proxy } = makeProxy(shield)

  const injected = serveHtml(proxy, DRIVE)
  assert.match(injected.body, /data-pear-scriptlet="set-constant"/)
  assert.match(injected.body, /ads\.enabled/)
  // Body is pure JS inside a script tag (sha256ScriptBody path)
  assert.match(injected.body, /<script data-pear-scriptlet="set-constant">[\s\S]*?<\/script>/)

  // The response-header CSP authorizes exactly that script's hash — the
  // desktop meta-CSP model adapted to this proxy's header CSP.
  const tag = injected.body.match(/(<script data-pear-scriptlet="set-constant">[\s\S]*?<\/script>)/)[1]
  const expectedHash = sha256ScriptBody(tag)
  assert.ok(expectedHash)
  assert.match(injected.headers['content-security-policy'], new RegExp(`'sha256-${expectedHash}'`))
  assert.doesNotMatch(injected.headers['content-security-policy'], /unsafe-inline/)

  shield.setEnabled(false)
  const clean = serveHtml(proxy, DRIVE)
  assert.doesNotMatch(clean.body, /data-pear-scriptlet/)
})

test('the swarm shim is hash-authorized in the response CSP', () => {
  const { proxy } = makeProxy(null)
  proxy.setPearSwarmShim('<script>window.__pearShim = 1</script>')

  const served = serveHtml(proxy, DRIVE)
  assert.match(served.body, /window\.__pearShim = 1/)
  const hash = sha256ScriptBody('<script>window.__pearShim = 1</script>')
  assert.match(served.headers['content-security-policy'], new RegExp(`'sha256-${hash}'`))
})

test('plugin styles and scripts inject only when enabled (Mission B4a)', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.applyPluginContribution('plug', {
    styles: { matches: ['*'], css: '.plug-hide { display:none }' },
    scripts: { matches: ['*'], js: 'window.__plug=1' }
  }, ['pear.content.styles', 'pear.content.scripts'])
  const { proxy } = makeProxy(shield)

  const on = serveHtml(proxy, DRIVE)
  assert.match(on.body, /<style data-pear-plugin-style>/)
  assert.match(on.body, /\.plug-hide/)
  assert.match(on.body, /<script data-pear-plugin="plug">/)
  assert.match(on.body, /window\.__plug=1/)

  // The plugin script is hash-authorized in the response-header CSP,
  // exactly like a scriptlet — never 'unsafe-inline'.
  const tag = on.body.match(/(<script data-pear-plugin="plug">[\s\S]*?<\/script>)/)[1]
  const expectedHash = sha256ScriptBody(tag)
  assert.ok(expectedHash)
  assert.ok(on.headers['content-security-policy'].includes(`'sha256-${expectedHash}'`))
  assert.doesNotMatch(on.headers['content-security-policy'], /unsafe-inline/)

  // Kill switch strips both surfaces.
  shield.setPluginEnabled('plug', false)
  const off = serveHtml(proxy, DRIVE)
  assert.doesNotMatch(off.body, /data-pear-plugin-style/)
  assert.doesNotMatch(off.body, /data-pear-plugin="plug"/)
  assert.equal(off.headers['content-security-policy'].includes(`'sha256-${expectedHash}'`), false)
})

test('plugin scripts authorize the strict-CSP meta too', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.setStrictDrive(DRIVE, true)
  shield.applyPluginContribution('plug', {
    scripts: { matches: ['*'], js: 'window.__plugStrict=1' }
  }, ['pear.content.scripts'])
  const { proxy } = makeProxy(shield)

  const served = serveHtml(proxy, DRIVE)
  const tag = served.body.match(/(<script data-pear-plugin="plug">[\s\S]*?<\/script>)/)[1]
  const hash = sha256ScriptBody(tag)
  const strictMeta = served.body.match(/data-pear-shield-strict="1"/)
  assert.ok(strictMeta)
  assert.ok(served.body.includes(`'sha256-${hash}'`))
})

test('plugin CSS cannot close the browser-owned style element', () => {
  const payload = '</style><script>window.__escaped=1</script><style>'
  const shield = new ContentShield({ builtinList: false })
  shield.applyPluginContribution('style-only', {
    styles: { matches: ['*'], css: payload }
  }, ['pear.content.styles'])
  const { proxy } = makeProxy(shield)

  const served = serveHtml(proxy, DRIVE)
  const style = served.body.match(/<style data-pear-plugin-style>([\s\S]*?)<\/style>/)
  assert.ok(style)
  assert.equal(style[1].includes('</style>'), false)
  assert.equal(served.body.includes('<script>window.__escaped=1</script>'), false)
})

test('filter CSS cannot close the browser-owned style element', () => {
  const payload = '</style><script>window.__escaped=1</script><style>'
  assert.equal(escapeStyleText(payload).includes('</style>'), false)

  // The list parser rejects selectors carrying markup delimiters outright.
  const shield = new ContentShield({ builtinList: false })
  shield.addList('malicious-list', `##${payload}`)
  assert.equal(shield.cosmeticCssFor('example.test'), '')

  // And anything that still reaches the style sink is < -escaped.
  const { proxy } = makeProxy(shield)
  const served = serveHtml(proxy, DRIVE)
  const style = served.body.match(/<style data-pear-shield>([\s\S]*?)<\/style>/)
  if (style) {
    assert.equal(style[1].includes('</style>'), false)
  }
  assert.equal(served.body.includes('<script>window.__escaped=1</script>'), false)
})
