/**
 * Pear Bridge Spec — the injected JavaScript + TS API shape.
 *
 * This module is the SINGLE SOURCE OF TRUTH for what `window.pear` and
 * `window.posAPI` look like inside a PearBrowser WebView. Both the current
 * React Native shell and the upcoming native Android (Kotlin) and iOS
 * (Swift) shells inject **byte-identical** JavaScript into their WebViews
 * by calling `createBridgeScript(port, apiToken)`.
 *
 * Design goals:
 *   1. One bridge spec across all shells (RN, bare-android, bare-ios)
 *   2. Typed — so app code can import the shape without risking drift
 *   3. Self-contained ES5 — runs in any WebView, no build step, no deps
 *   4. Safe defaults — fail closed if token missing
 *
 * See: docs/HOLEPUNCH_ALIGNMENT_PLAN.md (Phase 0 ticket 3 + Phase 2 ticket 6)
 */

// --- TypeScript API shape ---
// This is what `window.pear` looks like to pages. Native shells should
// reference this type when writing their bridge contracts.

export interface PearSyncAPI {
  create(appId: string): Promise<{ inviteKey: string; appId: string; writerPublicKey: string }>
  join(appId: string, inviteKey: string): Promise<{ inviteKey: string; appId: string; writerPublicKey: string }>
  append(appId: string, op: unknown): Promise<{ ok: true }>
  get(appId: string, key: string): Promise<unknown>
  list(appId: string, prefix?: string, opts?: { limit?: number }): Promise<Array<{ key: string; value: unknown }>>
  /** Range query with explicit bounds + reverse. Phase 4 addition. */
  range(appId: string, opts?: {
    gte?: string; gt?: string; lte?: string; lt?: string
    reverse?: boolean; limit?: number
  }): Promise<Array<{ key: string; value: unknown }>>
  /** Count entries under a prefix. Phase 4 addition. */
  count(appId: string, prefix?: string): Promise<{ count: number }>
  status(appId: string): Promise<{ appId: string; inviteKey: string; writerCount: number; viewLength: number }>
}

export interface PearIdentityAPI {
  /** Return the app's PER-APP sub-key (stable for this user + this drive,
   *  different from what other apps see for the same user). */
  getPublicKey(): Promise<{ publicKey: string; driveKey: string; algorithm: 'ed25519' }>
  /** Sign an arbitrary payload with the PER-APP sub-key. Automatically
   *  namespaced as `pear.app.<driveKey>:<namespace>:<payload>`. */
  sign(payload: string, namespace?: string): Promise<{
    signature: string; publicKey: string; algorithm: 'ed25519'; tag: string
  }>
}

// --- Login ceremony (Identity Plan Phase C) ---

export type PearScope =
  | 'profile:read'
  | 'profile:name'
  | 'profile:contact'
  | 'contacts:read'
  | 'pay'

export interface PearLoginOptions {
  /** Capabilities this app is requesting. If empty, app only gets its
   *  stable per-app pubkey (profile stays hidden). */
  scopes?: PearScope[]
  /** Human-friendly name shown in the consent sheet. */
  appName?: string
  /** One-liner explaining why the app needs these scopes. */
  reason?: string
}

export interface PearLoginAttestation {
  appPubkey: string
  scopes: PearScope[]
  grantedAt: number
  expiresAt: number
  loginProof: string
  tag: string
  /** Profile fields the user granted. `null` if no profile:* scope. */
  profile: Record<string, string> | null
}

export interface PearLoginStatus {
  loggedIn: boolean
  appPubkey?: string
  scopes?: PearScope[]
  expiresAt?: number
  profile?: Record<string, string> | null
}

export interface PearContact {
  pubkey: string
  displayName: string
  avatar?: string
  tags?: string[]
  addedAt: number
}

export interface PearContactsAPI {
  /** `contacts:read` scope required. Returns up to `limit` contacts. */
  list(opts?: { limit?: number }): Promise<PearContact[]>
  /** `contacts:read` scope required. `null` if not found. */
  lookup(pubkey: string): Promise<PearContact | null>
}

