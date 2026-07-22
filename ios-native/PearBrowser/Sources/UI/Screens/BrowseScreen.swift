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
    @State private var webViewUrl: URL?
    @State private var session: BridgeSession?
    @State private var loadError: String?
    /// Set when the worklet's trusted-origins gate refused the page.
    /// The bridge is NOT injected; we surface a "Trust this site"
    /// affordance so the user can opt in.
    @State private var untrustedOrigin: String?
    @State private var trustErrorMessage: String?
    @State private var findVisible = false
    @State private var findQuery = ""
    @State private var findCommand: FindCommand?
    @State private var findSequence = 0
    @State private var findResult = ""
    @State private var reloadSequence = 0
    @State private var pageTitle = ""
    @State private var bookmarked = false
    @State private var desktopSiteRequested = false
    @State private var shareItem: String?

    var body: some View {
        if let urlString = initialUrl {
            ZStack(alignment: .bottom) {
                if let webViewUrl {
                    VStack(spacing: 0) {
                        if findVisible {
                            FindInPageBar(
                                query: $findQuery,
                                result: findResult,
                                onPrevious: { runFind(backwards: true) },
                                onNext: { runFind(backwards: false) },
                                onClose: closeFind
                            )
                        }
                        WebViewContainer(
                            url: webViewUrl,
                            session: session,
                            findCommand: findCommand,
                            reloadSequence: reloadSequence,
                            desktopSiteRequested: desktopSiteRequested,
                            onFindResult: { findResult = $0 },
                            onTitleChange: { pageTitle = $0 },
                            onShareRequested: { shareItem = $0 }
                        )
                    }
                    .overlay(alignment: .topTrailing) {
                        if !findVisible {
                            Menu {
                                Button {
                                    shareItem = urlString
                                } label: {
                                    Label("Share", systemImage: "square.and.arrow.up")
                                }
                                Button {
                                    UIPasteboard.general.string = urlString
                                } label: {
                                    Label("Copy Link", systemImage: "doc.on.doc")
                                }
                                Button {
                                    toggleBookmark(urlString: urlString)
                                } label: {
                                    Label(
                                        bookmarked ? "Remove Bookmark" : "Add Bookmark",
                                        systemImage: bookmarked ? "bookmark.slash" : "bookmark"
                                    )
                                }
                                Divider()
                                Button {
                                    reloadSequence += 1
                                } label: {
                                    Label("Reload", systemImage: "arrow.clockwise")
                                }
                                .accessibilityLabel("Reload page")
                                Button {
                                    findVisible = true
                                } label: {
                                    Label("Find in Page", systemImage: "magnifyingglass")
                                }
                                .accessibilityLabel("Find in page")
                                Button {
                                    desktopSiteRequested.toggle()
                                } label: {
                                    Label(
                                        desktopSiteRequested ? "Request Mobile Site" : "Request Desktop Site",
                                        systemImage: desktopSiteRequested ? "iphone" : "desktopcomputer"
                                    )
                                }
                            } label: {
                                Image(systemName: "ellipsis.circle")
                                    .frame(width: 36, height: 36)
                                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6))
                            }
                            .accessibilityLabel("Page actions")
                            .padding(8)
                        }
                    }
                } else {
                    loadingState
                }
                if let pending = untrustedOrigin {
                    TrustOriginBanner(
                        origin: pending,
                        errorMessage: trustErrorMessage,
                        onTrust: {
                            Task {
                                if let original = URL(string: urlString) {
                                    await trust(origin: pending, then: original)
                                }
                            }
                        }
                    )
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .task(id: navigationTaskID) { await prepareNavigation(urlString: urlString) }
            .task(id: bookmarkTaskID(urlString: urlString)) { await loadBookmark(urlString: urlString) }
            .sheet(isPresented: Binding(
                get: { shareItem != nil },
                set: { if !$0 { shareItem = nil } }
            )) {
                if let shareItem {
                    ShareSheet(activityItems: [shareItem])
                }
            }
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

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView().tint(PearColors.accent)
            Text(loadError ?? "Connecting to peers...")
                .font(.system(size: 14))
                .foregroundStyle(loadError == nil ? PearColors.textSecondary : PearColors.error)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PearColors.bg)
    }

    private var navigationTaskID: String {
        "\(initialUrl ?? "")|\(host.isReady)|\(host.proxyPort)"
    }

    private func runFind(backwards: Bool) {
        let query = findQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        findSequence += 1
        findCommand = FindCommand(query: query, backwards: backwards, sequence: findSequence)
    }

    private func closeFind() {
        findVisible = false
        findQuery = ""
        findResult = ""
        findSequence += 1
        findCommand = FindCommand(query: "", backwards: false, sequence: findSequence)
    }

    private func bookmarkTaskID(urlString: String) -> String {
        "\(urlString)|\(host.isReady)"
    }

    private func loadBookmark(urlString: String) async {
        guard host.isReady else {
            bookmarked = false
            return
        }
        do {
            let items = try await host.rpc.listBookmarks()
            bookmarked = items.contains { ($0["url"] as? String) == urlString }
        } catch {
            bookmarked = false
        }
    }

    private func toggleBookmark(urlString: String) {
        guard host.isReady else {
            loadError = "P2P engine is not ready yet."
            return
        }
        Task {
            do {
                if bookmarked {
                    try await host.rpc.removeBookmark(url: urlString)
                    bookmarked = false
                } else {
                    try await host.rpc.addBookmark(
                        url: urlString,
                        title: pageTitle.isEmpty ? urlString : pageTitle
                    )
                    bookmarked = true
                }
            } catch {
                loadError = "Could not update bookmark: \(error.localizedDescription)"
            }
        }
    }

    private func prepareNavigation(urlString: String?) async {
        guard let urlString, let original = URL(string: urlString) else {
            webViewUrl = nil
            session = nil
            return
        }

        loadError = nil
        let scheme = original.scheme?.lowercased()

        if scheme == "hyper" {
            guard host.isReady, host.proxyPort > 0 else {
                session = nil
                webViewUrl = nil
                return
            }
            do {
                let result = try await host.rpc.navigate(url: urlString)
                guard let localUrl = result["localUrl"] as? String,
                      let local = URL(string: localUrl) else {
                    throw RPCError(message: "navigate returned no localUrl")
                }
                let token = (result["apiToken"] as? String) ?? ""
                session = BridgeSession(port: local.port ?? host.proxyPort, token: token)
                webViewUrl = local
                return
            } catch {
                session = nil
                webViewUrl = nil
                loadError = "Could not open hyper:// URL: \(error.localizedDescription)"
                return
            }
        }

        webViewUrl = original
        await refreshSession(for: original)
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

struct FindCommand: Equatable {
    let query: String
    let backwards: Bool
    let sequence: Int
}

struct WebViewContainer: UIViewRepresentable {
    let url: URL
    let session: BridgeSession?
    let findCommand: FindCommand?
    let reloadSequence: Int
    let desktopSiteRequested: Bool
    let onFindResult: (String) -> Void
    let onTitleChange: (String) -> Void
    let onShareRequested: (String) -> Void

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Listen to window.webkit.messageHandlers.PearBrowserNative.postMessage
        config.userContentController.add(context.coordinator, name: "PearBrowserNative")

        // Pages can capture audio/video only with explicit user gesture.
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.preferredContentMode = desktopSiteRequested ? .desktop : .mobile

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.customUserAgent = desktopSiteRequested ? pearDesktopUserAgent : nil
        webView.navigationDelegate = context.coordinator
        webView.backgroundColor = UIColor.black
        webView.isOpaque = false

        // Stash a reference on the coordinator so navigation callbacks
        // can re-inject when the session changes.
        context.coordinator.webView = webView
        context.coordinator.session = session
        context.coordinator.findCommand = findCommand
        context.coordinator.reloadSequence = reloadSequence
        context.coordinator.desktopSiteRequested = desktopSiteRequested
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
        if context.coordinator.findCommand != findCommand {
            context.coordinator.findCommand = findCommand
            applyFind(findCommand, in: webView)
        }
        if context.coordinator.reloadSequence != reloadSequence {
            context.coordinator.reloadSequence = reloadSequence
            webView.reload()
        }
        if context.coordinator.desktopSiteRequested != desktopSiteRequested {
            context.coordinator.desktopSiteRequested = desktopSiteRequested
            webView.configuration.defaultWebpagePreferences.preferredContentMode = desktopSiteRequested ? .desktop : .mobile
            webView.customUserAgent = desktopSiteRequested ? pearDesktopUserAgent : nil
            webView.reload()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onTitleChange: onTitleChange, onShareRequested: onShareRequested)
    }

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

    private func applyFind(_ command: FindCommand?, in webView: WKWebView) {
        guard let command else { return }
        let configuration = WKFindConfiguration()
        configuration.backwards = command.backwards
        configuration.wraps = true
        webView.find(command.query, configuration: configuration) { result in
            onFindResult(command.query.isEmpty ? "" : (result.matchFound ? "Match" : "No match"))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var session: BridgeSession?
        var findCommand: FindCommand?
        var reloadSequence = 0
        var desktopSiteRequested = false
        let onTitleChange: (String) -> Void
        let onShareRequested: (String) -> Void

        init(onTitleChange: @escaping (String) -> Void,
             onShareRequested: @escaping (String) -> Void) {
            self.onTitleChange = onTitleChange
            self.onShareRequested = onShareRequested
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            NSLog("[BrowseScreen] navigation error: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onTitleChange(webView.title ?? "")
        }

        func userContentController(_ userContentController: WKUserContentController,
                                    didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }
            switch type {
            case "pear-navigate":
                NSLog("[BrowseScreen] pear-navigate → \(body["url"] ?? "")")
            case "pear-share":
                if let url = body["url"] as? String, !url.isEmpty {
                    onShareRequested(url)
                }
            default:
                break
            }
        }
    }
}

private let pearDesktopUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 PearBrowser/0.1 Safari/605.1.15"

private struct FindInPageBar: View {
    @Binding var query: String
    let result: String
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            TextField("Find in page", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit(onNext)
                .textFieldStyle(.roundedBorder)
            if !result.isEmpty {
                Text(result)
                    .font(.system(size: 11))
                    .foregroundStyle(PearColors.textSecondary)
                    .fixedSize()
            }
            Button(action: onPrevious) {
                Image(systemName: "chevron.up")
                    .frame(width: 28, height: 28)
            }
            .accessibilityLabel("Previous match")
            Button(action: onNext) {
                Image(systemName: "chevron.down")
                    .frame(width: 28, height: 28)
            }
            .accessibilityLabel("Next match")
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .frame(width: 28, height: 28)
            }
            .accessibilityLabel("Close find")
        }
        .padding(8)
        .background(PearColors.surface)
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
