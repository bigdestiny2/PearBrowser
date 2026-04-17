//  PearBrowser — MoreScreen.swift (stub)

import SwiftUI

struct MoreScreen: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("More")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(PearColors.textPrimary)
                Text("Bookmarks, history, sites, identity — coming in the next pass.")
                    .font(.system(size: 14))
                    .foregroundStyle(PearColors.textSecondary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(PearColors.bg)
    }
}

#Preview { MoreScreen() }
