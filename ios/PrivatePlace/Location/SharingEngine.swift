import Foundation
import Combine
import CoreLocation
import UserNotifications

struct SelfState: Equatable {
    var point: LatLng?, rawPoint: LatLng?, acc: Double?, speed: Double?, heading: Double?, at: Int64?
    var still = false, stoppedSince: Int64?
    var transport = TransportMode.walk, manualTransport: TransportMode?
    var sharing = false, sharingSince: Int64?, battery: Int?
    var tracking = false, error: String?, gpsIntervalMs = ACTIVE_GPS_MS, placeShiftM = 0.0
}

/// Nyers fix → drift-szűrő → saját helyek korrekciója → megjelenítés és (megosztásnál) küldés. Az alkalmazás szintjén él.
@MainActor
final class SharingEngine: ObservableObject {
    @Published private(set) var state = SelfState()
    @Published private(set) var authStatus: CLAuthorizationStatus
    @Published private(set) var accuracyAuth: CLAccuracyAuthorization
    private(set) var recentFixes: [FixLite] = []
    private let store: Store, location = LocationService()
    private weak var peers: PeerManager?
    private var filter = DriftFilter()
    private var visible = true
    private var compass: Double?, stepping = false
    private var headingState = HeadingState(source: .gps, angle: nil)
    private var transportState = TransportState(mode: .walk, candidate: nil, candidateAt: 0)
    private var lastSent: Int64 = 0, curInterval = ACTIVE_GPS_MS
    private var places: [Place]

    init(store: Store, peers: PeerManager) {
        self.store = store; self.peers = peers; places = store.loadPlaces()
        authStatus = location.status; accuracyAuth = location.accuracy
        location.onFix = { [weak self] f in Task { @MainActor in self?.onFix(f) } }
        location.onHeading = { [weak self] h in self?.compass = h }
        location.onWalking = { [weak self] w in self?.stepping = w }
        location.onBattery = { [weak self] b in Task { @MainActor in self?.state.battery = b } }
        location.onAuth = { [weak self] s, a in Task { @MainActor in self?.authStatus = s; self?.accuracyAuth = a; self?.evaluate() } }
    }
    var granted: Bool { authStatus == .authorizedAlways || authStatus == .authorizedWhenInUse }
    func setPlaces(_ p: [Place]) { places = p }
    func requestWhenInUse() { location.requestWhenInUse() }
    func requestAlways() { location.requestAlways() }
    func setVisible(_ v: Bool) { visible = v; evaluate() }
    func setManualTransport(_ m: TransportMode?) {
        transportState = updateTransport(transportState, speed: state.speed, now: nowMs(), manual: m)
        state.manualTransport = m; state.transport = transportState.mode
    }
    func setSharing(_ on: Bool) {
        if state.sharing == on { return }
        state.sharing = on; state.sharingSince = on ? nowMs() : nil
        var p = store.loadPrefs(); p.sharing = on; store.savePrefs(p)
        if !on { peers?.sendLocation(nil) } else { lastSent = 0 }
        evaluate()
    }
    func evaluate() {
        if granted && (visible || state.sharing) {
            location.start(intervalMs: curInterval, background: state.sharing)
            state.tracking = true; state.error = nil
        } else {
            location.stop(); state.tracking = false; filter = DriftFilter(); recentFixes = []
            if !granted && authStatus != .notDetermined { state.error = "denied" }
        }
    }
    private func onFix(_ raw: RawFix) {
        let now = nowMs(), at = raw.at ?? now
        if now - at > 30_000 || at > now + 60_000 { return }
        var r = raw; r.stepping = stepping
        let f = filter.filter(r)
        if f.dropped { return }
        let still = f.mode == "still"
        if still { recentFixes.append(FixLite(lat: raw.lat, lng: raw.lng, acc: raw.acc)); if recentFixes.count > 40 { recentFixes.removeFirst() } } else { recentFixes = [] }
        let applied = applyPlaces(places, LatLng(lat: f.lat, lng: f.lng))
        headingState = hybridHeading(headingState, speed: f.speed, gps: f.bearing, compass: compass)
        transportState = updateTransport(transportState, speed: f.speed, now: now, manual: state.manualTransport)
        state.point = applied.point; state.rawPoint = LatLng(lat: f.lat, lng: f.lng); state.acc = f.acc; state.speed = f.speed
        state.heading = headingState.angle; state.at = at; state.still = still; state.stoppedSince = f.stoppedSince
        state.transport = transportState.mode; state.placeShiftM = applied.shiftM; state.error = nil
        guard let pm = peers else { return }
        if state.sharing && shouldPublishLocation(sharing: true, now: now, lastSent: lastSent, intervalMs: publishIntervalMs(visible: visible, still: still)) {
            lastSent = now
            pm.sendLocation(LocationMessage(lat: applied.point.lat, lng: applied.point.lng, t: at, acc: f.acc, speed: f.speed, heading: headingState.angle,
                                            battery: state.battery.map(Double.init), since: state.sharingSince, stoppedSince: f.stoppedSince, transport: transportState.mode))
        }
        let calm = still && f.stoppedSince != nil && now - f.stoppedSince! >= CALM_AFTER_MS
        var want = desiredGpsIntervalMs(PowerContext(visible: visible, sharing: state.sharing, viewers: pm.hasViewers, calm: calm))
        if want > ACTIVE_GPS_MS && movementWake(lat: f.lat, lng: f.lng, speed: raw.speed, acc: raw.acc, anchor: f.anchor) { want = ACTIVE_GPS_MS }
        if want != curInterval { curInterval = want; state.gpsIntervalMs = want; location.start(intervalMs: want, background: state.sharing) }
    }
}
