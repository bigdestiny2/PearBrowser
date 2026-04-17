//  PearBrowser — PearWorkletHost.swift
//
//  Hosts the Bare worklet that runs the backend (Hyperswarm, Corestore,
//  HyperProxy, sync groups).
//
//  Uses the `BareKit` framework documented at
//  https://github.com/holepunchto/bare-ios — drop the .xcframework in
//  ios-native/PearBrowser/Frameworks/ and project.yml picks it up.
//
//  The worklet and the UI run in the same process on iOS (unlike the
//  Android shell where we use a :worklet process) because iOS doesn't
//  have isolated services. BareKit handles thread isolation internally.
//
//  Phase 3 tickets 1 + 2 — see docs/HOLEPUNCH_ALIGNMENT_PLAN.md.

import Foundation

#if canImport(BareKit)
import BareKit
#endif

/// Adapter + lifecycle owner for the Bare worklet. Keeps a single
/// PearRPC instance and a reference to the running worklet.
@MainActor
final class PearWorkletHost: ObservableObject {

    static let shared = PearWorkletHost()

    @Published private(set) var isReady: Bool = false
    @Published private(set) var proxyPort: Int = 0
    @Published private(set) var peerCount: Int = 0
    @Published private(set) var apiToken: String = ""
    @Published private(set) var bootMessage: String = "Starting…"
    @Published private(set) var bootStage: String = "init"

    let rpc: PearRPC

    private var worklet: Any?           // BareKit.Worklet (protected by canImport)
    private var ipcAdapter: BareKitIPCAdapter?

    private init() {
        let adapter = BareKitIPCAdapter()
        self.ipcAdapter = adapter
        self.rpc = PearRPC(ipc: adapter)
    }

    /// Boot the worklet. Idempotent.
    func boot() async {
        guard worklet == nil else { return }
        await rpc.attach()

        // Wire event listeners BEFORE start() so we don't miss READY.
        let rpcRef = rpc
        let weakSelf = WeakBox(self)
        await rpcRef.on(Evt.READY) { payload in
            Task { @MainActor in
                if let dict = payload as? [String: Any] {
                    weakSelf.value?.proxyPort = (dict["proxyPort"] as? Int) ?? 0
                    weakSelf.value?.apiToken = (dict["apiToken"] as? String) ?? ""
                }
                weakSelf.value?.isReady = true
                weakSelf.value?.bootMessage = "Connected"
                weakSelf.value?.bootStage = "ready"
            }
        }
        await rpcRef.on(Evt.PEER_COUNT) { payload in
            if let dict = payload as? [String: Any], let n = dict["peerCount"] as? Int {
                Task { @MainActor in weakSelf.value?.peerCount = n }
            }
        }
        await rpcRef.on(Evt.BOOT_PROGRESS) { payload in
            if let dict = payload as? [String: Any] {
                let stage = dict["stage"] as? String ?? "progress"
                let message = dict["message"] as? String ?? stage
                Task { @MainActor in
                    weakSelf.value?.bootStage = stage
                    weakSelf.value?.bootMessage = message
                }
            }
        }

        guard let bundleURL = Self.bundleURL() else {
            NSLog("[PearWorkletHost] backend.ios.bundle missing from app bundle")
            bootMessage = "Bundle missing"
            bootStage = "error"
            return
        }

        let storageURL = Self.storageURL()

        #if canImport(BareKit)
        do {
            // The canonical BareKit Swift API (see holepunchto/bare-ios):
            //     let wkt = Worklet()
            //     try wkt.start(file: bundleURL, args: [storageURL.path])
            //     wkt.ipc.sink { data in ... }
            //     wkt.ipc.send(data)
            let wkt = Worklet()
            try wkt.start(file: bundleURL, source: nil, arguments: [storageURL.path])
            self.worklet = wkt
            ipcAdapter?.attach(to: wkt)
        } catch {
            NSLog("[PearWorkletHost] boot failed: \(error)")
            bootMessage = "Boot failed: \(error.localizedDescription)"
            bootStage = "error"
        }
        #else
        NSLog("[PearWorkletHost] BareKit framework not linked — demo mode. See BUILD.md.")
        bootMessage = "Running in demo mode (BareKit.xcframework not linked)"
        bootStage = "demo"
        #endif
    }

    func shutdown() {
        #if canImport(BareKit)
        (worklet as? Worklet)?.terminate()
        #endif
        worklet = nil
    }

    // MARK: - Paths

    private static func bundleURL() -> URL? {
        // Asset catalog references the bundle via project.yml resources: directive.
        if let url = Bundle.main.url(forResource: "backend.ios", withExtension: "bundle") {
            return url
        }
        return nil
    }

    private static func storageURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("pearbrowser", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

/// Adapter from the BareKit worklet's IPC stream to our [WorkletIPC]
/// protocol. Kept lightweight — all protocol logic lives in PearRPC.
final class BareKitIPCAdapter: WorkletIPC {
    private var listeners: [(Data) -> Void] = []
    #if canImport(BareKit)
    private weak var worklet: Worklet?
    #else
    private var worklet: Any?
    #endif

    func attach(to worklet: Any) {
        #if canImport(BareKit)
        if let wkt = worklet as? Worklet {
            self.worklet = wkt
            // BareKit.IPC exposes .sink(handler:) on the Swift side
            wkt.ipc.sink { [weak self] data in
                self?.listeners.forEach { $0(data) }
            }
        }
        #endif
    }

    func write(_ bytes: Data) {
        #if canImport(BareKit)
        worklet?.ipc.send(bytes)
        #else
        _ = bytes
        #endif
    }

    func onData(_ listener: @escaping (Data) -> Void) {
        listeners.append(listener)
    }

    func close() {
        listeners.removeAll()
    }
}

/// Tiny weak box for closure captures that need access to MainActor state.
private final class WeakBox<T: AnyObject> {
    weak var value: T?
    init(_ value: T) { self.value = value }
}
