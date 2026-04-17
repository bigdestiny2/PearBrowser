//  PearBrowser — PearWorkletHost.swift
//
//  Hosts the Bare worklet that runs the backend (Hyperswarm, Corestore,
//  HyperProxy, sync groups).
//
//  Talks DIRECTLY to the BareKit ObjC API via our local bridging header
//  (Sources/Bridge/BareKitBridge.h imports <BareKit/BareKit.h>). This
//  avoids the bare-kit-swift SPM wrapper which expects a module layout
//  the RN-shipped BareKit.xcframework doesn't provide.
//
//  Phase 3 / Phase 1 — see docs/HOLEPUNCH_ALIGNMENT_PLAN.md.

import Foundation

/// Adapter + lifecycle owner for the Bare worklet.
@MainActor
final class PearWorkletHost: ObservableObject {

    static let shared = PearWorkletHost()

    @Published private(set) var isReady: Bool = false
    @Published private(set) var proxyPort: Int = 0
    @Published private(set) var peerCount: Int = 0
    @Published private(set) var apiToken: String = ""
    @Published private(set) var bootMessage: String = "Starting…"
    @Published private(set) var bootStage: String = "init"
    /// The currently pending login-consent request. MainView observes
    /// this to pop a native sheet. `nil` when no request is pending.
    @Published var pendingLogin: LoginRequest? = nil

    let rpc: PearRPC

    private var worklet: BareWorklet?
    private var ipc: BareIPC?
    private let ipcAdapter: BareKitIPCAdapter

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
            NSLog("[PearWorkletHost] ERROR event: \(payload ?? "nil")")
            if let dict = payload as? [String: Any] {
                let message = (dict["message"] as? String)
                    ?? (dict["error"] as? String)
                    ?? String(describing: dict)
                Task { @MainActor in
                    weakSelf.value?.bootMessage = "Error: \(message)"
                    weakSelf.value?.bootStage = "error"
                }
            }
        }
        await rpc.on(Evt.LOGIN_REQUEST) { payload in
            guard let dict = payload as? [String: Any],
                  let requestId = dict["requestId"] as? String,
                  let driveKey = dict["driveKey"] as? String else { return }
            let request = LoginRequest(
                requestId: requestId,
                driveKey: driveKey,
                appName: (dict["appName"] as? String) ?? "A PearBrowser app",
                reason: (dict["reason"] as? String) ?? "",
                scopes: (dict["scopes"] as? [String]) ?? []
            )
            Task { @MainActor in weakSelf.value?.pendingLogin = request }
        }

        // Resolve the bundle path out of the app's main bundle. The
        // resource name is `backend.ios` and the extension is `bundle`
        // (project.yml sources it from ../backend/dist/).
        guard let bundlePath = Bundle.main.path(forResource: "backend.ios", ofType: "bundle") else {
            NSLog("[PearWorkletHost] backend.ios.bundle missing from app bundle")
            bootMessage = "Bundle missing"
            bootStage = "error"
            return
        }

        let storagePath = Self.storageURL().path

        let config = BareWorkletConfiguration()
        config.memoryLimit = 64 * 1024 * 1024
        let wkt = BareWorklet(configuration: config)
        // Start: `-start:source:arguments:` where source=nil means "read
        // from filename on disk". Pass our storage path as arg[0].
        wkt?.start(bundlePath, source: nil, arguments: [storagePath])

        self.worklet = wkt
        if let wkt = wkt {
            let ipc = BareIPC(worklet: wkt)
            self.ipc = ipc
            if let ipc = ipc {
                ipcAdapter.attach(to: ipc)
                bootStage = "waiting-ready"
                bootMessage = "Worklet running, waiting for ready event…"
            } else {
                bootStage = "error"
                bootMessage = "BareIPC initialisation failed"
            }
        } else {
            bootStage = "error"
            bootMessage = "BareWorklet initialisation failed"
        }
    }

    func shutdown() {
        worklet?.terminate()
        worklet = nil
        ipc = nil
    }

    // MARK: - Paths

    private static func storageURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("pearbrowser", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

/// Adapter from BareIPC's readable-callback API to our [WorkletIPC]
/// protocol. BareIPC exposes:
///   - `readable` property — callback invoked when bytes are available
///   - `-read` — synchronous drain
///   - `-write:` — synchronous write
///
/// We wrap both sides, surfacing each incoming chunk to listeners.
final class BareKitIPCAdapter: WorkletIPC {
    private var listeners: [(Data) -> Void] = []
    private var ipc: BareIPC?

    func attach(to ipc: BareIPC) {
        self.ipc = ipc
        ipc.readable = { [weak self] ipcInstance in
            guard let self else { return }
            while let data = ipcInstance.read(), data.count > 0 {
                for listener in self.listeners { listener(data) }
            }
        }
    }

    func write(_ bytes: Data) {
        ipc?.write(bytes)
    }

    func onData(_ listener: @escaping (Data) -> Void) {
        listeners.append(listener)
    }

    func close() {
        listeners.removeAll()
        ipc?.readable = nil
        ipc?.close()
    }
}

/// Tiny weak box for closure captures that need MainActor state.
private final class WeakBox<T: AnyObject> {
    weak var value: T?
    init(_ value: T) { self.value = value }
}

// MARK: - Login consent request model

struct LoginRequest: Identifiable, Equatable {
    var id: String { requestId }
    let requestId: String
    /// Full hex drive key of the app asking to sign in.
    let driveKey: String
    /// Display name the app asked us to show. Fall back to "A PearBrowser app".
    let appName: String
    /// One-liner the app provided. May be empty.
    let reason: String
    /// Capabilities the app requested.
    let scopes: [String]
}

extension PearWorkletHost {
    /// Send the user's decision back to the worklet. `scopes` can
    /// narrow or match what the app asked for.
    func resolveLogin(_ request: LoginRequest, approved: Bool, scopes: [String]? = nil) async {
        do {
            try await rpc.loginResolve(
                requestId: request.requestId,
                approved: approved,
                scopes: scopes
            )
        } catch {
            NSLog("[PearWorkletHost] loginResolve failed: \(error)")
        }
        if pendingLogin?.requestId == request.requestId {
            pendingLogin = nil
        }
    }
}
