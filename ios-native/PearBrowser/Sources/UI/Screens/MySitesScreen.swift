//  PearBrowser — MySitesScreen.swift
//
//  SwiftUI mirror of app/screens/MySitesScreen.tsx. Lists the user's
//  personal websites (published as Hyperdrives), lets them create a
//  new one, edit it, publish it, share the hyper:// URL, or delete.
//
//  Uses PearRPC's CMD_LIST_SITES / CMD_CREATE_SITE / CMD_PUBLISH_SITE /
//  CMD_DELETE_SITE.

import SwiftUI

struct SiteRecord: Identifiable, Hashable {
    let id: String
    let keyHex: String
    let name: String
    let published: Bool
    let url: String
}

struct MySitesScreen: View {
    let onEdit: (String) -> Void
    let onPreview: (String) -> Void
    let onCreateNew: (String) -> Void
    let onBack: () -> Void

    @Environment(\.pearRPC) private var rpc
    @State private var sites: [SiteRecord] = []
    @State private var newName: String = ""
    @State private var creating = false
    @State private var loading = true
    @State private var errorMessage: String? = nil
    @State private var publishResult: String? = nil
    @State private var shareItem: String? = nil
    @State private var siteToDelete: SiteRecord? = nil

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("My Sites", onBack: onBack)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Create and publish P2P websites")
                        .font(.system(size: 13))
                        .foregroundStyle(PearColors.textSecondary)

                    createRow

                    if let errorMessage {
                        errorBox(errorMessage) { Task { await load() } }
                    }

                    if loading {
                        ProgressView().tint(PearColors.accent).padding(.top, 20)
                    } else if sites.isEmpty {
                        emptyState
                    } else {
                        ForEach(sites) { site in
                            siteCard(site)
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
        .task { await load() }
        .alert("Site published!", isPresented: Binding(get: { publishResult != nil }, set: { if !$0 { publishResult = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            if let publishResult { Text("Your site is live at:\n\nhyper://\(publishResult.prefix(16))…") }
        }
        .alert("Delete site?", isPresented: Binding(get: { siteToDelete != nil }, set: { if !$0 { siteToDelete = nil } })) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                if let site = siteToDelete { delete(site) }
            }
        } message: {
            Text("\"\(siteToDelete?.name ?? "")\" will be removed from this device.")
        }
        .sheet(isPresented: Binding(get: { shareItem != nil }, set: { if !$0 { shareItem = nil } })) {
            if let item = shareItem {
                ShareSheet(activityItems: [item])
            }
        }
    }

    private var createRow: some View {
        HStack(spacing: 8) {
            TextField("Site name…", text: $newName)
                .font(.system(size: 16))
                .foregroundStyle(PearColors.textPrimary)
                .padding(12)
                .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
            Button {
                if let onCreateNew = onCreateNewIfValid() {
                    onCreateNew()
                }
            } label: {
                if creating {
                    ProgressView().tint(PearColors.bg)
                } else {
                    Text("Create")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(PearColors.bg)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(creating || newName.trimmingCharacters(in: .whitespaces).isEmpty
                        ? PearColors.surface
                        : PearColors.accent,
                        in: RoundedRectangle(cornerRadius: 12))
            .disabled(creating || newName.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func onCreateNewIfValid() -> (() -> Void)? {
        let trimmed = newName.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        return {
            newName = ""
            onCreateNew(trimmed)
        }
    }

    private func errorBox(_ message: String, retry: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Could not load sites")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PearColors.error)
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(PearColors.textSecondary)
            Button("Retry", action: retry)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(PearColors.accent)
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Text("</>").font(.system(size: 36, design: .monospaced)).foregroundStyle(PearColors.accent)
            Text("No sites yet")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(PearColors.textPrimary)
            Text("Create your first P2P website above. It will be served from your phone and available to anyone on the network.")
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private func siteCard(_ site: SiteRecord) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10).fill(PearColors.surfaceElevated).frame(width: 40, height: 40)
                    Text(site.name.first.map { String($0).uppercased() } ?? "?")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(PearColors.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(site.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(PearColors.textPrimary)
                    Text("\(site.published ? "Live" : "Draft") · hyper://\(site.keyHex.prefix(8))…")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(PearColors.textMuted)
                }
                Spacer()
                Text(site.published ? "Live" : "Draft")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(site.published ? PearColors.success : PearColors.textMuted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(site.published ? Color(red: 0.09, green: 0.39, blue: 0.27) : PearColors.surfaceElevated,
                                in: RoundedRectangle(cornerRadius: 8))
            }
            HStack(spacing: 8) {
                actionButton("Edit") { onEdit(site.id) }
                actionButton("Preview") { onPreview(site.url) }
                if site.published {
                    actionButton("Share", prominent: false) { shareItem = site.url }
                } else {
                    actionButton("Publish", prominent: true) { publish(site.id) }
                }
                actionButton("Delete", destructive: true) { siteToDelete = site }
            }
        }
        .padding(16)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func actionButton(_ title: String, prominent: Bool = false, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(destructive ? PearColors.error
                                  : (prominent ? PearColors.bg : PearColors.textSecondary))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(prominent ? PearColors.accent : PearColors.surfaceElevated,
                            in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func load() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        guard let rpc else { sites = []; return }
        do {
            let resp = try await rpc.request(Cmd.LIST_SITES)
            if let arr = resp as? [[String: Any]] {
                sites = arr.compactMap { toSiteRecord($0) }
            } else if let obj = resp as? [String: Any], let arr = obj["sites"] as? [[String: Any]] {
                sites = arr.compactMap { toSiteRecord($0) }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func toSiteRecord(_ dict: [String: Any]) -> SiteRecord? {
        guard let id = dict["siteId"] as? String ?? dict["id"] as? String,
              let keyHex = dict["keyHex"] as? String,
              let name = dict["name"] as? String else { return nil }
        let published = (dict["published"] as? Bool) ?? false
        let url = (dict["url"] as? String) ?? "hyper://\(keyHex)"
        return SiteRecord(id: id, keyHex: keyHex, name: name, published: published, url: url)
    }

    private func publish(_ siteId: String) {
        guard let rpc else { return }
        Task {
            do {
                let resp = try await rpc.request(Cmd.PUBLISH_SITE, data: ["siteId": siteId])
                if let obj = resp as? [String: Any], let key = obj["keyHex"] as? String {
                    publishResult = key
                }
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func delete(_ site: SiteRecord) {
        guard let rpc else { return }
        Task {
            do {
                _ = try await rpc.request(Cmd.DELETE_SITE, data: ["siteId": site.id])
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - ShareSheet wrapper

struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
