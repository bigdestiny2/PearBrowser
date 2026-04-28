//  PearBrowser — BrowseScreen.swift
//
//  WKWebView-backed browser host with Pear bridge injection.
//  Mirror of app/screens/BrowseScreen.tsx and ui/screens/BrowseScreen.kt.
//
//  Token model:
//    - hyper:// URLs (proxied to localhost:PORT/v1/hyper/<key>/...) →
//      use `host.apiToken`, the drive-scoped token issued by the proxy
//      when the worklet navigated to that drive.
//    - HTTPS pages (loaded directly into WKWebView) → fetch a per-origin
//      session token via PearRPC.pearSession(origin: ...) before the
//      page loads. Injected bridge gets that token in its template.
//      Each app sees a different per-app sub-pubkey via the per-origin
//      pseudo-driveKey derivation in the worklet.
//    - Anything else (about:, data:) → no bridge token, the bridge
//      fails-closed for those pages.

import SwiftUI
@preconcurrency import WebKit

struct BrowseScreen: View {
    let initialUrl: String?

    @EnvironmentObject private var host: PearWorkletHost
    @State private var session: BridgeSession?
    /// Set when the worklet's trusted-origins gate refused the page.
    /// The bridge is NOT injected; we surface a "Trust this site"
    /// affordance so the user can opt in.
    @State private var untrustedOrigin: String?
    @State private var trustErrorMessage: String?

