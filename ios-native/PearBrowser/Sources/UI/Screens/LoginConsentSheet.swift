//  PearBrowser — LoginConsentSheet.swift
//
//  The native "Sign in with PearBrowser" consent sheet. Shows when a
//  page in the WebView calls window.pear.login(). User picks
//  "Sign in as …" or Cancel. Can narrow scopes by toggling individual
//  rows.
//
//  Fires CMD_LOGIN_RESOLVE back to the worklet via PearWorkletHost.

import SwiftUI

struct LoginConsentSheet: View {
    let request: LoginRequest
    let identityLabel: String
    let identityPubkey: String?
    let onDecision: (_ approved: Bool, _ grantedScopes: [String]) -> Void

    @State private var grantedScopes: Set<String>
    @State private var submitting = false

    init(request: LoginRequest,
         identityLabel: String,
         identityPubkey: String?,
         onDecision: @escaping (Bool, [String]) -> Void) {
        self.request = request
        self.identityLabel = identityLabel
        self.identityPubkey = identityPubkey
        self.onDecision = onDecision
        self._grantedScopes = State(initialValue: Set(request.scopes))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                identityCard
                seesSection
                doesNotSeeSection
                actions
            }
            .padding(20)
        }
        .background(PearColors.bg)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(request.appName)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(PearColors.textPrimary)
            Text("wants to sign in as you")
                .font(.system(size: 15))
                .foregroundStyle(PearColors.textSecondary)
            if !request.reason.isEmpty {
                Text(request.reason)
                    .font(.system(size: 13))
                    .foregroundStyle(PearColors.textSecondary)
                    .padding(.top, 6)
            }
        }
    }

    private var identityCard: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(PearColors.accent.opacity(0.2))
                .overlay(Text("🍐").font(.system(size: 20)))
                .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(identityLabel)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PearColors.textPrimary)
                if let pk = identityPubkey {
                    Text(shortPubkey(pk))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(PearColors.textMuted)
                }
            }
            Spacer()
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private var seesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("This app will see")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PearColors.textSecondary)
                .tracking(1)
                .textCase(.uppercase)

            VStack(spacing: 0) {
                scopeRow(
                    label: "A unique ID just for this app",
                    detail: "Different from the ID other apps see for you.",
                    icon: "✓",
                    isMandatory: true,
                    isOn: .constant(true)
                )
                if request.scopes.contains("profile:read") {
                    Divider().background(PearColors.border)
                    scopeToggle("Your full profile",
                                detail: "Name, avatar, bio, email, website.",
                                scope: "profile:read")
                }
                if request.scopes.contains("profile:name") {
                    Divider().background(PearColors.border)
                    scopeToggle("Your name and avatar",
                                detail: "Display name + profile picture.",
                                scope: "profile:name")
                }
                if request.scopes.contains("profile:contact") {
                    Divider().background(PearColors.border)
                    scopeToggle("Your contact info",
                                detail: "Email and website URL.",
                                scope: "profile:contact")
                }
                if request.scopes.contains("contacts:read") {
                    Divider().background(PearColors.border)
                    scopeToggle("Your contacts",
                                detail: "Read-only access to people you've added.",
                                scope: "contacts:read")
                }
            }
            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var doesNotSeeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("This app will NOT see")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PearColors.textSecondary)
                .tracking(1)
                .textCase(.uppercase)
            VStack(spacing: 0) {
                denyRow("Your other apps or what you do in them")
                Divider().background(PearColors.border)
                denyRow("Your master identity or backup phrase")
                if !request.scopes.contains("profile:read") &&
                    !request.scopes.contains("profile:contact") {
                    Divider().background(PearColors.border)
                    denyRow("Your email or contact info")
                }
                if !request.scopes.contains("contacts:read") {
                    Divider().background(PearColors.border)
                    denyRow("Your contacts or social graph")
                }
            }
            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var actions: some View {
        HStack(spacing: 12) {
            Button {
                submitting = true
                onDecision(false, [])
            } label: {
                Text("Cancel")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PearColors.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .disabled(submitting)

            Button {
                submitting = true
                onDecision(true, Array(grantedScopes))
            } label: {
                Text(submitting ? "…" : "Sign in")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(PearColors.bg)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(PearColors.accent, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .disabled(submitting)
        }
        .padding(.top, 8)
    }

    // MARK: - Components

    private func scopeRow(label: String, detail: String, icon: String,
                          isMandatory: Bool,
                          isOn: Binding<Bool>) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(PearColors.success)
                .frame(width: 20, alignment: .center)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 14))
                    .foregroundStyle(PearColors.textPrimary)
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(PearColors.textMuted)
            }
            Spacer()
            if !isMandatory {
                Toggle("", isOn: isOn).labelsHidden().tint(PearColors.accent)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func scopeToggle(_ label: String, detail: String, scope: String) -> some View {
        let binding = Binding<Bool>(
            get: { grantedScopes.contains(scope) },
            set: { on in
                if on { grantedScopes.insert(scope) } else { grantedScopes.remove(scope) }
            }
        )
        return scopeRow(label: label, detail: detail, icon: "✓",
                        isMandatory: false, isOn: binding)
    }

    private func denyRow(_ label: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("✗")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(PearColors.error)
                .frame(width: 20, alignment: .center)
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func shortPubkey(_ hex: String) -> String {
        guard hex.count >= 12 else { return hex }
        let head = hex.prefix(6)
        let tail = hex.suffix(4)
        return "\(head)…\(tail)"
    }
}
