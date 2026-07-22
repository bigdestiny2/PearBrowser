'use strict'

/**
 * Pear Plugins registry tests — ported from
 * pearbrowser-desktop/test/pear-plugins.test.js (converted to this repo's
 * CJS test style). backend/pear-plugins.cjs is a verbatim port, so these
 * assert the same behavior contract as the desktop.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { ContentShield } = require('../backend/content-shield.cjs')
const {
  PearPluginRegistry,
  parsePluginManifest,
  PLUGIN_CAPABILITIES
} = require('../backend/pear-plugins.cjs')

const FIXTURE_MANIFEST = {
  name: 'fixture-blocker',
  version: '1.0.0',
  pear: {
    plugin: true,
    capabilities: ['pear.net.filter', 'pear.content.styles', 'pear.content.scripts']
  },
  content: {
    filters: '||plugin-tracker.example^\n##.plugin-ad',
    styles: { matches: ['*'], css: '.plugin-banner { opacity: 0; }' },
    scripts: { matches: ['news.example'], js: 'window.__fixturePlugin = true' }
  }
}

test('parsePluginManifest is fail-closed without pear.plugin', () => {
  assert.equal(parsePluginManifest(null).ok, false)
  assert.equal(parsePluginManifest({ name: 'x' }).ok, false)
  assert.equal(parsePluginManifest({ pear: { plugin: false } }).ok, false)
  const ok = parsePluginManifest(FIXTURE_MANIFEST)
  assert.equal(ok.ok, true)
  assert.equal(ok.name, 'fixture-blocker')
  assert.ok(ok.capabilities.includes('pear.net.filter'))
  assert.ok(PLUGIN_CAPABILITIES.includes('pear.net.filter'))
})

test('registry register + kill-switch drives ContentShield contributions', () => {
  const shield = new ContentShield({ builtinList: false })
  const reg = new PearPluginRegistry({ shield })

  const bad = reg.register({ id: 'not-plugin', manifest: { name: 'nope' } })
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'not-a-plugin')

  const result = reg.register({
    id: 'fixture-blocker',
    manifest: FIXTURE_MANIFEST
  })
  assert.equal(result.ok, true)
  assert.equal(result.enabled, true)
  assert.equal(result.applied.filters, true)
  assert.equal(result.applied.styles, true)
  assert.equal(result.applied.scripts, true)

  assert.equal(shield.shouldBlockUrl('https://plugin-tracker.example/pixel').blocked, true)
  assert.match(shield.cosmeticCssFor('x'), /\.plugin-ad/)
  assert.match(shield.pluginStylesFor('x'), /\.plugin-banner/)
  assert.equal(shield.pluginScriptsFor('news.example').length, 1)

  // Kill switch without uninstall
  const killed = reg.setEnabled('fixture-blocker', false)
  assert.equal(killed.ok, true)
  assert.equal(killed.enabled, false)
  assert.equal(shield.shouldBlockUrl('https://plugin-tracker.example/pixel').blocked, false)
  assert.equal(shield.pluginStylesFor('x'), '')
  assert.deepEqual(shield.pluginScriptsFor('news.example'), [])

  // Plugin still listed
  const listed = reg.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].enabled, false)

  // Re-enable restores contributions
  reg.setEnabled('fixture-blocker', true)
  assert.equal(shield.shouldBlockUrl('https://plugin-tracker.example/pixel').blocked, true)
  assert.match(shield.pluginStylesFor('x'), /\.plugin-banner/)
})

test('missing capability means contribution has no effect even if payload present', () => {
  const shield = new ContentShield({ builtinList: false })
  const reg = new PearPluginRegistry({ shield })
  const result = reg.register({
    id: 'styles-only',
    manifest: {
      name: 'styles-only',
      pear: { plugin: true, capabilities: ['pear.content.styles'] }
    },
    contribution: {
      filters: '||should-not-block.example^',
      styles: '.ok { color: red }',
      scripts: 'window.x=1'
    }
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied.filters, false)
  assert.equal(result.applied.styles, true)
  assert.equal(result.applied.scripts, false)
  assert.equal(shield.shouldBlockUrl('https://should-not-block.example/').blocked, false)
  assert.match(shield.pluginStylesFor('x'), /\.ok/)
  assert.deepEqual(shield.pluginScriptsFor('x'), [])
})

test('unregister removes plugin and its rules', () => {
  const shield = new ContentShield({ builtinList: false })
  const reg = new PearPluginRegistry({ shield })
  reg.register({ id: 'tmp', manifest: FIXTURE_MANIFEST })
  assert.equal(shield.shouldBlockUrl('https://plugin-tracker.example/x').blocked, true)
  assert.equal(reg.unregister('tmp'), true)
  assert.equal(reg.get('tmp'), null)
  assert.equal(shield.shouldBlockUrl('https://plugin-tracker.example/x').blocked, false)
})
