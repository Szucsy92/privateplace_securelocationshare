import Foundation

struct RosterEntry: Equatable { var deviceId: String; var name: String; var firstSeen: Int64; var lastSeen: Int64 }
typealias Rosters = [String: [RosterEntry]]
typealias Avatars = [String: String]
let MAX_ROSTER_PER_ROOM = 200, MAX_AVATAR_STORE_CHARS = 1_000_000

func upsertMember(_ r: Rosters, token: String, deviceId: String, name: String, now: Int64, selfId: String?) -> Rosters {
    if deviceId == selfId || !isDeviceId(deviceId) { return r }
    var list = r[token] ?? []
    if let i = list.firstIndex(where: { $0.deviceId == deviceId }) {
        if list[i].name == name && now - list[i].lastSeen < 1000 { return r }
        list[i].name = name; list[i].lastSeen = max(list[i].lastSeen, now)
    } else { list.append(RosterEntry(deviceId: deviceId, name: name, firstSeen: now, lastSeen: now)); list = Array(list.suffix(MAX_ROSTER_PER_ROOM)) }
    var out = r; out[token] = list; return out
}
func touchMember(_ r: Rosters, token: String, deviceId: String, now: Int64) -> Rosters {
    guard var list = r[token], let i = list.firstIndex(where: { $0.deviceId == deviceId }) else { return r }
    list[i].lastSeen = max(list[i].lastSeen, now); var out = r; out[token] = list; return out
}
func removeMember(_ r: Rosters, token: String, deviceId: String) -> Rosters {
    guard let list = r[token], list.contains(where: { $0.deviceId == deviceId }) else { return r }
    var out = r; out[token] = list.filter { $0.deviceId != deviceId }; return out
}
func dropRoster(_ r: Rosters, token: String) -> Rosters { var o = r; o.removeValue(forKey: token); return o }
/// Az avatárok sorrendje a frissesség (külön `order` lista), túl nagy tárolónál a legrégebbiek törlődnek.
func setAvatar(_ a: Avatars, order: inout [String], deviceId: String, avatar: String?) -> Avatars {
    var m = a
    order.removeAll { $0 == deviceId }
    guard let av = avatar else { m.removeValue(forKey: deviceId); return m }
    m[deviceId] = av; order.append(deviceId)
    var total = m.values.reduce(0) { $0 + $1.count }
    for id in order where total > MAX_AVATAR_STORE_CHARS && id != deviceId { total -= m[id]?.count ?? 0; m.removeValue(forKey: id) }
    order = order.filter { m[$0] != nil }
    return m
}

// Saját helyek
struct Bias: Codable, Equatable { var e: Double; var n: Double }
struct Spot: Codable, Equatable, Identifiable { var id: String; var label: String; var lat: Double; var lng: Double; var bias: Bias? = nil; var learnedAt: Int64? = nil; var samples = 0 }
struct Place: Codable, Equatable, Identifiable { var id: String; var name: String; var icon = ""; var note = ""; var radius = DEFAULT_RADIUS; var spots: [Spot] = []; var createdAt: Int64 }
struct FixLite { var lat: Double; var lng: Double; var acc: Double? }
let MIN_RADIUS = 5.0, MAX_RADIUS = 100.0, DEFAULT_RADIUS = 20.0
private let MAX_BIAS_M = 60.0, LEARN_MIN_FIXES = 8, LEARN_MAX_SPREAD_M = 3.0, LEARN_MAX_ACC_M = 15.0, M_PER_DEG = 111320.0

