//  PearBrowser — SiteEditorScreen.swift
//
//  SwiftUI mirror of app/screens/SiteEditorScreen.tsx — simplified first
//  pass. Supports the 8 block types, add/remove/reorder, save, publish,
//  preview. Theme picker is a 5-preset row. Published URL opens in the
//  Browse tab.
//
//  Backend wire calls CMD_UPDATE_SITE + CMD_PUBLISH_SITE.

import SwiftUI

enum BlockType: String, CaseIterable {
    case heading, text, list, divider, code, quote, link, image

    var label: String {
        switch self {
        case .heading: return "H"
        case .text: return "T"
        case .list: return "="
        case .divider: return "--"
        case .code: return "{}"
        case .quote: return "\""
        case .link: return "@"
        case .image: return "Img"
        }
    }
}

struct EditorBlock: Identifiable, Hashable {
    var id: String = UUID().uuidString
    var type: BlockType
    var text: String = ""
    var level: Int = 2      // for heading
    var items: [String] = []  // for list
    var href: String = ""    // for link
    var src: String = ""     // for image
    var alt: String = ""     // for image

    func toDict() -> [String: Any] {
        var d: [String: Any] = ["id": id, "type": type.rawValue]
        switch type {
        case .heading: d["text"] = text; d["level"] = level
        case .text, .code, .quote: d["text"] = text
        case .list: d["items"] = items
        case .link: d["text"] = text; d["href"] = href
        case .image: d["src"] = src; d["alt"] = alt
        case .divider: break
        }
        return d
    }

    static func from(_ dict: [String: Any]) -> EditorBlock? {
        guard let typeRaw = dict["type"] as? String, let type = BlockType(rawValue: typeRaw) else { return nil }
        var b = EditorBlock(id: (dict["id"] as? String) ?? UUID().uuidString, type: type)
        b.text = (dict["text"] as? String) ?? ""
        b.level = (dict["level"] as? Int) ?? 2
        b.items = (dict["items"] as? [String]) ?? []
        b.href = (dict["href"] as? String) ?? ""
        b.src = (dict["src"] as? String) ?? ""
        b.alt = (dict["alt"] as? String) ?? ""
        return b
    }
}

struct SiteEditorScreen: View {
    let siteId: String
    let siteName: String?
    /// Initial block list (from TemplatePicker) or nil to load from backend.
    let initialBlocks: [[String: Any]]?
    let initialTheme: [String: String]?
    let onBack: () -> Void
    let onPreview: (String) -> Void

    @Environment(\.pearRPC) private var rpc

