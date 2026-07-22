# PearBrowser Mobile — Release Signing & Distribution

Exact commands for producing signed, distributable Android and iOS builds.
Run `node scripts/release-preflight.js` at any point to see what is still missing.

App identity: `com.pearbrowser.app` · version `0.1.0` (bump in `app.json`).

---

## Android

Both `android/app/build.gradle` (generated Expo shell) and
`android-native/app/build.gradle.kts` (native Kotlin shell) use the same four
environment variables. If any is unset, the generated shell falls back to the
**debug** key and the native shell leaves the release artifact unsigned, so set
all four. `scripts/release-preflight.js` checks the values and guards the native
Gradle contract against naming drift.

### 1. Generate the upload/release keystore (you hold this — back it up)

> ⚠️ This key governs every future Android update. If you lose it you cannot
> publish updates to the same Play listing. Store the `.keystore` file and its
> passwords in a password manager / secure backup, **not** in the repo.

```sh
keytool -genkeypair -v \
  -keystore pearbrowser-release.keystore \
  -alias pearbrowser \
  -keyalg RSA -keysize 2048 -validity 10000
# Choose a strong store password and key password when prompted.
```

### 2. Export the signing env vars (absolute path to the keystore)

```sh
export PEARBROWSER_RELEASE_STORE_FILE="$HOME/keys/pearbrowser-release.keystore"
export PEARBROWSER_RELEASE_STORE_PASSWORD="…"
export PEARBROWSER_RELEASE_KEY_ALIAS="pearbrowser"
export PEARBROWSER_RELEASE_KEY_PASSWORD="…"
```

### 3a. Direct-download APK (no Play account needed — ships from the website)

```sh
npm run bundle-all                       # build the Bare backend bundles
cd android && ./gradlew assembleRelease  # → app/build/outputs/apk/release/app-release.apk
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

Or via EAS (uses the same env credentials / EAS-managed keystore):

```sh
eas build --platform android --profile production-apk
```

Upload the APK to the GitHub release; the website download page picks it up.

### 3b. Google Play (.aab) — requires a Play Console account ($25 one-time)

```sh
eas build --platform android --profile production        # → .aab (app-bundle)
eas submit --platform android --profile production       # uploads to the internal track (draft)
```

Play App Signing will re-sign with Google's key; your keystore above becomes the
**upload** key. (Configure the Play service-account JSON in EAS for `eas submit`.)

---

## iOS

iOS cannot be distributed as a downloadable file — only App Store / TestFlight.
Everything past the simulator needs the **Apple Developer Program** ($99/yr).

### 1. Configure the Apple team

```sh
export PEARBROWSER_IOS_DEVELOPMENT_TEAM="<10-char Team ID>"
```

(Or set `DEVELOPMENT_TEAM` in the iOS project.) Register the bundle id
`com.pearbrowser.app` and create the app record in App Store Connect.

### 2. Build + submit (EAS manages the distribution cert & provisioning profile)

```sh
eas build  --platform ios --profile production    # signed device archive (.ipa)
eas submit --platform ios --profile production     # upload to App Store Connect / TestFlight
```

Fill `eas.json` → `submit.production.ios` with `appleId`, `ascAppId`, and
`appleTeamId` (these are not secrets but identify the App Store Connect app), or
pass them to `eas submit`. Then promote the TestFlight build / submit for review.
The website links an App Store badge or a TestFlight public link — never a file.

### Record store validation for preflight

```sh
export PEARBROWSER_TESTFLIGHT_VALIDATED=1          # or PEARBROWSER_APP_STORE_CONNECT_VALIDATED=1
```

---

## Preflight

```sh
node scripts/release-preflight.js
```

Green when: backend bundles present, BareKit native worklets present, Android
signing env set (the four `PEARBROWSER_RELEASE_*` vars above), iOS team set, EAS
project identity filled, and store-validation markers recorded.

For GitHub Actions, configure the matching repository secrets plus
`PEARBROWSER_RELEASE_KEYSTORE_BASE64`, containing the base64-encoded keystore.
The workflow materializes it under the runner's temporary directory and exports
the absolute path as `PEARBROWSER_RELEASE_STORE_FILE`.
