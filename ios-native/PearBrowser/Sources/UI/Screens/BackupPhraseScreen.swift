//  PearBrowser — BackupPhraseScreen.swift
//
//  SwiftUI mirror of app/screens/BackupPhraseScreen.tsx.
//  Shows the user's 12-word BIP-39 seed phrase with a tap-to-reveal
//  grid, copy-to-clipboard button, confirmation switch, and a done
//  button gated on the user confirming they've written it down.

import SwiftUI

struct BackupPhraseScreen: View {
    let onBack: () -> Void

    @Environment(\.pearRPC) private var rpc

    @State private var mnemonic: String = ""
    @State private var loading = true
    @State private var errorMessage: String? = nil
    @State private var revealed = false
    @State private var confirmed = false
    @State private var copiedToast = false

    private var words: [String] {
        mnemonic.split(separator: " ").map(String.init)
    }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("Backup Phrase", onBack: onBack)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    warningCard

                    if loading {
                        ProgressView().tint(PearColors.accent).frame(maxWidth: .infinity).padding(.top, 40)
                    } else if let errorMessage {
                        Text(errorMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(PearColors.error)
                            .padding(14)
                            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
                    } else {
                        grid

                        if !revealed {
                            Button { revealed = true } label: {
                                Text("Tap to reveal")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(PearColors.bg)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(PearColors.accent, in: RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                        } else {
                            Button(action: copy) {
                                Text(copiedToast ? "Copied" : "Copy to clipboard")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(PearColors.accent)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(PearColors.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)

                            HStack(spacing: 12) {
                                Toggle("", isOn: $confirmed).labelsHidden().tint(PearColors.accent)
                                Text("I've written down or saved this phrase somewhere safe")
                                    .font(.system(size: 13))
                                    .foregroundStyle(PearColors.textPrimary)
                            }
                            .padding(12)
                            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))

                            Button(action: onBack) {
                                Text("Done")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(confirmed ? PearColors.bg : PearColors.textMuted)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(confirmed ? PearColors.accent : PearColors.surface,
                                                in: RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .disabled(!confirmed)
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
        .task { await load() }
    }

    private var warningCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Write this down. Keep it private.")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(PearColors.warning)
            Text("This 12-word phrase is the master key to your PearBrowser identity. Anyone with these words can impersonate you on the P2P network and read any synced data.")
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textPrimary)
            Text("Save it on paper, in a password manager, or somewhere only you can reach. If you lose it, you cannot recover your identity.")
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textPrimary)
        }
        .padding(16)
        .background(Color(red: 0.17, green: 0.10, blue: 0.00), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .leading) {
            Rectangle().fill(PearColors.warning).frame(width: 4)
                .clipShape(RoundedRectangle(cornerRadius: 2))
        }
    }

    private var grid: some View {
        let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return LazyVGrid(columns: columns, spacing: 8) {
            ForEach(Array(words.enumerated()), id: \.offset) { idx, word in
                HStack(spacing: 8) {
                    Text("\(idx + 1)")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(PearColors.textMuted)
                        .frame(minWidth: 16, alignment: .leading)
                    Text(revealed ? word : "••••••")
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(PearColors.textPrimary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 10)
                .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func load() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        guard let rpc else {
            errorMessage = "P2P engine not connected"
            return
        }
        do {
            mnemonic = try await rpc.exportPhrase()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func copy() {
        guard !mnemonic.isEmpty else { return }
        UIPasteboard.general.string = mnemonic
        copiedToast = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copiedToast = false }
    }
}
