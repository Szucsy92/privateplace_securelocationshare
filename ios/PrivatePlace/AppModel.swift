import Foundation
import Combine
import UserNotifications

/// Az alkalmazás szintjén élő állapot (megfelelője az Android `AppGraph`-nak).
@MainActor
final class AppModel: ObservableObject {
    static let relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"]
    let store = Store()
    let deviceId: String
    @Published var rooms: [SavedRoom]
    @Published var profile: LocalProfile?
    @Published var prefs: Prefs
    @Published var personColors: [String: String]
    @Published var places: [Place]
    @Published var invite: Invitation?
    @Published var closedMessage: String?
    let peers: PeerManager
    let engine: SharingEngine
    private var bag = Set<AnyCancellable>()

    init() {
        deviceId = store.deviceId(); rooms = store.loadRooms(); profile = store.loadProfile(); prefs = store.loadPrefs()
        personColors = store.loadPersonColors(); places = store.loadPlaces()
        let turn = (Bundle.main.object(forInfoDictionaryKey: "TURN_URLS") as? String).flatMap { $0.isEmpty ? nil : TurnConfig(urls: $0.split(separator: ",").map(String.init), username: Bundle.main.object(forInfoDictionaryKey: "TURN_USERNAME") as? String, credential: Bundle.main.object(forInfoDictionaryKey: "TURN_CREDENTIAL") as? String) }
        peers = PeerManager(store: store, transport: WebRtcTransport(relays: Self.relays, turn: turn))
        engine = SharingEngine(store: store, peers: peers)
        peers.onRoomClosed = { [weak self] t, why in self?.roomGone(t, why) }
        peers.onShareRequest = { [weak self] dev in self?.notifyAsk(dev) }
        peers.sync(rooms: rooms, deviceId: deviceId, profile: profile)
        engine.setPlaces(places)
        // A beágyazott objektumok változása a nézetekhez is eljusson
        peers.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        engine.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        if prefs.sharing { engine.setSharing(true) }
    }
    private func resync() { peers.sync(rooms: rooms, deviceId: deviceId, profile: profile) }
    private func setRooms(_ r: [SavedRoom]) { rooms = r; store.saveRooms(r); resync() }
    func saveProfile(_ p: LocalProfile) { profile = p; store.saveProfile(p); resync() }
    func updatePrefs(_ f: (inout Prefs) -> Void) { f(&prefs); store.savePrefs(prefs) }
    func setPersonColor(_ id: String, _ c: String?) { personColors = PrivatePlace.setPersonColor(personColors, id: id, color: c); store.savePersonColors(personColors) }
    func savePlaces(_ p: [Place]) { places = p; store.savePlaces(p); engine.setPlaces(p) }

    @discardableResult func createRoom(name: String, color: String) -> SavedRoom {
        let a = createRoomAuthority()
        let n = String(name.trimmingCharacters(in: .whitespaces).prefix(40))
        let r = SavedRoom(token: generateRoomToken(), name: n.isEmpty ? "Szoba" : n, owner: true, createdAt: nowMs(), color: color, ownerKey: a.ownerKey, ownerPrivateKey: a.ownerPrivateKey)
        setRooms(rooms + [r]); return r
    }
    func joinRoom(_ inv: Invitation) {
        if rooms.contains(where: { $0.token == inv.token }) { return }
        setRooms(rooms + [SavedRoom(token: inv.token, name: inv.name ?? "Szoba", owner: false, createdAt: nowMs(), color: inv.color ?? DEFAULT_ROOM_COLOR, ownerKey: inv.ownerKey)])
    }
    func customizeRoom(_ token: String, name: String, color: String) {
        let n = String(name.trimmingCharacters(in: .whitespaces).prefix(40)); guard !n.isEmpty, isRoomColor(color) else { return }
        setRooms(rooms.map { $0.token == token ? { var x = $0; x.name = n; x.color = color; return x }() : $0 })
    }
    func deleteOrLeave(_ token: String) {
        guard let r = rooms.first(where: { $0.token == token }) else { return }
        if r.owner, let k = r.ownerKey, let c = signRoomControl(token: token, auth: RoomAuthority(ownerKey: k, ownerPrivateKey: r.ownerPrivateKey), kind: "close", target: nil) { peers.sendControl(c) }
        peers.forgetRoom(token); store.deleteOwnerKey(token); setRooms(rooms.filter { $0.token != token })
    }
    func kick(_ token: String, _ dev: String) {
        guard let r = rooms.first(where: { $0.token == token }), r.owner, let k = r.ownerKey,
              let c = signRoomControl(token: token, auth: RoomAuthority(ownerKey: k, ownerPrivateKey: r.ownerPrivateKey), kind: "kick", target: dev) else { return }
        peers.sendControl(c)
    }
    private func roomGone(_ token: String, _ why: String) {
        store.deleteOwnerKey(token); setRooms(rooms.filter { $0.token != token })
        closedMessage = why == "kicked" ? "A gazda eltávolított a szobából." : "A gazda törölte a szobát."
    }
    func handleURL(_ url: URL) { if let inv = parseRoomInput(url.absoluteString) { invite = inv } }
    private func notifyAsk(_ dev: String) {
        let c = UNMutableNotificationContent(); c.title = "Megosztást kér"; c.body = "\(peers.people[dev]?.name ?? "Valaki") szeretné látni a helyzetedet"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "ask-\(dev)", content: c, trigger: nil))
    }
    func requestNotifications() { UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in } }
}
