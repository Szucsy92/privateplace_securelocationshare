import Foundation
import Combine

struct RemotePerson: Identifiable, Equatable {
    var id: String { deviceId }
    var deviceId: String, name = "Névtelen", avatar: String? = nil
    var color: String
    var points: [TrackPoint] = [], speed: Double? = nil, acc: Double? = nil, at: Int64? = nil, heading: Double? = nil, battery: Double? = nil
    var since: Int64? = nil, online = true, sharing = false, transport: TransportMode? = nil, measurementAt: Int64? = nil, stoppedSince: Int64? = nil
    init(_ id: String) { deviceId = id; color = colorForDevice(id) }
}

/// A szobák közvetlen kapcsolatai és a beérkező üzenetek feldolgozása (a TS `usePeerNetwork` / Kotlin `PeerManager` portja).
@MainActor
final class PeerManager: ObservableObject {
    @Published var people: [String: RemotePerson] = [:]
    @Published var roomPeers: [String: Int] = [:]
    @Published var roomMembers: [String: [String]] = [:]
    @Published var roster: Rosters
    @Published var avatars: Avatars
    @Published var connectIssues = 0

    private final class Joined: RoomListener {
        let token: String, joinedAt = Date()
        var room: PeerRoom!; var peers = Set<String>()
        weak var owner: PeerManager?
        init(token: String, owner: PeerManager) { self.token = token; self.owner = owner }
        func onPeerJoin(_ id: String) { DispatchQueue.main.async { [self] in owner?.peerJoined(self, id) } }
        func onPeerLeave(_ id: String) { DispatchQueue.main.async { [self] in owner?.peerLeft(self, id) } }
        func onMessage(_ a: String, _ d: Any?, from id: String) { DispatchQueue.main.async { [self] in owner?.handle(self, a, d, id) } }
        func onError(_ m: String) { DispatchQueue.main.async { [self] in owner?.connectIssues += 1 } }
    }
    private let store: Store, transport: PeerTransport
    private var joined: [String: Joined] = [:]
    private var peerDevice: [String: String] = [:], pendingLoc: [String: LocationMessage?] = [:], pendingSet = Set<String>()
    private var roomDevices: [String: Set<String>] = [:], wantHello: [String: Date] = [:], tries: [String: Int] = [:]
    private var rooms: [SavedRoom] = [], deviceId: String?, hello: HelloMessage?, lastLoc: LocationMessage?
    private var avatarOrder: [String] = []
    private var timers: [Timer] = []
    var onRoomClosed: ((String, String) -> Void)?
    var onShareRequest: ((String) -> Void)?

