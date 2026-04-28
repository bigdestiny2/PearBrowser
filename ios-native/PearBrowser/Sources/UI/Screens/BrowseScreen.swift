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

    var body: some View {
        if let urlString = initialUrl, let url = URL(string: urlString) {
            WebViewContainer(
                url: url,
                session: session
            )
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
    private func refreshSession(for url: URL) async {
        guard let scheme = url.scheme?.lowercased() else { session = nil; return }

        // Loopback proxy URL — bridge uses the drive-scoped token issued
        // by the worklet when it served the drive. host.apiToken is set
        // by EVT_READY / evening-up navigation events.
        if scheme == "http" && (url.host == "127.0.0.1" || url.host == "localhost") {
            session = BridgeSession(port: host.proxyPort, token: host.apiToken)
            return
        }

        // hyper:// — should never reach the WebView directly because we
        // route those through the proxy in the navigator. If we do, fall
        // back to the drive-scoped browser token.
        if scheme == "hyper" {
            session = BridgeSession(port: host.proxyPort, token: host.apiToken)
            return
        }

        // Real HTTPS / HTTP origin — mint per-origin token via RPC.
        guard let origin = canonicalOrigin(of: url) else {
            session = nil
            return
        }
        do {
            let s = try await host.rpc.pearSession(origin: origin)
            session = BridgeSession(port: s.port > 0 ? s.port : host.proxyPort, token: s.token)
        } catch {
            NSLog("[BrowseScreen] pearSession failed for \(origin): \(error)")
            session = nil // bridge will be injected unauthorised
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

#Preview {
    BrowseScreen(initialUrl: nil)
        .environmentObject(PearWorkletHost.shared)
}
