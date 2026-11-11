import Foundation
import CryptoKit
import P256K

protocol RoomListener: AnyObject {
    func onPeerJoin(_ peerId: String)
    func onPeerLeave(_ peerId: String)
    /// action: "hello" | "loc" | "ctrl" | "ask"; data: JSON érték (NSNull / Bool / [String: Any])
    func onMessage(_ action: String, _ data: Any?, from peerId: String)
    func onError(_ message: String)
}
protocol PeerRoom: AnyObject {
    var openPeers: Set<String> { get }
    func send(_ action: String, _ data: Any?, to: Set<String>?)
    func leave()
}
protocol PeerTransport { func join(token: String, listener: RoomListener) -> PeerRoom }

func frame(_ action: String, _ data: Any?) -> Data {
    (try? JSONSerialization.data(withJSONObject: ["a": action, "d": data ?? NSNull()], options: [.fragmentsAllowed])) ?? Data()
}

/// A szobakulcs egyben a jelzések titkosító jelszava; a relék csak titkosított tartalmat és témahasht látnak (az Android-oldallal azonos).
final class RoomCrypto {
    let topic: String
    private let key: SymmetricKey
    init(token: String) {
        topic = SHA256.hash(data: Data("privateplace/v1/topic/\(token)".utf8)).map { String(format: "%02x", $0) }.joined()
        key = SymmetricKey(data: SHA256.hash(data: Data("privateplace/v1/key/\(token)".utf8)))
    }
    func encrypt(_ plain: String) -> String? { (try? AES.GCM.seal(Data(plain.utf8), using: key))?.combined.map { b64url($0) } }  // nonce(12)‖ciphertext‖tag
    func decrypt(_ b64: String) -> String? {
        guard let raw = unb64url(b64), let box = try? AES.GCM.SealedBox(combined: raw), let p = try? AES.GCM.open(box, using: key) else { return nil }
        return String(data: p, encoding: .utf8)
    }
}

/// Jelzés nyilvános Nostr-reléken (29333-as ephemeral események, BIP-340 aláírás).
final class NostrSignaling {
    static let kind = 29333
    private let relays: [URL], crypto: RoomCrypto
    private let onSignal: ([String: Any]) -> Void
    private let priv: P256K.Schnorr.PrivateKey
    private let pk: String
    private var sockets: [URL: URLSessionWebSocketTask] = [:], open = Set<URL>(), seen = Set<String>()
    private var closed = false
    private let subId: String
    private let session = URLSession(configuration: .default)

    init?(relays: [String], crypto: RoomCrypto, onSignal: @escaping ([String: Any]) -> Void) {
        guard let k = try? P256K.Schnorr.PrivateKey() else { return nil }
        priv = k; pk = Data(k.xonly.bytes).hex
        self.relays = relays.compactMap(URL.init(string:)); self.crypto = crypto; self.onSignal = onSignal
        subId = "pp" + String(pk.prefix(10))
    }
    func start() { relays.forEach { connect($0, attempt: 0) } }
    private func connect(_ url: URL, attempt: Int) {
        if closed { return }
        let t = session.webSocketTask(with: url); sockets[url] = t; t.resume()
        let since = Int(Date().timeIntervalSince1970) - 30
        let req: [Any] = ["REQ", subId, ["kinds": [Self.kind], "#x": [crypto.topic], "since": since] as [String: Any]]
        if let d = try? JSONSerialization.data(withJSONObject: req), let s = String(data: d, encoding: .utf8) { t.send(.string(s)) { _ in } }
        listen(url, t, attempt)
    }
    private func listen(_ url: URL, _ t: URLSessionWebSocketTask, _ attempt: Int) {
        t.receive { [weak self] result in
            guard let self = self, !self.closed else { return }
            switch result {
            case .failure:
                DispatchQueue.main.async { self.open.remove(url) }
                DispatchQueue.main.asyncAfter(deadline: .now() + min(30, Double(2 << min(attempt, 4)))) { self.connect(url, attempt: attempt + 1) }
            case .success(let msg):
                DispatchQueue.main.async { self.open.insert(url) }
                if case .string(let text) = msg, let a = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [Any], a.count >= 3, a[0] as? String == "EVENT",
                   let ev = a[2] as? [String: Any], let id = ev["id"] as? String, ev["pubkey"] as? String != self.pk, let content = ev["content"] as? String {
                    DispatchQueue.main.async {
                        if !self.seen.insert(id).inserted { return }
                        if self.seen.count > 2000 { self.seen.removeAll() }
                        if let plain = self.crypto.decrypt(content), let o = (try? JSONSerialization.jsonObject(with: Data(plain.utf8))) as? [String: Any] { self.onSignal(o) }
                    }
                }
                self.listen(url, t, attempt)
            }
        }
    }
    func publish(_ signal: [String: Any]) {
        guard let sd = try? JSONSerialization.data(withJSONObject: signal), let content = crypto.encrypt(String(data: sd, encoding: .utf8) ?? "") else { return }
        let createdAt = Int(Date().timeIntervalSince1970)
        let tags: [[String]] = [["x", crypto.topic]]
        let arr: [Any] = [0, pk, createdAt, Self.kind, tags, content]
        guard let ser = try? JSONSerialization.data(withJSONObject: arr, options: [.withoutEscapingSlashes]) else { return }
        let digest = SHA256.hash(data: ser)
        guard let sig = try? priv.signature(for: digest) else { return }
        let ev: [String: Any] = ["id": digest.map { String(format: "%02x", $0) }.joined(), "pubkey": pk, "created_at": createdAt, "kind": Self.kind,
                                 "tags": tags, "content": content, "sig": Data(sig.dataRepresentation).hex]
        guard let d = try? JSONSerialization.data(withJSONObject: ["EVENT", ev], options: [.withoutEscapingSlashes]), let s = String(data: d, encoding: .utf8) else { return }
        for u in open { sockets[u]?.send(.string(s)) { _ in } }
    }
    func close() { closed = true; sockets.values.forEach { $0.cancel(with: .normalClosure, reason: nil) }; sockets = [:]; open = [] }
}
extension Data { var hex: String { map { String(format: "%02x", $0) }.joined() } }
