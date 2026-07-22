'use strict'

/**
 * Content Shield engine tests — ported from
 * pearbrowser-desktop/test/content-shield.test.js (converted to this repo's
 * CJS test style). The engine is a verbatim port, so these assert the same
 * behavior contract as the desktop.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { ContentShield, parseFilterList, BUILTIN_FILTER_LIST } = require('../backend/content-shield.cjs')

test('filter parsing supports the documented ABP/hosts subset', () => {
  const parsed = parseFilterList(`
! comment line
[Adblock Plus 2.0]
||ads.example.com^
||cdn.example.com/banners/^
/pixel/track.gif
@@||ads.example.com/allowed^
##.ad-banner
example.com###sponsored
# hosts-style comment
0.0.0.0 tracker.example.net
127.0.0.1 localhost
||optioned.example.com^$third-party
||documented.example.com^$document
abc
badcosmetic##{}
`)

  assert.deepEqual(parsed.block.map(rule => [rule.kind, rule.value]), [
    ['host', 'ads.example.com'],
    ['substring', 'cdn.example.com/banners/'],
    ['substring', '/pixel/track.gif'],
    ['host', 'tracker.example.net'],
    ['host', 'documented.example.com']
  ])
  assert.deepEqual(parsed.exceptions.map(rule => rule.kind), ['substring'])
  assert.deepEqual(parsed.cosmetic, [
    { host: null, selector: '.ad-banner' },
    { host: 'example.com', selector: '#sponsored' }
  ])
})

test('network blocking matches hosts, subdomains, and substrings; exceptions win', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', `
||ads.example.com^
/pixel/track.gif
@@||ads.example.com/allowed^
`)

  assert.equal(shield.shouldBlockUrl('https://ads.example.com/banner.js').blocked, true)
  assert.equal(shield.shouldBlockUrl('https://sub.ads.example.com/x.js').blocked, true)
  assert.equal(shield.shouldBlockUrl('https://example.com/page.html').blocked, false)
  assert.equal(shield.shouldBlockUrl('hyper://abc123/assets/pixel/track.gif').blocked, true)
  assert.equal(shield.shouldBlockUrl('https://ads.example.com/allowed/x.js').blocked, false)

  const stats = shield.stats()
  assert.equal(stats.blocked, 3)
  assert.equal(stats.allowed, 2) // one plain allow + one exception hit
  assert.ok(stats.topRules.length >= 1)
})

test('hyper URLs carrying clearnet-shaped ad paths are caught by host rules', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', '||doubleclick.net^')
  const key = 'a'.repeat(64)
  assert.equal(shield.shouldBlockUrl(`hyper://${key}/vendor/doubleclick.net/ad.js`).blocked, true)
  assert.equal(shield.shouldBlockUrl(`hyper://${key}/index.html`).blocked, false)
})

test('cosmetic CSS scopes global and per-host rules', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', `
##.ad-banner
example.com###sponsored
other.com##.other-ad
`)

  const globalCss = shield.cosmeticCssFor('unrelated.net')
  assert.match(globalCss, /\.ad-banner/)
  assert.doesNotMatch(globalCss, /#sponsored/)

  const scoped = shield.cosmeticCssFor('www.example.com')
  assert.match(scoped, /\.ad-banner/)
  assert.match(scoped, /#sponsored/)
  assert.doesNotMatch(scoped, /\.other-ad/)
  assert.match(scoped, /display: none !important/)
})

test('disabling the shield passes everything through and empties cosmetic CSS', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('test', '||ads.example.com^\n##.ad')
  shield.setEnabled(false)

  assert.equal(shield.shouldBlockUrl('https://ads.example.com/x.js').blocked, false)
  assert.equal(shield.cosmeticCssFor('example.com'), '')
  assert.equal(shield.stats().enabled, false)
  // Disabled evaluation must not count traffic.
  assert.equal(shield.stats().blocked, 0)
  assert.equal(shield.stats().allowed, 0)
})

test('re-adding a list replaces it and removeList drops its rules', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('mine', '||old.example.com^')
  assert.equal(shield.shouldBlockUrl('https://old.example.com/').blocked, true)

  shield.addList('mine', '||new.example.com^')
  assert.equal(shield.shouldBlockUrl('https://old.example.com/').blocked, false)
  assert.equal(shield.shouldBlockUrl('https://new.example.com/').blocked, true)

  assert.equal(shield.removeList('mine'), true)
  assert.equal(shield.shouldBlockUrl('https://new.example.com/').blocked, false)
})

test('builtin seed list blocks canonical ad hosts and ships a cosmetic rule', () => {
  const shield = new ContentShield()
  assert.equal(shield.shouldBlockUrl('https://stats.doubleclick.net/pixel').blocked, true)
  assert.equal(shield.shouldBlockUrl('https://www.googletagmanager.com/gtm.js').blocked, true)
  assert.equal(shield.shouldBlockUrl('https://connect.facebook.net/en_US/fbevents.js').blocked, true)
  assert.equal(shield.shouldBlockUrl('https://cdn.segment.com/analytics.js').blocked, true)
  assert.equal(shield.shouldBlockUrl('https://static.hotjar.com/c/hotjar.js').blocked, true)
  assert.equal(shield.shouldBlockUrl('https://example.com/an-innocent-page').blocked, false)
  assert.match(shield.cosmeticCssFor('anything.example'), /\.adsbygoogle/)
  assert.match(BUILTIN_FILTER_LIST, /\|\|doubleclick\.net\^/)
  assert.ok(shield.stats().blockRules > 40)
})

test('malformed input never throws', () => {
  const shield = new ContentShield({ builtinList: false })
  shield.addList('junk', null)
  shield.addList('junk2', '||\n@@\n##\n$\n^^^^\n*')
  assert.equal(shield.shouldBlockUrl(null).blocked, false)
  assert.equal(shield.shouldBlockUrl('').blocked, false)
  assert.equal(shield.shouldBlockUrl('not a url at all').blocked, false)
  assert.equal(shield.cosmeticCssFor(null), '')
})