    @State private var blocks: [EditorBlock] = []
    @State private var themeName: String = "default"
    @State private var saving = false
    @State private var publishing = false
    @State private var errorMessage: String? = nil
    @State private var publishResult: String? = nil

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(siteName ?? "Editor", onBack: onBack) {
                HStack(spacing: 12) {
                    Button(action: save) {
                        Text(saving ? "…" : "Save")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(PearColors.accent)
                    }
                    .disabled(saving || rpc == nil)
                    Button(action: publish) {
                        Text(publishing ? "…" : "Publish")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(PearColors.accent)
                    }
                    .disabled(publishing || rpc == nil)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(PearColors.error)
                    .padding(12)
                    .frame(maxWidth: .infinity)
                    .background(Color(red: 0.17, green: 0.05, blue: 0.05))
            }

            ScrollView {
                VStack(spacing: 10) {
                    themeRow
                    ForEach($blocks) { $block in
                        blockEditor(for: $block)
                    }
                }
                .padding(16)
                .padding(.bottom, 140)
            }

            toolbar
        }
        .background(PearColors.bg)
        .onAppear { loadIfNeeded() }
        .alert("Site published", isPresented: Binding(get: { publishResult != nil }, set: { if !$0 { publishResult = nil } })) {
            Button("View") {
                if let publishResult { onPreview(publishResult) }
            }
            Button("OK", role: .cancel) {}
        } message: {
            if let publishResult { Text("Live at \(publishResult)") }
        }
    }

    // MARK: - Theme row

    private var themeRow: some View {
        let themes: [(id: String, name: String, color: Color)] = [
            ("default", "Default", PearColors.accent),
            ("dark", "Dark", Color.black),
            ("warm", "Warm", Color(red: 0.95, green: 0.55, blue: 0.2)),
            ("ocean", "Ocean", PearColors.link),
            ("forest", "Forest", PearColors.success),
        ]
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(themes, id: \.id) { t in
                    Button { themeName = t.id } label: {
                        HStack(spacing: 6) {
                            Circle().fill(t.color).frame(width: 10, height: 10)
                            Text(t.name).font(.system(size: 12, weight: .medium))
                                .foregroundStyle(themeName == t.id ? PearColors.bg : PearColors.textSecondary)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(themeName == t.id ? PearColors.accent : PearColors.surface,
                                    in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Block editor

    @ViewBuilder
    private func blockEditor(for block: Binding<EditorBlock>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(block.wrappedValue.type.rawValue.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PearColors.textMuted)
                    .tracking(1)
                Spacer()
                Button { move(block.wrappedValue.id, by: -1) } label: {
                    Text("↑").font(.system(size: 14, weight: .bold)).foregroundStyle(PearColors.textSecondary)
                }
                .buttonStyle(.plain)
                Button { move(block.wrappedValue.id, by: 1) } label: {
                    Text("↓").font(.system(size: 14, weight: .bold)).foregroundStyle(PearColors.textSecondary)
                }
                .buttonStyle(.plain)
                Button { remove(block.wrappedValue.id) } label: {
                    Text("x").font(.system(size: 14, weight: .bold)).foregroundStyle(PearColors.error)
                }
                .buttonStyle(.plain)
            }
            switch block.wrappedValue.type {
            case .heading:
                TextField("Heading", text: block.text)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(PearColors.textPrimary)
                    .padding(10)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 8))
            case .text, .code, .quote:
                TextEditor(text: block.text)
                    .font(block.wrappedValue.type == .code
                          ? .system(size: 13, design: .monospaced)
                          : .system(size: 14))
                    .foregroundStyle(PearColors.textPrimary)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 8))
                    .frame(minHeight: 80)
            case .list:
                ForEach(Array(block.items.wrappedValue.enumerated()), id: \.offset) { idx, _ in
                    TextField("Item", text: Binding(
                        get: { block.wrappedValue.items[idx] },
                        set: { block.wrappedValue.items[idx] = $0 }
                    ))
                    .font(.system(size: 14))
                    .foregroundStyle(PearColors.textPrimary)
                    .padding(10)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 8))
                }
                Button("+ item") { block.wrappedValue.items.append("") }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PearColors.accent)
            case .divider:
                Rectangle().fill(PearColors.border).frame(height: 1)
                    .padding(.vertical, 8)
            case .link:
                TextField("Label", text: block.text)
                    .font(.system(size: 14))
                    .foregroundStyle(PearColors.textPrimary)
                    .padding(10)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 8))
                TextField("https://…", text: block.href)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(PearColors.link)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(10)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 8))
            case .image:
                TextField("Image URL", text: block.src)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(PearColors.textPrimary)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(10)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 8))
                TextField("Alt text", text: block.alt)
                    .font(.system(size: 13))
                    .foregroundStyle(PearColors.textSecondary)
                    .padding(10)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(12)
        .background(PearColors.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(BlockType.allCases, id: \.self) { type in
                    Button { add(type) } label: {
                        Text(type.label)
                            .font(.system(size: 14, weight: .bold, design: .monospaced))
                            .foregroundStyle(PearColors.textPrimary)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(PearColors.surface.opacity(0.9))
        .overlay(alignment: .top) {
            Rectangle().fill(PearColors.border).frame(height: 0.5)
        }
    }

    // MARK: - Actions

    private func loadIfNeeded() {
        guard blocks.isEmpty else { return }
        if let initialBlocks {
            blocks = initialBlocks.compactMap { EditorBlock.from($0) }
            if blocks.isEmpty { seedDefault() }
        } else {
            seedDefault()
        }
    }

    private func seedDefault() {
        blocks = [
            EditorBlock(type: .heading, text: siteName ?? "My Website", level: 1),
            EditorBlock(type: .text, text: "Welcome to my P2P website."),
        ]
    }

    private func add(_ type: BlockType) {
        var block = EditorBlock(type: type)
        if type == .heading { block.text = "Heading" }
        if type == .text { block.text = "" }
        if type == .list { block.items = ["Item 1"] }
        if type == .link { block.text = "Link"; block.href = "https://" }
        if type == .image { block.alt = "" }
        blocks.append(block)
    }

    private func remove(_ id: String) {
        blocks.removeAll { $0.id == id }
    }

    private func move(_ id: String, by delta: Int) {
        guard let idx = blocks.firstIndex(where: { $0.id == id }) else { return }
        let target = idx + delta
        guard target >= 0 && target < blocks.count else { return }
        blocks.swapAt(idx, target)
    }

    private func save() {
        guard let rpc else { return }
        saving = true
        errorMessage = nil
        Task {
            do {
                _ = try await rpc.request(Cmd.UPDATE_SITE, data: [
                    "siteId": siteId,
                    "blocks": blocks.map { $0.toDict() },
                    "theme": themeName,
                ])
            } catch {
                errorMessage = "Save failed: \(error.localizedDescription)"
            }
            saving = false
        }
    }

    private func publish() {
        guard let rpc else { return }
        publishing = true
        errorMessage = nil
        Task {
            do {
                // Save current blocks first
                _ = try await rpc.request(Cmd.UPDATE_SITE, data: [
                    "siteId": siteId,
                    "blocks": blocks.map { $0.toDict() },
                    "theme": themeName,
                ])
                let resp = try await rpc.request(Cmd.PUBLISH_SITE, data: ["siteId": siteId])
                if let obj = resp as? [String: Any], let url = obj["url"] as? String {
                    publishResult = url
                } else if let obj = resp as? [String: Any], let key = obj["keyHex"] as? String {
                    publishResult = "hyper://\(key)"
                }
            } catch {
                errorMessage = "Publish failed: \(error.localizedDescription)"
            }
            publishing = false
        }
    }
}
