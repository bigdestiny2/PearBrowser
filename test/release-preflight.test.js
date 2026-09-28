const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { collectPreflight, inspectAndroidAar } = require('../scripts/release-preflight')

const REPO_ROOT = path.join(__dirname, '..')
const CANONICAL_ANDROID_SIGNING_ENV = [
  'PEARBROWSER_RELEASE_STORE_FILE',
  'PEARBROWSER_RELEASE_STORE_PASSWORD',
  'PEARBROWSER_RELEASE_KEY_ALIAS',
  'PEARBROWSER_RELEASE_KEY_PASSWORD'
]

function write (root, rel, content) {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

function writeSized (root, rel, size) {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, Buffer.alloc(size, 1))
}

function mkdir (root, rel) {
  fs.mkdirSync(path.join(root, rel), { recursive: true })
}


function bundleContent (root, host) {
  const digest = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'backend/index.js')))
    .update(fs.readFileSync(path.join(root, 'package-lock.json')))
    .update(host)
    .digest()
  const body = Buffer.alloc(1024 * 1024 + 10, 1)
  digest.copy(body)
  return body
}

function fixtureBundleBuilder (root, host, output) {
  fs.writeFileSync(output, bundleContent(root, host))
}

function collectFixture (root, env) {
  return collectPreflight(root, { env, rebuildBundle: fixtureBundleBuilder, inspectAndroidAar: () => ({ addonCount: 10, abiCount: 4 }) })
}

function makeFixture (opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearbrowser-release-preflight-'))
  const version = opts.version || '1.2.3'
  const androidId = opts.androidId || 'com.pearbrowser.app'
  const appAndroidId = opts.appAndroidId || androidId
  const iosId = opts.iosId || 'com.pearbrowser.app'
  const appIosId = opts.appIosId || iosId
  const team = Object.prototype.hasOwnProperty.call(opts, 'team') ? opts.team : 'TEAM12345'

  const dependencies = { autobase: '^7.28.1' }
  const overrides = { 'image-size': '2.0.4' }
  write(root, 'package.json', JSON.stringify({ version, dependencies, overrides }, null, 2))
  write(root, 'package-lock.json', JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { version, dependencies },
      'node_modules/autobase': { version: '7.28.2', integrity: 'sha512-autobase-fixture' },
      'node_modules/worker-dep': { version: '1.0.0', integrity: 'sha512-worker-fixture' },
      'node_modules/image-size': { version: '2.0.4', integrity: 'sha512-image-size-fixture' },
      'node_modules/other-platform': { version: '1.0.0', optional: true, os: ['neverland'] }
    }
  }, null, 2))
  write(root, 'node_modules/.package-lock.json', JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/autobase': { version: '7.28.2', integrity: 'sha512-autobase-fixture' },
      'node_modules/worker-dep': { version: '1.0.0', integrity: 'sha512-worker-fixture' },
      'node_modules/image-size': { version: '2.0.4', integrity: 'sha512-image-size-fixture' }
    }
  }, null, 2))
  write(root, 'node_modules/autobase/package.json', JSON.stringify({ version: '7.28.2' }))
  write(root, 'backend/index.js', '// fixture worklet source\n')
  write(root, 'app.json', JSON.stringify({
    expo: {
      slug: 'pear-browser',
      version,
      owner: 'bigdestiny22s-organization',
      ios: { bundleIdentifier: appIosId },
      android: { package: appAndroidId },
      extra: { eas: { projectId: 'f84eafc6-f7c2-4489-b81e-479410ab3340' } }
    }
  }, null, 2))
  write(root, 'android-native/app/build.gradle.kts', `
val releaseKeystorePath = providers.environmentVariable("${opts.signingStoreFileEnv || 'PEARBROWSER_RELEASE_STORE_FILE'}").orNull
val releaseStorePassword = providers.environmentVariable("PEARBROWSER_RELEASE_STORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("PEARBROWSER_RELEASE_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("PEARBROWSER_RELEASE_KEY_PASSWORD").orNull
android {
    namespace = "${androidId}"
    compileSdk = 35
    defaultConfig {
        applicationId = "${androidId}"
        minSdk = 29
        targetSdk = 35
        versionCode = 12
        versionName = "${version}"
    }
}
`)
  write(root, 'ios-native/project.yml', `
settings:
  base:
    MARKETING_VERSION: "${version}"
    CURRENT_PROJECT_VERSION: "12"
    DEVELOPMENT_TEAM: "${team}"
options:
  deploymentTarget:
    iOS: "16.0"
targets:
  PearBrowser:
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: ${iosId}
`)

  if (!opts.omitArtifacts) {
    write(root, 'backend/dist/backend.ios.bundle', bundleContent(root, 'ios-arm64'))
    write(root, 'backend/dist/backend.android.bundle', bundleContent(root, 'android-arm64'))
    mkdir(root, 'ios-native/PearBrowser/Frameworks/BareKit.xcframework')
    for (let i = 0; i < 10; i++) mkdir(root, `ios-native/PearBrowser/Frameworks/addons/addon-${i}.xcframework`)
    writeSized(root, 'android-native/app/libs/bare-kit.aar', 1024 * 1024 + 10)
  }

  const keystore = path.join(root, 'release.keystore')
  write(root, 'release.keystore', 'test-keystore')
  return { root, keystore }
}

