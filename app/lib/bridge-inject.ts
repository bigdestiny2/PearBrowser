/**
 * JavaScript to inject into WebViews running P2P apps.
 *
 * Provides window.pear and window.posAPI bridges that communicate
 * with React Native via postMessage. RN relays these to the
 * worklet backend for actual P2P/Autobase operations.
 *
 * The injected code runs in the WebView context (not RN).
 */

export const BRIDGE_INJECT_JS = `
(function() {
  if (window.__pearBridgeInjected) return;
  window.__pearBridgeInjected = true;

  // --- Message handling ---
  let _nextId = 1;
  const _pending = new Map(); // id → { resolve, reject }
  const _listeners = new Map(); // event → [callback]

  function call(method, args) {
    return new Promise((resolve, reject) => {
      const id = _nextId++;
      const timeout = setTimeout(() => {
        _pending.delete(id);
        reject(new Error('Bridge timeout: ' + method));
      }, 30000);

      _pending.set(id, { resolve, reject, timeout });

      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'pear-bridge',
        id: id,
        method: method,
        args: args
      }));
    });
  }

  // Handle replies from React Native
  window.addEventListener('message', function(event) {
    try {
      const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (msg.type === 'pear-bridge-reply') {
        const pending = _pending.get(msg.id);
        if (pending) {
          clearTimeout(pending.timeout);
          _pending.delete(msg.id);
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.result);
        }
      }
      if (msg.type === 'pear-bridge-event') {
        const listeners = _listeners.get(msg.event) || [];
        listeners.forEach(function(cb) { try { cb(msg.data); } catch(e) {} });
      }
    } catch(e) {}
  });

  // --- window.pear API (generic P2P) ---
  window.pear = {
    sync: {
      create: function(appId) { return call('sync.create', { appId: appId }); },
      join: function(appId, inviteKey) { return call('sync.join', { appId: appId, inviteKey: inviteKey }); },
      append: function(appId, op) { return call('sync.append', { appId: appId, op: op }); },
      get: function(appId, key) { return call('sync.get', { appId: appId, key: key }); },
      list: function(appId, prefix, opts) { return call('sync.list', { appId: appId, prefix: prefix, opts: opts }); },
      status: function(appId) { return call('sync.status', { appId: appId }); },
      onSync: function(cb) {
        var cbs = _listeners.get('sync') || [];
        cbs.push(cb);
        _listeners.set('sync', cbs);
      }
    },
    identity: {
      getPublicKey: function() { return call('identity.getPublicKey', {}); }
    },
    navigate: function(url) { return call('navigate', { url: url }); },
    share: function(url) { return call('share', { url: url }); }
  };

  // --- window.posAPI (POS-specific, wraps pear.sync for POS data model) ---
  var POS_APP_ID = 'pear-pos';
  var _posReady = false;

  // Auto-initialize sync group when POS loads
  (function initPOS() {
    // Check if there's a saved invite key to join, otherwise create new
    var savedKey = localStorage.getItem('pear-pos-invite-key');
    var initPromise = savedKey
      ? call('sync.join', { appId: POS_APP_ID, inviteKey: savedKey })
      : call('sync.create', { appId: POS_APP_ID });

    initPromise.then(function(result) {
      _posReady = true;
      if (result.inviteKey) {
        localStorage.setItem('pear-pos-invite-key', result.inviteKey);
      }
      console.log('[PearBridge] POS sync group ready:', result.inviteKey ? result.inviteKey.slice(0, 16) + '...' : 'unknown');
    }).catch(function(err) {
      console.error('[PearBridge] POS sync init failed:', err.message);
      // Still mark as ready — app can work offline
      _posReady = true;
    });
  })();

  window.posAPI = {
    // Auth — P2P mode uses local-only auth
    register: function(name, email, password) {
      return call('sync.append', {
        appId: POS_APP_ID,
        op: { type: 'merchant:register', data: { name: name, email: email }, timestamp: new Date().toISOString() }
      }).then(function() {
        return { token: 'p2p-local', merchant: { name: name, email: email } };
      });
    },
    login: function(email, password) {
      return Promise.resolve({ token: 'p2p-local', merchant: { email: email } });
    },
    getMe: function() {
      return call('sync.list', { appId: POS_APP_ID, prefix: 'merchant!', opts: { limit: 1 } })
        .then(function(results) {
          return results.length > 0 ? results[0].value : { name: 'POS User' };
        });
    },

    // Products
    listProducts: function(params) {
      return call('sync.list', { appId: POS_APP_ID, prefix: 'products!', opts: { limit: params?.limit || 100 } })
        .then(function(results) { return results.map(function(r) { return r.value; }); });
    },
    createProduct: function(product) {
      var id = product.id || ('prod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
      var p = Object.assign({ id: id, created_at: new Date().toISOString(), stock: 0 }, product);
      return call('sync.append', {
        appId: POS_APP_ID,
        op: { type: 'product:create', data: p }
      }).then(function() { return p; });
    },
    updateProduct: function(id, updates) {
      return call('sync.append', {
        appId: POS_APP_ID,
        op: { type: 'product:update', data: { id: id, updates: updates } }
      }).then(function() { return Object.assign({ id: id }, updates); });
    },
    deleteProduct: function(id) {
      return call('sync.append', {
        appId: POS_APP_ID,
        op: { type: 'product:delete', data: { id: id } }
      });
    },
    getProduct: function(id) {
      return call('sync.get', { appId: POS_APP_ID, key: 'products!' + id });
    },

    // Stock
    adjustStock: function(productId, delta, reason) {
      return call('sync.append', {
        appId: POS_APP_ID,
        op: { type: 'stock:adjust', data: { product_id: productId, delta: delta, reason: reason } }
      });
    },
    getLowStock: function() {
      return call('sync.list', { appId: POS_APP_ID, prefix: 'products!', opts: { limit: 100 } })
        .then(function(results) {
          return results.map(function(r) { return r.value; })
            .filter(function(p) { return p && p.stock !== undefined && p.stock <= (p.low_stock_threshold || 5); });
        });
    },

    // Transactions
    createTransaction: function(items, paymentMethod, options) {
      var id = 'txn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      var txn = {
        id: id,
        items: items,
        payment_method: paymentMethod,
        status: 'completed',
        created_at: new Date().toISOString(),
        total_cents: items.reduce(function(sum, item) { return sum + (item.price_cents * item.quantity); }, 0)
      };
      if (options) Object.assign(txn, options);
      return call('sync.append', {
        appId: POS_APP_ID,
        op: { type: 'transaction:create', data: txn }
      }).then(function() { return txn; });
    },
    listTransactions: function(params) {
      return call('sync.list', { appId: POS_APP_ID, prefix: 'transactions!', opts: { limit: params?.limit || 50 } })
        .then(function(results) { return { transactions: results.map(function(r) { return r.value; }) }; });
    },

    // Sync
    getSyncStatus: function() {
      return call('sync.status', { appId: POS_APP_ID });
    },
    getSyncInviteKey: function() {
      return Promise.resolve(localStorage.getItem('pear-pos-invite-key'));
    },
    joinSyncGroup: function(inviteKey) {
      localStorage.setItem('pear-pos-invite-key', inviteKey);
      return call('sync.join', { appId: POS_APP_ID, inviteKey: inviteKey });
    },
    getConfig: function() {
      return call('sync.get', { appId: POS_APP_ID, key: 'config!main' })
        .then(function(r) { return r || {}; });
    },
    updateConfig: function(updates) {
      return call('sync.append', {
        appId: POS_APP_ID,
        op: { type: 'config:set', data: updates }
      });
    }
  };

  console.log('[PearBridge] window.pear and window.posAPI injected');
})();
`;
