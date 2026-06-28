#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const PRODUCTION_BLOCKERS = new Set([
  'android-release-signing',
  'ios-release-signing',
  'ios-store-validation',
  'android-store-validation'
])

function analyzeReport (report, options = {}) {
  const allowProductionBlockers = Boolean(options.allowProductionBlockers)
  const allowWarnings = Boolean(options.allowWarnings)
  const blockers = Array.isArray(report.blockers)
    ? report.blockers
    : (report.checks || []).filter((check) => check.status === 'fail')
  const warnings = Array.isArray(report.warnings)
    ? report.warnings
    : (report.checks || []).filter((check) => check.status === 'warn')

  const unexpectedBlockers = blockers.filter((check) => {
    return !(allowProductionBlockers && PRODUCTION_BLOCKERS.has(check.id))
  })
  const unexpectedWarnings = allowWarnings ? [] : warnings

  return {
    ok: unexpectedBlockers.length === 0 && unexpectedWarnings.length === 0,
    counts: {
      pass: report.counts?.pass || (report.checks || []).filter((check) => check.status === 'pass').length,
      warn: warnings.length,
      fail: blockers.length,
      unexpectedBlockers: unexpectedBlockers.length,
      unexpectedWarnings: unexpectedWarnings.length
    },
    blockers,
    warnings,
    unexpectedBlockers,
    unexpectedWarnings
  }
}

function parseArgs (argv) {
  const opts = {
    file: '',
    allowProductionBlockers: false,
    allowWarnings: false
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--allow-production-blockers') opts.allowProductionBlockers = true
    else if (arg === '--allow-warnings') opts.allowWarnings = true
    else if (arg === '-h' || arg === '--help') usage(0)
    else if (!opts.file) opts.file = arg
    else usage(2, `unknown argument: ${arg}`)
  }

  if (!opts.file) usage(2, 'missing preflight report path')
  opts.file = path.resolve(opts.file)
  return opts
}

function usage (code, message = '') {
  if (message) console.error(`error: ${message}`)
  console.error('usage: node scripts/check-release-preflight-report.js <report.json> [--allow-production-blockers] [--allow-warnings]')
  process.exit(code)
}

function printSummary (file, result) {
  console.log(`Mobile release preflight report: ${file}`)
  console.log(`  passed:              ${result.counts.pass}`)
  console.log(`  warnings:            ${result.counts.warn}`)
  console.log(`  blockers:            ${result.counts.fail}`)
  console.log(`  unexpected blockers: ${result.counts.unexpectedBlockers}`)
  console.log(`  unexpected warnings: ${result.counts.unexpectedWarnings}`)

  const printItems = (label, items) => {
    if (!items.length) return
    console.log('')
    console.log(label)
    for (const item of items) {
      console.log(`  - ${item.id}: ${item.detail || item.label || item.status}`)
      if (item.remediation) console.log(`    fix: ${item.remediation}`)
    }
  }

  printItems('Unexpected blockers', result.unexpectedBlockers)
  printItems('Unexpected warnings', result.unexpectedWarnings)
  console.log('')
  console.log(result.ok ? 'Mobile release preflight report is within the expected gate envelope.' : 'Mobile release preflight report has unexpected release blockers.')
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2))
  const report = JSON.parse(fs.readFileSync(opts.file, 'utf8'))
  const result = analyzeReport(report, opts)
  printSummary(opts.file, result)
  process.exit(result.ok ? 0 : 1)
}

module.exports = {
  PRODUCTION_BLOCKERS,
  analyzeReport
}
