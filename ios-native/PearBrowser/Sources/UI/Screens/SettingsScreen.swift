//  PearBrowser — SettingsScreen.swift
//
//  SwiftUI mirror of app/screens/SettingsScreen.tsx. Sections:
//    - Storage (bytes used, clear cache)
//    - Privacy (private mode toggle)
//    - Relays (on/off, list, add/remove) — RPC-driven
//    - Catalogs (Explore directory list)
//    - Identity (backup phrase + restore from phrase)
//    - Data (clear all local data)
//    - About (version, runtime, platform)
//
//  All worklet-side config via PearRPC. Local preferences (privateMode,
//  catalogs list) via @AppStorage UserDefaults.

import SwiftUI

struct SettingsScreen: View {
    let onBack: () -> Void
    let onOpenBackupPhrase: () -> Void
    let onOpenRestoreIdentity: () -> Void
    let onOpenProfile: () -> Void
    let onOpenConnectedApps: () -> Void

    @Environment(\.pearRPC) private var rpc
    @EnvironmentObject private var host: PearWorkletHost

    @AppStorage("pearbrowser.privateMode") private var privateMode = false
    @AppStorage("pearbrowser.catalogListJSON") private var catalogListJSON = "[\"https://relay-us.p2phiverelay.xyz\",\"https://relay-sg.p2phiverelay.xyz\"]"
    @AppStorage("pearbrowser.catalogUrl") private var catalogUrl = "https://relay-us.p2phiverelay.xyz"

