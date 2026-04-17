//  PearBrowser — MainView.swift
//
//  Root SwiftUI view. Hosts the tab navigator and status indicator.
//  Equivalent of `app/App.tsx` and `MainActivity.kt`.

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

struct MainView: View {
    @EnvironmentObject private var host: PearWorkletHost
    @State private var activeTab: Tab = .home
    @State private var browseUrl: String? = nil

    var body: some View {
        VStack(spacing: 0) {
            header

            ZStack {
                switch activeTab {
                case .home:
                    HomeScreen(onNavigate: navigateTo)
                case .explore:
                    ExploreScreen(onVisit: navigateTo)
                case .browse:
                    BrowseScreen(initialUrl: browseUrl)
                case .more:
                    MoreScreen()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            tabBar
        }
        .background(PearColors.bg.ignoresSafeArea())
    }

    private func navigateTo(_ url: String) {
        browseUrl = url
        activeTab = .browse
    }

    // MARK: - Header with StatusDot

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
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
            Text(statusLabel)
                .font(.caption2)
                .foregroundStyle(statusColor)
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
