//  PearBrowser — PearWorkletHost.swift
//
//  Hosts the Bare worklet that runs the backend (Hyperswarm, Corestore,
//  HyperProxy, sync groups).
//
//  Uses Holepunch's `bare-kit-swift` SPM package which wraps the BareKit
//  xcframework. See BUILD.md — you must BOTH add the SPM package AND
//  drop the xcframework into PearBrowser/Frameworks/.
//
//  Real bare-kit Swift API (researched against github.com/holepunchto/bare-kit-swift):
//
//      let worklet = Worklet(configuration: Worklet.Configuration(
//          memoryLimit: 32 * 1024 * 1024
//      ))
//      worklet.start(filename: "/app.bundle", source: bundleData, arguments: [storagePath])
//      // or:
//      worklet.start(name: "app", ofType: "bundle", arguments: [storagePath])
//
//      let ipc = IPC(worklet: worklet)
//      ipc.readable = { [weak self] in self?.pump(ipc) }
//      ipc.write(framedBytes)
//
//  Phase 3 ticket — see docs/HOLEPUNCH_ALIGNMENT_PLAN.md.

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

    #if canImport(BareKit)
    private var worklet: Worklet?
    private var ipc: IPC?
    #endif

    private let ipcAdapter: BareKitIPCAdapter

    private init() {
        let adapter = BareKitIPCAdapter()
        self.ipcAdapter = adapter
        self.rpc = PearRPC(ipc: adapter)
    }

    /// Boot the worklet. Idempotent.
    func boot() async {
        #if canImport(BareKit)
        guard worklet == nil else { return }
        #endif
        await rpc.attach()

        // Wire event listeners BEFORE start() so we don't miss READY.
        let weakSelf = WeakBox(self)
        await rpc.on(Evt.READY) { payload in
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
        await rpc.on(Evt.PEER_COUNT) { payload in
            if let dict = payload as? [String: Any], let n = dict["peerCount"] as? Int {
                Task { @MainActor in weakSelf.value?.peerCount = n }
            }
        }
        await rpc.on(Evt.BOOT_PROGRESS) { payload in
            if let dict = payload as? [String: Any] {
                let stage = dict["stage"] as? String ?? "progress"
                let message = dict["message"] as? String ?? stage
                Task { @MainActor in
                    weakSelf.value?.bootStage = stage
                    weakSelf.value?.bootMessage = message
                }
            }
        }
        await rpc.on(Evt.ERROR) { payload in
            if let dict = payload as? [String: Any], let message = dict["message"] as? String {
                Task { @MainActor in
                    weakSelf.value?.bootMessage = "Error: \(message)"
                    weakSelf.value?.bootStage = "error"
                }
            }
        }

        #if canImport(BareKit)
        let config = Worklet.Configuration(memoryLimit: 64 * 1024 * 1024)
        let wkt = Worklet(configuration: config)

        let storagePath = Self.storageURL().path
        // Load the bare-pack bundle from the app bundle resources.
        // project.yml references ../backend/dist/backend.ios.bundle so
        // the file lands at Bundle.main.path(forResource:"backend.ios", ofType:"bundle").
        wkt.start(name: "backend.ios", ofType: "bundle", arguments: [storagePath])

        let ipc = IPC(worklet: wkt)
        self.worklet = wkt
        self.ipc = ipc
        ipcAdapter.attach(to: ipc)
        bootStage = "waiting-ready"
        bootMessage = "Worklet running, waiting for ready event…"
        #else
        NSLog("[PearWorkletHost] BareKit framework not linked — demo mode. See BUILD.md.")
        bootMessage = "Demo mode — BareKit not linked"
        bootStage = "demo"
        #endif
    }

    func shutdown() {
        #if canImport(BareKit)
        worklet?.terminate()
        worklet = nil
        ipc = nil
        #endif
    }

    // MARK: - Paths

    private static func storageURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("pearbrowser", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

/// Adapter from BareKit's IPC struct to our [WorkletIPC] protocol.
///
/// BareKit's IPC is an AsyncSequence: `for try await data in ipc { ... }`.
/// We run the consumer loop on a background Task and fan bytes out to
/// registered listeners. Writes go through the async `write(data:)` API
/// serialised via our own actor to preserve framing order.
final class BareKitIPCAdapter: WorkletIPC {
    private var listeners: [(Data) -> Void] = []
    private var readTask: Task<Void, Never>?

    #if canImport(BareKit)
    private var ipc: IPC?
    private let writeQueue = WriteSerializer()
    #endif

    func attach(to ipcObject: Any) {
        #if canImport(BareKit)
        guard let ipc = ipcObject as? IPC else { return }
        self.ipc = ipc
        // Consume IPC.read() in a detached Task; deliver bytes to listeners.
        readTask?.cancel()
        readTask = Task.detached { [weak self] in
            do {
                for try await chunk in ipc {
                    guard let self else { return }
                    await self.deliver(chunk)
                    if Task.isCancelled { break }
                }
            } catch {
                NSLog("[BareKitIPCAdapter] read loop ended: \(error)")
            }
        }
        #endif
    }

    private func deliver(_ data: Data) async {
        // Snapshot listeners under `@MainActor` for safety (we mutate them
        // from onData which can be called on any thread)
        await MainActor.run {
            for listener in self.listeners {
                listener(data)
            }
        }
    }

    func write(_ bytes: Data) {
        #if canImport(BareKit)
        guard let ipc else { return }
        Task.detached { [writeQueue] in
            await writeQueue.write(ipc: ipc, data: bytes)
        }
        #else
        _ = bytes
        #endif
    }

    func onData(_ listener: @escaping (Data) -> Void) {
        listeners.append(listener)
    }

    func close() {
        listeners.removeAll()
        readTask?.cancel()
        readTask = nil
        #if canImport(BareKit)
        ipc?.close()
        ipc = nil
        #endif
    }
}

#if canImport(BareKit)
/// Serialises writes to the IPC stream so framed messages stay intact
/// across concurrent RPC callers.
private actor WriteSerializer {
    func write(ipc: IPC, data: Data) async {
        do {
            try await ipc.write(data: data)
        } catch {
            NSLog("[BareKitIPCAdapter] write failed: \(error)")
        }
    }
}
#endif

/// Tiny weak box for closure captures that need access to MainActor state.
private final class WeakBox<T: AnyObject> {
    weak var value: T?
    init(_ value: T) { self.value = value }
}
