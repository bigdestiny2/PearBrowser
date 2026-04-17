# @pearbrowser/verify-login

**Verify "Sign in with PearBrowser" attestations, server-side, with no servers.**

When a web app calls `window.pear.login()` inside PearBrowser, it gets back an
ed25519-signed attestation proving the user approved the sign-in. This package
lets any Node.js server verify that attestation offline — no PearBrowser SDK,
no network call, no OAuth provider. Just cryptography.

## Install

```bash
npm install @pearbrowser/verify-login
```

## Verify

```js
const { verifyLoginAttestation } = require('@pearbrowser/verify-login')

// The attestation came from the user's browser via fetch/POST/etc.
const result = await verifyLoginAttestation(attestation, {
  expectedDriveKey: 'c8698b6a…',   // enforce it was for YOUR app
  maxAgeMs: 24 * 60 * 60 * 1000,   // 24h — stricter than the 7d default
})

if (!result.ok) {
  return res.status(401).json({ error: result.error })
}

// result.appPubkey is the stable unique ID for this user on your app.
// Use it as the primary key in your user table.
console.log(`user ${result.appPubkey} signed in with scopes:`, result.scopes)
if (result.profile?.displayName) {
  console.log(`welcome, ${result.profile.displayName}`)
}
```

## Express middleware

```js
const { verifyLoginMiddleware } = require('@pearbrowser/verify-login')

app.post(
  '/api/pear-login',
  express.json(),
  verifyLoginMiddleware({ expectedDriveKey: MY_APP_KEY, maxAgeMs: 60 * 60 * 1000 }),
  (req, res) => {
    // req.pearLogin is the verified attestation
    const session = issueSessionFor(req.pearLogin.appPubkey)
    res.json({ token: session })
  }
)
```

## What gets verified

- **ed25519 signature** over `pear.app.<driveKey>:login:pear.login.v1:<driveKey>:<appPubkey>:<scopes>:<expiresAt>`
- **Drive key binding** — optional check that the attestation was for your app
- **Freshness** — rejects expired or future-dated attestations (with clock skew tolerance)
- **Shape** — pubkey is 64-hex, signature is 128-hex, tag starts with `pear.app.`

## Why use this

Normal OAuth:
- You register with a provider
- Users authenticate with the provider
- Provider gives your server a token
- Your server calls the provider's API to validate

"Sign in with PearBrowser":
- No registration. No provider. No token exchange.
- User signs with their own ed25519 keypair
- You verify the signature with a 100-line library

The user's identity is theirs forever. They can log in across every one of your
apps with the same 12-word backup phrase. Your server never talks to
PearBrowser's infrastructure because there isn't any.

## Security notes

- **Trust model**: the attestation proves the user signed it. It does NOT prove
  the sig came from "the real" PearBrowser app — anyone can generate a valid
  attestation with a fake keypair. What this buys you is **continuity**:
  `appPubkey` is stable per user, so you know "the same user as last time" is
  signing in. If you need a higher bar (e.g. attested platform), pair this
  with App Attest / Play Integrity and verify both.

- **Scope enforcement**: the attestation tells you what the user *granted*.
  Your app still chooses what to do with that — e.g. don't surface an
  attestation's `profile.email` if your privacy policy doesn't need it.

- **Replay**: the signature is deterministic. Treat attestations as bearer
  tokens and reject replays by storing a nonce / using `maxAgeMs` aggressively.

## License

MIT.
