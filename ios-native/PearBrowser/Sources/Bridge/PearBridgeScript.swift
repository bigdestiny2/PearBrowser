//  PearBrowser — PearBridgeScript.swift
//
//  The Pear bridge script injected into WebViews that load hyper:// content.
//
//  Swift equivalent of app/lib/pear-bridge-spec.ts + PearBridgeScript.kt.
//  The ES5 template is byte-identical across all three shells — we just
//  substitute the two placeholders __PEAR_BRIDGE_PORT__ and
//  __PEAR_BRIDGE_TOKEN__ with platform-specific values.
//
//  Keep in sync with:
//    - app/lib/pear-bridge-spec.ts
//    - android-native/.../bridge/PearBridgeScript.kt
//
//  Phase 3 ticket — see docs/HOLEPUNCH_ALIGNMENT_PLAN.md.

import Foundation

enum PearBridgeScript {

    /// Raw ES5 script with placeholder markers.
    static let template = """
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
      status: function(appId) { return apiGet('/api/sync/status?appId=' + encodeURIComponent(appId)); }
    },
    identity: { getPublicKey: function() { return apiGet('/api/identity'); } },
    bridge: { status: function() { return apiGet('/api/bridge/status'); } },
    navigate: function(url) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.PearBrowserNative) {
        window.webkit.messageHandlers.PearBrowserNative.postMessage({ type: 'pear-navigate', url: url });
      }
    },
    share: function(url) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.PearBrowserNative) {
        window.webkit.messageHandlers.PearBrowserNative.postMessage({ type: 'pear-share', url: url });
      }
    }
  };

  console.log('[PearBridge] Injected (native iOS, port ' + PORT + ')');
})();
"""

    /// Build the actual script for a given WebView.
    static func build(port: Int, apiToken: String) -> String {
        precondition((0...65535).contains(port), "port out of range: \(port)")
        // JSON-encode the token so embedded quotes / backslashes are safe.
        let tokenLiteral: String
        if let data = try? JSONSerialization.data(withJSONObject: apiToken, options: [.fragmentsAllowed]),
           let str = String(data: data, encoding: .utf8) {
            tokenLiteral = str
        } else {
            tokenLiteral = "\"\""
        }
        return template
            .replacingOccurrences(of: "__PEAR_BRIDGE_PORT__", with: String(port))
            .replacingOccurrences(of: "__PEAR_BRIDGE_TOKEN__", with: tokenLiteral)
    }
}