    init(store: Store, transport: PeerTransport) {
        self.store = store; self.transport = transport
        roster = store.loadRosters(); avatars = store.loadAvatars(); avatarOrder = Array(avatars.keys)
        timers.append(Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in Task { @MainActor in self?.heartbeat() } })
        timers.append(Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in Task { @MainActor in self?.reconnectStalled(force: false) } })
    }
    private func heartbeat() {
        guard let l = lastLoc, freshLocation(l, now: nowMs()) != nil else { return }
        for j in joined.values where !j.peers.isEmpty { j.room.send("loc", locationJSON(l), to: nil) }
    }
    private func isKicked(_ token: String, _ dev: String) -> Bool { store.loadControls().contains { $0.kind == "kick" && $0.token == token && $0.target == dev } }
    private func updateRoster(_ f: (Rosters) -> Rosters) {
        let next = f(roster); if next == roster { return }
        roster = next; store.saveRosters(next)
        let ids = Set(next.values.flatMap { $0 }.map { $0.deviceId })
        let kept = avatars.filter { ids.contains($0.key) }
        if kept != avatars { avatars = kept; store.saveAvatars(kept) }
    }
    private func refreshCounts() {
        var counts: [String: Int] = [:], members: [String: [String]] = [:]
        for (t, j) in joined {
            counts[t] = j.peers.count
            var seen = Set<String>(); members[t] = j.peers.compactMap { peerDevice[$0] }.filter { !isKicked(t, $0) && seen.insert($0).inserted }
        }
        roomPeers = counts; roomMembers = members
    }
    private func peerInAnyRoom(_ id: String) -> Bool { joined.values.contains { $0.peers.contains(id) } }

    func sync(rooms newRooms: [SavedRoom], deviceId device: String?, profile: LocalProfile?) {
        rooms = newRooms; deviceId = device
        let old = hello
        hello = (profile != nil && device != nil) ? HelloMessage(deviceId: device!, name: profile!.name, avatar: profile!.avatar) : nil
        guard let h = hello else { for t in Array(joined.keys) { leaveRoom(t, removePeople: true) }; return }
        let wanted = Set(newRooms.map { $0.token })
        for t in Array(joined.keys) where !wanted.contains(t) { leaveRoom(t, removePeople: true) }
        for t in wanted where joined[t] == nil { joinRoom(t) }
        if let o = old, o != h { for j in joined.values { j.room.send("hello", helloJSON(h), to: nil) } }
    }
    private func joinRoom(_ token: String) {
        let j = Joined(token: token, owner: self)
        j.room = transport.join(token: token, listener: j); joined[token] = j; refreshCounts()
    }
    fileprivate func peerJoined(_ j: Joined, _ id: String) {
        guard joined[j.token] === j else { return }
        j.peers.insert(id); tries[j.token] = nil; refreshCounts()
        if let h = hello { j.room.send("hello", helloJSON(h), to: [id]) }
        if case .send(let m) = announcement(lastLoc, now: nowMs()) { j.room.send("loc", locationJSON(m), to: [id]) }
        for c in store.loadControls().filter({ $0.kind == "kick" && $0.token == j.token }).suffix(20) { j.room.send("ctrl", c.json, to: [id]) }
    }
    fileprivate func peerLeft(_ j: Joined, _ id: String) {
        if let dev = peerDevice[id] { updateRoster { touchMember($0, token: j.token, deviceId: dev, now: nowMs()) } }
        j.peers.remove(id); pendingLoc[id] = nil; pendingSet.remove(id); refreshCounts()
        if peerInAnyRoom(id) { return }
        let dev = peerDevice.removeValue(forKey: id); wantHello[id] = nil
        if let d = dev, var p = people[d] { p.online = false; people[d] = p }
    }
    fileprivate func handle(_ j: Joined, _ action: String, _ data: Any?, _ id: String) {
        let token = j.token
        switch action {
        case "hello":
            guard j.peers.contains(id), let h = parseHello(data), h.deviceId != deviceId else { return }
            if isKicked(token, h.deviceId) { j.peers.remove(id); refreshCounts(); return }
            peerDevice[id] = h.deviceId
            updateRoster { upsertMember($0, token: token, deviceId: h.deviceId, name: h.name, now: nowMs(), selfId: deviceId) }
            if roster[token]?.contains(where: { $0.deviceId == h.deviceId }) == true {
                let next = setAvatar(avatars, order: &avatarOrder, deviceId: h.deviceId, avatar: h.avatar)
                if next != avatars { avatars = next; store.saveAvatars(next) }
            }
            roomDevices[token, default: []].insert(h.deviceId)
            var p = people[h.deviceId] ?? RemotePerson(h.deviceId); p.name = h.name; p.avatar = h.avatar; p.online = true; people[h.deviceId] = p
            refreshCounts()
            if h.want, let me = hello { j.room.send("hello", helloJSON(me), to: [id]) }
            if pendingSet.contains(id) { let pend = pendingLoc.removeValue(forKey: id) ?? nil; pendingSet.remove(id); applyLocation(h.deviceId, pend) }
        case "loc":
            guard j.peers.contains(id), case .ok(let msg) = parseLocation(data) else { return }
            guard let dev = peerDevice[id] else {
                pendingLoc[id] = .some(msg); pendingSet.insert(id)
                if let me = hello, Date().timeIntervalSince(wantHello[id] ?? .distantPast) > 4 { wantHello[id] = Date(); var h = me; h.want = true; j.room.send("hello", helloJSON(h), to: [id]) }
                return
            }
            applyLocation(dev, msg)
        case "ctrl":
            guard let c = parseRoomControl(data), c.token == token, let saved = rooms.first(where: { $0.token == token }), let ok = saved.ownerKey, verifyRoomControl(c, ownerKey: ok) else { return }
            if c.kind == "close" { updateRoster { dropRoster($0, token: token) }; onRoomClosed?(token, "closed") }
            else if c.target == deviceId { store.rememberControl(c); updateRoster { dropRoster($0, token: token) }; onRoomClosed?(token, "kicked") }
            else if let t = c.target { store.rememberControl(c); dropDevice(token, t) }
        case "ask":
            if j.peers.contains(id), parseShareRequest(data), let d = peerDevice[id] { onShareRequest?(d) }
        default: break
        }
    }
    private func applyLocation(_ dev: String, _ m: LocationMessage?) {
        var p = people[dev] ?? RemotePerson(dev)
        guard let m = m else { p.sharing = false; p.online = true; p.points = []; p.at = nil; p.heading = nil; p.since = nil; p.measurementAt = nil; people[dev] = p; return }
        let now = nowMs()
        if let ma = p.measurementAt, m.t < ma { return }
        if !acceptMeasurement(p.measurementAt, m) { p.online = true; p.heading = m.heading ?? p.heading; p.battery = m.battery ?? p.battery; p.transport = m.transport ?? p.transport; p.stoppedSince = m.stoppedSince ?? p.stoppedSince; people[dev] = p; return }
        let age = max(0, now - m.t)
        p.sharing = true; p.online = true
        p.points = appendTrackPoint(p.points, TrackPoint(lat: m.lat, lng: m.lng, t: now - age), now: now)
        p.speed = m.speed; p.acc = m.acc; p.at = now - age; p.measurementAt = m.t; p.heading = m.heading; p.battery = m.battery ?? p.battery
        p.since = m.since != nil ? now - (m.t - m.since!) : (p.since ?? now); p.transport = m.transport ?? p.transport; p.stoppedSince = m.stoppedSince
        people[dev] = p
    }
    private func dropDevice(_ token: String, _ dev: String) {
        updateRoster { removeMember($0, token: token, deviceId: dev) }
        guard let j = joined[token] else { return }
        roomDevices[token]?.remove(dev)
        for pid in Array(j.peers) where peerDevice[pid] == dev { j.peers.remove(pid) }
        if !peerDevice.contains(where: { $0.value == dev && peerInAnyRoom($0.key) }) { people.removeValue(forKey: dev) }
        refreshCounts()
    }
    private func leaveRoom(_ token: String, removePeople: Bool) {
        guard let j = joined.removeValue(forKey: token) else { return }
        j.room.leave()
        var devs = roomDevices.removeValue(forKey: token) ?? []
        for pid in j.peers { if let d = peerDevice[pid] { devs.insert(d) } }
        let still: (String) -> Bool = { d in self.roomDevices.values.contains { $0.contains(d) } || self.peerDevice.contains { $0.value == d && self.peerInAnyRoom($0.key) } }
        for pid in j.peers where !peerInAnyRoom(pid) { peerDevice[pid] = nil; pendingLoc[pid] = nil; pendingSet.remove(pid); wantHello[pid] = nil }
        for d in devs where !still(d) { if removePeople { people.removeValue(forKey: d) } else if var p = people[d] { p.online = false; people[d] = p } }
        refreshCounts()
    }
    private func reconnectStalled(force: Bool) {
        let now = Date()
        for (token, j) in joined {
            if !j.peers.isEmpty { tries[token] = nil; continue }
            let t = tries[token] ?? 0
            let wait = force ? 8.0 : min(30.0 * Double(1 << t), 180)
            if now.timeIntervalSince(j.joinedAt) < wait { continue }
            tries[token] = t + 1; leaveRoom(token, removePeople: false); joinRoom(token)
        }
    }
    func wake() {
        let a = announcement(lastLoc, now: nowMs())
        for j in joined.values {
            if let h = hello { j.room.send("hello", helloJSON(h), to: nil) }
            if case .send(let m) = a { j.room.send("loc", locationJSON(m), to: nil) }
        }
        reconnectStalled(force: true)
    }
    func sendLocation(_ m: LocationMessage?) {
        lastLoc = m
        for j in joined.values where !j.peers.isEmpty { j.room.send("loc", locationJSON(m), to: nil) }
        if m == nil { for s in [1.5, 5.0] { DispatchQueue.main.asyncAfter(deadline: .now() + s) { [weak self] in
            guard let self = self, self.lastLoc == nil else { return }
            for j in self.joined.values where !j.peers.isEmpty { j.room.send("loc", NSNull(), to: nil) } } } }
    }
    var hasViewers: Bool { joined.values.contains { !$0.peers.isEmpty } }
    func sendControl(_ c: RoomControl) {
        if c.kind == "kick" && c.target == deviceId { return }
        if let j = joined[c.token], !j.peers.isEmpty { j.room.send("ctrl", c.json, to: nil) }
        if c.kind == "kick", let t = c.target { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.store.rememberControl(c); self?.dropDevice(c.token, t) } }
    }
    func forgetRoom(_ token: String) { updateRoster { dropRoster($0, token: token) } }
    func forgetMember(_ token: String, _ dev: String) { updateRoster { removeMember($0, token: token, deviceId: dev) } }
    func requestShare(_ dev: String) -> Bool {
        var sent = false
        for j in joined.values { let t = Set(j.peers.filter { peerDevice[$0] == dev }); if t.isEmpty { continue }; j.room.send("ask", true, to: t); sent = true }
        return sent
    }
    func clearTrail(_ dev: String) { if var p = people[dev], let l = p.points.last { p.points = [l]; people[dev] = p } }
}