function envFor (keystore, extras = {}) {
  return {
    PEARBROWSER_RELEASE_STORE_FILE: keystore,
    PEARBROWSER_RELEASE_STORE_PASSWORD: 'store-password',
    PEARBROWSER_RELEASE_KEY_ALIAS: 'pearbrowser',
    PEARBROWSER_RELEASE_KEY_PASSWORD: 'key-password',
    PEARBROWSER_TESTFLIGHT_VALIDATED: '1',
    PEARBROWSER_PLAY_CONSOLE_VALIDATED: '1',
    ...extras
  }
}

test('Android AAR gate rejects stale addon versions and accepts complete ABI coverage', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearbrowser-aar-gate-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const abis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']
  const stage = path.join(root, 'stage')
  for (const abi of abis) {
    write(root, `node_modules/react-native-bare-kit/android/src/main/addons/${abi}/librocksdb-native.3.18.1.so`, 'current')
    write(root, `stage/jni/${abi}/libbare-kit.so`, 'runtime')
    write(root, `stage/jni/${abi}/librocksdb-native.3.15.0.so`, 'stale')
  }
  const archive = path.join(root, 'bare-kit.aar')
  const pack = () => {
    fs.rmSync(archive, { force: true })
    const zipped = spawnSync('zip', ['-qr', archive, '.'], { cwd: stage })
    assert.equal(zipped.status, 0, String(zipped.stderr))
  }
  pack()
  assert.throws(() => inspectAndroidAar(root, archive), /missing jni\/arm64-v8a\/librocksdb-native\.3\.18\.1\.so/)
  for (const abi of abis) {
    fs.rmSync(path.join(stage, `jni/${abi}/librocksdb-native.3.15.0.so`))
    write(root, `stage/jni/${abi}/librocksdb-native.3.18.1.so`, 'current')
  }
  pack()
  assert.deepEqual(inspectAndroidAar(root, archive), { addonCount: 1, abiCount: 4 })
})

test('release preflight passes for aligned production fixture', () => {
  const { root, keystore } = makeFixture()
  const report = collectFixture(root, envFor(keystore))
  assert.equal(report.ok, true)
  assert.deepEqual(report.blockers.map((check) => check.id), [])
})

test('release preflight blocks missing production signing and store evidence', () => {
  const { root } = makeFixture({ team: '' })
  const report = collectFixture(root, {})
  assert.equal(report.ok, false)
  const ids = new Set(report.blockers.map((check) => check.id))
  assert.ok(ids.has('android-release-signing'))
  assert.ok(ids.has('ios-release-signing'))
  assert.ok(ids.has('ios-store-validation'))
  assert.ok(ids.has('android-store-validation'))
})

test('release preflight detects native identity and artifact drift', () => {
  const { root, keystore } = makeFixture({
    appAndroidId: 'com.example.wrong',
    appIosId: 'com.example.wrong',
    omitArtifacts: true
  })
  const report = collectFixture(root, envFor(keystore, { PEARBROWSER_IOS_DEVELOPMENT_TEAM: 'TEAM12345' }))
  assert.equal(report.ok, false)
  const ids = new Set(report.blockers.map((check) => check.id))
  assert.ok(ids.has('android-ids'))
  assert.ok(ids.has('ios-bundle-id'))
  assert.ok(ids.has('ios-worklet-bundle'))
  assert.ok(ids.has('android-worklet-bundle'))
  assert.ok(ids.has('ios-barekit'))
  assert.ok(ids.has('android-barekit'))
})

test('release preflight blocks Android signing contract drift', () => {
  const { root, keystore } = makeFixture({ signingStoreFileEnv: 'PEARBROWSER_ANDROID_KEYSTORE' })
  const report = collectFixture(root, envFor(keystore))
  assert.equal(report.ok, false)
  assert.ok(report.blockers.some((check) => check.id === 'android-signing-contract'))
})

