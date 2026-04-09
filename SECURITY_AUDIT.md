# Pear Browser Security Audit Report

**Date:** 2026-04-09  
**Scope:** Full codebase audit (~3,500 lines of TypeScript/JavaScript)  
**Result:** 18 vulnerabilities identified  
**Risk Level:** Multiple Critical/High severity issues

---

## Executive Summary

Pear Browser has several critical security vulnerabilities that could allow:
- Remote code execution via path traversal
- Local network API abuse
- XSS attacks on directory listings
- Prototype pollution attacks
- Information disclosure

The most critical issues are in the HyperProxy HTTP server and the HTTP Bridge API.

---

## Critical Severity (4)

### 1. Path Traversal in HyperProxy (hyper-proxy.js)
**Location:** `backend/hyper-proxy.js`  
**Issue:** The path extraction from URL doesn't validate or sanitize the drive key, allowing path traversal attacks.

```javascript
// VULNERABLE CODE:
const rest = path.slice('/hyper/'.length)
const slash = rest.indexOf('/')
driveKeyHex = slash === -1 ? rest : rest.slice(0, slash)
// No validation! driveKeyHex could be "../../../etc/passwd"
```

**Impact:** Attackers could potentially access arbitrary files on the filesystem.

**Fix:** Add drive key validation:
```javascript
if (!/^[0-9a-f]{64}$/i.test(driveKeyHex)) {
  res.statusCode = 400
  return res.end('Invalid drive key')
}
```

---

### 2. No Authentication on HTTP Bridge API (http-bridge.js)
**Location:** `backend/http-bridge.js`  
**Issue:** All API endpoints (`/api/*`) are accessible without any authentication. Any app running on the device can:
- Create/join sync groups
- Read/write data to any app's sync group
- Access identity information
- List drive contents

```javascript
// Anyone can call:
POST /api/sync/append  // Write to any app's data
GET /api/sync/get      // Read any app's data
GET /api/identity      // Get user's public key
```

**Impact:** Complete lack of access control between apps.

**Fix:** Implement app-scoped permissions and request signing.

---

### 3. Hardcoded Cryptographic Key (bridge-inject.ts)
**Location:** `app/lib/bridge-inject.ts`  
**Issue:** A hardcoded invite key is embedded in the JavaScript:

```javascript
var savedKey = urlParams.get('inviteKey') || localStorage.getItem('pear-pos-invite-key') || 
  '8501172756df882990c4cea0d2762b4cbd594e264e6c6da76293bb95e5eeda6b';
```

**Impact:** Anyone with this key can join the POS sync group and access/modify all POS data.

**Fix:** Remove hardcoded key; require explicit user configuration.

---

