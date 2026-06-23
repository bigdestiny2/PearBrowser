const test = require('node:test')
const assert = require('node:assert/strict')
const z32 = require('z32')
const b4a = require('b4a')

const {
  buildNavigateResponse,
  normalizeDriveKey,
  parseHyperUrl
} = require('../backend/navigation')

const KEY = 'a'.repeat(64)
const Z32_KEY = z32.encode(b4a.from(KEY, 'hex'))

test('normalizeDriveKey accepts hex and z32 keys', () => {
  assert.equal(normalizeDriveKey(KEY.toUpperCase()), KEY)
  assert.equal(normalizeDriveKey(Z32_KEY), KEY)
  assert.equal(normalizeDriveKey('not-a-key'), '')
})

test('parseHyperUrl accepts only valid hyper drive URLs', () => {
  assert.deepEqual(parseHyperUrl(`hyper://${KEY}/docs/readme?x=1#top`), {
    key: KEY,
    path: '/docs/readme',
    search: '?x=1',
    hash: '#top'
  })
  assert.throws(() => parseHyperUrl(`https://${KEY}/`), /Only hyper:\/\//)
  assert.throws(() => parseHyperUrl('hyper://not-a-key/'), /Invalid hyper:\/\/ drive key/)
})

test('buildNavigateResponse issues token and preserves path, query, and hash', () => {
  const res = buildNavigateResponse({
    url: `hyper://${Z32_KEY}/hello/world?mode=test#section`,
    proxyPort: 8123,
    issueApiToken: (key) => `token-for-${key.slice(0, 8)}`
  })

  assert.equal(res.key, KEY)
  assert.equal(res.path, '/hello/world')
  assert.equal(res.proxyPort, 8123)
  assert.equal(res.apiToken, 'token-for-aaaaaaaa')
  assert.equal(res.localUrl, `http://127.0.0.1:8123/hyper/${KEY}/hello/world?mode=test#section`)
})

test('buildNavigateResponse fails closed without proxy or token', () => {
  assert.throws(() => buildNavigateResponse({
    url: `hyper://${KEY}/`,
    proxyPort: 0,
    issueApiToken: () => 'token'
  }), /Proxy not running/)

  assert.throws(() => buildNavigateResponse({
    url: `hyper://${KEY}/`,
    proxyPort: 8123,
    issueApiToken: () => ''
  }), /Could not issue page API token/)
})
