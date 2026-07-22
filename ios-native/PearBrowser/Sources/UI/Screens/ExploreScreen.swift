//  PearBrowser — ExploreScreen.swift
//
//  SwiftUI mirror of app/screens/ExploreScreen.tsx.
//  First pass fetches catalog via URLSession over HTTPS. Phase 1 ticket 1
//  (Hyperbee catalogs) will call PearRPC.loadCatalogBee when the relay
//  starts publishing one.

import SwiftUI

struct SiteInfo: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let description: String
    let driveKey: String?
    let link: String?
    let desktopPackage: Bool
}

struct ExploreScreen: View {
    let onVisit: (String) -> Void

    @State private var sites: [SiteInfo] = []
    @State private var loading = true
    @State private var errorMessage: String? = nil
    @State private var sourceUrl = "https://relay-us.p2phiverelay.xyz"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Explore")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(PearColors.textPrimary)
                Text("Discover sites and tools on the P2P web")
                    .font(.system(size: 14))
                    .foregroundStyle(PearColors.textSecondary)

                if loading {
                    HStack { Spacer(); ProgressView().tint(PearColors.accent); Spacer() }
                        .padding(.top, 40)
                } else if let msg = errorMessage {
                    Text("Could not load directory: \(msg)")
                        .font(.system(size: 13))
                        .foregroundStyle(PearColors.error)
                        .padding(.top, 24)
                } else if sites.isEmpty {
                    Text("Directory is empty.")
                        .font(.system(size: 13))
                        .foregroundStyle(PearColors.textMuted)
                        .padding(.top, 24)
                } else {
                    VStack(spacing: 8) {
                        ForEach(sites) { site in
                            SiteCard(site: site) { visit(site) }
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(PearColors.bg)
        .task { await load() }
    }

    private func visit(_ site: SiteInfo) {
        if site.desktopPackage {
            errorMessage = "\(site.name) is a desktop v3 package. Open this catalogue on desktop to install its verified native release."
        } else if let link = site.link, link.lowercased().hasPrefix("hyper://") {
            onVisit(link)
        } else if let driveKey = site.driveKey {
            onVisit("hyper://\(driveKey)")
        } else if let link = site.link, link.lowercased().hasPrefix("pear://") || link.lowercased().hasPrefix("file://") {
            errorMessage = "\(site.name) is a legacy Pear v2 app. Migrate it to a native v3 package on desktop."
        }
    }

    private func load() async {
        loading = true
        errorMessage = nil
        do {
            let target = sourceUrl.hasSuffix("/catalog.json") ? sourceUrl : sourceUrl + "/catalog.json"
            guard let url = URL(string: target) else {
                errorMessage = "Invalid catalog URL"
                loading = false
                return
            }
            var req = URLRequest(url: url)
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            req.timeoutInterval = 10
            let (data, response) = try await URLSession.shared.data(for: req)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                errorMessage = "Relay returned HTTP \(http.statusCode)"
                sites = []
            } else {
                let decoded = try decodeCatalog(data: data)
                sites = decoded
            }
        } catch {
            errorMessage = error.localizedDescription
            sites = []
        }
        loading = false
    }

    private func decodeCatalog(data: Data) throws -> [SiteInfo] {
        // Live relay catalog returns `apps`; the paginated variant returns `items`;
        // legacy registry exports may use `entries`.
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return []
        }
        let apps = (root["apps"] as? [[String: Any]])
            ?? (root["items"] as? [[String: Any]])
            ?? (root["entries"] as? [[String: Any]])
            ?? []
        return apps.compactMap { app in
            let link = normalizeCatalogLink(app["link"])
            let driveKey = normalizeDriveKey(app["driveKey"])
                ?? normalizeDriveKey(app["appKey"])
                ?? normalizeDriveKey(app["key"])
                ?? driveKeyFromHyperLink(link)
            guard driveKey != nil || link != nil else { return nil }
            return SiteInfo(
                id: (app["id"] as? String) ?? driveKey ?? link!,
                name: (app["name"] as? String) ?? "Untitled",
                description: (app["description"] as? String) ?? "",
                driveKey: driveKey,
                link: link,
                desktopPackage: isDesktopPackage(app)
            )
        }
    }
}

private func isDesktopPackage(_ app: [String: Any]) -> Bool {
    let generation = (app["generation"] as? Int) == 3 || (app["pearGeneration"] as? Int) == 3
    let delivery = ((app["delivery"] as? String) ?? (app["packageType"] as? String) ?? (app["kind"] as? String) ?? "").lowercased()
    let isPackage = generation || delivery.contains("native") || delivery.contains("desktop") || delivery.contains("package")
    let targets = (app["platforms"] as? [String]) ?? (app["targets"] as? [String]) ?? []
    return isPackage && targets.contains { ["darwin", "linux", "win32", "desktop"].contains($0.lowercased()) }
}

private func normalizeDriveKey(_ raw: Any?) -> String? {
    guard let value = raw as? String else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if isHex64(trimmed) { return trimmed.lowercased() }
    return driveKeyFromHyperLink(trimmed)
}

private func normalizeCatalogLink(_ raw: Any?) -> String? {
    guard let value = raw as? String else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let schemeRange = trimmed.range(of: "://") else { return nil }
    let scheme = String(trimmed[..<schemeRange.lowerBound]).lowercased()
    switch scheme {
    case "hyper":
        return normalizeHyperLink(trimmed)
    case "pear", "file": // Retain as a migration record; never pass to onVisit.
        return "\(scheme)://\(trimmed[schemeRange.upperBound...])"
    default:
        return nil
    }
}

private func normalizeHyperLink(_ link: String) -> String? {
    let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let schemeRange = trimmed.range(of: "://") else { return nil }
    guard String(trimmed[..<schemeRange.lowerBound]).lowercased() == "hyper" else { return nil }
    let rest = String(trimmed[schemeRange.upperBound...])
    let split = rest.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? rest.endIndex
    let key = String(rest[..<split])
    guard isHex64(key) else { return nil }
    return "hyper://\(key.lowercased())\(rest[split...])"
}

private func driveKeyFromHyperLink(_ link: String?) -> String? {
    guard let normalized = normalizeHyperLink(link ?? "") else { return nil }
    let rest = normalized.dropFirst("hyper://".count)
    let split = rest.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? rest.endIndex
    return String(rest[..<split])
}

private func isHex64(_ value: String) -> Bool {
    value.range(of: #"^[0-9a-fA-F]{64}$"#, options: .regularExpression) != nil
}

struct SiteCard: View {
    let site: SiteInfo
    let onVisit: () -> Void

    private var actionLabel: String {
        if site.desktopPackage { return "Desktop only" }
        guard let link = site.link else { return "Open" }
        return link.lowercased().hasPrefix("hyper://") ? "Open" : "Migration required"
    }

    var body: some View {
        Button(action: onVisit) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(site.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(PearColors.textPrimary)
                    if !site.description.isEmpty {
                        Text(site.description)
                            .font(.system(size: 12))
                            .foregroundStyle(PearColors.textSecondary)
                            .lineLimit(2)
                    }
                }
                Spacer()
                Text(actionLabel)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PearColors.accent)
            }
            .padding(14)
            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ExploreScreen(onVisit: { _ in })
}
