import Foundation
import WebRTC

struct TurnConfig { var urls: [String]; var username: String?; var credential: String? }

/// Közvetlen telefon–telefon kapcsolat: WebRTC adatcsatorna, jelzés Nostr-reléken. A kisebb azonosítójú fél ajánlatot tesz.
final class WebRtcTransport: PeerTransport {
    private let relays: [String], turn: TurnConfig?
    fileprivate static let factory = RTCPeerConnectionFactory()
    init(relays: [String], turn: TurnConfig?) { self.relays = relays; self.turn = turn }
    func join(token: String, listener: RoomListener) -> PeerRoom { WebRtcRoom(token: token, relays: relays, turn: turn, listener: listener) }
}

private final class Link: NSObject, RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    let peerId: String, startedAt = Date()
    var pc: RTCPeerConnection!, channel: RTCDataChannel?, open = false, sent = false
    weak var room: WebRtcRoom?
    init(peerId: String, room: WebRtcRoom) { self.peerId = peerId; self.room = room }
    func attach(_ dc: RTCDataChannel) { channel = dc; dc.delegate = self }
    // RTCPeerConnectionDelegate
    func peerConnection(_ p: RTCPeerConnection, didChange s: RTCSignalingState) {}
    func peerConnection(_ p: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ p: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ p: RTCPeerConnection) {}
    func peerConnection(_ p: RTCPeerConnection, didChange s: RTCIceConnectionState) {
        if s == .failed || s == .closed || s == .disconnected { DispatchQueue.main.async { self.room?.drop(self.peerId, notify: true) } }
    }
    func peerConnection(_ p: RTCPeerConnection, didChange s: RTCIceGatheringState) { if s == .complete { DispatchQueue.main.async { self.room?.sendLocalDescription(self) } } }
    func peerConnection(_ p: RTCPeerConnection, didGenerate c: RTCIceCandidate) {}
    func peerConnection(_ p: RTCPeerConnection, didRemove c: [RTCIceCandidate]) {}
    func peerConnection(_ p: RTCPeerConnection, didOpen dc: RTCDataChannel) { attach(dc) }
    // RTCDataChannelDelegate
    func dataChannelDidChangeState(_ dc: RTCDataChannel) {
        DispatchQueue.main.async {
            if dc.readyState == .open { self.room?.opened(self) } else if dc.readyState == .closed { self.room?.drop(self.peerId, notify: true) }
        }
    }
    func dataChannel(_ dc: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        let data = buffer.data
        DispatchQueue.main.async {
            if let o = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) as? [String: Any], let a = o["a"] as? String { self.room?.listener?.onMessage(a, o["d"], from: self.peerId) }
        }
    }
}

private final class WebRtcRoom: PeerRoom {
    weak var listener: RoomListener?
    private let selfId = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24).lowercased()
    private var links: [String: Link] = [:]
    private var signaling: NostrSignaling?
    private var left = false
    private var timer: Timer?
    private let turn: TurnConfig?
    var openPeers: Set<String> { Set(links.values.filter { $0.open }.map { $0.peerId }) }

    init(token: String, relays: [String], turn: TurnConfig?, listener: RoomListener) {
        self.listener = listener; self.turn = turn
        signaling = NostrSignaling(relays: relays, crypto: RoomCrypto(token: token)) { [weak self] s in self?.onSignal(s) }
        if signaling == nil { listener.onError("signaling") }
        signaling?.start()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.tick() }
    }
    private func tick() {
        if left { return }
        signaling?.publish(["t": "hi", "from": String(selfId)])
        for l in links.values where !l.open && Date().timeIntervalSince(l.startedAt) > 25 { drop(l.peerId, notify: false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + (links.values.contains { $0.open } ? 12 : 4)) { [weak self] in self?.tick() }
    }
    private func config() -> RTCConfiguration {
        let c = RTCConfiguration(); c.sdpSemantics = .unifiedPlan
        var servers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]), RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])]
        if let t = turn, !t.urls.isEmpty { servers.append(RTCIceServer(urlStrings: t.urls, username: t.username ?? "", credential: t.credential ?? "")) }
        c.iceServers = servers; return c
    }
    private func newLink(_ peerId: String) -> Link? {
        let link = Link(peerId: peerId, room: self)
        guard let pc = WebRtcTransport.factory.peerConnection(with: config(), constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: link) else { return nil }
        link.pc = pc; links[peerId] = link
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self, weak link] in if let l = link { self?.sendLocalDescription(l) } }   // időkorlát: eddigi jelöltekkel küldjük
        return link
    }
    fileprivate func sendLocalDescription(_ l: Link) {
        if left || links[l.peerId] !== l || l.sent { return }
        guard let d = l.pc.localDescription else { return }
        l.sent = true
        signaling?.publish(["t": d.type == .offer ? "offer" : "answer", "from": String(selfId), "to": l.peerId, "sdp": d.sdp])
    }
    fileprivate func opened(_ l: Link) { if !l.open && links[l.peerId] === l { l.open = true; listener?.onPeerJoin(l.peerId) } }
    fileprivate func drop(_ peerId: String, notify: Bool) {
        guard let l = links.removeValue(forKey: peerId) else { return }
        l.channel?.close(); l.pc.close()
        if notify && l.open { listener?.onPeerLeave(peerId) }
    }
    private func onSignal(_ s: [String: Any]) {
        if left { return }
        guard let from = s["from"] as? String, !from.isEmpty, from != String(selfId) else { return }
        let to = s["to"] as? String ?? ""
        if !to.isEmpty && to != String(selfId) { return }
        switch s["t"] as? String {
        case "hi": if links[from] == nil && String(selfId) < from { startOffer(from) }
        case "offer": if to == String(selfId), let sdp = s["sdp"] as? String { acceptOffer(from, sdp) }
        case "answer": if to == String(selfId), let sdp = s["sdp"] as? String { links[from]?.pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { _ in } }
        default: break
        }
    }
    private func startOffer(_ peerId: String) {
        guard let l = newLink(peerId), let dc = l.pc.dataChannel(forLabel: "pp", configuration: RTCDataChannelConfiguration()) else { listener?.onError("offer"); return }
        l.attach(dc)
        l.pc.offer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { sdp, _ in
            guard let sdp = sdp else { return }
            l.pc.setLocalDescription(sdp) { _ in }
        }
    }
    private func acceptOffer(_ peerId: String, _ sdp: String) {
        if let ex = links[peerId] { if ex.open { return }; drop(peerId, notify: false) }
        guard let l = newLink(peerId) else { listener?.onError("answer"); return }
        l.pc.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp)) { err in
            if err != nil { return }
            l.pc.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { a, _ in
                guard let a = a else { return }
                l.pc.setLocalDescription(a) { _ in }
            }
        }
    }
    func send(_ action: String, _ data: Any?, to targets: Set<String>?) {
        let bytes = frame(action, data)
        for l in links.values where l.open && (targets == nil || targets!.contains(l.peerId)) { _ = l.channel?.sendData(RTCDataBuffer(data: bytes, isBinary: false)) }
    }
    func leave() { left = true; signaling?.close(); for id in Array(links.keys) { drop(id, notify: false) } }
}
