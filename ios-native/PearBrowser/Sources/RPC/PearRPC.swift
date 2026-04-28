//  PearBrowser — PearRPC.swift
//
//  Actor-based IPC client for the Bare worklet.
//
//  Wire format (must match backend/rpc.js, app/lib/rpc.ts, PearRpc.kt):
//     [8-char ASCII-hex length][JSON payload]
//
//       Request  : { id: int, cmd: int, data: any }
//       Response : { id: int, result?: any, error?: string }
//       Event    : { event: int, data: any }
//
//  NB: `result` field (not `ok`), `event` field name (not `evt`) —
//  matches backend/rpc.js _send() exactly.
//
//  Phase 3 ticket 2 — see docs/HOLEPUNCH_ALIGNMENT_PLAN.md.

import Foundation

/// Abstraction over the bare-kit Worklet.IPC so we can test the protocol
/// layer without a live worklet. `PearWorkletHost` provides the real one.
protocol WorkletIPC: AnyObject {
    func write(_ bytes: Data)
    func onData(_ listener: @escaping (Data) -> Void)
    func close()
}

/// Errors surfaced from the worklet side of the RPC bridge.
struct RPCError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// The IPC client. Actor-based so concurrent requests from SwiftUI views
/// are serialised onto a single mailbox — matches the kotlinx.coroutines
/// + Mutex pattern used in the Kotlin shell.
actor PearRPC {
    private let ipc: WorkletIPC
    private var nextId: Int = 1
    private var pending: [Int: CheckedContinuation<Any?, Error>] = [:]
    private var listeners: [Int: [(Any?) -> Void]] = [:]
    private var buffer = Data()

    init(ipc: WorkletIPC) {
        self.ipc = ipc
    }

    /// Start listening for worklet data. Call once immediately after init.
    func attach() {
        ipc.onData { [weak self] chunk in
            guard let self else { return }
            Task { await self.handleIncoming(chunk) }
        }
    }

    func close() {
        for (_, cont) in pending {
            cont.resume(throwing: CancellationError())
        }
        pending.removeAll()
        listeners.removeAll()
        ipc.close()
    }

    // MARK: - Public request API

    /// Fire an RPC request and await the result. `data` can be any
    /// JSON-encodable type (NSDictionary-style).
    func request(_ cmd: Int, data: Any? = nil, timeoutMs: Int = 30_000) async throws -> Any? {
        let id = nextId
        nextId += 1

        let payload: [String: Any] = [
            "id": id,
            "cmd": cmd,
            "data": data as Any? ?? NSNull(),
        ]
        let frame = try encodeFrame(payload)

        return try await withThrowingTaskGroup(of: Any?.self) { group in
            group.addTask { [weak self] in
                try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Any?, Error>) in
                    Task { [weak self] in
                        await self?.storePending(id: id, cont: cont)
                        await self?.sendBytes(frame)
                    }
                }
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000)
                throw RPCError(message: "RPC timeout after \(timeoutMs)ms (cmd=\(cmd))")
            }
            defer { group.cancelAll() }
            // Return the first resolved task.
            guard let first = try await group.next() else {
                throw RPCError(message: "RPC group empty")
            }
            return first
        }
    }

    /// Actor-scoped helper so task-group closures don't access `self.ipc`
    /// across isolation (Swift 6 strict-concurrency friendly).
    private func sendBytes(_ frame: Data) {
        ipc.write(frame)
    }

    /// Register an event listener. Returns a handle that unsubscribes.
    @discardableResult
    func on(_ event: Int, listener: @escaping (Any?) -> Void) -> () -> Void {
        listeners[event, default: []].append(listener)
        let index = (listeners[event]?.count ?? 1) - 1
        return { [weak self] in
            Task { await self?.removeListener(event: event, index: index) }
        }
    }

    private func removeListener(event: Int, index: Int) {
        guard var list = listeners[event], index < list.count else { return }
        list.remove(at: index)
        listeners[event] = list
    }

    private func storePending(id: Int, cont: CheckedContinuation<Any?, Error>) {
        pending[id] = cont
    }

    // MARK: - Typed convenience wrappers (mirror the TS + Kotlin surfaces)

    func getStatus() async throws -> [String: Any] {
        try (await request(Cmd.GET_STATUS) as? [String: Any]) ?? [:]
    }

    func navigate(url: String) async throws -> [String: Any] {
        try (await request(Cmd.NAVIGATE, data: ["url": url], timeoutMs: 60_000) as? [String: Any]) ?? [:]
    }

    func loadCatalog(keyHex: String) async throws -> [String: Any] {
        try (await request(Cmd.LOAD_CATALOG, data: ["keyHex": keyHex], timeoutMs: 60_000) as? [String: Any]) ?? [:]
    }

    func loadCatalogBee(keyHex: String) async throws -> [String: Any] {
        try (await request(Cmd.LOAD_CATALOG_BEE, data: ["keyHex": keyHex], timeoutMs: 60_000) as? [String: Any]) ?? [:]
    }

    func listBookmarks() async throws -> [[String: Any]] {
        let res = try await request(Cmd.USERDATA_LIST_BOOKMARKS) as? [String: Any]
        return (res?["bookmarks"] as? [[String: Any]]) ?? []
    }

    func addBookmark(url: String, title: String) async throws {
        _ = try await request(Cmd.USERDATA_ADD_BOOKMARK, data: ["url": url, "title": title])
    }

    func removeBookmark(url: String) async throws {
        _ = try await request(Cmd.USERDATA_REMOVE_BOOKMARK, data: ["url": url])
    }

    func listHistory(limit: Int? = nil) async throws -> [[String: Any]] {
        var data: [String: Any] = [:]
        if let limit { data["limit"] = limit }
        let res = try await request(Cmd.USERDATA_LIST_HISTORY, data: data) as? [String: Any]
        return (res?["history"] as? [[String: Any]]) ?? []
    }

    func addHistory(url: String, title: String) async throws {
        _ = try await request(Cmd.USERDATA_ADD_HISTORY, data: ["url": url, "title": title])
    }

    func clearHistory() async throws {
        _ = try await request(Cmd.USERDATA_CLEAR_HISTORY)
    }

    func getRelays() async throws -> [String: Any] {
        try (await request(Cmd.GET_RELAYS) as? [String: Any]) ?? [:]
    }

    func setRelays(_ relays: [String]) async throws -> [String: Any] {
        try (await request(Cmd.SET_RELAYS, data: ["relays": relays]) as? [String: Any]) ?? [:]
    }

    func setRelayEnabled(_ enabled: Bool) async throws -> [String: Any] {
        try (await request(Cmd.SET_RELAY_ENABLED, data: ["enabled": enabled]) as? [String: Any]) ?? [:]
    }

    func exportPhrase() async throws -> String {
        let res = try await request(Cmd.IDENTITY_EXPORT_PHRASE) as? [String: Any]
        return (res?["mnemonic"] as? String) ?? ""
    }

    func importPhrase(_ mnemonic: String) async throws -> [String: Any] {
        try (await request(Cmd.IDENTITY_IMPORT_PHRASE, data: ["mnemonic": mnemonic]) as? [String: Any]) ?? [:]
    }

    func validatePhrase(_ mnemonic: String) async throws -> Bool {
        let res = try await request(Cmd.IDENTITY_VALIDATE_PHRASE, data: ["mnemonic": mnemonic]) as? [String: Any]
        return (res?["valid"] as? Bool) ?? false
    }

    func getIdentity() async throws -> [String: Any] {
        try (await request(Cmd.GET_IDENTITY) as? [String: Any]) ?? [:]
    }

    // MARK: - Profile + grants (Identity Plan Phases B + C + F)

    func profileGet() async throws -> [String: String] {
        let resp = try await request(Cmd.PROFILE_GET) as? [String: Any]
        return (resp?["profile"] as? [String: String]) ?? [:]
    }

    func profileUpdate(_ updates: [String: String]) async throws -> [String: String] {
        let resp = try await request(Cmd.PROFILE_UPDATE, data: ["updates": updates]) as? [String: Any]
        return (resp?["profile"] as? [String: String]) ?? [:]
    }

    func profileClear() async throws {
        _ = try await request(Cmd.PROFILE_CLEAR)
    }

    func loginListGrants() async throws -> [[String: Any]] {
        let resp = try await request(Cmd.LOGIN_LIST_GRANTS) as? [String: Any]
        return (resp?["grants"] as? [[String: Any]]) ?? []
    }

    func loginRevokeGrant(driveKeyHex: String) async throws {
        _ = try await request(Cmd.LOGIN_REVOKE_GRANT, data: ["driveKeyHex": driveKeyHex])
    }

    func loginRevokeAll() async throws -> Int {
        let resp = try await request(Cmd.LOGIN_REVOKE_ALL) as? [String: Any]
        return (resp?["revoked"] as? Int) ?? 0
    }

    /// Answer a pending consent sheet. Fired from the UI after the user
    /// decides. `scopes` may narrow what the page asked for; leave
    /// `approved` false to deny.
    func loginResolve(requestId: String, approved: Bool, scopes: [String]? = nil, ttlMs: Int? = nil) async throws {
        var data: [String: Any] = ["requestId": requestId, "approved": approved]
        if let scopes { data["scopes"] = scopes }
        if let ttlMs { data["ttlMs"] = ttlMs }
        _ = try await request(Cmd.LOGIN_RESOLVE, data: data)
    }

    // MARK: - Per-origin session token (HTTPS bridge, Phase E follow-up)

    /// Mint a session token + pseudo-driveKey for an HTTPS origin so the
    /// shell can inject `window.pear.*` into pages on that origin and
    /// have the bridge accept their requests.
    ///
    /// `origin` should be `scheme://host[:port]` — anything else gets
    /// canonicalised by the worklet.
    func pearSession(origin: String) async throws -> (token: String, driveKey: String, origin: String, port: Int) {
        let resp = try await request(Cmd.PEAR_SESSION, data: ["origin": origin]) as? [String: Any]
        guard
            let token = resp?["token"] as? String,
            let driveKey = resp?["driveKey"] as? String,
            let canonical = resp?["origin"] as? String
        else {
            throw RPCError(message: "pearSession: malformed response")
        }
        let port = (resp?["port"] as? Int) ?? 0
        return (token, driveKey, canonical, port)
    }

    // MARK: - Framing
    //
    // Wire format matches backend/rpc.js _send():
    //     [8-char ASCII hex length][JSON body bytes]
    //   e.g. "0000002a{\"event\":100,...}" for a 42-byte body.
    //
    // The backend is UTF-8 / string-oriented: it concats the hex length
    // with the JSON and calls ipc.write(Buffer.from(string)). So our
    // Swift encode emits hex-as-ASCII too, and decode parses it as ASCII.

    private func encodeFrame(_ payload: [String: Any]) throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed])
        let hex = String(body.count, radix: 16).padLeft(to: 8, with: "0")
        var frame = Data()
        frame.append(hex.data(using: .ascii)!)
        frame.append(body)
        return frame
    }

    private func handleIncoming(_ chunk: Data) {
        buffer.append(chunk)
        while buffer.count >= 8 {
            // First 8 ASCII hex chars = body length
            let lenBytes = buffer.prefix(8)
            guard let lenHex = String(data: lenBytes, encoding: .ascii),
                  let length = Int(lenHex, radix: 16) else {
                NSLog("[PearRPC] Bad frame: length prefix not hex, resetting buffer")
                buffer.removeAll()
                return
            }
            guard length > 0, length <= 10_000_000 else {
                NSLog("[PearRPC] Bad frame length \(length); resetting buffer")
                buffer.removeAll()
                return
            }
            guard buffer.count >= 8 + length else { return }
            let payload = buffer[8..<(8 + length)]
            buffer.removeSubrange(0..<(8 + length))
            handleMessage(Data(payload))
        }
    }

    private func handleMessage(_ payload: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: payload, options: [.fragmentsAllowed]) as? [String: Any] else {
            let preview = String(data: payload.prefix(200), encoding: .utf8) ?? "<binary>"
            NSLog("[PearRPC] invalid JSON from worklet (\(payload.count) bytes): \(preview)")
            return
        }
        // Event: { event: <id>, data: <any> }
        if let evtId = json["event"] as? Int {
            let data = json["data"]
            listeners[evtId]?.forEach { $0(data) }
            return
        }
        // Response: { id, result } (success) or { id, error } (failure)
        guard let id = json["id"] as? Int, let cont = pending.removeValue(forKey: id) else { return }
        if let errorMsg = json["error"] as? String {
            cont.resume(throwing: RPCError(message: errorMsg))
        } else {
            cont.resume(returning: json["result"])
        }
    }
}

private extension String {
    func padLeft(to width: Int, with pad: Character) -> String {
        if count >= width { return self }
        return String(repeating: pad, count: width - count) + self
    }
}
