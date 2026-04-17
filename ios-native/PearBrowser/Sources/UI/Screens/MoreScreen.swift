//  PearBrowser — MoreScreen.swift
//
//  Navigation hub for the More tab. Mirrors
//  app/screens/MoreScreen.tsx: lists the sub-sections, shows P2P
//  connection status + peer count, exposes the user's device public key.

import SwiftUI

struct MoreScreen: View {
    let onNavigateToSites: () -> Void
    let onNavigateToBookmarks: () -> Void
    let onNavigateToHistory: () -> Void
    let onNavigateToSettings: () -> Void

    @EnvironmentObject private var host: PearWorkletHost
    @Environment(\.pearRPC) private var rpc

    @State private var publicKey: String? = nil
    @State private var copiedPublicKey = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("More")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(PearColors.textPrimary)
                    .padding(.bottom, 8)

                section {
                    menuItem("My Sites", "Create and manage P2P websites", onTap: onNavigateToSites)
                    divider
                    menuItem("Bookmarks", "Saved sites", onTap: onNavigateToBookmarks)
                    divider
                    menuItem("History", "Recently visited", onTap: onNavigateToHistory)
                }

                Text("CONNECTION STATUS")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PearColors.textSecondary)
                    .tracking(1)
                    .padding(.horizontal, 4).padding(.top, 8)

                section {
                    statusRow("DHT Network", host.isReady ? "Connected" : host.bootMessage,
                              isOk: host.isReady)
                    divider
                    statusRow("Active Peers", "\(host.peerCount)", isOk: host.peerCount > 0)
                    divider
                    statusRow("Local Proxy",
                              host.proxyPort > 0 ? "Port \(host.proxyPort)" : "Not running",
                              isOk: host.proxyPort > 0)
                }

                section {
                    menuItem("P2P Status",
                             host.isReady
                             ? (host.peerCount > 0 ? "\(host.peerCount) peers" : "Engine ready")
                             : host.bootMessage,
                             onTap: {})
                    divider
                    menuItem("My Identity",
                             "View your device public key",
                             onTap: { Task { await loadIdentity() } })
                    divider
                    menuItem("Settings", "Privacy, relays, identity, data", onTap: onNavigateToSettings)
                }

                if let pk = publicKey {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("YOUR DEVICE IDENTITY")
                            .font(.system(size: 10, weight: .semibold))
                            .tracking(1)
                            .foregroundStyle(PearColors.textSecondary)
                        Text(pk)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(PearColors.textPrimary)
                            .textSelection(.enabled)
                        Button(copiedPublicKey ? "Copied" : "Copy Key") {
                            UIPasteboard.general.string = pk
                            copiedPublicKey = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copiedPublicKey = false }
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PearColors.accent)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(PearColors.surfaceElevated, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .padding(14)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
                }

                section {
                    menuItem("About PearBrowser",
                             "v0.1.0 · Built on Holepunch",
                             onTap: {})
                }
            }
            .padding(16)
        }
        .background(PearColors.bg)
    }

    // MARK: - Components

    @ViewBuilder
    private func section<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private var divider: some View {
        Rectangle()
            .fill(PearColors.border)
            .frame(height: 0.5)
            .padding(.leading, 14)
    }

    private func menuItem(_ title: String, _ subtitle: String, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16))
                        .foregroundStyle(PearColors.textPrimary)
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(PearColors.textSecondary)
                }
                Spacer()
                Text(">")
                    .font(.system(size: 18))
                    .foregroundStyle(PearColors.textMuted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func statusRow(_ label: String, _ value: String, isOk: Bool) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 14))
                .foregroundStyle(PearColors.textSecondary)
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(isOk ? PearColors.success : PearColors.warning).frame(width: 6, height: 6)
                Text(value)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(isOk ? PearColors.success : PearColors.textPrimary)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func loadIdentity() async {
        guard let rpc else { return }
        do {
            let resp = try await rpc.getIdentity()
            publicKey = resp["publicKey"] as? String
        } catch {
            NSLog("[MoreScreen] getIdentity failed: \(error)")
        }
    }
}
