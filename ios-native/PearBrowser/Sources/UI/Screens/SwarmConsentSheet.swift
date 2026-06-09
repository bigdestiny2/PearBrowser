//  PearBrowser - SwarmConsentSheet.swift
//
//  Native consent sheet for arbitrary `window.pear.swarm.v1.join()`
//  requests. Drive-derived subtopics are automatic; this only appears
//  when a page asks to join a raw 32-byte swarm topic.

import SwiftUI

struct SwarmConsentSheet: View {
    let request: SwarmConsentRequest
    let onDecision: (_ approved: Bool) -> Void

    @State private var submitting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                networkCard
                riskSection
                actions
            }
            .padding(20)
        }
        .background(PearColors.bg)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(request.appName)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(PearColors.textPrimary)
            Text("wants direct peer networking")
                .font(.system(size: 15))
                .foregroundStyle(PearColors.textSecondary)
            if !request.reason.isEmpty {
                Text(request.reason)
                    .font(.system(size: 13))
                    .foregroundStyle(PearColors.textSecondary)
                    .padding(.top, 6)
            }
        }
    }

    private var networkCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            labeledValue("Protocol", request.protocolName)
            labeledValue("Topic", shortHex(request.topicHex))
            labeledValue("App key", shortHex(request.driveKey))
        }
        .padding(14)
        .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private var riskSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Before approving")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PearColors.textSecondary)
                .tracking(1)
                .textCase(.uppercase)
            VStack(spacing: 0) {
                infoRow("Peers on this topic may see your network address.")
                Divider().background(PearColors.border)
                infoRow("Only approve apps and topics you trust.")
                Divider().background(PearColors.border)
                infoRow("This grant is saved per app and topic until revoked.")
            }
            .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var actions: some View {
        HStack(spacing: 12) {
            Button {
                submitting = true
                onDecision(false)
            } label: {
                Text("Cancel")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PearColors.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(PearColors.surface, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .disabled(submitting)

            Button {
                submitting = true
                onDecision(true)
            } label: {
                Text(submitting ? "..." : "Allow")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(PearColors.bg)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(PearColors.accent, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .disabled(submitting)
        }
        .padding(.top, 8)
    }

    private func labeledValue(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PearColors.textMuted)
                .textCase(.uppercase)
            Text(value)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(PearColors.textPrimary)
                .textSelection(.enabled)
        }
    }

    private func infoRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("!")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(PearColors.warning)
                .frame(width: 20, alignment: .center)
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(PearColors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func shortHex(_ value: String) -> String {
        guard value.count > 20 else { return value }
        return String(value.prefix(12)) + "..." + String(value.suffix(8))
    }
}
