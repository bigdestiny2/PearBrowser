'use strict'

/**
 * Privacy ladder unit tests — ported from
 * pearbrowser-desktop/test/privacy-policy.test.js (Mission B2).
 * The module is pure JS (global URL only), so no Bare stubs are needed.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  classifyUrl,
  sanitizeClearnetUrl,
  normalizeNavigationInput,
  looksLikeClearnetHost,
  fingerprintFarblingScript,
  normalizePrivacySettings,
  DEFAULT_PRIVACY
} = require('../backend/privacy-policy.cjs')

test('classifyUrl distinguishes hyper, clearnet, loopback', () => {
  assert.equal(classifyUrl('hyper://' + 'a'.repeat(64) + '/'), 'hyper')
  assert.equal(classifyUrl('https://example.com/x'), 'clearnet')
  assert.equal(classifyUrl('http://127.0.0.1:9876/hyper/x'), 'loopback')
  assert.equal(classifyUrl('not a url'), null)
})

test('HTTPS-only upgrades http navigations', () => {
  const { url, upgraded } = sanitizeClearnetUrl('http://example.com/path', { httpsOnly: true })
  assert.equal(upgraded, true)
  assert.equal(url, 'https://example.com/path')
  const off = sanitizeClearnetUrl('http://example.com/path', { httpsOnly: false })
  assert.equal(off.upgraded, false)
  assert.equal(off.url, 'http://example.com/path')
})

test('tracking parameters are stripped', () => {
  const { url, stripped } = sanitizeClearnetUrl(
    'https://news.example/a?utm_source=x&id=1&fbclid=abc&gclid=y',
    { stripTrackingParams: true, httpsOnly: true }
  )
  assert.ok(stripped.includes('utm_source'))
  assert.ok(stripped.includes('fbclid'))
  assert.ok(stripped.includes('gclid'))
  assert.match(url, /[?&]id=1/)
  assert.doesNotMatch(url, /utm_source/)
  assert.doesNotMatch(url, /fbclid/)
})

test('looksLikeClearnetHost and normalizeNavigationInput', () => {
  assert.equal(looksLikeClearnetHost('example.com'), true)
  assert.equal(looksLikeClearnetHost('www.example.co.uk/path'), true)
  assert.equal(looksLikeClearnetHost('keet'), false)
  assert.equal(looksLikeClearnetHost('a'.repeat(64)), false)
  assert.equal(normalizeNavigationInput('example.com'), 'https://example.com')
  // Structural only — privacy strip happens in SessionBridge.sanitizeClearnetUrl
  assert.equal(normalizeNavigationInput('https://example.com/?utm_source=x'), 'https://example.com/?utm_source=x')
  assert.match(normalizeNavigationInput('a'.repeat(64)), /^hyper:\/\//)
})

test('fingerprint farbling script is pure JS and origin-seeded', () => {
  const body = fingerprintFarblingScript('test-salt')
  assert.match(body, /__pearFarbling/)
  assert.match(body, /toDataURL/)
  assert.match(body, /getChannelData/)
  assert.doesNotMatch(body, /<script/)
  assert.match(body, /test-salt/)
})

test('normalizePrivacySettings fills defaults', () => {
  const p = normalizePrivacySettings({})
  assert.equal(p.httpsOnly, DEFAULT_PRIVACY.httpsOnly)
  assert.equal(p.clearnetMode, 'proxy')
  assert.equal(p.historyEnabled, false)
  assert.equal(p.searchIndexEnabled, false)
  assert.equal(p.telemetryEnabled, false)
  assert.equal(normalizePrivacySettings({ clearnetMode: 'direct' }).clearnetMode, 'direct')
  assert.equal(normalizePrivacySettings({ telemetryEnabled: true }).telemetryEnabled, false)
})
