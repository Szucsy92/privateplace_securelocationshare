import Foundation
import Security

struct LocalProfile: Codable, Equatable { var name: String; var avatar: String? }
struct Prefs: Codable, Equatable {
    var sharing = false, showTrails = false
    var trailIds: [String] = []
    var orientation = "north", mapTheme = "dark", addressConsent = "ask"
    var hint = 0          // súgóbuborékok: következő lépés (>= összes → kész)
    init() {}
    // Új mezők hozzáadásakor a régi mentés ne vesszen el
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        sharing = try c.decodeIfPresent(Bool.self, forKey: .sharing) ?? false
        showTrails = try c.decodeIfPresent(Bool.self, forKey: .showTrails) ?? false
        trailIds = try c.decodeIfPresent([String].self, forKey: .trailIds) ?? []
        orientation = try c.decodeIfPresent(String.self, forKey: .orientation) ?? "north"
        mapTheme = try c.decodeIfPresent(String.self, forKey: .mapTheme) ?? "dark"
        addressConsent = try c.decodeIfPresent(String.self, forKey: .addressConsent) ?? "ask"
        hint = try c.decodeIfPresent(Int.self, forKey: .hint) ?? 0
    }
}

/// Helyi tárolás: UserDefaults (JSON) + Keychain a gazda privát kulcsának. Nincs fiók, nincs központi tárolás.
final class Store {
    private let d = UserDefaults.standard
    private func load<T: Decodable>(_ k: String, _ t: T.Type) -> T? { d.data(forKey: k).flatMap { try? JSONDecoder().decode(t, from: $0) } }
    private func save<T: Encodable>(_ k: String, _ v: T) { if let data = try? JSONEncoder().encode(v) { d.set(data, forKey: k) } }

    func loadProfile() -> LocalProfile? { load("profile", LocalProfile.self).flatMap { $0.name.isEmpty ? nil : $0 } }
    func saveProfile(_ p: LocalProfile) { save("profile", p) }
    func deviceId() -> String {
        if let c = d.string(forKey: "device"), isDeviceId(c) { return c }
        var b = [UInt8](repeating: 0, count: 16); _ = SecRandomCopyBytes(kSecRandomDefault, 16, &b)
        let id = b.map { String(format: "%02x", $0) }.joined(); d.set(id, forKey: "device"); return id
    }
    func loadPrefs() -> Prefs { load("prefs", Prefs.self) ?? Prefs() }
    func savePrefs(_ p: Prefs) { save("prefs", p) }

    private struct RoomDTO: Codable { var token: String; var name: String; var owner: Bool; var createdAt: Int64; var color: String; var ownerKey: String? }
    func loadRooms() -> [SavedRoom] {
        (load("rooms", [RoomDTO].self) ?? []).filter { $0.token.count == ROOM_TOKEN_LENGTH }.map {
            SavedRoom(token: $0.token, name: $0.name, owner: $0.owner, createdAt: $0.createdAt, color: isRoomColor($0.color) ? $0.color : DEFAULT_ROOM_COLOR,
                      ownerKey: $0.ownerKey, ownerPrivateKey: $0.owner ? Keychain.get("owner.\($0.token)") : nil) }
    }
    func saveRooms(_ r: [SavedRoom]) {
        save("rooms", r.map { RoomDTO(token: $0.token, name: $0.name, owner: $0.owner, createdAt: $0.createdAt, color: $0.color, ownerKey: $0.ownerKey) })
        for room in r { if let k = room.ownerPrivateKey { Keychain.set("owner.\(room.token)", k) } }
    }
    func deleteOwnerKey(_ token: String) { Keychain.delete("owner.\(token)") }

    private struct RosterDTO: Codable { var deviceId: String; var name: String; var firstSeen: Int64; var lastSeen: Int64 }
    func loadRosters() -> Rosters {
        (load("rosters", [String: [RosterDTO]].self) ?? [:]).mapValues { $0.filter { isDeviceId($0.deviceId) }.map { RosterEntry(deviceId: $0.deviceId, name: $0.name, firstSeen: $0.firstSeen, lastSeen: $0.lastSeen) } }
    }
    func saveRosters(_ r: Rosters) { save("rosters", r.mapValues { $0.map { RosterDTO(deviceId: $0.deviceId, name: $0.name, firstSeen: $0.firstSeen, lastSeen: $0.lastSeen) } }) }
    func loadAvatars() -> Avatars { load("avatars", Avatars.self) ?? [:] }
    func saveAvatars(_ a: Avatars) { save("avatars", a) }
    func loadPersonColors() -> [String: String] { (load("personColors", [String: String].self) ?? [:]).filter { isPersonColor($0.value) } }
    func savePersonColors(_ c: [String: String]) { save("personColors", c) }
    func loadPlaces() -> [Place] { Array((load("places", [Place].self) ?? []).prefix(50)) }
    func savePlaces(_ p: [Place]) { save("places", p) }

