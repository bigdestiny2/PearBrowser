//  PearBrowser — BookmarksScreen.swift
//
//  SwiftUI mirror of app/screens/BookmarksScreen.tsx.
//  Reads bookmarks from the Hyperbee user data store via PearRPC so they
//  sync across the user's devices (Phase 1 ticket 2).

import SwiftUI

struct BookmarkEntry: Identifiable, Hashable {
    let id = UUID()
    let url: String
    let title: String
    let addedAt: Double
}

struct BookmarksScreen: View {
    let onOpen: (String) -> Void
    let onBack: () -> Void

    @Environment(\.pearRPC) private var rpc
    @State private var bookmarks: [BookmarkEntry] = []
    @State private var loading = true
    @State private var errorMessage: String? = nil

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("Bookmarks", onBack: onBack)

            ScrollView {
                VStack(spacing: 8) {
                    if loading {
                        ProgressView().tint(PearColors.accent).padding(.top, 60)
                    } else if let errorMessage {
                        Text(errorMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(PearColors.error)
                            .padding(.top, 60)
                    } else if bookmarks.isEmpty {
                        emptyState
                    } else {
                        ForEach(bookmarks) { bm in
                            BookmarkRow(bookmark: bm, onOpen: { onOpen(bm.url) }, onRemove: { remove(bm.url) })
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
        .task { await load() }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Text("*").font(.system(size: 36)).foregroundStyle(PearColors.accent)
            Text("No bookmarks yet").font(.system(size: 18, weight: .semibold)).foregroundStyle(PearColors.textPrimary)
            Text("Bookmark sites while browsing by tapping the share button.")
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 60)
    }

    private func load() async {
        loading = true
        errorMessage = nil
        defer { loading = false }

        guard let rpc else {
            // Demo mode: no worklet — show empty list
            bookmarks = []
            return
        }
        do {
            let items = try await rpc.listBookmarks()
            bookmarks = items.map {
                BookmarkEntry(
                    url: ($0["url"] as? String) ?? "",
                    title: ($0["title"] as? String) ?? "",
                    addedAt: ($0["addedAt"] as? Double) ?? 0
                )
            }
        } catch {
            errorMessage = "Could not load bookmarks: \(error.localizedDescription)"
        }
    }

    private func remove(_ url: String) {
        guard let rpc else { return }
        Task {
            try? await rpc.removeBookmark(url: url)
            await load()
        }
    }
}

private struct BookmarkRow: View {
    let bookmark: BookmarkEntry
    let onOpen: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(PearColors.surfaceElevated)
                    .frame(width: 40, height: 40)
                Text(bookmark.title.first.map { String($0).uppercased() } ?? "*")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(PearColors.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(bookmark.title.isEmpty ? "Untitled" : bookmark.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(PearColors.textPrimary)
                    .lineLimit(1)
                Text(bookmark.url)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(PearColors.textMuted)
                    .lineLimit(1)
            }
            Spacer()
            Button(action: onRemove) {
                Text("x").font(.system(size: 16)).foregroundStyle(PearColors.error)
                    .padding(8)
            }
            .buttonStyle(.plain)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .padding(12)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}