func newId() -> String { String(Int64(Date().timeIntervalSince1970 * 1000), radix: 36) + String(Int.random(in: 0..<1_000_000), radix: 36) }
func offsetPoint(_ p: LatLng, e: Double, n: Double) -> LatLng { LatLng(lat: p.lat + n / M_PER_DEG, lng: p.lng + e / (M_PER_DEG * max(0.01, cos(p.lat * .pi / 180)))) }
func localVector(_ a: LatLng, _ b: LatLng) -> Bias { Bias(e: (b.lng - a.lng) * M_PER_DEG * cos(a.lat * .pi / 180), n: (b.lat - a.lat) * M_PER_DEG) }
func medianPoint(_ pts: [LatLng]) -> LatLng? {
    if pts.isEmpty { return nil }
    func med(_ v: [Double]) -> Double { let s = v.sorted(); let m = s.count / 2; return s.count % 2 == 1 ? s[m] : (s[m - 1] + s[m]) / 2 }
    return LatLng(lat: med(pts.map { $0.lat }), lng: med(pts.map { $0.lng }))
}
func newPlace(_ name: String) -> Place { let n = String(name.trimmingCharacters(in: .whitespaces).prefix(60)); return Place(id: newId(), name: n.isEmpty ? "Új hely" : n, createdAt: nowMs()) }
func newSpot(_ at: LatLng, label: String = "") -> Spot { Spot(id: newId(), label: label, lat: at.lat, lng: at.lng) }
func nudgeSpot(_ s: Spot, de: Double, dn: Double) -> Spot { let p = offsetPoint(LatLng(lat: s.lat, lng: s.lng), e: de, n: dn); var o = s; o.lat = p.lat; o.lng = p.lng; o.bias = nil; o.learnedAt = nil; o.samples = 0; return o }
enum LearnResult { case ok(Spot), fail(String) }
func learnBias(_ s: Spot, recent: [FixLite], now: Int64 = nowMs()) -> LearnResult {
    let good = recent.filter { $0.acc == nil || $0.acc! <= LEARN_MAX_ACC_M }
    if good.count < LEARN_MIN_FIXES { return .fail(recent.count < LEARN_MIN_FIXES ? "kevés fix" : "pontatlan") }
    let c = medianPoint(good.map { LatLng(lat: $0.lat, lng: $0.lng) })!
    let spread = (good.reduce(0) { $0 + pow(distanceMeters(LatLng(lat: $1.lat, lng: $1.lng), c), 2) } / Double(good.count)).squareRoot()
    if spread > LEARN_MAX_SPREAD_M { return .fail("mozgás") }
    let bias = localVector(LatLng(lat: s.lat, lng: s.lng), c)
    if (bias.e * bias.e + bias.n * bias.n).squareRoot() > MAX_BIAS_M { return .fail("nagy eltérés") }
    var o = s; o.bias = bias; o.learnedAt = now; o.samples = good.count; return .ok(o)
}
struct AppliedPlace { var point: LatLng; var placeId: String?; var shiftM: Double }
func applyPlaces(_ places: [Place], _ p: LatLng) -> AppliedPlace {
    var best: (w: Double, spot: Spot, id: String)?
    for pl in places { for s in pl.spots { guard let b = s.bias else { continue }
        let expected = offsetPoint(LatLng(lat: s.lat, lng: s.lng), e: b.e, n: b.n)
        let w = 1 - distanceMeters(p, expected) / pl.radius
        if w > 0 && (best == nil || w > best!.w) { best = (w, s, pl.id) } } }
    guard let b = best, let bias = b.spot.bias else { return AppliedPlace(point: p, placeId: nil, shiftM: 0) }
    return AppliedPlace(point: offsetPoint(p, e: -bias.e * b.w, n: -bias.n * b.w), placeId: b.id, shiftM: (bias.e * bias.e + bias.n * bias.n).squareRoot() * b.w)
}
func describeVector(_ a: LatLng, _ b: LatLng) -> String {
    let d = distanceMeters(a, b); if d < 0.5 { return "egyezik" }
    let dirs = ["É", "ÉK", "K", "DK", "D", "DNy", "Ny", "ÉNy"]
    let br = bearingDegrees(a, b); let i = Int((((br.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360) / 45).rounded()) % 8
    return String(format: "%.1f", d).replacingOccurrences(of: ".", with: ",") + " m " + dirs[i]
}

// Személyszínek
let SELF_COLOR_KEY = "self"
let PERSON_COLOR_OPTIONS: [(value: String, name: String)] = SELECTION_COLORS.map { ($0.hex, $0.name) } + [("#FB923C", "Mandarin"), ("#A3E635", "Lime"), ("#F472B6", "Rózsaszín"), ("#E2E8F0", "Gyöngyház")]
func isPersonColor(_ v: String?) -> Bool { v != nil && PERSON_COLOR_OPTIONS.contains { $0.value.caseInsensitiveCompare(v!) == .orderedSame } }
func setPersonColor(_ c: [String: String], id: String, color: String?) -> [String: String] {
    guard id == SELF_COLOR_KEY || isDeviceId(id) else { return c }
    var o = c
    if let col = color { guard isPersonColor(col) else { return c }; o[id] = col } else { o.removeValue(forKey: id) }
    return o
}
