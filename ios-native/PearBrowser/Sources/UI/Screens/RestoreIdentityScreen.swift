//  PearBrowser — RestoreIdentityScreen.swift
//
//  SwiftUI mirror of app/screens/RestoreIdentityScreen.tsx. Accepts a
//  12-word BIP-39 phrase, validates it via PearRPC.validatePhrase (async
//  as the user types), and on confirm calls PearRPC.importPhrase then
//  prompts the user to restart.

import SwiftUI

struct RestoreIdentityScreen: View {
    let onBack: () -> Void
    let onRestored: () -> Void

    @Environment(\.pearRPC) private var rpc
    @State private var input: String = ""
    @State private var validating = false
    @State private var isValid: Bool? = nil
    @State private var submitting = false
    @State private var showConfirm = false
    @State private var errorMessage: String? = nil
    @State private var showRestartPrompt = false

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("Restore Identity", onBack: onBack)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Enter your 12-word backup phrase. Words separated by single spaces. Case doesn't matter.")
                        .font(.system(size: 13))
                        .foregroundStyle(PearColors.textSecondary)

                    TextEditor(text: $input)
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(PearColors.textPrimary)
                        .scrollContentBackground(.hidden)
                        .padding(12)
                        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
                        .frame(minHeight: 110)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: input) { newValue in
                            Task { await validate(newValue) }
                        }

                    statusRow

                    warning

                    Button(action: submit) {
                        Group {
                            if submitting {
                                ProgressView().tint(PearColors.bg)
                            } else {
                                Text("Restore Identity")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(isValid == true ? PearColors.bg : PearColors.textMuted)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(isValid == true ? PearColors.accent : PearColors.surface,
                                    in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .disabled(isValid != true || submitting)
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
        .alert("Replace identity?", isPresented: $showConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Replace", role: .destructive) { confirmRestore() }
        } message: {
            Text("Your current identity will be replaced. Data stored under the current seed will remain on disk but will no longer be used. The app will reload.")
        }
        .alert("Identity restored", isPresented: $showRestartPrompt) {
            Button("OK", action: onRestored)
        } message: {
            Text("Close and reopen PearBrowser for the new identity to take effect.")
        }
        .alert("Restore failed",
               isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        HStack {
            if validating {
                ProgressView().tint(PearColors.accent)
            } else if isValid == true {
                Text("✓ Valid phrase").font(.system(size: 13)).foregroundStyle(PearColors.success)
            } else if isValid == false {
                Text("✗ Invalid phrase — check each word").font(.system(size: 13)).foregroundStyle(PearColors.error)
            } else if !input.isEmpty {
                Text("Enter 12 or 24 words to validate")
                    .font(.system(size: 13))
                    .foregroundStyle(PearColors.textMuted)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 24)
    }

    private var warning: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Heads up")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(PearColors.warning)
            Text("Restoring will replace your current identity. The app will need to restart to apply the change. Data saved under your current identity will stay on disk but will not be readable with the new identity.")
                .font(.system(size: 12))
                .foregroundStyle(PearColors.textPrimary)
        }
        .padding(14)
        .background(Color(red: 0.17, green: 0.10, blue: 0.00), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .leading) {
            Rectangle().fill(PearColors.warning).frame(width: 4)
                .clipShape(RoundedRectangle(cornerRadius: 2))
        }
    }

    private func validate(_ value: String) async {
        let words = value.split(separator: " ").filter { !$0.isEmpty }
        isValid = nil
        if words.count != 12 && words.count != 24 { return }
        guard let rpc else { return }
        validating = true
        defer { validating = false }
        do {
            let ok = try await rpc.validatePhrase(value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
            isValid = ok
        } catch {
            isValid = false
        }
    }

    private func submit() {
        guard isValid == true else {
            errorMessage = "Check that every word is spelled correctly and the phrase is 12 or 24 words."
            return
        }
        showConfirm = true
    }

    private func confirmRestore() {
        guard let rpc else { return }
        submitting = true
        Task {
            do {
                _ = try await rpc.importPhrase(input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
                showRestartPrompt = true
            } catch {
                errorMessage = error.localizedDescription
            }
            submitting = false
        }
    }
}