test('Android signing names stay aligned across Gradle, CI, and release docs', () => {
  const files = [
    'android-native/app/build.gradle.kts',
    '.github/workflows/mobile-release-preflight.yml',
    'docs/RELEASE_SIGNING.md'
  ].map((rel) => [rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')])

  for (const [rel, source] of files) {
    for (const name of CANONICAL_ANDROID_SIGNING_ENV) {
      assert.match(source, new RegExp(name), `${rel} must use ${name}`)
    }
    assert.doesNotMatch(source, /PEARBROWSER_ANDROID_(?:KEYSTORE|STORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD)/, `${rel} still uses the retired signing prefix`)
  }

  const workflow = files.find(([rel]) => rel.startsWith('.github/'))[1]
  assert.match(workflow, /PEARBROWSER_RELEASE_KEYSTORE_BASE64/, 'CI must import the encoded release keystore')
  assert.match(workflow, /echo "PEARBROWSER_RELEASE_STORE_FILE=\$keystore"/, 'CI must expose the decoded keystore at the canonical path variable')
})


test('release preflight catches worklet source changes without replacing bundles', () => {
  const { root, keystore } = makeFixture()
  const original = fs.readFileSync(path.join(root, 'backend/dist/backend.ios.bundle'))
  write(root, 'backend/index.js', '// changed fixture worklet source\\n')
  const report = collectFixture(root, envFor(keystore))
  assert.equal(report.ok, false)
  assert.ok(report.blockers.some((check) => check.id === 'ios-worklet-bundle-freshness'))
  assert.ok(report.blockers.some((check) => check.id === 'android-worklet-bundle-freshness'))
  assert.deepEqual(fs.readFileSync(path.join(root, 'backend/dist/backend.ios.bundle')), original)
})

test('release preflight catches a changed transitive lock entry before rebundling', () => {
  const { root, keystore } = makeFixture()
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  lock.packages['node_modules/worker-dep'].version = '2.0.0'
  write(root, 'package-lock.json', JSON.stringify(lock, null, 2))
  const report = collectFixture(root, envFor(keystore))
  assert.equal(report.ok, false)
  assert.ok(report.blockers.some((check) => check.id === 'dependency-lock' && /worker-dep/.test(check.detail)))
  assert.ok(report.blockers.some((check) => check.id === 'ios-worklet-bundle-freshness'))
  assert.ok(report.blockers.some((check) => check.id === 'android-worklet-bundle-freshness'))
})

test('release preflight blocks a lockfile that disagrees with package.json', () => {
  const { root, keystore } = makeFixture()
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  lock.packages[''].version = '9.9.9'
  write(root, 'package-lock.json', JSON.stringify(lock, null, 2))
  const report = collectFixture(root, envFor(keystore))
  assert.ok(report.blockers.some((check) => check.id === 'dependency-lock'))
})

test('release preflight blocks a package override absent from resolved lock entries', () => {
  const { root, keystore } = makeFixture()
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  pkg.overrides['image-size'] = '2.0.5'
  write(root, 'package.json', JSON.stringify(pkg, null, 2))
  const report = collectFixture(root, envFor(keystore))
  assert.ok(report.blockers.some((check) =>
    check.id === 'dependency-lock' && /override image-size@2.0.5/.test(check.detail)))
})

test('release preflight blocks an omitted host-required optional binary', () => {
  const { root, keystore } = makeFixture()
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  lock.packages['node_modules/host-native'] = {
    version: '1.0.0', optional: true, os: [process.platform], cpu: [process.arch]
  }
  write(root, 'package-lock.json', JSON.stringify(lock, null, 2))
  const report = collectFixture(root, envFor(keystore))
  assert.ok(report.blockers.some((check) =>
    check.id === 'dependency-lock' && /host-native.*missing/.test(check.detail)))
})

test('release preflight checks host-required optional package files, not only npm hidden lock', () => {
  const { root, keystore } = makeFixture()
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const native = {
    version: '1.0.0', optional: true, os: [process.platform], cpu: [process.arch]
  }
  lock.packages['node_modules/host-native'] = native
  write(root, 'package-lock.json', JSON.stringify(lock, null, 2))
  const installedLock = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/.package-lock.json'), 'utf8'))
  installedLock.packages['node_modules/host-native'] = native
  write(root, 'node_modules/.package-lock.json', JSON.stringify(installedLock, null, 2))
  const report = collectFixture(root, envFor(keystore))
  assert.ok(report.blockers.some((check) =>
    check.id === 'dependency-lock' && /host-required optional dependency.*missing on disk/.test(check.detail)))
})

test('release preflight blocks an installed direct package that disagrees with the lockfile', () => {
  const { root, keystore } = makeFixture()
  write(root, 'node_modules/autobase/package.json', JSON.stringify({ version: '7.27.3' }))
  const report = collectFixture(root, envFor(keystore))
  assert.ok(report.blockers.some((check) => check.id === 'dependency-lock' && /installed autobase/.test(check.detail)))
})

test('release preflight treats a failed fresh build as a structural blocker', () => {
  const { root, keystore } = makeFixture()
  const report = collectPreflight(root, {
    env: envFor(keystore),
    rebuildBundle: () => { throw new Error('fixture pack failed') }
  })
  assert.ok(report.blockers.some((check) => check.id === 'ios-worklet-bundle-freshness' && /fixture pack failed/.test(check.detail)))
  assert.ok(report.blockers.some((check) => check.id === 'android-worklet-bundle-freshness' && /fixture pack failed/.test(check.detail)))
})
