const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { collectPreflight } = require('../scripts/release-preflight')

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

function makeFixture (opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearbrowser-release-preflight-'))
  const version = opts.version || '1.2.3'
  const androidId = opts.androidId || 'com.pearbrowser.app'
  const appAndroidId = opts.appAndroidId || androidId
  const iosId = opts.iosId || 'com.pearbrowser.app'
  const appIosId = opts.appIosId || iosId
  const team = Object.prototype.hasOwnProperty.call(opts, 'team') ? opts.team : 'TEAM12345'

  write(root, 'package.json', JSON.stringify({ version }, null, 2))
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
    writeSized(root, 'backend/dist/backend.ios.bundle', 1024 * 1024 + 10)
    writeSized(root, 'backend/dist/backend.android.bundle', 1024 * 1024 + 10)
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
    PEARBROWSER_ANDROID_KEYSTORE: keystore,
    PEARBROWSER_ANDROID_STORE_PASSWORD: 'store-password',
    PEARBROWSER_ANDROID_KEY_ALIAS: 'pearbrowser',
    PEARBROWSER_ANDROID_KEY_PASSWORD: 'key-password',
    PEARBROWSER_TESTFLIGHT_VALIDATED: '1',
    PEARBROWSER_PLAY_CONSOLE_VALIDATED: '1',
    ...extras
  }
}

test('release preflight passes for aligned production fixture', () => {
  const { root, keystore } = makeFixture()
  const report = collectPreflight(root, { env: envFor(keystore) })
  assert.equal(report.ok, true)
  assert.deepEqual(report.blockers.map((check) => check.id), [])
})

test('release preflight blocks missing production signing and store evidence', () => {
  const { root } = makeFixture({ team: '' })
  const report = collectPreflight(root, { env: {} })
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
  const report = collectPreflight(root, { env: envFor(keystore, { PEARBROWSER_IOS_DEVELOPMENT_TEAM: 'TEAM12345' }) })
  assert.equal(report.ok, false)
  const ids = new Set(report.blockers.map((check) => check.id))
  assert.ok(ids.has('android-ids'))
  assert.ok(ids.has('ios-bundle-id'))
  assert.ok(ids.has('ios-worklet-bundle'))
  assert.ok(ids.has('android-worklet-bundle'))
  assert.ok(ids.has('ios-barekit'))
  assert.ok(ids.has('android-barekit'))
})