    private struct ControlDTO: Codable { var kind: String; var token: String; var target: String?; var at: Int64; var nonce: String; var signature: String }
    func loadControls() -> [RoomControl] { (load("controls", [ControlDTO].self) ?? []).map { RoomControl(kind: $0.kind, token: $0.token, target: $0.target, at: $0.at, nonce: $0.nonce, signature: $0.signature) } }
    func rememberControl(_ c: RoomControl) {
        var cur = loadControls(); if cur.contains(where: { $0.nonce == c.nonce }) { return }
        cur.append(c); save("controls", cur.suffix(500).map { ControlDTO(kind: $0.kind, token: $0.token, target: $0.target, at: $0.at, nonce: $0.nonce, signature: $0.signature) })
    }
}

enum Keychain {
    private static func query(_ k: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "hu.privateplace.app", kSecAttrAccount as String: k] }
    static func set(_ k: String, _ v: String) {
        var q = query(k); SecItemDelete(q as CFDictionary)
        q[kSecValueData as String] = Data(v.utf8); q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
    static func get(_ k: String) -> String? {
        var q = query(k); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?; guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
    static func delete(_ k: String) { SecItemDelete(query(k) as CFDictionary) }
}

/// Cím lekérése – csak beleegyezés után (a koordináta az OSM Nominatimnak megy).
struct AddressInfo { var title: String; var near: String? }
func lookupAddress(lat: Double, lng: Double) async throws -> AddressInfo {
    var c = URLComponents(string: "https://nominatim.openstreetmap.org/reverse")!
    c.queryItems = [("format", "jsonv2"), ("lat", "\(lat)"), ("lon", "\(lng)"), ("zoom", "18"), ("accept-language", "hu"), ("addressdetails", "1"), ("extratags", "1")].map { URLQueryItem(name: $0.0, value: $0.1) }
    var req = URLRequest(url: c.url!); req.setValue("PrivatePlace-Native/1.0", forHTTPHeaderField: "User-Agent"); req.timeoutInterval = 8
    let (data, _) = try await URLSession.shared.data(for: req)
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any], let a = root["address"] as? [String: Any] else { throw URLError(.badServerResponse) }
    func s(_ o: [String: Any]?, _ k: String) -> String? { (o?[k] as? String)?.trimmingCharacters(in: .whitespaces).nilIfEmpty }
    let kind = root["type"] as? String ?? ""
    let motorway = kind == "motorway" || kind == "motorway_link"
    let major = motorway || kind == "trunk" || kind == "trunk_link" || kind == "primary"
    let ref = s(root["extratags"] as? [String: Any], "ref")?.split(separator: ";").first.map { String($0).trimmingCharacters(in: .whitespaces) }
    let road = s(a, "road") ?? s(a, "pedestrian") ?? s(a, "footway") ?? s(a, "neighbourhood") ?? s(root, "name") ?? s(a, "village")
    var title = road
    if major, let r = ref { title = motorway ? ((road?.localizedCaseInsensitiveContains("autópálya") ?? false) ? road : "\(r) autópálya") : (r.allSatisfy(\.isNumber) ? "\(r). sz. főút" : r) }
    guard var t = title else { throw URLError(.cannotParseResponse) }
    if t.count <= 5 && t.allSatisfy(\.isNumber) { t += ". sz. út" }
    if let n = s(a, "house_number"), !major { t += " \(n)" }
    let place = s(a, "city") ?? s(a, "town") ?? s(a, "village") ?? s(a, "hamlet") ?? s(a, "municipality") ?? s(a, "suburb") ?? s(a, "county")
    return AddressInfo(title: t, near: (place != nil && !t.contains(place!)) ? "\(place!) közelében" : nil)
}
extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }
