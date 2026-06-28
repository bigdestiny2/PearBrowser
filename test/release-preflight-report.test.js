const { test } = require('node:test')
const assert = require('node:assert/strict')

const { analyzeReport } = require('../scripts/check-release-preflight-report')

function report (checks) {
  const blockers = checks.filter((check) => check.status === 'fail')
  const warnings = checks.filter((check) => check.status === 'warn')
  return {
    counts: {
      pass: checks.filter((check) => check.status === 'pass').length,
      warn: warnings.length,
      fail: blockers.length
    },
    checks,
    blockers,
    warnings
  }
}

test('preflight report checker accepts only documented production blockers in soft mode', () => {
  const result = analyzeReport(report([
    { status: 'pass', id: 'version-lock' },
    { status: 'fail', id: 'android-release-signing' },
    { status: 'fail', id: 'ios-release-signing' },
    { status: 'fail', id: 'ios-store-validation' },
    { status: 'fail', id: 'android-store-validation' }
  ]), { allowProductionBlockers: true })

  assert.equal(result.ok, true)
  assert.equal(result.counts.unexpectedBlockers, 0)
})

test('preflight report checker fails on structural blockers', () => {
  const result = analyzeReport(report([
    { status: 'pass', id: 'version-lock' },
    { status: 'fail', id: 'android-ids', detail: 'wrong app id' },
    { status: 'fail', id: 'android-release-signing' }
  ]), { allowProductionBlockers: true })

  assert.equal(result.ok, false)
  assert.deepEqual(result.unexpectedBlockers.map((check) => check.id), ['android-ids'])
})

test('preflight report checker fails on warnings unless explicitly allowed', () => {
  const blocked = analyzeReport(report([
    { status: 'warn', id: 'eas-project' }
  ]), { allowProductionBlockers: true })
  const allowed = analyzeReport(report([
    { status: 'warn', id: 'eas-project' }
  ]), { allowProductionBlockers: true, allowWarnings: true })

  assert.equal(blocked.ok, false)
  assert.equal(allowed.ok, true)
})
