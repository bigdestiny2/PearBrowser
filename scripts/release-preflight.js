#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// These names are shared by the generated Expo shell, the native Kotlin shell,
// CI, and release documentation. A drift between any of them can turn a green
// preflight into an unsigned or debug-signed release artifact.
const ANDROID_SIGNING_ENV = [
  'PEARBROWSER_RELEASE_STORE_FILE',
  'PEARBROWSER_RELEASE_STORE_PASSWORD',
  'PEARBROWSER_RELEASE_KEY_ALIAS',
  'PEARBROWSER_RELEASE_KEY_PASSWORD'
]

function readText (root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function readJson (root, rel) {
  return JSON.parse(readText(root, rel))
}

function cleanValue (value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
}

function matchValue (text, re) {
  const m = text.match(re)
  return m ? cleanValue(m[1]) : ''
}

function yamlValue (text, key) {
  return matchValue(text, new RegExp(`\\b${key}:\\s*([^#\\n]*)`))
}

function yamlNestedValue (text, parentKey, childKey) {
  const parent = text.indexOf(`${parentKey}:`)
  if (parent === -1) return ''
  const rest = text.slice(parent)
  return yamlValue(rest, childKey)
}

function fileInfo (root, rel) {
  const full = path.join(root, rel)
  try {
    const st = fs.statSync(full)
    return { exists: true, file: st.isFile(), dir: st.isDirectory(), size: st.size, path: full }
  } catch {
    return { exists: false, file: false, dir: false, size: 0, path: full }
  }
}

function listDirs (root, rel, suffix) {
  const full = path.join(root, rel)
  try {
    return fs.readdirSync(full, { withFileTypes: true })
      .filter((ent) => ent.isDirectory() && (!suffix || ent.name.endsWith(suffix)))
      .map((ent) => ent.name)
  } catch {
    return []
  }
}

function sameDeclarations (left = {}, right = {}) {
  const sorted = (value) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
}

function selectorAllows (selector, value) {
  if (!Array.isArray(selector) || selector.length === 0) return true
  if (selector.includes('!' + value)) return false
  const allowed = selector.filter((item) => !item.startsWith('!'))
  return allowed.length === 0 || allowed.includes(value)
}

function hostLibc () {
  if (process.platform !== 'linux') return null
  try {
    return process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl'
  } catch {
    return null
  }
}

function hostRequiresOptional (name, locked) {
  const constrained = [locked.os, locked.cpu, locked.libc]
    .some((selector) => Array.isArray(selector) && selector.length > 0)
  if (!constrained) return false
  if (!selectorAllows(locked.os, process.platform) ||
      !selectorAllows(locked.cpu, process.arch)) return false
  const libc = hostLibc()
  if (process.platform === 'linux' && libc) {
    if (!selectorAllows(locked.libc, libc)) return false
    // Some npm locks predate the libc field: distinguish binary variants by
    // their package suffix so GNU hosts need not install the musl binary.
    if (name.endsWith('-musl') && libc !== 'musl') return false
    if (name.endsWith('-gnu') && libc !== 'glibc') return false
  }
  return true
}

function verifyOverrides (lock, overrides = {}) {
  for (const [name, requested] of Object.entries(overrides)) {
    // npm lock v3 does not record root overrides, so compare each resolved
    // instance with the exact replacement requested by package.json.
    if (!/^(?:@[^/]+\/)?[^@/]+$/.test(name) ||
        typeof requested !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(requested)) {
      throw new Error('cannot verify override ' + name + '; use an exact top-level package version')
    }
    const suffix = 'node_modules/' + name
    const instances = Object.entries(lock.packages)
      .filter(([location]) => location === suffix || location.endsWith('/' + suffix))
    if (instances.length === 0) {
      throw new Error('override ' + name + ' has no resolved package in package-lock.json')
    }
    for (const [location, locked] of instances) {
      if (locked.version !== requested) {
        throw new Error('override ' + name + '@' + requested + ' is not applied at ' + location +
          ' (locked ' + (locked.version || 'missing') + ')')
      }
    }
  }
}

function verifyDependencyLock (root, pkg) {
  const lock = readJson(root, 'package-lock.json')
  const lockedRoot = lock.packages && lock.packages['']
  if (!lockedRoot || lock.lockfileVersion < 2) throw new Error('package-lock.json has no supported root package record')
  if (lockedRoot.version !== pkg.version ||
      !sameDeclarations(pkg.dependencies, lockedRoot.dependencies) ||
      !sameDeclarations(pkg.devDependencies, lockedRoot.devDependencies) ||
      !sameDeclarations(pkg.optionalDependencies, lockedRoot.optionalDependencies) ||
      (lockedRoot.overrides && !sameDeclarations(pkg.overrides, lockedRoot.overrides))) {
    throw new Error('package.json and package-lock.json root version or dependencies differ')
  }

  verifyOverrides(lock, pkg.overrides)

  // bare-pack reads installed packages, not the lockfile. A stale node_modules
  // tree could otherwise reproduce a stale bundle and appear fresh.
  const installedLock = readJson(root, 'node_modules/.package-lock.json')
  const installedPackages = installedLock.packages || {}
  for (const [name, locked] of Object.entries(lock.packages)) {
    if (!name.startsWith('node_modules/')) continue
    const installed = installedPackages[name]
    const requiredOptional = locked.optional && hostRequiresOptional(name, locked)
    if (!installed) {
      if (locked.optional && !requiredOptional) continue // Other-platform binaries may be omitted.
      throw new Error('installed dependency ' + name + ' is missing; run npm ci')
    }
    if (installed.version !== locked.version || (locked.integrity && installed.integrity !== locked.integrity)) {
      throw new Error('installed dependency ' + name + ' differs from package-lock.json; run npm ci')
    }
    if (requiredOptional) {
      let installedPackage
      try {
        installedPackage = readJson(root, name + '/package.json')
      } catch {
        throw new Error('host-required optional dependency ' + name + ' is missing on disk; run npm ci')
      }
      if (installedPackage.version !== locked.version) {
        throw new Error('host-required optional dependency ' + name + ' differs from package-lock.json; run npm ci')
      }
    }
  }
  for (const name of Object.keys(installedPackages)) {
    if (!lock.packages[name]) throw new Error('installed dependency ' + name + ' is absent from package-lock.json; run npm ci')
  }

  const declared = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const name of Object.keys(declared).sort()) {
    const locked = lock.packages['node_modules/' + name]
    if (!locked || !locked.version) throw new Error('package-lock.json has no resolved ' + name)
    let installed
    try {
      installed = readJson(root, 'node_modules/' + name + '/package.json')
    } catch {
      throw new Error('installed ' + name + ' is missing; run npm ci')
    }
    if (installed.version !== locked.version) {
      throw new Error('installed ' + name + '@' + installed.version + ' differs from lockfile ' + locked.version + '; run npm ci')
    }
  }
  return Object.keys(declared).length
}