export interface PearBridgeStatusAPI {
  status(): Promise<{ ready: boolean; port: number }>
}

export interface PearLoginAPI {
  /** Start (or resume) a sign-in. Shows a native consent sheet on first
   *  use; returns instantly if a valid grant already exists. */
  (opts?: PearLoginOptions): Promise<PearLoginAttestation>
  /** Current login status without triggering a prompt. */
  status(): Promise<PearLoginStatus>
  /** Revoke this app's grant (log the user out of just this app). */
  logout(): Promise<void>
}

export interface PearAPI {
  sync: PearSyncAPI
  identity: PearIdentityAPI
  bridge: PearBridgeStatusAPI
  /** The one-click sign-in surface. `await window.pear.login()` returns
   *  an ed25519-signed attestation tied to this user + this app. */
  login: PearLoginAPI
  contacts: PearContactsAPI
  navigate(url: string): void
  share(url: string): void
}

// --- Augment Window globally for TS consumers in the WebView ---
declare global {
  interface Window {
    pear?: PearAPI
    posAPI?: Record<string, (...args: unknown[]) => Promise<unknown>>
    /** Marker flag set by the bridge script to prevent double-injection. */
    __pearBridgeInjected?: boolean
    /** React Native WebView's postMessage bridge (if running inside RN). */
    ReactNativeWebView?: { postMessage(msg: string): void }
  }
}

// --- Options ---

export interface BridgeScriptOptions {
  /** Port of the localhost HTTP server exposed by the Bare worklet. */
  port: number
  /** X-Pear-Token capability token for this drive. Empty = bridge unauthorized. */
  apiToken?: string
}

// --- The injected script ---
// ES5, no dependencies. Runs inside the WebView. Uses template literals for
// PORT and TOKEN substitution at build time, but the script body itself does
// not require any compilation — native shells can just do string replacement
// on `__PEAR_BRIDGE_PORT__` / `__PEAR_BRIDGE_TOKEN__` if they prefer that
// pattern over template literals (e.g. Kotlin uses `String.format`).

