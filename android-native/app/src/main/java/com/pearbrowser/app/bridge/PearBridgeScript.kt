package com.pearbrowser.app.bridge

/**
 * The Pear bridge script injected into WebViews that load hyper:// content.
 *
 * This is the Kotlin equivalent of `app/lib/pear-bridge-spec.ts`. The
 * template itself is byte-identical — we just substitute the two
 * placeholders __PEAR_BRIDGE_PORT__ and __PEAR_BRIDGE_TOKEN__ with the
 * local proxy port + the drive-scoped capability token issued by the
 * worklet.
 *
 * Keep in sync with app/lib/pear-bridge-spec.ts! Any change to the
 * bridge protocol must update both files together.
 *
 * See docs/HOLEPUNCH_ALIGNMENT_PLAN.md, Phase 2 ticket 6.
 */
object PearBridgeScript {

    /** The raw ES5 script with placeholder markers. Mirrors
     *  [PEAR_BRIDGE_SCRIPT_TEMPLATE] from the TS module. */
    private const val TEMPLATE = """
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
    bridge: { status: function() { return apiGet('/api/bridge/status'); } },
    navigate: function(url) {
      if (window.PearBrowserNative && window.PearBrowserNative.navigate) window.PearBrowserNative.navigate(url);
    },
    share: function(url) {
      if (window.PearBrowserNative && window.PearBrowserNative.share) window.PearBrowserNative.share(url);
    }
  };

  console.log('[PearBridge] Injected (native Android, port ' + PORT + ')');
})();
"""

    /**
     * Build the actual script for a given WebView. Escapes the token
     * through JSON encoding so embedded quotes are safe.
     */
    fun build(port: Int, apiToken: String): String {
        require(port in 0..65535) { "port out of range: $port" }
        // JSON-encode the token so embedded quotes are safe inside the script.
        val tokenLiteral = "\"" + apiToken.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
        return TEMPLATE
            .replace("__PEAR_BRIDGE_PORT__", port.toString())
            .replace("__PEAR_BRIDGE_TOKEN__", tokenLiteral)
    }
}
