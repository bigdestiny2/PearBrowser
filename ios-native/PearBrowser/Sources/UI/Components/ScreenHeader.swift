//  PearBrowser — ScreenHeader.swift
//
//  Reusable "< Back | Title | trailing" header used across all the
//  More-tab sub-screens. Keeps styling consistent with the RN version
//  of app/screens/* headers.

import SwiftUI

struct ScreenHeader<Trailing: View>: View {
    let title: String
    let onBack: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    init(_ title: String, onBack: @escaping () -> Void,
         @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
        self.title = title
        self.onBack = onBack
        self.trailing = trailing
    }

    var body: some View {
        HStack {
            Button(action: onBack) {
                Text("< Back")
                    .font(.system(size: 16))
                    .foregroundStyle(PearColors.accent)
            }
            .buttonStyle(.plain)
            .frame(width: 60, alignment: .leading)

            Spacer()
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(PearColors.textPrimary)
            Spacer()

            trailing()
                .frame(minWidth: 60, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(PearColors.surface)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(PearColors.border)
                .frame(height: 0.5)
        }
    }
}
