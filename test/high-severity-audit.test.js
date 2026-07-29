import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectBraceExpansionVersions,
  evaluateHighSeverityAudit,
  isPatchedBraceExpansionVersion
} from '../scripts/check-high-severity-audit.mjs'

const advisory = {
  source: 1124334,
  name: 'brace-expansion',
  severity: 'high',
  url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg'
}

function lockWith (...versions) {
  return {
    packages: Object.fromEntries(versions.map((version, index) => [
      index === 0 ? 'node_modules/brace-expansion' : `node_modules/path-${index}/node_modules/brace-expansion`,
      { version }
    ]))
  }
}

test('brace-expansion policy accepts only the reviewed patched release lines', () => {
  assert.equal(isPatchedBraceExpansionVersion('1.1.17'), true)
  assert.equal(isPatchedBraceExpansionVersion('5.0.8'), true)
  assert.equal(isPatchedBraceExpansionVersion('1.1.16'), false)
  assert.equal(isPatchedBraceExpansionVersion('5.0.7'), false)
  assert.equal(isPatchedBraceExpansionVersion('2.0.3'), false)
  assert.deepEqual(collectBraceExpansionVersions(lockWith('5.0.8', '1.1.17')), ['1.1.17', '5.0.8'])
})

test('audit policy accepts a meta-chain only when it reaches the reviewed advisory and patched leaves', () => {
  const result = evaluateHighSeverityAudit({
    vulnerabilities: {
      'brace-expansion': { severity: 'high', via: [advisory] },
      minimatch: { severity: 'high', via: ['brace-expansion'] },
      glob: { severity: 'high', via: ['minimatch'] },
      'react-native': { severity: 'high', via: ['glob'] }
    }
  }, lockWith('1.1.17', '5.0.8'))
  assert.equal(result.ok, true)
  assert.deepEqual(result.acknowledged.sort(), ['brace-expansion', 'glob', 'minimatch', 'react-native'])
})

test('audit policy blocks a vulnerable leaf even when npm reports only the reviewed advisory', () => {
  const result = evaluateHighSeverityAudit({
    vulnerabilities: { 'brace-expansion': { severity: 'high', via: [advisory] } }
  }, lockWith('1.1.16'))
  assert.equal(result.ok, false)
  assert.match(result.blockers.join('\n'), /Unpatched or unreviewed/)
})

test('audit policy fails closed on a new or unresolved high-severity root', () => {
  const newAdvisory = evaluateHighSeverityAudit({
    vulnerabilities: {
      other: { severity: 'critical', via: [{ name: 'other', severity: 'critical', url: 'https://example.invalid/new-advisory' }] }
    }
  }, lockWith('1.1.17'))
  assert.equal(newAdvisory.ok, false)
  assert.match(newAdvisory.blockers.join('\n'), /unapproved high\/critical advisory/)

  const unresolved = evaluateHighSeverityAudit({
    vulnerabilities: { parent: { severity: 'high', via: ['missing-child'] } }
  }, lockWith('5.0.8'))
  assert.equal(unresolved.ok, false)
  assert.match(unresolved.blockers.join('\n'), /missing-child/)
})
