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
                .task {
                    await host.boot()
#if DEBUG
                    postDebugLaunchHyperURLIfNeeded()
#endif
                }
                .onOpenURL { url in
                    postHyperURL(url)
                }
                .preferredColorScheme(.dark)
        }
    }

    private func postHyperURL(_ url: URL) {
        guard url.scheme?.lowercased() == "hyper" else { return }
        NotificationCenter.default.post(name: .pearBrowserOpenHyperURL, object: url)
    }

#if DEBUG
    private func postDebugLaunchHyperURLIfNeeded() {
        let arguments = ProcessInfo.processInfo.arguments
        guard let argumentIndex = arguments.firstIndex(of: "--open-hyper-url") else { return }
        let urlIndex = arguments.index(after: argumentIndex)
        guard arguments.indices.contains(urlIndex),
              let url = URL(string: arguments[urlIndex]) else { return }
        postHyperURL(url)
    }
#endif
}

extension Notification.Name {
    static let pearBrowserOpenHyperURL = Notification.Name("PearBrowserOpenHyperURL")
}
