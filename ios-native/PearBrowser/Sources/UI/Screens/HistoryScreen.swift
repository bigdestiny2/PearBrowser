//  PearBrowser — HistoryScreen.swift
//
//  SwiftUI mirror of app/screens/HistoryScreen.tsx. Pulls the last
//  200 visited URLs from the Hyperbee user-data store and groups them
//  by day (Today / Yesterday / <weekday> / <ISO date>).

import SwiftUI

struct HistoryEntry: Identifiable, Hashable {
    let id = UUID()
    let url: String
    let title: String
    let visitedAt: Double  // epoch millis
}

struct HistoryScreen: View {
    let onOpen: (String) -> Void
    let onBack: () -> Void

    @Environment(\.pearRPC) private var rpc
    @State private var history: [HistoryEntry] = []
    @State private var loading = true
    @State private var errorMessage: String? = nil
    @State private var showClearConfirm = false

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader("History", onBack: onBack) {
                if !history.isEmpty {
                    Button("Clear") { showClearConfirm = true }
                        .font(.system(size: 14))
                        .foregroundStyle(PearColors.error)
                }
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if loading {
                        HStack { Spacer(); ProgressView().tint(PearColors.accent); Spacer() }
                            .padding(.top, 60)
                    } else if let errorMessage {
                        Text(errorMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(PearColors.error)
                            .padding(.top, 60)
                            .frame(maxWidth: .infinity)
                    } else if history.isEmpty {
                        emptyState
                    } else {
                        ForEach(grouped, id: \.label) { group in
                            Text(group.label)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(PearColors.textSecondary)
                                .textCase(.uppercase)
                                .tracking(1)
                                .padding(.top, 16)
                                .padding(.bottom, 8)

                            VStack(spacing: 1) {
                                ForEach(group.items) { entry in
                                    historyRow(entry)
                                }
                            }
                            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(PearColors.bg)
        .task { await load() }
        .alert("Clear History?", isPresented: $showClearConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Clear", role: .destructive) { clear() }
        } message: {
            Text("This will permanently remove your browsing history on all devices where this identity is active.")
        }
    }

    private func historyRow(_ entry: HistoryEntry) -> some View {
        Button { onOpen(entry.url) } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title.isEmpty ? entry.url : entry.title)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PearColors.textPrimary)
                        .lineLimit(1)
                    Text(entry.url)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(PearColors.textMuted)
                        .lineLimit(1)
                }
                Spacer()
                Text(formatTime(entry.visitedAt))
                    .font(.system(size: 11))
                    .foregroundStyle(PearColors.textMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Text("⌚").font(.system(size: 36))
            Text("No history").font(.system(size: 18, weight: .semibold)).foregroundStyle(PearColors.textPrimary)
            Text("Your browsing history will appear here.")
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    // MARK: - Grouping

    private var grouped: [(label: String, items: [HistoryEntry])] {
        let now = Date()
        let cal = Calendar.current
        var buckets: [(Date, String, [HistoryEntry])] = []
        for entry in history {
            let date = Date(timeIntervalSince1970: entry.visitedAt / 1000)
            let label = dayLabel(for: date, now: now, cal: cal)
            let dayStart = cal.startOfDay(for: date)
            if let existing = buckets.firstIndex(where: { $0.0 == dayStart }) {
                buckets[existing].2.append(entry)
            } else {
                buckets.append((dayStart, label, [entry]))
            }
        }
        return buckets.map { (label: $0.1, items: $0.2) }
    }

    private func dayLabel(for date: Date, now: Date, cal: Calendar) -> String {
        if cal.isDateInToday(date) { return "Today" }
        if cal.isDateInYesterday(date) { return "Yesterday" }
        let days = cal.dateComponents([.day], from: date, to: now).day ?? 0
        if days < 7 {
            let f = DateFormatter(); f.dateFormat = "EEEE"; return f.string(from: date)
        }
        let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .none
        return f.string(from: date)
    }

    private func formatTime(_ epochMs: Double) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        return f.string(from: Date(timeIntervalSince1970: epochMs / 1000))
    }

    // MARK: - Actions

    private func load() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        guard let rpc else { history = []; return }
        do {
            let items = try await rpc.listHistory(limit: 200)
            history = items.map {
                HistoryEntry(
                    url: ($0["url"] as? String) ?? "",
                    title: ($0["title"] as? String) ?? "",
                    visitedAt: ($0["visitedAt"] as? Double) ?? 0
                )
            }
        } catch {
            errorMessage = "Could not load history: \(error.localizedDescription)"
        }
    }

    private func clear() {
        guard let rpc else { return }
        Task {
            try? await rpc.clearHistory()
            history = []
        }
    }
}
