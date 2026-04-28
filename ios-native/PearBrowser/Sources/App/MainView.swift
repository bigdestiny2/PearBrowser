//  PearBrowser — MainView.swift
//
//  Root SwiftUI view. Tab navigator, status dot, sheet routing to all
//  the modal screens (QR scanner, site editor, backup phrase, restore).
//
//  More tab uses a simple state-machine for its sub-navigation (matches
//  the RN shell's pattern in app/App.tsx).

import SwiftUI

enum Tab: Hashable {
    case home, explore, browse, more
    var icon: String {
        switch self {
        case .home: return "{ }"
        case .explore: return "[ ]"
        case .browse: return "<>"
        case .more: return "..."
        }
    }
    var label: String {
        switch self {
        case .home: return "Home"
        case .explore: return "Explore"
        case .browse: return "Browse"
        case .more: return "More"
        }
    }
}

// Sub-screens under the More tab.
private enum MoreRoute: Hashable {
    case hub
    case bookmarks
    case history
    case settings
    case sites
    case sitesTemplatePicker(pendingName: String)
    case editor(siteId: String, siteName: String?, initialBlocks: [[String: Any]]?)
    case backupPhrase
    case restoreIdentity
    case profile
    case connectedApps
    case trustedSites

    static func == (lhs: MoreRoute, rhs: MoreRoute) -> Bool {
        switch (lhs, rhs) {
        case (.hub, .hub), (.bookmarks, .bookmarks), (.history, .history),
             (.settings, .settings), (.sites, .sites), (.backupPhrase, .backupPhrase),
             (.restoreIdentity, .restoreIdentity),
             (.profile, .profile), (.connectedApps, .connectedApps),
             (.trustedSites, .trustedSites):
            return true
        case (.sitesTemplatePicker(let a), .sitesTemplatePicker(let b)): return a == b
        case (.editor(let a, _, _), .editor(let b, _, _)): return a == b
        default: return false
        }
    }
    func hash(into hasher: inout Hasher) {
        switch self {
        case .hub: hasher.combine(0)
        case .bookmarks: hasher.combine(1)
        case .history: hasher.combine(2)
        case .settings: hasher.combine(3)
        case .sites: hasher.combine(4)
        case .sitesTemplatePicker(let n): hasher.combine(5); hasher.combine(n)
        case .editor(let id, _, _): hasher.combine(6); hasher.combine(id)
        case .backupPhrase: hasher.combine(7)
        case .restoreIdentity: hasher.combine(8)
        case .profile: hasher.combine(9)
        case .connectedApps: hasher.combine(10)
        case .trustedSites: hasher.combine(11)
        }
    }
}

struct MainView: View {
    @EnvironmentObject private var host: PearWorkletHost
    @State private var activeTab: Tab = .home
    @State private var browseUrl: String? = nil
    @State private var moreRoute: MoreRoute = .hub

    @State private var showQRScanner = false

