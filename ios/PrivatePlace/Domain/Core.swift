import Foundation

struct LatLng: Equatable, Codable { var lat: Double; var lng: Double }
func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

func bearingDegrees(_ a: LatLng, _ b: LatLng) -> Double {
    let f1 = a.lat * .pi / 180, f2 = b.lat * .pi / 180, dl = (b.lng - a.lng) * .pi / 180
    let y = sin(dl) * cos(f2), x = cos(f1) * sin(f2) - sin(f1) * cos(f2) * cos(dl)
    return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
}
func distanceMeters(_ a: LatLng, _ b: LatLng) -> Double {
    let r = 6371000.0, dLat = (b.lat - a.lat) * .pi / 180, dLng = (b.lng - a.lng) * .pi / 180
    let s = pow(sin(dLat / 2), 2) + cos(a.lat * .pi / 180) * cos(b.lat * .pi / 180) * pow(sin(dLng / 2), 2)
    return 2 * r * asin(min(1, s.squareRoot()))
}
func angleDelta(_ from: Double, _ to: Double) -> Double { ((((to - from).truncatingRemainder(dividingBy: 360)) + 540).truncatingRemainder(dividingBy: 360)) - 180 }
func smoothAngle(_ cur: Double, _ target: Double, _ k: Double) -> Double { cur + angleDelta(cur, target) * min(1, max(0, k)) }

// Közlekedési mód
enum TransportMode: String, Codable, CaseIterable { case walk, bike, car }
struct TransportState { var mode: TransportMode; var candidate: TransportMode?; var candidateAt: Int64 }
let TRANSPORT_HOLD_MS: Int64 = 7000
func updateTransport(_ p: TransportState, speed: Double?, now: Int64, manual: TransportMode? = nil) -> TransportState {
    if let m = manual { return TransportState(mode: m, candidate: nil, candidateAt: now) }
    guard let s = speed, s.isFinite, s >= 0.8 else { return TransportState(mode: p.mode, candidate: nil, candidateAt: now) }
    let kmh = s * 3.6
    let target: TransportMode = kmh >= 28 ? .car : (kmh >= 14 ? .bike : .walk)
    if target == p.mode { return TransportState(mode: p.mode, candidate: nil, candidateAt: now) }
    if target != p.candidate { return TransportState(mode: p.mode, candidate: target, candidateAt: now) }
    if now - p.candidateAt >= TRANSPORT_HOLD_MS { return TransportState(mode: target, candidate: nil, candidateAt: now) }
    return p
}

// Irány
enum HeadingSource { case gps, compass }
struct HeadingState { var source: HeadingSource; var angle: Double? }
func hybridHeading(_ p: HeadingState, speed: Double?, gps: Double?, compass: Double?) -> HeadingState {
    var source = p.source
    if let s = speed { if s > 1.4 { source = .gps } else if s < 0.8 { source = .compass } }
    let target = source == .gps ? gps : compass
    guard let t = target, t.isFinite else { return HeadingState(source: source, angle: p.angle) }
    let angle = p.angle == nil ? t : smoothAngle(p.angle!, t, 0.2)
    return HeadingState(source: source, angle: (angle.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360))
}

// Energia
let ACTIVE_GPS_MS: Int64 = 1000, STILL_GPS_MS: Int64 = 3000, IDLE_GPS_MS: Int64 = 5000, CALM_AFTER_MS: Int64 = 60_000
let MOVING_SPEED = 0.55
struct PowerContext { var visible: Bool, sharing: Bool, viewers: Bool, calm: Bool }
func desiredGpsIntervalMs(_ c: PowerContext) -> Int64 {
    if c.visible { return ACTIVE_GPS_MS }
    if !(c.sharing && c.viewers) { return IDLE_GPS_MS }
    return c.calm ? STILL_GPS_MS : ACTIVE_GPS_MS
}
func movementWake(lat: Double, lng: Double, speed: Double?, acc: Double?, anchor: LatLng?) -> Bool {
    if let s = speed, s.isFinite, s >= MOVING_SPEED, acc == nil || acc! <= 30 { return true }
    guard let a = anchor else { return false }
    let radius = min(40, max(10, acc ?? 10))
    return distanceMeters(a, LatLng(lat: lat, lng: lng)) > radius * 1.5
}