### 4. eval-like Code Injection via Dynamic HTML (site-manager.js)
**Location:** `backend/site-manager.js`  
**Issue:** The `_escapeHtml` function is incomplete (doesn't escape single quotes or backticks), allowing XSS:

```javascript
_escapeHtml (str) {
  return (str || '').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')  // Missing: ' and `
}
```

**Impact:** XSS attacks when rendering user content in sites.

**Fix:** Use proper escaping or a whitelist-based sanitizer.

---

## High Severity (6)

### 5. Prototype Pollution via JSON.parse (Multiple locations)
**Locations:**
- `backend/catalog-manager.js:38` - `const data = JSON.parse(catalogBuf.toString())`
- `backend/index.js:268` - `const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))`
- `backend/http-bridge.js:168` - `resolve(data ? JSON.parse(data) : {})`

**Issue:** No validation on parsed JSON objects, allowing prototype pollution attacks via `__proto__` or `constructor.prototype`.

**Impact:** Potential DoS or code execution through prototype manipulation.

**Fix:** Add prototype pollution protection:
```javascript
function safeJSONParse(str) {
  const obj = JSON.parse(str)
  if (obj && typeof obj === 'object') {
    delete obj.__proto__
    delete obj.constructor
  }
  return obj
}
```

---

### 6. XSS in Directory Listing (hyper-proxy.js)
**Location:** `backend/hyper-proxy.js`  
**Issue:** Directory listing HTML includes unsanitized file names:

```javascript
const items = entries.map(e => {
  const name = e.startsWith(dirPath) ? e.slice(dirPath.length) : e
  return `<li><a href="/hyper/${keyHex}${e}">${name}</a></li>`
  // name is not escaped!
}).join('\n')
```

**Impact:** XSS if a directory contains files with malicious names.

**Fix:** Escape HTML entities in file names.

---

### 7. Unbounded List Operations (Multiple locations)
**Locations:**
- `backend/pear-bridge.js:137` - No max limit on sync.list
- `backend/http-bridge.js:67` - limit parameter not validated
- `backend/hyper-proxy.js:248` - Directory listing not capped

**Issue:** No maximum limits on list operations can cause memory exhaustion.

**Impact:** DoS via memory exhaustion.

**Fix:** Enforce hard limits (e.g., max 1000 items).

---

### 8. Information Disclosure in Error Messages (hyper-proxy.js)
**Location:** `backend/hyper-proxy.js:178-182`  
**Issue:** Error messages expose internal paths and implementation details:

```javascript
res.end(`<html><body...>
  <p>${err.message}</p>  // Could leak file paths
`)
```

**Impact:** Information leakage aids attackers in reconnaissance.

**Fix:** Log detailed errors internally, show generic messages externally.

---

### 9. No Origin Validation on CORS (hyper-proxy.js)
**Location:** `backend/hyper-proxy.js:78`  
**Issue:**
```javascript
res.setHeader('Access-Control-Allow-Origin', '*')
```

**Impact:** Any website can make requests to the local proxy.

**Fix:** Restrict to localhost or validate origins.

---

### 10. Silent Error Swallowing (Multiple locations)
**Locations:** Too many to count - pattern is `.catch(() => {})` or `catch {}` throughout codebase.

**Issue:** Errors are silently ignored, making debugging impossible and hiding attacks.

Examples:
- `backend/index.js:198,199`
- `backend/pear-bridge.js:245`
- `backend/app-manager.js:58`

**Fix:** Add error logging to all catch blocks.

---

## Medium Severity (5)

### 11. Weak Key Derivation for Sync Groups (pear-bridge.js)
**Location:** `backend/pear-bridge.js:52,79`  
**Issue:** Using simple SHA256 hash for topic derivation:
```javascript
const topic = crypto.createHash('sha256').update(inviteKey).digest()
```

**Impact:** Predictable topics if invite keys are weak.

**Fix:** Use HKDF or similar key derivation function.

---

### 12. No Rate Limiting on RPC (rpc.js)
**Location:** `backend/rpc.js`  
**Issue:** No rate limiting on command handlers.

**Impact:** DoS via command flooding.

**Fix:** Implement per-command rate limiting.

---

### 13. Buffer Size Validation Issues (rpc.js)
**Location:** `backend/rpc.js:87-91`  
**Issue:** Message length check allows exactly 10MB which could still cause issues:
```javascript
if (isNaN(len) || len <= 0 || len > 10_000_000) {
```

**Impact:** Potential memory exhaustion.

---

### 14. Missing Input Validation on App ID (pear-bridge.js)
**Location:** `backend/pear-bridge.js`  
**Issue:** appId is used directly in file paths without sanitization:
```javascript
const localWriter = this.store.get({ name: `pear-app-${appId}-writer` })
```

**Impact:** Path traversal if appId contains special characters.

**Fix:** Validate appId format (alphanumeric only).

---

### 15. Insecure RNG for IDs (bridge-inject.ts)
**Location:** `app/lib/bridge-inject.ts:137,164`  
**Issue:** Using Math.random() for ID generation:
```javascript
var id = product.id || ('prod_' + Date.now() + '_' + Math.random().toString(36).slice(2,8));
```

**Impact:** IDs are predictable.

**Fix:** Use crypto.getRandomValues() or similar.

---

## Low Severity (3)

### 16. HTTP Instead of HTTPS (relay-client.js)
**Location:** `backend/relay-client.js`  
**Issue:** Default relay URL uses HTTP:
```javascript
this.relays = opts.relays || ['http://127.0.0.1:9100']
```

**Impact:** Traffic is unencrypted (though localhost mitigates this).

---

### 17. Version Comparison Vulnerability (index.js)
**Location:** `backend/index.js:788`  
**Issue:** Custom semver comparison may be bypassed:
```javascript
_compareVersions (a, b) {
  const pa = (a || '0.0.0').split('.').map(Number)
  // ...
}
```

**Impact:** Version confusion attacks possible.

---

### 18. LocalStorage Key Collisions (bridge-inject.ts)
**Location:** `app/lib/bridge-inject.ts:102,109`  
**Issue:** Using generic localStorage keys:
```javascript
localStorage.setItem('pear-pos-invite-key', result.inviteKey);
```

**Impact:** Potential conflicts with other apps.

**Fix:** Use namespaced keys.

---

## Recommendations

### Immediate Actions Required:
1. **Fix path traversal** - Validate all drive keys
2. **Add authentication** - Implement API authentication
3. **Remove hardcoded keys** - Use secure configuration
4. **Fix XSS issues** - Proper HTML escaping
5. **Add prototype pollution protection**

### Short-term:
6. Add rate limiting
7. Implement proper error logging
8. Add CORS origin validation
9. Validate all input parameters

### Long-term:
10. Security audit of third-party dependencies
11. Implement Content Security Policy
12. Add request signing for sensitive operations

---

## Files Requiring Immediate Attention

1. `backend/hyper-proxy.js` - Path traversal, XSS, CORS
2. `backend/http-bridge.js` - No authentication
3. `app/lib/bridge-inject.ts` - Hardcoded keys, insecure RNG
4. `backend/site-manager.js` - XSS
5. `backend/catalog-manager.js` - Prototype pollution
6. `backend/pear-bridge.js` - Input validation

---

*Report generated by Claude Code CLI*