function sha256File (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function rebuildNativeBundle (root, host, output) {
  const barePack = path.join(root, 'node_modules/bare-pack/bin.js')
  const result = spawnSync(process.execPath, [
    barePack, '--linked', '--host', host, 'backend/index.js', '-o', output
  ], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error('bare-pack ' + host + ' failed: ' + ((result.stderr || result.stdout || '').trim().slice(-1200) || ('exit ' + result.status)))
  }
}

function verifyNativeBundle (root, rel, host, rebuildBundle = rebuildNativeBundle) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pearbrowser-preflight-bundle-'))
  try {
    const output = path.join(temp, path.basename(rel))
    rebuildBundle(root, host, output)
    const actual = sha256File(path.join(root, rel))
    const expected = sha256File(output)
    return { fresh: actual === expected, actual, expected }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

function collectPreflight (root = process.cwd(), options = {}) {
  const env = options.env || process.env
  const checks = []

  function add (status, id, label, detail, remediation) {
    checks.push({
      status,
      id,
      label,
      detail: detail || '',
      remediation: remediation || ''
    })
  }

  let pkg = null
  let app = null
  let gradle = ''
  let project = ''

  try {
    pkg = readJson(root, 'package.json')
    add('pass', 'package-json', 'package.json readable', `version ${pkg.version || '(missing)'}`)
  } catch (err) {
    add('fail', 'package-json', 'package.json readable', err.message)
  }

  try {
    app = readJson(root, 'app.json').expo
    add('pass', 'app-json', 'app.json readable', `expo slug ${app.slug || '(missing)'}`)
  } catch (err) {
    add('fail', 'app-json', 'app.json readable', err.message)
  }

  try {
    gradle = readText(root, 'android-native/app/build.gradle.kts')
    add('pass', 'android-gradle', 'Android Gradle config readable', 'android-native/app/build.gradle.kts')
  } catch (err) {
    add('fail', 'android-gradle', 'Android Gradle config readable', err.message)
  }

  const missingSigningVars = ANDROID_SIGNING_ENV.filter((name) => !gradle.includes(`environmentVariable("${name}")`))
  if (gradle && missingSigningVars.length === 0) {
    add('pass', 'android-signing-contract', 'Android native signing contract is aligned', ANDROID_SIGNING_ENV.join(', '))
  } else {
    add('fail', 'android-signing-contract', 'Android native signing contract is aligned', `missing ${missingSigningVars.join(', ') || 'Gradle configuration'}`, 'Make android-native/app/build.gradle.kts consume the canonical PEARBROWSER_RELEASE_* signing variables used by CI and the generated Expo shell.')
  }

  try {
    project = readText(root, 'ios-native/project.yml')
    add('pass', 'ios-project', 'iOS XcodeGen config readable', 'ios-native/project.yml')
  } catch (err) {
    add('fail', 'ios-project', 'iOS XcodeGen config readable', err.message)
  }

  const packageVersion = pkg?.version || ''
  const expoVersion = app?.version || ''
  const androidVersionName = matchValue(gradle, /versionName\s*=\s*"([^"]+)"/)
  const iosMarketingVersion = yamlValue(project, 'MARKETING_VERSION')
  const versionValues = [packageVersion, expoVersion, androidVersionName, iosMarketingVersion].filter(Boolean)
  const uniqueVersions = new Set(versionValues)
  if (versionValues.length === 4 && uniqueVersions.size === 1) {
    add('pass', 'version-lock', 'Release version is aligned', packageVersion)
  } else {
    add('fail', 'version-lock', 'Release version is aligned', `package=${packageVersion || '?'} expo=${expoVersion || '?'} android=${androidVersionName || '?'} ios=${iosMarketingVersion || '?'}`, 'Keep package.json, app.json, Android versionName, and iOS MARKETING_VERSION in lockstep.')
  }

  const androidPackage = app?.android?.package || ''
  const androidNamespace = matchValue(gradle, /namespace\s*=\s*"([^"]+)"/)
  const androidApplicationId = matchValue(gradle, /applicationId\s*=\s*"([^"]+)"/)
  if (androidPackage && androidNamespace === androidPackage && androidApplicationId === androidPackage) {
    add('pass', 'android-ids', 'Android package IDs are aligned', androidPackage)
  } else {
    add('fail', 'android-ids', 'Android package IDs are aligned', `app.json=${androidPackage || '?'} namespace=${androidNamespace || '?'} applicationId=${androidApplicationId || '?'}`, 'Use one production Android package ID everywhere.')
  }

  const iosBundleId = app?.ios?.bundleIdentifier || ''
  const iosProductBundleId = yamlValue(project, 'PRODUCT_BUNDLE_IDENTIFIER')
  if (iosBundleId && iosProductBundleId === iosBundleId) {
    add('pass', 'ios-bundle-id', 'iOS bundle IDs are aligned', iosBundleId)
  } else {
    add('fail', 'ios-bundle-id', 'iOS bundle IDs are aligned', `app.json=${iosBundleId || '?'} project.yml=${iosProductBundleId || '?'}`, 'Use one production iOS bundle identifier everywhere.')
  }

  const minSdk = Number(matchValue(gradle, /minSdk\s*=\s*(\d+)/))
  const targetSdk = Number(matchValue(gradle, /targetSdk\s*=\s*(\d+)/))
  const compileSdk = Number(matchValue(gradle, /compileSdk\s*=\s*(\d+)/))
  if (minSdk >= 29 && targetSdk >= 35 && compileSdk >= 35) {
    add('pass', 'android-sdk-floor', 'Android SDK targets are release-grade', `min=${minSdk} target=${targetSdk} compile=${compileSdk}`)
  } else {
    add('fail', 'android-sdk-floor', 'Android SDK targets are release-grade', `min=${minSdk || '?'} target=${targetSdk || '?'} compile=${compileSdk || '?'}`, 'Keep minSdk >= 29 and target/compile SDK at the audited release level.')
  }

  const iosDeploymentTarget = yamlNestedValue(project, 'deploymentTarget', 'iOS')
  if (iosDeploymentTarget && Number(iosDeploymentTarget) >= 16) {
    add('pass', 'ios-deployment-target', 'iOS deployment target is release-grade', iosDeploymentTarget)
  } else {
    add('fail', 'ios-deployment-target', 'iOS deployment target is release-grade', iosDeploymentTarget || '(missing)', 'Keep the native shell deployment target at iOS 16.0 or newer.')
  }

  try {
    const count = verifyDependencyLock(root, pkg)
    add('pass', 'dependency-lock', 'Package lock and installed dependency tree are aligned', String(count) + ' direct packages; resolved tree checked')
  } catch (err) {
    add('fail', 'dependency-lock', 'Package lock and installed dependency tree are aligned', err.message, 'Run npm ci from the current package-lock.json before bundling or release preflight.')
  }

  for (const [id, rel, host] of [
    ['ios-worklet-bundle', 'backend/dist/backend.ios.bundle', 'ios-arm64'],
    ['android-worklet-bundle', 'backend/dist/backend.android.bundle', 'android-arm64']
  ]) {
    const info = fileInfo(root, rel)
    if (info.file && info.size > 1024 * 1024) {
      add('pass', id, `${rel} exists`, `${Math.round(info.size / 1024)} KiB`)
      try {
        const result = verifyNativeBundle(root, rel, host, options.rebuildBundle)
        if (result.fresh) {
          add('pass', id + '-freshness', rel + ' matches current worklet inputs', result.actual.slice(0, 16))
        } else {
          add('fail', id + '-freshness', rel + ' matches current worklet inputs', 'artifact ' + result.actual.slice(0, 16) + '; rebuilt ' + result.expected.slice(0, 16), 'Run npm ci && npm run bundle-all-native, then repeat release preflight.')
        }
      } catch (err) {
        add('fail', id + '-freshness', rel + ' matches current worklet inputs', err.message, 'Install dependencies with npm ci, regenerate native bundles, and repeat release preflight.')
      }
    } else {
      add('fail', id, `${rel} exists`, info.exists ? `${info.size} bytes` : 'missing', 'Run npm run bundle-all-native before native release builds.')
    }
  }

  const bareKit = fileInfo(root, 'ios-native/PearBrowser/Frameworks/BareKit.xcframework')
  const addons = listDirs(root, 'ios-native/PearBrowser/Frameworks/addons', '.xcframework')
  if (bareKit.dir && addons.length >= 10) {
    add('pass', 'ios-barekit', 'iOS BareKit and native addons are present', `${addons.length} addon frameworks`)
  } else {
    add('fail', 'ios-barekit', 'iOS BareKit and native addons are present', `BareKit=${bareKit.dir ? 'yes' : 'no'} addons=${addons.length}`, 'Run npm run barekit:fetch and npm run barekit:fetch:addons.')
  }

  const androidAar = fileInfo(root, 'android-native/app/libs/bare-kit.aar')
  if (androidAar.file && androidAar.size > 1024 * 1024) {
    add('pass', 'android-barekit', 'Android BareKit AAR is present', `${Math.round(androidAar.size / 1024 / 1024)} MiB`)
  } else {
    add('fail', 'android-barekit', 'Android BareKit AAR is present', androidAar.exists ? `${androidAar.size} bytes` : 'missing', 'Run npm run barekit:fetch and confirm the native Android worklet is not in demo fallback mode.')
  }

  const missingAndroidSigning = ANDROID_SIGNING_ENV.filter((name) => !String(env[name] || '').trim())
  const androidKeystore = String(env.PEARBROWSER_RELEASE_STORE_FILE || '').trim()
  if (missingAndroidSigning.length > 0) {
    add('fail', 'android-release-signing', 'Android production signing env is configured', `missing ${missingAndroidSigning.join(', ')}`, 'Set PEARBROWSER_RELEASE_STORE_FILE, PEARBROWSER_RELEASE_STORE_PASSWORD, PEARBROWSER_RELEASE_KEY_ALIAS, and PEARBROWSER_RELEASE_KEY_PASSWORD for the real release keystore used by both Android shells.')
  } else if (!path.isAbsolute(androidKeystore)) {
    add('fail', 'android-release-signing', 'Android production signing env is configured', 'PEARBROWSER_RELEASE_STORE_FILE must be an absolute path', 'Use an absolute path so Gradle signs the intended keystore.')
  } else if (!fs.existsSync(androidKeystore)) {
    add('fail', 'android-release-signing', 'Android production signing env is configured', `keystore missing: ${androidKeystore}`, 'Point PEARBROWSER_RELEASE_STORE_FILE at the production release/upload keystore.')
  } else {
    add('pass', 'android-release-signing', 'Android production signing env is configured', `${path.basename(androidKeystore)}; explicit key password`)
  }

  const teamFromConfig = yamlValue(project, 'DEVELOPMENT_TEAM')
  const team = String(env.PEARBROWSER_IOS_DEVELOPMENT_TEAM || teamFromConfig || '').trim()
  if (team) {
    add('pass', 'ios-release-signing', 'iOS production team is configured', team)
  } else {
    add('fail', 'ios-release-signing', 'iOS production team is configured', 'DEVELOPMENT_TEAM is blank and PEARBROWSER_IOS_DEVELOPMENT_TEAM is unset', 'Set the Apple development team before device archive/TestFlight release.')
  }

  const easProjectId = app?.extra?.eas?.projectId || ''
  if (app?.owner && easProjectId) {
    add('pass', 'eas-project', 'EAS project identity is present', `${app.owner}/${easProjectId}`)
  } else {
    add('warn', 'eas-project', 'EAS project identity is present', `owner=${app?.owner || '?'} projectId=${easProjectId || '?'}`, 'Fill app.json extra.eas.projectId and owner if using EAS distribution.')
  }

  if (env.PEARBROWSER_TESTFLIGHT_VALIDATED === '1' || env.PEARBROWSER_APP_STORE_CONNECT_VALIDATED === '1') {
    add('pass', 'ios-store-validation', 'iOS TestFlight/App Store Connect validation is recorded', 'validated marker present')
  } else {
    add('fail', 'ios-store-validation', 'iOS TestFlight/App Store Connect validation is recorded', 'missing PEARBROWSER_TESTFLIGHT_VALIDATED=1 or PEARBROWSER_APP_STORE_CONNECT_VALIDATED=1', 'Archive with production signing and upload/validate in App Store Connect or TestFlight.')
  }

  if (env.PEARBROWSER_PLAY_CONSOLE_VALIDATED === '1' || env.PEARBROWSER_FIREBASE_APP_DISTRIBUTION_VALIDATED === '1') {
    add('pass', 'android-store-validation', 'Android Play/Firebase distribution validation is recorded', 'validated marker present')
  } else {
    add('fail', 'android-store-validation', 'Android Play/Firebase distribution validation is recorded', 'missing PEARBROWSER_PLAY_CONSOLE_VALIDATED=1 or PEARBROWSER_FIREBASE_APP_DISTRIBUTION_VALIDATED=1', 'Upload the signed AAB/APK to Play Console or Firebase App Distribution and record the validation marker.')
  }

  const blockers = checks.filter((check) => check.status === 'fail')
  const warnings = checks.filter((check) => check.status === 'warn')
  return {
    ok: blockers.length === 0,
    root,
    checkedAt: new Date().toISOString(),
    counts: { pass: checks.filter((c) => c.status === 'pass').length, warn: warnings.length, fail: blockers.length },
    checks,
    blockers,
    warnings
  }
}

