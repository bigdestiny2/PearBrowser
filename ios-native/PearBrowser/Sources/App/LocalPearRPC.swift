//  PearBrowser — LocalPearRPC.swift
//
//  SwiftUI EnvironmentValue + Key for injecting the worklet RPC client
//  into any screen without passing it down through the view tree.
//
//  Usage in a screen:
//      @Environment(\.pearRPC) private var rpc
//      // rpc is Optional<PearRPC> — nil when worklet is in demo mode
//
//  Host sets it once at the root:
//      MainView().environment(\.pearRPC, host.rpc)

import SwiftUI

private struct PearRPCKey: EnvironmentKey {
    static let defaultValue: PearRPC? = nil
}

extension EnvironmentValues {
    var pearRPC: PearRPC? {
        get { self[PearRPCKey.self] }
        set { self[PearRPCKey.self] = newValue }
    }
}