    var body: some View {
        if let urlString = initialUrl, let url = URL(string: urlString) {
            ZStack(alignment: .bottom) {
                WebViewContainer(
                    url: url,
                    session: session
                )
                if let pending = untrustedOrigin {
                    TrustOriginBanner(
                        origin: pending,
                        errorMessage: trustErrorMessage,
                        onTrust: { Task { await trust(origin: pending, then: url) } }
                    )
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .task(id: urlString) { await refreshSession(for: url) }
        } else {
            VStack(spacing: 12) {
                Text("Browse")
                    .font(.system(size: 24))
                    .foregroundStyle(PearColors.textPrimary)
                Text("Enter a hyper:// address on the Home tab, or tap a site in Explore.")
                    .font(.system(size: 14))
                    .foregroundStyle(PearColors.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(PearColors.bg)
        }
    }

    /// Pick a token for this URL. For loopback hyper:// proxy URLs we
    /// reuse the worklet's drive-scoped token. For real HTTPS pages we
    /// mint a fresh per-origin session token so the bridge accepts the
    /// page as a distinct "app" for the identity / login flow.
    ///
    /// Also handles the trusted-origins privacy gate: when the worklet
    /// is in 'allowlist' mode and the origin is not trusted, the bridge
    /// is NOT injected and we surface a TrustOriginBanner so the user
    /// can opt in.
    private func refreshSession(for url: URL) async {
        // Default state: clear any prior trust-banner before deciding.
        untrustedOrigin = nil
        trustErrorMessage = nil

        guard let scheme = url.scheme?.lowercased() else { session = nil; return }

        // Loopback proxy URL — bridge uses the drive-scoped token issued
        // by the worklet when it served the drive. host.apiToken is set
        // by EVT_READY / evening-up navigation events. Always-on,
        // bypasses the trust gate (this IS our own surface).
        if scheme == "http" && (url.host == "127.0.0.1" || url.host == "localhost") {
            session = BridgeSession(port: host.proxyPort, token: host.apiToken)
            return
        }

        // hyper:// — should never reach the WebView directly because we
        // route those through the proxy in the navigator. If we do, fall
        // back to the drive-scoped browser token. Always-on for the same
        // reason loopback is.
        if scheme == "hyper" {
            session = BridgeSession(port: host.proxyPort, token: host.apiToken)
            return
        }

        // Real HTTPS / HTTP origin — ask the worklet to mint a per-origin
        // token. If trust mode = 'allowlist' and this origin isn't on
        // it, we receive .denied and skip injection entirely.
        guard let origin = canonicalOrigin(of: url) else {
            session = nil
            return
        }
        do {
            let result = try await host.rpc.pearSession(origin: origin)
            switch result {
            case .allowed(let token, _, _, let port):
                session = BridgeSession(port: port > 0 ? port : host.proxyPort, token: token)
            case .denied(let reason, _):
                NSLog("[BrowseScreen] bridge injection denied for \(origin) (reason=\(reason))")
                session = nil
                untrustedOrigin = origin
            }
        } catch {
            NSLog("[BrowseScreen] pearSession failed for \(origin): \(error)")
            session = nil // bridge will be injected unauthorised
        }
    }

    /// User tapped "Trust this site" — add the origin to the allow-list
    /// and refresh the session so the bridge gets injected on next load.
    private func trust(origin: String, then url: URL) async {
        do {
            _ = try await host.rpc.trustedOriginsAdd(origin)
            await refreshSession(for: url)
            // A reload here would re-run document-start scripts, so the
            // newly-installed bridge takes effect on the *next* navigation.
            // For an in-place flip the page would need to reload — left
            // to the URL bar / pull-to-refresh which we don't render in
            // this minimal BrowseScreen.
        } catch {
            NSLog("[BrowseScreen] trustedOriginsAdd failed: \(error)")
            trustErrorMessage = "Could not trust this site: \(error.localizedDescription)"
        }
    }

    /// Build `scheme://host[:port]` matching what the worklet's
    /// `normaliseOrigin` does so the resulting pseudo-driveKey is stable.
    private func canonicalOrigin(of url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(),
              !host.isEmpty,
              scheme == "http" || scheme == "https" else { return nil }
        let defaultPort = scheme == "https" ? 443 : 80
        if let port = url.port, port != defaultPort {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }
}

/// What the bridge needs to know to authenticate against the worklet's
/// HTTP server. `nil` when no token is available (bridge renders unauth).
struct BridgeSession: Equatable {
    let port: Int
    let token: String
}

struct WebViewContainer: UIViewRepresentable {
    let url: URL
    let session: BridgeSession?

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Listen to window.webkit.messageHandlers.PearBrowserNative.postMessage
        config.userContentController.add(context.coordinator, name: "PearBrowserNative")

        // Pages can capture audio/video only with explicit user gesture.
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.backgroundColor = UIColor.black
        webView.isOpaque = false

        // Stash a reference on the coordinator so navigation callbacks
        // can re-inject when the session changes.
        context.coordinator.webView = webView
        context.coordinator.session = session
        installBridge(in: webView, session: session)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Token rotated — refresh the user-script set so the next
        // navigation injects the new token at document-start.
        if context.coordinator.session != session {
            context.coordinator.session = session
            installBridge(in: webView, session: session)
        }
        if webView.url != url {
            webView.load(URLRequest(url: url))
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Replace the user-content-controller's userScripts with a fresh
    /// bridge built from the current session. Called on every session
    /// change. Cheap — userScripts is a small array.
    private func installBridge(in webView: WKWebView, session: BridgeSession?) {
        let port = session?.port ?? 0
        let token = session?.token ?? ""
        let script = PearBridgeScript.build(port: port, apiToken: token)
        let userScript = WKUserScript(
            source: script,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        webView.configuration.userContentController.removeAllUserScripts()
        webView.configuration.userContentController.addUserScript(userScript)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var session: BridgeSession?

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            NSLog("[BrowseScreen] navigation error: \(error.localizedDescription)")
        }

        func userContentController(_ userContentController: WKUserContentController,
                                    didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }
            switch type {
            case "pear-navigate":
                NSLog("[BrowseScreen] pear-navigate → \(body["url"] ?? "")")
            case "pear-share":
                NSLog("[BrowseScreen] pear-share → \(body["url"] ?? "")")
            default:
                break
            }
        }
    }
}

/// A discreet banner shown over the WebView when the page's origin is
/// not on the user's trust list (privacy mode = 'allowlist'). Tapping
/// "Trust this site" adds the origin and re-runs the session-mint flow.
private struct TrustOriginBanner: View {
    let origin: String
    let errorMessage: String?
    let onTrust: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "lock.shield")
                    .foregroundStyle(PearColors.textPrimary)
                Text("Pear bridge disabled")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PearColors.textPrimary)
                Spacer()
            }
            Text(origin)
                .font(.system(size: 12))
                .foregroundStyle(PearColors.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Text("This site is not on your trusted list. Tap Trust if you want it to use window.pear features.")
                .font(.system(size: 12))
                .foregroundStyle(PearColors.textSecondary)
            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 12))
                    .foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button(action: onTrust) {
                    Text("Trust this site")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(PearColors.accent, in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(PearColors.border, lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.3), radius: 8, x: 0, y: 4)
    }
}

#Preview {
    BrowseScreen(initialUrl: nil)
        .environmentObject(PearWorkletHost.shared)
}
