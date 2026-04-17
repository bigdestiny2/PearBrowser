//  PearBrowser — BookmarksScreen.swift (stub)
//  Full implementation in the next pass — wired to PearRPC.listBookmarks().

import SwiftUI

struct BookmarksScreen: View {
    var body: some View {
        VStack(alignment: .leading) {
            Text("Bookmarks")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(PearColors.textPrimary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(PearColors.bg)
    }
}
