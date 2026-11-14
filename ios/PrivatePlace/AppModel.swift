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
    @Published var toasts: [ToastMsg] = []
    @Published var shareRequest: String?
    func toast(_ kind: String, _ text: String, description: String? = nil, action: (String, () -> Void)? = nil, ms: Double = 4) {
        let t = ToastMsg(kind: kind, text: text, description: description, action: action, ms: ms)
        toasts.append(t); DispatchQueue.main.asyncAfter(deadline: .now() + ms) { [weak self] in self?.toasts.removeAll { $0.id == t.id } }
    }
    var permissionsAsked: Bool { get { UserDefaults.standard.bool(forKey: "permAsked") } set { UserDefaults.standard.set(newValue, forKey: "permAsked") } }
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
        peers.onShareRequest = { [weak self] dev in self?.shareRequest = dev; self?.notifyAsk(dev) }
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

    /// A webes createRoom: „Szobám” / „Szobám N” néven jön létre, utána a megosztás ablak nyílik.
    @discardableResult func createRoom() -> SavedRoom {
        let a = createRoomAuthority(); let owned = rooms.filter { $0.owner }.count
        let r = SavedRoom(token: generateRoomToken(), name: owned > 0 ? "Szobám \(owned + 1)" : "Szobám", owner: true, createdAt: nowMs(), color: DEFAULT_ROOM_COLOR, ownerKey: a.ownerKey, ownerPrivateKey: a.ownerPrivateKey)
        setRooms(rooms + [r]); return r
    }
    /// A webes joinRoom pontos szabályaival és szövegeivel.
    func joinRoom(token: String, name: String?, color: String?, ownerKey: String?) {
        let existing = rooms.first { $0.token == token }
        if existing?.owner == true { toast("info", "Ez a te szobád: ugyanarról az eszközről nem veheted fel magad tagként."); return }
        if store.loadControls().contains(where: { $0.kind == "kick" && $0.token == token && $0.target == deviceId }) { toast("error", "Ebből a szobából a létrehozó eltávolított, ezért nem csatlakozhatsz újra."); return }
        if let ex = existing {
            if ex.ownerKey == nil, let k = ownerKey { setRooms(rooms.map { $0.token == token && $0.ownerKey == nil ? { var x = $0; x.ownerKey = k; return x }() : $0 }); toast("success", "A gazda kulcsa hozzáadva: a szoba törlése és az eltávolítások mostantól hozzád is megérkeznek.") }
            else { toast("info", "Ebben a szobában már benne vagy.") }
            return
        }
        setRooms(rooms + [SavedRoom(token: token, name: (name?.isEmpty == false ? name! : "Meghívott szoba"), owner: false, createdAt: nowMs(), color: isRoomColor(color) ? color! : DEFAULT_ROOM_COLOR, ownerKey: ownerKey)])
        toast("success", "Csatlakoztál. Amint a többiek is online vannak, látjátok egymást.")
    }
    func customizeRoom(_ token: String, name: String, color: String) {
        let n = String(name.trimmingCharacters(in: .whitespaces).prefix(40)); guard !n.isEmpty, isRoomColor(color) else { return }
        setRooms(rooms.map { $0.token == token ? { var x = $0; x.name = n; x.color = color; return x }() : $0 })
    }
    func deleteOrLeave(_ token: String) {
        guard let r = rooms.first(where: { $0.token == token }) else { return }
        if r.owner, let k = r.ownerKey, let c = signRoomControl(token: token, auth: RoomAuthority(ownerKey: k, ownerPrivateKey: r.ownerPrivateKey), kind: "close", target: nil) { peers.sendControl(c) }
        peers.forgetRoom(token); store.deleteOwnerKey(token); setRooms(rooms.filter { $0.token != token })
        toast("success", r.owner ? (r.ownerPrivateKey != nil ? "A szoba törölve." : "A régi szobát eltávolítottam erről a készülékről.") : "Kiléptél a szobából.")
    }
    func kick(_ token: String, _ dev: String) {
        guard dev != deviceId, let r = rooms.first(where: { $0.token == token }), r.owner, let k = r.ownerKey,
              let c = signRoomControl(token: token, auth: RoomAuthority(ownerKey: k, ownerPrivateKey: r.ownerPrivateKey), kind: "kick", target: dev) else { return }
        peers.sendControl(c)
    }
    private func roomGone(_ token: String, _ why: String) {
        let room = rooms.first { $0.token == token }
        store.deleteOwnerKey(token); setRooms(rooms.filter { $0.token != token })
        if let r = room, !r.owner { toast("info", why == "kicked" ? "A létrehozó eltávolított a(z) „\(r.name)” szobából." : "A(z) „\(r.name)” szobát a létrehozója törölte.") }
    }
    func handleURL(_ url: URL) { if let inv = parseRoomInput(url.absoluteString) { invite = inv } }
    private func notifyAsk(_ dev: String) {
        let c = UNMutableNotificationContent(); c.title = "Megosztást kér"; c.body = "\(peers.people[dev]?.name ?? "Valaki") szeretné látni a helyzetedet"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "ask-\(dev)", content: c, trigger: nil))
    }
    func requestNotifications() { UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in } }
}
