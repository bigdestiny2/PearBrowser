//  PearBrowser — PearBrowserApp.swift (@main)
//
//  SwiftUI app entry. Kicks off the worklet at launch and hands the
//  PearWorkletHost singleton down to MainView via @StateObject.

import SwiftUI

@main
struct PearBrowserApp: App {
    @StateObject private var host = PearWorkletHost.shared

    var body: some Scene {
        WindowGroup {
            MainView()
                .environmentObject(host)
                .task { await host.boot() }
                .preferredColorScheme(.dark)
        }
    }
}
