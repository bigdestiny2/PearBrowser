//  PearBrowser — ConnectedAppsScreen.swift
//
//  Phase F of the Identity Plan. Lists every app that holds an active
//  grant (result of a past window.pear.login() the user approved),
//  shows what scopes it has + when it expires, and lets the user
//  revoke any or all grants.
//
//  RPC: CMD_LOGIN_LIST_GRANTS / REVOKE_GRANT / REVOKE_ALL.

import SwiftUI

struct AppGrant: Identifiable, Hashable {
    let id: String          // driveKeyHex
    let appName: String
    let scopes: [String]
    let grantedAt: Double
    let expiresAt: Double
}

struct ConnectedAppsScreen: View {
    let onBack: () -> Void

    @Environment(\.pearRPC) private var rpc
    @State private var grants: [AppGrant] = []
    @State private var loading = true
    @State private var errorMessage: String? = nil
    @State private var showRevokeAllConfirm = false
    @State private var grantToRevoke: AppGrant? = nil

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("Connected Apps", onBack: onBack) {
                if !grants.isEmpty {
                    Button("Revoke all") { showRevokeAllConfirm = true }
                        .font(.system(size: 14))
                        .foregroundStyle(PearColors.error)
                }
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    explainer

                    if loading {
                        HStack { Spacer(); ProgressView().tint(PearColors.accent); Spacer() }
                            .padding(.top, 40)
                    } else if let errorMessage {
                        errorBox(errorMessage)
                    } else if grants.isEmpty {
                        emptyState
                    } else {
                        ForEach(grants) { grant in
                            grantCard(grant)
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
        .task { await load() }
        .alert("Revoke all app sign-ins?", isPresented: $showRevokeAllConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Revoke all", role: .destructive) { revokeAll() }
        } message: {
            Text("Every app you've signed into with PearBrowser will be logged out. They'll need to prompt for sign-in again on next use.")
        }
        .alert("Revoke sign-in?", isPresented: Binding(get: { grantToRevoke != nil }, set: { if !$0 { grantToRevoke = nil } })) {
            Button("Cancel", role: .cancel) {}
            Button("Revoke", role: .destructive) {
                if let grant = grantToRevoke { revoke(grant) }
            }
        } message: {
            if let grant = grantToRevoke {
                Text("\(grant.appName) will be signed out immediately. You can always sign back in.")
            }
        }
    }

    private var explainer: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Apps you've signed into with PearBrowser show up here. Each one sees a unique ID — never your master identity. Revoke any time.")
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textSecondary)
                .lineSpacing(2)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Text("🔒").font(.system(size: 36))
            Text("No apps signed in")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(PearColors.textPrimary)
            Text("When a P2P app calls window.pear.login() and you approve, it'll appear here.")
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private func errorBox(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Could not load grants")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PearColors.error)
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(PearColors.textSecondary)
            Button("Retry") { Task { await load() } }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(PearColors.accent)
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func grantCard(_ grant: AppGrant) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10).fill(PearColors.surfaceElevated).frame(width: 44, height: 44)
                    Text(grant.appName.first.map { String($0).uppercased() } ?? "?")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(PearColors.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(grant.appName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(PearColors.textPrimary)
                    Text("Signed in \(relative(grant.grantedAt)) · expires \(relative(grant.expiresAt))")
                        .font(.system(size: 11))
                        .foregroundStyle(PearColors.textMuted)
                }
                Spacer()
            }

            if !grant.scopes.isEmpty {
                FlowHStack(spacing: 6) {
                    ForEach(grant.scopes, id: \.self) { scope in
                        Text(scopeLabel(scope))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(PearColors.textSecondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(PearColors.surfaceElevated, in: Capsule())
                    }
                }
            }

            HStack {
                Text(grant.id.prefix(12) + "…")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(PearColors.textMuted)
                Spacer()
                Button("Revoke") { grantToRevoke = grant }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PearColors.error)
            }
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func scopeLabel(_ scope: String) -> String {
        switch scope {
        case "profile:read": return "Full profile"
        case "profile:name": return "Name + avatar"
        case "profile:contact": return "Contact info"
        case "contacts:read": return "Contacts"
        case "pay": return "Payments"
        default: return scope
        }
    }

    private func relative(_ epochMs: Double) -> String {
        let date = Date(timeIntervalSince1970: epochMs / 1000)
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: date, relativeTo: Date())
    }

    // MARK: - Actions

    private func load() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        guard let rpc else { grants = []; return }
        do {
            let raw = try await rpc.loginListGrants()
            grants = raw.compactMap {
                guard let dk = $0["driveKeyHex"] as? String else { return nil }
                return AppGrant(
                    id: dk,
                    appName: ($0["appName"] as? String) ?? "Unknown app",
                    scopes: ($0["scopes"] as? [String]) ?? [],
                    grantedAt: ($0["grantedAt"] as? Double) ?? 0,
                    expiresAt: ($0["expiresAt"] as? Double) ?? 0
                )
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func revoke(_ grant: AppGrant) {
        guard let rpc else { return }
        Task {
            try? await rpc.loginRevokeGrant(driveKeyHex: grant.id)
            await load()
        }
    }

    private func revokeAll() {
        guard let rpc else { return }
        Task {
            _ = try? await rpc.loginRevokeAll()
            await load()
        }
    }
}

// MARK: - FlowHStack: a simple wrapping horizontal layout for scope chips

struct FlowHStack: Layout {
    let spacing: CGFloat

    init(spacing: CGFloat = 8) { self.spacing = spacing }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, totalH: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                totalH += rowH + spacing
                x = 0; rowH = 0
            }
            x += size.width + spacing
            rowH = max(rowH, size.height)
            y = totalH
        }
        return CGSize(width: maxWidth, height: totalH + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxWidth = bounds.width
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.minX + maxWidth && x > bounds.minX {
                x = bounds.minX; y += rowH + spacing; rowH = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
    }
}