/** Raw template with placeholders — useful for native (Kotlin/Swift) shells. */
export const PEAR_BRIDGE_SCRIPT_TEMPLATE: string = `
(function() {
  if (window.__pearBridgeInjected) return;
  window.__pearBridgeInjected = true;

  var PORT = __PEAR_BRIDGE_PORT__;
  var TOKEN = __PEAR_BRIDGE_TOKEN__;
  var BASE = 'http://127.0.0.1:' + PORT;

  function apiGet(path) {
    if (!TOKEN) return Promise.reject(new Error('Bridge unauthorized for this page'));
    return fetch(BASE + path, { headers: { 'X-Pear-Token': TOKEN } })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'API error') });
        return r.json();
      });
  }

  function apiPost(path, body) {
    if (!TOKEN) return Promise.reject(new Error('Bridge unauthorized for this page'));
    return fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pear-Token': TOKEN },
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'API error') });
      return r.json();
    });
  }

  window.pear = {
    sync: {
      create: function(appId) { return apiPost('/api/sync/create', { appId: appId }); },
      join: function(appId, inviteKey) { return apiPost('/api/sync/join', { appId: appId, inviteKey: inviteKey }); },
      append: function(appId, op) { return apiPost('/api/sync/append', { appId: appId, op: op }); },
      get: function(appId, key) {
        return apiGet('/api/sync/get?appId=' + encodeURIComponent(appId) + '&key=' + encodeURIComponent(key));
      },
      list: function(appId, prefix, opts) {
        var url = '/api/sync/list?appId=' + encodeURIComponent(appId);
        if (prefix) url += '&prefix=' + encodeURIComponent(prefix);
        if (opts && opts.limit) url += '&limit=' + opts.limit;
        return apiGet(url);
      },
      range: function(appId, opts) {
        var url = '/api/sync/range?appId=' + encodeURIComponent(appId);
        if (opts && opts.gte) url += '&gte=' + encodeURIComponent(opts.gte);
        if (opts && opts.gt)  url += '&gt='  + encodeURIComponent(opts.gt);
        if (opts && opts.lte) url += '&lte=' + encodeURIComponent(opts.lte);
        if (opts && opts.lt)  url += '&lt='  + encodeURIComponent(opts.lt);
        if (opts && opts.reverse) url += '&reverse=1';
        if (opts && opts.limit) url += '&limit=' + opts.limit;
        return apiGet(url);
      },
      count: function(appId, prefix) {
        var url = '/api/sync/count?appId=' + encodeURIComponent(appId);
        if (prefix) url += '&prefix=' + encodeURIComponent(prefix);
        return apiGet(url);
      },
      status: function(appId) { return apiGet('/api/sync/status?appId=' + encodeURIComponent(appId)); }
    },
    identity: {
      getPublicKey: function() { return apiGet('/api/identity'); },
      sign: function(payload, namespace) {
        return apiPost('/api/identity/sign', { payload: String(payload), namespace: namespace || '' });
      }
    },
    // Login ceremony — one call, returns an ed25519-signed attestation
    // tied to this app. Shows a native consent sheet the first time.
    login: (function() {
      function login(opts) {
        opts = opts || {};
        return apiPost('/api/login', {
          scopes: Array.isArray(opts.scopes) ? opts.scopes : [],
          appName: opts.appName || null,
          reason: opts.reason || null,
        });
      }
      login.status = function() { return apiGet('/api/login/status'); };
      login.logout = function() { return apiPost('/api/login/logout', {}); };
      return login;
    })(),
    contacts: {
      list: function(opts) {
        var url = '/api/contacts/list';
        if (opts && opts.limit) url += '?limit=' + opts.limit;
        return apiGet(url);
      },
      lookup: function(pubkey) {
        return apiGet('/api/contacts/lookup?pubkey=' + encodeURIComponent(pubkey));
      }
    },
    bridge: {
      status: function() { return apiGet('/api/bridge/status'); }
    },
    navigate: function(url) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pear-navigate', url: url }));
      } else if (window.PearBrowserNative && window.PearBrowserNative.navigate) {
        window.PearBrowserNative.navigate(url);
      }
    },
    share: function(url) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pear-share', url: url }));
      } else if (window.PearBrowserNative && window.PearBrowserNative.share) {
        window.PearBrowserNative.share(url);
      }
    }
  };

  // --- window.posAPI (POS-specific wrapper around pear.sync) ---
  var POS_APP_ID = 'pear-pos';

  function isValidInviteKey(key) {
    return typeof key === 'string' && /^[0-9a-f]{64}$/i.test(key);
  }

  function randomId(prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return prefix + '_' + crypto.randomUUID();
    var rand = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? crypto.getRandomValues(new Uint32Array(4)).join('')
      : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    return prefix + '_' + Date.now() + '_' + rand;
  }

  (function initPOS() {
    var urlParams = new URLSearchParams(window.location.search);
    var savedKey = urlParams.get('inviteKey') || localStorage.getItem('pear-pos-invite-key');

    if (!savedKey) {
      console.log('[PearBridge] POS: No invite key configured, creating new sync group');
      window.pear.sync.create(POS_APP_ID).then(function(result) {
        if (result && result.inviteKey && isValidInviteKey(result.inviteKey)) {
          localStorage.setItem('pear-pos-invite-key', result.inviteKey);
        }
        console.log('[PearBridge] POS sync ready');
      }).catch(function(err) { console.error('[PearBridge] POS init failed:', err.message); });
    } else if (isValidInviteKey(savedKey)) {
      window.pear.sync.join(POS_APP_ID, savedKey).then(function() {
        console.log('[PearBridge] POS sync ready');
      }).catch(function(err) { console.error('[PearBridge] POS init failed:', err.message); });
    } else {
      console.error('[PearBridge] Invalid invite key format in localStorage');
      localStorage.removeItem('pear-pos-invite-key');
    }
  })();

  window.posAPI = {
    register: function(name, email, password) {
      return window.pear.sync.append(POS_APP_ID, {
        type: 'merchant:register', data: { name: name, email: email }, timestamp: new Date().toISOString()
      }).then(function() { return { token: 'p2p-local', merchant: { name: name, email: email } }; });
    },
    login: function(email, password) { return Promise.resolve({ token: 'p2p-local', merchant: { email: email } }); },
    getMe: function() {
      return window.pear.sync.list(POS_APP_ID, 'config!merchant', { limit: 1 })
        .then(function(r) { return r.length > 0 ? r[0].value : { name: 'POS User' }; });
    },
    listProducts: function(params) {
      return window.pear.sync.list(POS_APP_ID, 'products!', { limit: (params && params.limit) || 100 })
        .then(function(r) { return r.map(function(i) { return i.value; }); });
    },
    createProduct: function(product) {
      var id = product.id || randomId('prod');
      var p = Object.assign({ id: id, created_at: new Date().toISOString(), stock: 0 }, product);
      return window.pear.sync.append(POS_APP_ID, { type: 'product:create', data: p }).then(function() { return p; });
    },
    updateProduct: function(id, updates) {
      return window.pear.sync.append(POS_APP_ID, { type: 'product:update', data: { id: id, updates: updates } })
        .then(function() { return Object.assign({ id: id }, updates); });
    },
    deleteProduct: function(id) {
      return window.pear.sync.append(POS_APP_ID, { type: 'product:delete', data: { id: id } });
    },
    getProduct: function(id) { return window.pear.sync.get(POS_APP_ID, 'products!' + id); },
    adjustStock: function(productId, delta, reason) {
      return window.pear.sync.append(POS_APP_ID, { type: 'stock:adjust', data: { product_id: productId, delta: delta, reason: reason } });
    },
    getLowStock: function() {
      return window.pear.sync.list(POS_APP_ID, 'products!', { limit: 100 }).then(function(r) {
        return r.map(function(i) { return i.value; })
          .filter(function(p) { return p && p.stock !== undefined && p.stock <= (p.low_stock_threshold || 5); });
      });
    },
    getStockAlerts: function() { return this.getLowStock().then(function(p) { return { alerts: p, total: p.length }; }); },
    createTransaction: function(items, paymentMethod, options) {
      var txn = {
        id: randomId('txn'), items: items, payment_method: paymentMethod, status: 'completed',
        created_at: new Date().toISOString(),
        total_cents: items.reduce(function(s,i) { return s + (i.price_cents * i.quantity); }, 0)
      };
      if (options) Object.assign(txn, options);
      return window.pear.sync.append(POS_APP_ID, { type: 'transaction:create', data: txn }).then(function() { return txn; });
    },
    listTransactions: function(params) {
      return window.pear.sync.list(POS_APP_ID, 'transactions!', { limit: (params && params.limit) || 50 })
        .then(function(r) { return { transactions: r.map(function(i) { return i.value; }) }; });
    },
    getSyncStatus: function() { return window.pear.sync.status(POS_APP_ID); },
    getSyncInviteKey: function() { return Promise.resolve(localStorage.getItem('pear-pos-invite-key')); },
    joinSyncGroup: function(key) {
      localStorage.setItem('pear-pos-invite-key', key);
      return window.pear.sync.join(POS_APP_ID, key);
    },
    getConfig: function() {
      return window.pear.sync.get(POS_APP_ID, 'config!merchant').then(function(r) { return r || {}; });
    },
    updateConfig: function(updates) {
      return window.pear.sync.append(POS_APP_ID, { type: 'config:set', data: updates });
    }
  };

  console.log('[PearBridge] Injected (port ' + PORT + ')');
})();
`

// --- Public factory ---

/**
 * Produce the exact JavaScript string to inject into a WebView.
 * Works across RN (WebView.injectedJavaScript) and native shells
 * (WebView.evaluateJavascript / WKWebView.evaluateJavaScript).
 */
export function createBridgeScript({ port, apiToken = '' }: BridgeScriptOptions): string {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError(`Invalid port for bridge script: ${port}`)
  }
  return PEAR_BRIDGE_SCRIPT_TEMPLATE
    .replace('__PEAR_BRIDGE_PORT__', String(port))
    .replace('__PEAR_BRIDGE_TOKEN__', JSON.stringify(apiToken))
}
