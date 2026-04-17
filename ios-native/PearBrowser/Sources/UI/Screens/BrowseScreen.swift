//  PearBrowser — BrowseScreen.swift
//
//  WKWebView-backed browser host with Pear bridge injection.
//  Mirror of app/screens/BrowseScreen.tsx and ui/screens/BrowseScreen.kt.

import SwiftUI
@preconcurrency import WebKit

struct BrowseScreen: View {
    let initialUrl: String?

    @EnvironmentObject private var host: PearWorkletHost

    var body: some View {
        if let urlString = initialUrl, let url = URL(string: urlString) {
            WebViewContainer(
                url: url,
                proxyPort: host.proxyPort,
                apiToken: host.apiToken
            )
            .ignoresSafeArea(edges: .bottom)
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
}

struct WebViewContainer: UIViewRepresentable {
    let url: URL
    let proxyPort: Int
    let apiToken: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Inject the Pear bridge as soon as each page starts loading.
        let script = PearBridgeScript.build(port: proxyPort, apiToken: apiToken)
        let userScript = WKUserScript(
            source: script,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(userScript)

        // Listen to window.webkit.messageHandlers.PearBrowserNative.postMessage
        config.userContentController.add(context.coordinator, name: "PearBrowserNative")

        // Pages can capture audio/video only with explicit user gesture.
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.backgroundColor = UIColor.black
        webView.isOpaque = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url != url {
            webView.load(URLRequest(url: url))
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            NSLog("[BrowseScreen] navigation error: \(error.localizedDescription)")
        }

        func userContentController(_ userContentController: WKUserContentController,
                                    didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }
            switch type {
            case "pear-navigate":
                // TODO: route through the parent navigator — plumb a callback up via Environment
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