// Frissesség
let LOCATION_FRESH_MS: Int64 = 15000
func freshLocation(_ m: LocationMessage?, now: Int64) -> LocationMessage? { (m != nil && now - m!.t <= LOCATION_FRESH_MS && m!.t <= now + 60000) ? m : nil }
enum Announcement { case absent, send(LocationMessage?) }
func announcement(_ latest: LocationMessage?, now: Int64) -> Announcement {
    guard let l = latest else { return .send(nil) }
    guard let f = freshLocation(l, now: now) else { return .absent }
    return .send(f)
}
func acceptMeasurement(_ previous: Int64?, _ m: LocationMessage) -> Bool { previous == nil || m.t > previous! }

// Nyomvonal
struct TrackPoint: Equatable { var lat: Double; var lng: Double; var t: Int64 }
let TRAIL_WINDOW_MS: Int64 = 30 * 60 * 1000, TRAIL_MAX_POINTS = 600
let PUBLISH_INTERVAL_MS: Int64 = 1000, HIDDEN_PUBLISH_INTERVAL_MS: Int64 = 2000, STILL_PUBLISH_INTERVAL_MS: Int64 = 4000
func publishIntervalMs(visible: Bool, still: Bool) -> Int64 { still ? STILL_PUBLISH_INTERVAL_MS : (visible ? PUBLISH_INTERVAL_MS : HIDDEN_PUBLISH_INTERVAL_MS) }
func shouldPublishLocation(sharing: Bool, now: Int64, lastSent: Int64, intervalMs: Int64) -> Bool { sharing && now - lastSent >= intervalMs }
func appendTrackPoint(_ pts: [TrackPoint], _ p: TrackPoint, now: Int64) -> [TrackPoint] {
    var next = pts
    if let l = pts.last {
        if p.t < l.t { } else if l.lat == p.lat && l.lng == p.lng { next[next.count - 1] = p } else { next.append(p) }
    } else { next.append(p) }
    let cutoff = now - TRAIL_WINDOW_MS
    var out = next.enumerated().filter { $0.element.t >= cutoff || $0.offset == next.count - 1 }.map { $0.element }
    if out.count > TRAIL_MAX_POINTS { out = Array(out.suffix(TRAIL_MAX_POINTS)) }
    return out
}

// Járás-jelzés (gyorsulásmérő)
func looksLikeWalking(_ mags: [Double], hz: Double) -> Bool {
    if Double(mags.count) < hz { return false }
    let mean = mags.reduce(0, +) / Double(mags.count)
    let dev = mags.map { $0 - mean }
    let rms = (dev.reduce(0) { $0 + $1 * $1 } / Double(dev.count)).squareRoot()
    var cross = 0
    for i in 1..<max(1, dev.count) where (dev[i - 1] < 0) != (dev[i] < 0) { cross += 1 }
    let perSec = Double(cross) / (Double(mags.count) / hz)
    return rms >= 0.65 && perSec >= 2.4 && perSec <= 5.5
}
final class WalkingDetector {
    private var samples: [(Int64, Double)] = []
    private var walking = false, lastPositive: Int64 = 0, positives = 0, lastEval: Int64 = 0
    private let onChange: (Bool) -> Void
    init(onChange: @escaping (Bool) -> Void) { self.onChange = onChange }
    private func set(_ v: Bool) { if v != walking { walking = v; onChange(v) } }
    func onSample(_ now: Int64, _ x: Double, _ y: Double, _ z: Double) {
        samples.append((now, (x * x + y * y + z * z).squareRoot()))
        samples.removeAll { now - $0.0 > 2000 }
        if now - lastEval < 500 || samples.count < 20 { return }
        lastEval = now
        let hz = Double(samples.count) / max(0.5, Double(samples.last!.0 - samples.first!.0) / 1000)
        if looksLikeWalking(samples.map { $0.1 }, hz: hz) { positives += 1; lastPositive = now } else { positives = 0 }
        if positives >= 2 { set(true) } else if now - lastPositive > 3000 { set(false) }
    }
}