    var body: some View {
        VStack(spacing: 0) {
            header
            ZStack {
                switch activeTab {
                case .home:
                    HomeScreen(onNavigate: navigateTo, onOpenQR: { showQRScanner = true })
                case .explore:
                    ExploreScreen(onVisit: navigateTo)
                case .browse:
                    BrowseScreen(initialUrl: browseUrl)
                case .more:
                    moreRouteView
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            tabBar
        }
        .background(PearColors.bg.ignoresSafeArea())
        .environment(\.pearRPC, host.rpc)
        .sheet(isPresented: $showQRScanner) {
            QRScannerScreen(
                onScan: { url in
                    showQRScanner = false
                    navigateTo(url)
                },
                onClose: { showQRScanner = false }
            )
        }
        .sheet(item: $host.pendingLogin) { request in
            LoginConsentSheet(
                request: request,
                identityLabel: "You",
                identityPubkey: nil,
                onDecision: { approved, scopes in
                    Task { await host.resolveLogin(request, approved: approved, scopes: scopes) }
                }
            )
        }
    }

    // MARK: - Navigation

    private func navigateTo(_ url: String) {
        browseUrl = url
        activeTab = .browse
    }

    @ViewBuilder
    private var moreRouteView: some View {
        switch moreRoute {
        case .hub:
            MoreScreen(
                onNavigateToSites: { moreRoute = .sites },
                onNavigateToBookmarks: { moreRoute = .bookmarks },
                onNavigateToHistory: { moreRoute = .history },
                onNavigateToSettings: { moreRoute = .settings }
            )
        case .bookmarks:
            BookmarksScreen(
                onOpen: { url in moreRoute = .hub; navigateTo(url) },
                onBack: { moreRoute = .hub }
            )
        case .history:
            HistoryScreen(
                onOpen: { url in moreRoute = .hub; navigateTo(url) },
                onBack: { moreRoute = .hub }
            )
        case .settings:
            SettingsScreen(
                onBack: { moreRoute = .hub },
                onOpenBackupPhrase: { moreRoute = .backupPhrase },
                onOpenRestoreIdentity: { moreRoute = .restoreIdentity },
                onOpenProfile: { moreRoute = .profile },
                onOpenConnectedApps: { moreRoute = .connectedApps },
                onOpenTrustedSites: { moreRoute = .trustedSites }
            )
        case .trustedSites:
            TrustedSitesScreen(onBack: { moreRoute = .settings })
        case .backupPhrase:
            BackupPhraseScreen(onBack: { moreRoute = .settings })
        case .restoreIdentity:
            RestoreIdentityScreen(
                onBack: { moreRoute = .settings },
                onRestored: { moreRoute = .hub }
            )
        case .profile:
            ProfileEditScreen(onBack: { moreRoute = .settings })
        case .connectedApps:
            ConnectedAppsScreen(onBack: { moreRoute = .settings })
        case .sites:
            MySitesScreen(
                onEdit: { id in moreRoute = .editor(siteId: id, siteName: nil, initialBlocks: nil) },
                onPreview: { url in moreRoute = .hub; navigateTo(url) },
                onCreateNew: { name in moreRoute = .sitesTemplatePicker(pendingName: name) },
                onBack: { moreRoute = .hub }
            )
        case .sitesTemplatePicker(let pendingName):
            TemplatePickerScreen(
                onSelect: { template in
                    // Create the site then land in editor
                    let rpc = host.rpc
                    Task {
                        do {
                            let resp = try await rpc.request(Cmd.CREATE_SITE, data: ["name": pendingName])
                            let siteId = (resp as? [String: Any])?["siteId"] as? String ?? ""
                            moreRoute = .editor(siteId: siteId,
                                                siteName: pendingName,
                                                initialBlocks: template.blocks)
                        } catch {
                            moreRoute = .sites
                        }
                    }
                },
                onBack: { moreRoute = .sites }
            )
        case .editor(let siteId, let siteName, let initialBlocks):
            SiteEditorScreen(
                siteId: siteId,
                siteName: siteName,
                initialBlocks: initialBlocks,
                initialTheme: nil,
                onBack: { moreRoute = .sites },
                onPreview: { url in moreRoute = .hub; navigateTo(url) }
            )
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Spacer()
            statusDot
                .padding(.trailing, 16)
        }
        .padding(.vertical, 8)
        .background(PearColors.bg)
    }

    private var statusDot: some View {
        HStack(spacing: 6) {
            Circle().fill(statusColor).frame(width: 8, height: 8)
            Text(statusLabel).font(.caption2).foregroundStyle(statusColor)
        }
    }

    private var statusLabel: String {
        if host.isReady { return "Connected" }
        if host.bootStage == "error" { return "Offline" }
        if host.bootStage == "demo" { return "Demo mode" }
        return host.bootMessage
    }

    private var statusColor: Color {
        if host.isReady { return PearColors.success }
        if host.bootStage == "error" { return PearColors.error }
        if host.bootStage == "demo" { return PearColors.link }
        return PearColors.warning
    }

    // MARK: - Tab bar

    private var tabBar: some View {
        HStack {
            ForEach([Tab.home, .explore, .browse, .more], id: \.self) { tab in
                Button {
                    activeTab = tab
                    // If leaving More, reset its stack so we come back to the hub
                    if tab == .more && activeTab == .more {
                        moreRoute = .hub
                    }
                } label: {
                    VStack(spacing: 2) {
                        Text(tab.icon)
                            .font(.system(size: 18, weight: .bold, design: .monospaced))
                            .foregroundStyle(tab == activeTab ? PearColors.accent : PearColors.textMuted)
                        Text(tab.label)
                            .font(.system(size: 10))
                            .foregroundStyle(tab == activeTab ? PearColors.accent : PearColors.textMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.bottom, 16)
        .background(PearColors.surface)
    }
}

#Preview {
    MainView()
        .environmentObject(PearWorkletHost.shared)
}
