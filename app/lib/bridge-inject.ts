/**
 * JavaScript bridge injected into WebViews running P2P apps.
 *
 * Provides window.pear and window.posAPI APIs.
 *
 * Uses DIRECT localhost HTTP to the Bare worklet's server — no React
 * Native postMessage relay in the data path. This gives ~1-3ms latency
 * instead of ~5-10ms through the RN bridge.
 *
 * The port is injected by React Native when starting the WebView.
 */

export function createBridgeScript(port: number, apiToken = ''): string {
  return `
(function() {
  if (window.__pearBridgeInjected) return;
  window.__pearBridgeInjected = true;

  var PORT = ${port};
  var TOKEN = ${JSON.stringify(apiToken)};
  var BASE = 'http://127.0.0.1:' + PORT;

  // --- HTTP helpers ---

  function apiGet(path) {
    if (!TOKEN) return Promise.reject(new Error('Bridge unauthorized for this page'));
    return fetch(BASE + path, {
      headers: { 'X-Pear-Token': TOKEN }
    }).then(function(r) {
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

  // --- window.pear API (generic P2P) ---

  window.pear = {
    sync: {
      create: function(appId) {
        return apiPost('/api/sync/create', { appId: appId });
      },
      join: function(appId, inviteKey) {
        return apiPost('/api/sync/join', { appId: appId, inviteKey: inviteKey });
      },
      append: function(appId, op) {
        return apiPost('/api/sync/append', { appId: appId, op: op });
      },
      get: function(appId, key) {
        return apiGet('/api/sync/get?appId=' + encodeURIComponent(appId) + '&key=' + encodeURIComponent(key));
      },
      list: function(appId, prefix, opts) {
        var url = '/api/sync/list?appId=' + encodeURIComponent(appId);
        if (prefix) url += '&prefix=' + encodeURIComponent(prefix);
        if (opts && opts.limit) url += '&limit=' + opts.limit;
        return apiGet(url);
      },
      status: function(appId) {
        return apiGet('/api/sync/status?appId=' + encodeURIComponent(appId));
      }
    },
    identity: {
      getPublicKey: function() {
        return apiGet('/api/identity');
      }
    },
    bridge: {
      status: function() {
        return apiGet('/api/bridge/status');
      }
    },
    navigate: function(url) {
      // Falls back to postMessage for navigation (needs RN to change WebView URL)
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'pear-navigate', url: url
        }));
      }
    },
    share: function(url) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'pear-share', url: url
        }));
      }
    }
  };

  // --- window.posAPI (POS-specific, wraps pear.sync) ---

  var POS_APP_ID = 'pear-pos';

  // Auto-initialize sync group when POS loads
  // SECURITY: Hardcoded keys removed - must be configured by user
  (function initPOS() {
    var urlParams = new URLSearchParams(window.location.search);
    var savedKey = urlParams.get('inviteKey') || localStorage.getItem('pear-pos-invite-key');
    
    // SECURITY: Validate invite key format before use
    function isValidInviteKey(key) {
      return typeof key === 'string' && /^[0-9a-f]{64}$/i.test(key);
    }
    
    if (!savedKey) {
      console.log('[PearBridge] POS: No invite key configured, creating new sync group');
      window.pear.sync.create(POS_APP_ID).then(function(result) {
        if (result && result.inviteKey && isValidInviteKey(result.inviteKey)) {
          localStorage.setItem('pear-pos-invite-key', result.inviteKey);
        }
        console.log('[PearBridge] POS sync ready (direct HTTP)');
      }).catch(function(err) {
        console.error('[PearBridge] POS init failed:', err.message);
      });
    } else if (isValidInviteKey(savedKey)) {
      window.pear.sync.join(POS_APP_ID, savedKey).then(function(result) {
        console.log('[PearBridge] POS sync ready (direct HTTP)');
      }).catch(function(err) {
        console.error('[PearBridge] POS init failed:', err.message);
      });
    } else {
      console.error('[PearBridge] Invalid invite key format in localStorage');
      // Clear invalid key
      localStorage.removeItem('pear-pos-invite-key');
    }
  })();

  window.posAPI = {
    register: function(name, email, password) {
      return window.pear.sync.append(POS_APP_ID, {
        type: 'merchant:register', data: { name: name, email: email }, timestamp: new Date().toISOString()
      }).then(function() {
        return { token: 'p2p-local', merchant: { name: name, email: email } };
      });
    },
    login: function(email, password) {
      return Promise.resolve({ token: 'p2p-local', merchant: { email: email } });
    },
    getMe: function() {
      return window.pear.sync.list(POS_APP_ID, 'config!merchant', { limit: 1 })
        .then(function(r) { return r.length > 0 ? r[0].value : { name: 'POS User' }; });
    },
    listProducts: function(params) {
      return window.pear.sync.list(POS_APP_ID, 'products!', { limit: (params && params.limit) || 100 })
        .then(function(r) { return r.map(function(i) { return i.value; }); });
    },
    createProduct: function(product) {
      // SECURITY: Use crypto.randomUUID() if available, fallback to timestamp + random
      var id;
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = product.id || ('prod_' + crypto.randomUUID());
      } else {
        // Fallback with higher entropy
        var rand = (typeof crypto !== 'undefined' && crypto.getRandomValues) 
          ? crypto.getRandomValues(new Uint32Array(4)).join('')
          : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        id = product.id || ('prod_' + Date.now() + '_' + rand);
      }
      var p = Object.assign({ id: id, created_at: new Date().toISOString(), stock: 0 }, product);
      return window.pear.sync.append(POS_APP_ID, { type: 'product:create', data: p })
        .then(function() { return p; });
    },
    updateProduct: function(id, updates) {
      return window.pear.sync.append(POS_APP_ID, { type: 'product:update', data: { id: id, updates: updates } })
        .then(function() { return Object.assign({ id: id }, updates); });
    },
    deleteProduct: function(id) {
      return window.pear.sync.append(POS_APP_ID, { type: 'product:delete', data: { id: id } });
    },
    getProduct: function(id) {
      return window.pear.sync.get(POS_APP_ID, 'products!' + id);
    },
    adjustStock: function(productId, delta, reason) {
      return window.pear.sync.append(POS_APP_ID, { type: 'stock:adjust', data: { product_id: productId, delta: delta, reason: reason } });
    },
    getLowStock: function() {
      return window.pear.sync.list(POS_APP_ID, 'products!', { limit: 100 })
        .then(function(r) {
          return r.map(function(i) { return i.value; })
            .filter(function(p) { return p && p.stock !== undefined && p.stock <= (p.low_stock_threshold || 5); });
        });
    },
    getStockAlerts: function() { return this.getLowStock().then(function(p) { return { alerts: p, total: p.length }; }); },
    createTransaction: function(items, paymentMethod, options) {
      // SECURITY: Use crypto.randomUUID() if available
      var id;
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = 'txn_' + crypto.randomUUID();
      } else {
        var rand = (typeof crypto !== 'undefined' && crypto.getRandomValues)
          ? crypto.getRandomValues(new Uint32Array(4)).join('')
          : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        id = 'txn_' + Date.now() + '_' + rand;
      }
      var txn = {
        id: id, items: items, payment_method: paymentMethod, status: 'completed',
        created_at: new Date().toISOString(),
        total_cents: items.reduce(function(s,i) { return s + (i.price_cents * i.quantity); }, 0)
      };
      if (options) Object.assign(txn, options);
      return window.pear.sync.append(POS_APP_ID, { type: 'transaction:create', data: txn })
        .then(function() { return txn; });
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
      return window.pear.sync.get(POS_APP_ID, 'config!merchant')
        .then(function(r) { return r || {}; });
    },
    updateConfig: function(updates) {
      return window.pear.sync.append(POS_APP_ID, { type: 'config:set', data: updates });
    }
  };

  console.log('[PearBridge] Injected (direct HTTP on port ' + PORT + ')');
})();
`;
}

// Legacy export for backward compatibility
export const BRIDGE_INJECT_JS = createBridgeScript(0, '');
