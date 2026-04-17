# PearBrowser Audit And Ship Plan (April 15, 2026)

## Scope

Full repo audit of:
- Core backend worklet (`backend/*`)
- React Native app shell (`app/*`)
- Bridge/API trust boundary (`window.pear` -> localhost API)
- Release readiness signals (tests, persistence, core flows)

## Functional Audit

### Working
- Worklet boot + RPC wiring
- Hyper browsing via local proxy
- Hybrid fetch path (relay + P2P race)
- Site creation, editing, publishing
- Installed app metadata persistence

### High-Impact Gaps Found
- Browse tab button was not wired (no `onPress`)
- Settings catalog URL was not used by Explore startup
- Site metadata persisted, but site drives were not restored on restart
- `npm test` pointed to a missing file, so baseline verification was broken

## Security Audit

### Critical Risks Found
- Localhost origin validation used `startsWith`, allowing crafted origins like `http://localhost.evil.tld`
- WebView bridge API had no per-page capability token, so localhost API trust was too broad
- Sync data namespace was global by `appId`, allowing cross-app data collisions/access attempts

### Security Fixes Implemented
- Strict loopback origin validation (`URL` parse + exact hostname checks)
- Short-lived API capability tokens issued per drive key by proxy
- Required `X-Pear-Token` on localhost API access
- Drive-scoped sync namespace (`<driveKey>:<appId>`) in HTTP bridge
- Drive API endpoints now enforce token drive ownership
- New RPC identity endpoint so app no longer depends on open localhost identity route

## Fastest Route To Completion

### Phase 1 (Completed in this pass)
- Lock trust boundary (origin + token + drive-scoped sync)
- Fix core UX blockers (Browse tab, Explore startup settings)
- Restore site persistence
- Repair baseline verification (`npm test`)

### Phase 2 (Next, 2-4 days)
- Add relay configuration RPC + UI binding (remove hardcoded relay in backend)
- Add migration/compat checks for legacy sync-group data expectations
- Add smoke tests for navigation, publish/reload site, and sync round-trip

### Phase 3 (Next, 4-7 days)
- App permission model for bridge capabilities (identity/sync/drive operations)
- Catalog/app signing verification before install
- Release checklist automation (typecheck, bundle, startup smoke, regression suite)

## What Was Changed In This Pass

- `backend/hyper-proxy.js`
  - strict loopback CORS/origin validation
  - API token issue/validate with TTL
- `backend/http-bridge.js`
  - token-required API access
  - drive-scoped appId mapping
  - drive ownership checks on drive endpoints
- `backend/index.js`, `backend/constants.js`
  - RPC `CMD_GET_IDENTITY`
  - API token returned on navigation/launch
  - site restore on boot
- `backend/site-manager.js`
  - implemented persisted site import + drive reopen + republish join
- `app/screens/BrowseScreen.tsx`
  - trusted in-app URL gating
  - token-aware bridge injection
- `app/lib/bridge-inject.ts`
  - `X-Pear-Token` on API calls
- `app/screens/ExploreScreen.tsx`
  - startup uses saved catalog URL
  - site launch normalized to `hyper://<driveKey>`
- `app/App.tsx`
  - Browse tab `onPress` fixed
  - boot progress event wired
- `app/screens/MoreScreen.tsx`, `app/lib/rpc.ts`, `app/lib/constants.ts`
  - identity fetch moved to RPC
- `package.json`
  - `npm test` now runs typecheck + backend syntax checks

## Verification

Executed successfully:
- `npx tsc --noEmit`
- `npm test --silent`
