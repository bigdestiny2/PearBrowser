//  PearBrowser — HomeScreen.swift
//
//  SwiftUI mirror of app/screens/HomeScreen.tsx.
//  Phase 3 ticket — see docs/HOLEPUNCH_ALIGNMENT_PLAN.md.

import SwiftUI

struct HomeScreen: View {
    let onNavigate: (String) -> Void

    @State private var input: String = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("PearBrowser")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(PearColors.accent)
                    Spacer()
                }

                searchBar

                welcomeState
                    .padding(.top, 40)
            }
            .padding(16)
        }
        .background(PearColors.bg)
    }

    // MARK: - Search bar

    private var searchBar: some View {
        HStack(spacing: 8) {
            TextField("Search or enter hyper:// address", text: $input)
                .font(.system(size: 15))
                .foregroundStyle(PearColors.textPrimary)
                .tint(PearColors.accent)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .onSubmit(go)
                .padding(.vertical, 12)

            Button {
                // QR scanner — wired in the next pass with AVCaptureSession
            } label: {
                Text("QR")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PearColors.textSecondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(PearColors.surfaceElevated, in: RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Welcome

    private var welcomeState: some View {
        VStack(spacing: 12) {
            Text("{ }")
                .font(.system(size: 40, design: .monospaced))
                .foregroundStyle(PearColors.accent)
            Text("Welcome to PearBrowser")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(PearColors.textPrimary)
            Text("Browse the decentralized web, discover P2P sites, and build your own websites.")
                .font(.system(size: 14))
                .foregroundStyle(PearColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Text("Enter a hyper:// address above, or explore the directory.")
                .font(.system(size: 12))
                .foregroundStyle(PearColors.textMuted)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Actions

    private func go() {
        var url = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        // Bare hex key → hyper://
        if url.range(of: "^[a-f0-9]{52,64}$", options: [.regularExpression, .caseInsensitive]) != nil {
            url = "hyper://" + url
        } else if !url.contains("://") {
            url = "hyper://" + url
        }
        input = ""
        onNavigate(url)
    }
}

#Preview {
    HomeScreen(onNavigate: { _ in })
        .environmentObject(PearWorkletHost.shared)
}
