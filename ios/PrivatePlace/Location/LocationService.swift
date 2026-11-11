import Foundation
import CoreLocation
import CoreMotion
import UIKit

/// Helymeghatározás, iránytű, járás-jelzés és akkumulátor. iOS-en nincs előtér-szolgáltatás: a háttérbeli helymód
/// (UIBackgroundModes: location + allowsBackgroundLocationUpdates) tartja életben a folyamatot, amíg a megosztás aktív.
final class LocationService: NSObject, CLLocationManagerDelegate {
    private let lm = CLLocationManager(), motion = CMMotionManager()
    var onFix: ((RawFix) -> Void)?
    var onHeading: ((Double) -> Void)?
    var onWalking: ((Bool) -> Void)?
    var onAuth: ((CLAuthorizationStatus, CLAccuracyAuthorization) -> Void)?
    var onBattery: ((Int?) -> Void)?
    private(set) var running = false
    private lazy var walking = WalkingDetector { [weak self] in self?.onWalking?($0) }

    override init() { super.init(); lm.delegate = self; UIDevice.current.isBatteryMonitoringEnabled = true }

    var status: CLAuthorizationStatus { lm.authorizationStatus }
    var accuracy: CLAccuracyAuthorization { lm.accuracyAuthorization }
    func requestWhenInUse() { lm.requestWhenInUseAuthorization() }
    func requestAlways() { lm.requestAlwaysAuthorization() }
    func requestFullAccuracy() { lm.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "Precise") }

    func start(intervalMs: Int64, background: Bool) {
        // iOS-en nincs „közbeni” intervallum: kisebb pontosság + távolságszűrő ritkítja a frissítést (nyugalmi/rejtett üzemmód)
        let relaxed = intervalMs >= 3000
        lm.desiredAccuracy = relaxed ? kCLLocationAccuracyNearestTenMeters : kCLLocationAccuracyBest
        lm.distanceFilter = relaxed ? 5 : kCLDistanceFilterNone
        lm.activityType = .otherNavigation
        lm.pausesLocationUpdatesAutomatically = false
        if status == .authorizedAlways || status == .authorizedWhenInUse {
            lm.allowsBackgroundLocationUpdates = background
            lm.showsBackgroundLocationIndicator = background
        }
        if !running {
            running = true; lm.startUpdatingLocation(); lm.startUpdatingHeading()
            if motion.isAccelerometerAvailable {
                motion.accelerometerUpdateInterval = 0.02
                motion.startAccelerometerUpdates(to: .main) { [weak self] d, _ in
                    guard let a = d?.acceleration else { return }
                    self?.walking.onSample(nowMs(), a.x * 9.80665, a.y * 9.80665, a.z * 9.80665)
                }
            }
            NotificationCenter.default.addObserver(self, selector: #selector(batteryChanged), name: UIDevice.batteryLevelDidChangeNotification, object: nil)
            batteryChanged()
        }
    }
    func stop() {
        guard running else { return }
        running = false; lm.stopUpdatingLocation(); lm.stopUpdatingHeading(); motion.stopAccelerometerUpdates()
        lm.allowsBackgroundLocationUpdates = false
        NotificationCenter.default.removeObserver(self, name: UIDevice.batteryLevelDidChangeNotification, object: nil)
    }
    @objc private func batteryChanged() { let l = UIDevice.current.batteryLevel; onBattery?(l >= 0 ? Int((l * 100).rounded()) : nil) }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        for l in locs where l.horizontalAccuracy >= 0 {
            onFix?(RawFix(lat: l.coordinate.latitude, lng: l.coordinate.longitude, acc: l.horizontalAccuracy,
                          speed: l.speed >= 0 ? l.speed : nil, speedAcc: l.speedAccuracy >= 0 ? l.speedAccuracy : nil,
                          bearing: l.course >= 0 ? l.course : nil, at: Int64(l.timestamp.timeIntervalSince1970 * 1000),
                          src: l.horizontalAccuracy >= 65 ? "network" : "gps"))   // ≥65 m: Wi-Fi/cella alapú becslés
        }
    }
    func locationManager(_ m: CLLocationManager, didUpdateHeading h: CLHeading) { let v = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading; if v >= 0 { onHeading?(v) } }
    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) { onAuth?(m.authorizationStatus, m.accuracyAuthorization) }
    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {}
}
