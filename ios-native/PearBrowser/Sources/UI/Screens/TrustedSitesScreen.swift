//  PearBrowser — TrustedSitesScreen.swift
//
//  Settings → Privacy → Trusted Sites. Manages the allow-list that
//  gates window.pear bridge injection on HTTPS pages.
//
//  Two modes:
//    - "all":       Default. Bridge is injected on every page (still
//                   unauthorised until the page calls login() and the
//                   user consents). Lowest friction; current behaviour.
//    - "allowlist": Privacy-paranoid mode. Bridge is only injected on
//                   origins explicitly trusted here, plus loopback +
//                   hyper:// (those are our own UI).
//
//  Backed by backend/trusted-origins.js — the trust set replicates
//  across the user's devices via the existing Corestore swarm join.

import SwiftUI

struct TrustedSitesScreen: View {
    let onBack: () -> Void

    @Environment(\.pearRPC) private var rpc

    @State private var origins: [PearRPC.TrustedOrigin] = []
    @State private var mode: String = "all"
    @State private var loading = true
    @State private var addInput: String = ""
    @State private var addError: String?

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("Trusted Sites", onBack: onBack)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    modeSection
                    addSection
                    listSection
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
        .task { await reload() }
    }

    // MARK: - Sections

    private var modeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Bridge injection")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PearColors.textMuted)
                .tracking(1)
                .textCase(.uppercase)
            VStack(alignment: .leading, spacing: 0) {
                modeRow(
                    label: "Inject everywhere",
                    subtitle: "window.pear is available on every page (still unauthorised until you grant access). Default.",
                    value: "all"
                )
                Divider().background(PearColors.border)
                modeRow(
                    label: "Allow-list only",
                    subtitle: "Only sites you have explicitly trusted (below) plus PearBrowser's own surfaces see window.pear.",
                    value: "allowlist"
                )
            }
            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func modeRow(label: String, subtitle: String, value: String) -> some View {
        Button(action: { Task { await setMode(value) } }) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: mode == value ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(mode == value ? PearColors.accent : PearColors.textMuted)
                    .font(.system(size: 18))
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 3) {
                    Text(label)
                        .font(.system(size: 15))
                        .foregroundStyle(PearColors.textPrimary)
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(PearColors.textMuted)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
            }
            .padding(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(rpc == nil || loading)
    }

    private var addSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Add a trusted site")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PearColors.textMuted)
                .tracking(1)
                .textCase(.uppercase)
            HStack {
                TextField("https://example.com", text: $addInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(PearColors.textPrimary)
                    .padding(10)
                    .background(PearColors.surfaceElevated, in: RoundedRectangle(cornerRadius: 8))
                Button("Add") { Task { await addOrigin() } }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PearColors.bg)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(PearColors.accent, in: RoundedRectangle(cornerRadius: 8))
                    .disabled(rpc == nil
                              || addInput.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let addError {
                Text(addError)
                    .font(.system(size: 12))
                    .foregroundStyle(PearColors.error)
            }
            Text("URL fragments and ports are normalised. Adding example.com/login also covers example.com/anywhere.")
                .font(.system(size: 11))
                .foregroundStyle(PearColors.textMuted)
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private var listSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Trusted (\(origins.count))")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PearColors.textMuted)
                    .tracking(1)
                    .textCase(.uppercase)
                Spacer()
                if loading {
                    ProgressView().tint(PearColors.accent).scaleEffect(0.7)
                }
            }
            if !loading && origins.isEmpty {
                Text(mode == "all"
                     ? "You haven't pinned any sites yet — Allow-list only mode would currently inject the bridge nowhere."
                     : "No trusted sites. Pages will not see window.pear until you add one.")
                    .font(.system(size: 12))
                    .foregroundStyle(PearColors.textMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(origins.enumerated()), id: \.element.origin) { idx, entry in
                        if idx > 0 { Divider().background(PearColors.border) }
                        originRow(entry)
                    }
                }
                .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func originRow(_ entry: PearRPC.TrustedOrigin) -> some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.origin)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(PearColors.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(relativeDate(from: entry.trustedAt))
                    .font(.system(size: 11))
                    .foregroundStyle(PearColors.textMuted)
            }
            Spacer()
            Button("Remove") { Task { await removeOrigin(entry.origin) } }
                .font(.system(size: 12))
                .foregroundStyle(PearColors.error)
        }
        .padding(14)
    }

    // MARK: - RPC

    private func reload() async {
        guard let rpc else { loading = false; return }
        loading = true
        defer { loading = false }
        do {
            let result = try await rpc.trustedOriginsList()
            self.origins = result.origins
            self.mode = result.mode
        } catch {
            NSLog("[TrustedSites] list failed: \(error)")
        }
    }

    private func setMode(_ next: String) async {
        guard let rpc, mode != next else { return }
        do {
            let applied = try await rpc.trustedOriginsSetMode(next)
            self.mode = applied
        } catch {
            NSLog("[TrustedSites] setMode failed: \(error)")
        }
    }

    private func addOrigin() async {
        guard let rpc else { return }
        let raw = addInput.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return }
        addError = nil
        do {
            _ = try await rpc.trustedOriginsAdd(raw)
            addInput = ""
            await reload()
        } catch {
            addError = "Couldn't add: \(error.localizedDescription)"
        }
    }

    private func removeOrigin(_ origin: String) async {
        guard let rpc else { return }
        do {
            try await rpc.trustedOriginsRemove(origin)
            await reload()
        } catch {
            NSLog("[TrustedSites] remove failed: \(error)")
        }
    }

    // MARK: - Helpers

    private func relativeDate(from epochMs: Double) -> String {
        guard epochMs > 0 else { return "" }
        let date = Date(timeIntervalSince1970: epochMs / 1000.0)
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .full
        return "Trusted " + f.localizedString(for: date, relativeTo: Date())
    }
}
