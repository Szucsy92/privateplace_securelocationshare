import Foundation

struct HelloMessage: Equatable { var deviceId: String; var name: String; var avatar: String?; var want = false }
struct LocationMessage: Equatable {
    var lat: Double, lng: Double, t: Int64, acc: Double?, speed: Double?
    var heading: Double? = nil, battery: Double? = nil, since: Int64? = nil, stoppedSince: Int64? = nil, transport: TransportMode? = nil
}
enum ParsedLoc { case invalid, ok(LocationMessage?) }

private let deviceRe = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{8,64}$")
private let avatarRe = try! NSRegularExpression(pattern: "^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")
private let token20Re = try! NSRegularExpression(pattern: "^[A-HJ-NP-Z2-9]{20}$")
private let sigRe = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{80,100}$")
private func matches(_ re: NSRegularExpression, _ s: String) -> Bool { re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil }
func isDeviceId(_ s: String) -> Bool { matches(deviceRe, s) }

private func num(_ o: [String: Any], _ k: String) -> Double? {
    if o[k] is Bool { return nil }
    guard let n = o[k] as? NSNumber else { return nil }
    let d = n.doubleValue; return d.isFinite ? d : nil
}

func parseHello(_ d: Any?) -> HelloMessage? {
    guard let o = d as? [String: Any], let id = o["deviceId"] as? String, isDeviceId(id) else { return nil }
    let name = String(((o["name"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
    var avatar: String? = nil
    if let a = o["avatar"] as? String, a.count <= 80_000, matches(avatarRe, a) { avatar = a }
    return HelloMessage(deviceId: id, name: name.isEmpty ? "Névtelen" : name, avatar: avatar, want: (o["want"] as? Bool) == true)
}

func parseLocation(_ d: Any?, now: Int64 = nowMs()) -> ParsedLoc {
    if d == nil || d is NSNull { return .ok(nil) }
    guard let o = d as? [String: Any], let lat = num(o, "lat"), let lng = num(o, "lng"), let tD = num(o, "t") else { return .invalid }
    let t = Int64(tD)
    if t < 0 || t > now + 5 * 60_000 || lat < -90 || lat > 90 || lng < -180 || lng > 180 { return .invalid }
    func pos(_ k: String) -> Double? { num(o, k).flatMap { $0 >= 0 ? $0 : nil } }
    let heading = pos("heading").flatMap { $0 < 360 ? $0 : nil }
    let battery = num(o, "battery").flatMap { (0...100).contains($0) ? $0 : nil }
    func ts(_ k: String) -> Int64? { num(o, k).map { Int64($0) }.flatMap { $0 >= 0 && $0 <= t ? $0 : nil } }
    return .ok(LocationMessage(lat: lat, lng: lng, t: t, acc: pos("acc"), speed: pos("speed"), heading: heading, battery: battery,
                               since: ts("since"), stoppedSince: ts("stoppedSince"), transport: (o["transport"] as? String).flatMap(TransportMode.init(rawValue:))))
}

func locationJSON(_ m: LocationMessage?) -> Any {
    guard let m = m else { return NSNull() }
    var o: [String: Any] = ["lat": m.lat, "lng": m.lng, "t": m.t]
    o["acc"] = m.acc ?? NSNull(); o["speed"] = m.speed ?? NSNull(); o["heading"] = m.heading ?? NSNull(); o["battery"] = m.battery ?? NSNull()
    o["since"] = m.since ?? NSNull(); o["stoppedSince"] = m.stoppedSince ?? NSNull()
    if let t = m.transport { o["transport"] = t.rawValue }
    return o
}
func helloJSON(_ h: HelloMessage) -> [String: Any] {
    var o: [String: Any] = ["deviceId": h.deviceId, "name": h.name, "avatar": h.avatar ?? NSNull()]
    if h.want { o["want"] = true }
    return o
}
func parseShareRequest(_ d: Any?) -> Bool { (d as? Bool) == true }

struct RoomControl: Equatable {
    var kind: String, token: String, target: String?, at: Int64, nonce: String, signature: String
    var json: [String: Any] { ["kind": kind, "token": token, "target": target ?? NSNull(), "at": at, "nonce": nonce, "signature": signature] }
}
func parseRoomControl(_ d: Any?, now: Int64 = nowMs()) -> RoomControl? {
    guard let o = d as? [String: Any], let kind = o["kind"] as? String, kind == "close" || kind == "kick",
          let token = o["token"] as? String, matches(token20Re, token) else { return nil }
    var target: String? = nil
    let raw = o["target"]
    if kind == "close" { if raw != nil && !(raw is NSNull) { return nil } }
    else { guard let t = raw as? String, isDeviceId(t) else { return nil }; target = t }
    guard let atD = num(o, "at"), atD >= 0, Int64(atD) <= now + 60000, let nonce = o["nonce"] as? String, isDeviceId(nonce),
          let sig = o["signature"] as? String, matches(sigRe, sig) else { return nil }
    return RoomControl(kind: kind, token: token, target: target, at: Int64(atD), nonce: nonce, signature: sig)
}

let SELECTION_COLORS: [(key: String, hex: String, name: String)] = [
    ("mint", "#14B8A6", "Menta Zöld"), ("violet", "#818CF8", "Elektromos Levendula"), ("rose", "#FB7185", "Selyem Barack"),
    ("amber", "#FBBF24", "Napfény Citromsárga"), ("sky", "#38BDF8", "Jégkék")]
let SELF_COLOR = "#14B8A6"
func colorForDevice(_ id: String) -> String {
    var h: UInt32 = 0
    for u in id.unicodeScalars { h = h &* 31 &+ UInt32(u.value) }
    return SELECTION_COLORS[Int(h) % SELECTION_COLORS.count].hex
}
