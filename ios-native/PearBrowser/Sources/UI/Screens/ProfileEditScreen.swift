//  PearBrowser — ProfileEditScreen.swift
//
//  Phase B of the Identity Plan. User's self-declared profile fields
//  — displayName, avatar, bio, email, website, pronouns, location.
//  Stored in the profile Hyperbee; replicates across the user's
//  devices via the root seed.
//
//  Every field is OPT-IN. Apps never see a field until the user both
//  (a) fills it in here AND (b) grants the scope via pear.login().

import SwiftUI

struct ProfileEditScreen: View {
    let onBack: () -> Void

    @Environment(\.pearRPC) private var rpc
    @State private var fields: [String: String] = [:]
    @State private var loading = true
    @State private var errorMessage: String? = nil
    @State private var saving = false
    @State private var savedToast = false

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("Your Profile", onBack: onBack) {
                Button(action: save) {
                    Text(saving ? "…" : (savedToast ? "Saved" : "Save"))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PearColors.accent)
                }
                .disabled(saving || rpc == nil)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    explainer

                    if loading {
                        HStack { Spacer(); ProgressView().tint(PearColors.accent); Spacer() }
                            .padding(.top, 40)
                    } else if let errorMessage {
                        Text(errorMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(PearColors.error)
                    } else {
                        group("Shown to apps that ask for profile:name") {
                            field("Display name", key: "displayName", placeholder: "Maya")
                            field("Avatar URL", key: "avatar", placeholder: "hyper://… or https://…",
                                  mono: true)
                        }

                        group("Shown to apps that ask for profile:contact") {
                            field("Email", key: "email", placeholder: "maya@example.com",
                                  keyboard: .emailAddress)
                            field("Website", key: "website", placeholder: "https://maya.example",
                                  mono: true, keyboard: .URL)
                        }

                        group("Shown with profile:read") {
                            field("Bio", key: "bio", placeholder: "Short bio", multiline: true)
                            field("Pronouns", key: "pronouns", placeholder: "they/them")
                            field("Location", key: "location", placeholder: "Auckland")
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
        .task { await load() }
    }

    private var explainer: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Your profile lives on your device. Apps only see the fields you grant access to when you sign in.")
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textSecondary)
                .lineSpacing(2)
            Text("All fields are optional. Leave anything you don't want to share blank.")
                .font(.system(size: 12))
                .foregroundStyle(PearColors.textMuted)
        }
    }

    @ViewBuilder
    private func group<Content: View>(_ caption: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(caption)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PearColors.textSecondary)
                .tracking(1)
                .textCase(.uppercase)
            VStack(spacing: 8) { content() }
        }
    }

    private func field(_ label: String, key: String, placeholder: String,
                       multiline: Bool = false, mono: Bool = false,
                       keyboard: UIKeyboardType = .default) -> some View {
        let binding = Binding<String>(
            get: { fields[key] ?? "" },
            set: { fields[key] = $0 }
        )
        let textFont: Font = mono
            ? .system(size: 14, design: .monospaced)
            : .system(size: 15)
        return VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(PearColors.textSecondary)
            if multiline {
                TextEditor(text: binding)
                    .font(textFont)
                    .foregroundStyle(PearColors.textPrimary)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 10))
                    .frame(minHeight: 80)
            } else {
                TextField(placeholder, text: binding)
                    .font(textFont)
                    .foregroundStyle(PearColors.textPrimary)
                    .keyboardType(keyboard)
                    .textInputAutocapitalization(mono ? .never : .sentences)
                    .autocorrectionDisabled(mono)
                    .padding(12)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    // MARK: - Actions

    private func load() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        guard let rpc else { return }
        do {
            fields = try await rpc.profileGet()
        } catch {
            errorMessage = "Could not load profile: \(error.localizedDescription)"
        }
    }

    private func save() {
        guard let rpc else { return }
        saving = true
        Task {
            do {
                fields = try await rpc.profileUpdate(fields)
                savedToast = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { savedToast = false }
            } catch {
                errorMessage = "Save failed: \(error.localizedDescription)"
            }
            saving = false
        }
    }
}
