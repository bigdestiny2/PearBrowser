#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const APPROVED_ROOT_ADVISORY = 'https://github.com/advisories/GHSA-mh99-v99m-4gvg'
const HIGH_SEVERITIES = new Set(['high', 'critical'])

function compareVersion (left, right) {
  const a = String(left).split('.').map((part) => Number.parseInt(part, 10))
  const b = String(right).split('.').map((part) => Number.parseInt(part, 10))
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return null
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] || 0) - (b[i] || 0)
    if (delta !== 0) return delta
  }
  return 0
}

export function collectBraceExpansionVersions (lock) {
  const versions = new Set()
  for (const [path, entry] of Object.entries(lock?.packages || {})) {
    if ((path === 'node_modules/brace-expansion' || path.endsWith('/node_modules/brace-expansion')) && entry?.version) {
      versions.add(String(entry.version))
    }
  }
  return [...versions].sort()
}

export function isPatchedBraceExpansionVersion (version) {
  const major = Number.parseInt(String(version).split('.')[0], 10)
  const minimum = major === 1 ? '1.1.17' : (major === 5 ? '5.0.8' : null)
  if (!minimum) return false
  const comparison = compareVersion(version, minimum)
  return comparison != null && comparison >= 0
}

function rootAdvisoriesFor (name, vulnerabilities, visiting = new Set()) {
  if (visiting.has(name)) return [{ unresolved: `cycle:${name}` }]
  const vulnerability = vulnerabilities[name]
  if (!vulnerability) return [{ unresolved: name }]

  const nextVisiting = new Set(visiting)
  nextVisiting.add(name)
  const roots = []
  for (const cause of vulnerability.via || []) {
    if (typeof cause === 'string') roots.push(...rootAdvisoriesFor(cause, vulnerabilities, nextVisiting))
    else if (cause && typeof cause === 'object') roots.push(cause)
    else roots.push({ unresolved: `${name}:invalid-via` })
  }
  return roots.length ? roots : [{ unresolved: `${name}:no-via` }]
}

export function evaluateHighSeverityAudit (audit, lock) {
  const vulnerabilities = audit?.vulnerabilities || {}
  const highEntries = Object.entries(vulnerabilities)
    .filter(([, vulnerability]) => HIGH_SEVERITIES.has(vulnerability?.severity))

  if (highEntries.length === 0) {
    return { ok: true, acknowledged: [], braceVersions: [] }
  }

  const braceVersions = collectBraceExpansionVersions(lock)
  const unpatchedBraceVersions = braceVersions.filter((version) => !isPatchedBraceExpansionVersion(version))
  const blockers = []
  const acknowledged = []

  if (braceVersions.length === 0) blockers.push('The audit reports the approved brace-expansion advisory, but no locked brace-expansion versions were found.')
  if (unpatchedBraceVersions.length) blockers.push(`Unpatched or unreviewed brace-expansion versions are locked: ${unpatchedBraceVersions.join(', ')}`)

  for (const [name] of highEntries) {
    const highRoots = rootAdvisoriesFor(name, vulnerabilities)
      .filter((root) => !root.severity || HIGH_SEVERITIES.has(root.severity))
    const unsafeRoots = highRoots.filter((root) => root.url !== APPROVED_ROOT_ADVISORY)
    if (highRoots.length === 0 || unsafeRoots.length) {
      const labels = unsafeRoots.map((root) => root.url || root.unresolved || root.name || 'unknown').join(', ')
      blockers.push(`${name} reaches an unapproved high/critical advisory${labels ? `: ${labels}` : ''}`)
    } else {
      acknowledged.push(name)
    }
  }

  return { ok: blockers.length === 0, blockers, acknowledged, braceVersions }
}

function runAudit () {
  const result = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
  if (!result.stdout) throw new Error(`npm audit produced no JSON output${result.stderr ? `: ${result.stderr.trim()}` : ''}`)
  return JSON.parse(result.stdout)
}

function main () {
  const audit = runAudit()
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const result = evaluateHighSeverityAudit(audit, lock)
  if (!result.ok) {
    console.error('High-severity dependency audit: FAIL')
    for (const blocker of result.blockers) console.error(`- ${blocker}`)
    process.exitCode = 1
    return
  }

  if (result.acknowledged.length) {
    console.log('High-severity dependency audit: PASS with one reviewed npm meta-advisory')
    console.log(`- patched brace-expansion versions: ${result.braceVersions.join(', ')}`)
    console.log(`- affected metadata nodes traced only to ${APPROVED_ROOT_ADVISORY}: ${result.acknowledged.length}`)
    console.log('- any new high/critical root advisory remains release-blocking')
  } else {
    console.log('High-severity dependency audit: PASS (no high/critical advisories)')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