function printHuman (report) {
  console.log(`PearBrowser mobile release preflight (${report.ok ? 'PASS' : 'BLOCKED'})`)
  console.log(`root: ${report.root}`)
  console.log(`checks: ${report.counts.pass} pass, ${report.counts.warn} warn, ${report.counts.fail} fail`)
  console.log('')
  for (const check of report.checks) {
    const mark = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL'
    console.log(`${mark} ${check.id}: ${check.label}`)
    if (check.detail) console.log(`     ${check.detail}`)
    if (check.status !== 'pass' && check.remediation) console.log(`     fix: ${check.remediation}`)
  }
}

function parseCli (argv) {
  const opts = { root: process.cwd(), json: false, soft: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root') opts.root = path.resolve(argv[++i] || opts.root)
    else if (arg === '--json') opts.json = true
    else if (arg === '--soft') opts.soft = true
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/release-preflight.js [--root <repo>] [--json] [--soft]')
      process.exit(0)
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  return opts
}

if (require.main === module) {
  let opts
  try {
    opts = parseCli(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    process.exit(2)
  }
  const report = collectPreflight(opts.root)
  if (opts.json) console.log(JSON.stringify(report, null, 2))
  else printHuman(report)
  process.exit(report.ok || opts.soft ? 0 : 1)
}

module.exports = { collectPreflight }