    @State private var storageUsed: Int64 = 0
    @State private var storageLimit: Int64 = 1024 * 1024 * 1024
    @State private var relays: [String] = []
    @State private var relayEnabled = true
    @State private var relayInput = ""
    @State private var catalogInput = ""
    @State private var showClearConfirm = false
    @State private var loadedRelays = false

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("Settings", onBack: onBack)

            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    section("Storage") {
                        storageSection
                    }
                    section("Privacy") {
                        privacySection
                    }
                    section("Relays") {
                        relaysSection
                    }
                    section("Known catalogs") {
                        catalogsSection
                    }
                    section("Identity") {
                        identitySection
                    }
                    section("Data") {
                        Button(role: .destructive) {
                            showClearConfirm = true
                        } label: {
                            HStack {
                                Text("Clear all browser data")
                                    .foregroundStyle(PearColors.error)
                                Spacer()
                            }
                            .padding(.vertical, 10)
                            .padding(.horizontal, 14)
                            .frame(maxWidth: .infinity)
                            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                    section("About") {
                        aboutSection
                    }
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
        .task {
            await loadRelays()
            await loadStorage()
        }
        .alert("Clear all data?", isPresented: $showClearConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Clear everything", role: .destructive) { clearAll() }
        } message: {
            Text("This removes bookmarks, history, settings, and clears the drive cache on this device.")
        }
    }

    // MARK: - Sections

    private var storageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(formatBytes(storageUsed))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PearColors.textPrimary)
                Text(" / \(formatBytes(storageLimit))")
                    .font(.system(size: 13))
                    .foregroundStyle(PearColors.textSecondary)
                Spacer()
                Button("Clear cache") { Task { await clearCache() } }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PearColors.accent)
                    .disabled(rpc == nil)
            }
            ProgressView(value: Double(storageUsed), total: Double(max(storageLimit, 1)))
                .tint(PearColors.accent)
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private var privacySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Toggle(isOn: $privateMode) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Private Mode")
                        .font(.system(size: 15))
                        .foregroundStyle(PearColors.textPrimary)
                    Text("No history recorded. Cached drives cleared on exit.")
                        .font(.system(size: 11))
                        .foregroundStyle(PearColors.textMuted)
                }
            }
            .tint(PearColors.accent)
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private var relaysSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: Binding(get: { relayEnabled }, set: { setRelayEnabled($0) })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(relayEnabled ? "Hybrid Fetch (on)" : "Pure P2P Mode")
                        .font(.system(size: 15))
                        .foregroundStyle(PearColors.textPrimary)
                    Text(relayEnabled
                         ? "Relay HTTP (1-2s first paint) + P2P fallback."
                         : "P2P-only. Slower first visit, no relay dependency.")
                        .font(.system(size: 11))
                        .foregroundStyle(PearColors.textMuted)
                }
            }
            .tint(PearColors.accent)
            .disabled(rpc == nil || !loadedRelays)

            if !loadedRelays {
                Text(rpc == nil ? "Worklet not running — connect to edit relays." : "Loading…")
                    .font(.system(size: 12))
                    .foregroundStyle(PearColors.textMuted)
            } else if relays.isEmpty {
                Text("No relays configured. Add one below to speed up first paint.")
                    .font(.system(size: 12))
                    .foregroundStyle(PearColors.textMuted)
            } else {
                ForEach(Array(relays.enumerated()), id: \.element) { idx, url in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(url)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(PearColors.textPrimary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            if idx == 0 {
                                Text("Primary").font(.system(size: 10)).foregroundStyle(PearColors.accent)
                            }
                        }
                        Spacer()
                        if relays.count > 1 {
                            Button("Remove") { removeRelay(url) }
                                .font(.system(size: 12))
                                .foregroundStyle(PearColors.error)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            HStack {
                TextField("https://relay.example.com", text: $relayInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(PearColors.textPrimary)
                    .padding(10)
                    .background(PearColors.surfaceElevated, in: RoundedRectangle(cornerRadius: 8))
                Button("Add") { addRelay() }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PearColors.bg)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(PearColors.accent, in: RoundedRectangle(cornerRadius: 8))
                    .disabled(rpc == nil || relayInput.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private var catalogsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            let catalogs = decodeCatalogs()
            if catalogs.isEmpty {
                Text("No catalogs configured.")
                    .font(.system(size: 12))
                    .foregroundStyle(PearColors.textMuted)
            } else {
                ForEach(catalogs, id: \.self) { url in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(url).font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(PearColors.textPrimary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            if url == catalogUrl {
                                Text("Primary").font(.system(size: 10)).foregroundStyle(PearColors.accent)
                            }
                        }
                        Spacer()
                        if url != catalogUrl {
                            Button("Use") { catalogUrl = url }
                                .font(.system(size: 12))
                                .foregroundStyle(PearColors.accent)
                        }
                        if catalogs.count > 1 {
                            Button("Remove") { removeCatalog(url) }
                                .font(.system(size: 12))
                                .foregroundStyle(PearColors.error)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            HStack {
                TextField("https://relay.example.com", text: $catalogInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(PearColors.textPrimary)
                    .padding(10)
                    .background(PearColors.surfaceElevated, in: RoundedRectangle(cornerRadius: 8))
                Button("Add") { addCatalog() }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PearColors.bg)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(PearColors.accent, in: RoundedRectangle(cornerRadius: 8))
                    .disabled(catalogInput.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private var identitySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            identityRow("Your Profile",
                        subtitle: "Display name, avatar, contact info. All opt-in — apps only see what you grant.",
                        onTap: onOpenProfile)
            Divider().background(PearColors.border)
            identityRow("Connected Apps",
                        subtitle: "Review and revoke sign-ins.",
                        onTap: onOpenConnectedApps)
            Divider().background(PearColors.border)
            identityRow("Backup Phrase",
                        subtitle: "View your 12-word seed. Save it — without it you cannot recover.",
                        onTap: onOpenBackupPhrase)
            Divider().background(PearColors.border)
            identityRow("Restore from Phrase",
                        subtitle: "Replace this device's identity with one restored from a saved phrase.",
                        onTap: onOpenRestoreIdentity)
        }
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func identityRow(_ title: String, subtitle: String, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 15))
                        .foregroundStyle(PearColors.textPrimary)
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(PearColors.textMuted)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Text(">").font(.system(size: 18)).foregroundStyle(PearColors.accent)
            }
            .padding(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var aboutSection: some View {
        VStack(spacing: 0) {
            aboutRow("Version", "0.1.0")
            aboutRow("Runtime", "Bare Kit + Hyperswarm")
            aboutRow("Platform", "iOS (SwiftUI native)")
            aboutRow("Bridge", "Direct HTTP (localhost)")
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func aboutRow(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key).font(.system(size: 14)).foregroundStyle(PearColors.textSecondary)
            Spacer()
            Text(value).font(.system(size: 14)).foregroundStyle(PearColors.textPrimary)
        }
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PearColors.textMuted)
                .tracking(1)
                .textCase(.uppercase)
                .padding(.top, 16)
                .padding(.leading, 4)
            content()
        }
    }

    // MARK: - RPC

    private func loadRelays() async {
        guard let rpc else { return }
        do {
            let cfg = try await rpc.getRelays()
            relays = (cfg["relays"] as? [String]) ?? []
            relayEnabled = (cfg["enabled"] as? Bool) ?? true
            loadedRelays = true
        } catch {
            NSLog("[Settings] getRelays failed: \(error)")
        }
    }

    private func loadStorage() async {
        guard let rpc else { return }
        do {
            let status = try await rpc.getStatus()
            storageUsed = (status["storageUsed"] as? Int).map(Int64.init) ?? 0
            let limit = (status["storageLimit"] as? Int).map(Int64.init) ?? (1024 * 1024 * 1024)
            storageLimit = limit
        } catch {
            NSLog("[Settings] getStatus failed: \(error)")
        }
    }

    private func clearCache() async {
        guard let rpc else { return }
        _ = try? await rpc.request(Cmd.CLEAR_CACHE)
        await loadStorage()
    }

    private func setRelayEnabled(_ enabled: Bool) {
        guard let rpc else { return }
        Task {
            _ = try? await rpc.setRelayEnabled(enabled)
            await loadRelays()
        }
    }

    private func addRelay() {
        guard let rpc else { return }
        let url = relayInput.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard url.hasPrefix("http://") || url.hasPrefix("https://") else { return }
        Task {
            _ = try? await rpc.setRelays(relays + [url])
            relayInput = ""
            await loadRelays()
        }
    }

    private func removeRelay(_ url: String) {
        guard let rpc, relays.count > 1 else { return }
        let next = relays.filter { $0 != url }
        Task {
            _ = try? await rpc.setRelays(next)
            await loadRelays()
        }
    }

    // MARK: - Catalogs

    private func decodeCatalogs() -> [String] {
        guard let data = catalogListJSON.data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [String] else { return [] }
        return list
    }

    private func encodeCatalogs(_ list: [String]) {
        if let data = try? JSONSerialization.data(withJSONObject: list),
           let s = String(data: data, encoding: .utf8) { catalogListJSON = s }
    }

    private func addCatalog() {
        let url = catalogInput.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !url.isEmpty else { return }
        var list = decodeCatalogs()
        if !list.contains(url) { list.append(url) }
        encodeCatalogs(list)
        catalogInput = ""
    }

    private func removeCatalog(_ url: String) {
        var list = decodeCatalogs().filter { $0 != url }
        if list.isEmpty {
            list = ["https://relay-us.p2phiverelay.xyz"]
        }
        if catalogUrl == url { catalogUrl = list.first ?? catalogUrl }
        encodeCatalogs(list)
    }

    // MARK: - Helpers

    private func clearAll() {
        UserDefaults.standard.dictionaryRepresentation().keys
            .filter { $0.hasPrefix("pearbrowser.") }
            .forEach { UserDefaults.standard.removeObject(forKey: $0) }
        guard let rpc else { return }
        Task {
            _ = try? await rpc.clearHistory()
            _ = try? await rpc.request(Cmd.CLEAR_CACHE)
        }
    }

    private func formatBytes(_ bytes: Int64) -> String {
        if bytes <= 0 { return "0 B" }
        let kb = 1024.0
        let units = ["B", "KB", "MB", "GB", "TB"]
        var v = Double(bytes)
        var i = 0
        while v >= kb && i < units.count - 1 { v /= kb; i += 1 }
        return String(format: "%.1f %@", v, units[i])
    }
}
