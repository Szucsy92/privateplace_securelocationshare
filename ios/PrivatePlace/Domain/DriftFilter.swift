import Foundation

/// Drift-szűrő („horgony + bizonyíték” állapotgép) – a TypeScript `stationary.ts` / a Kotlin `DriftFilter` pontos portja.
struct RawFix {
    var lat: Double, lng: Double
    var acc: Double? = nil, speed: Double? = nil, speedAcc: Double? = nil, bearing: Double? = nil
    var at: Int64? = nil
    var src: String? = nil          // "gps" | "network"
    var stepping: Bool? = nil
}

struct FilteredFix {
    var lat: Double, lng: Double, acc: Double?, speed: Double?, bearing: Double?, at: Int64
    var src: String?, stepping: Bool?
    var mode: String                // "still" | "moving"
    var stoppedSince: Int64?, note: String?, anchor: LatLng?, distrust: Bool, dropped = false
}

private let SAT_ACC = 20.0, ROUGH_ACC = 30.0, SAT_FRESH_MS: Int64 = 22000, INIT_ROUGH_MS: Int64 = 8000
private let ACC_FLOOR = 6.0, ACC_TRUST = 1.3, STILL_SPEED = 0.5, GO_SPEED = 0.55, FAST_SPEED = 2.5
private let STEP_MOVE_MIN_M = 2.0, STEP_MOVE_ACC_K = 0.4, GO_FIXES = 2
private let ENTER_MS: Int64 = 5000, ENTER_FIXES = 4, NO_SPEED_ENTER_MS: Int64 = 20000
private let FAR_M = 30.0, FAR_AGREE_M = 25.0, FAR_STILL_MS: Int64 = 45000
private let WALK_EXIT_METERS = 8.0, NOISE_K = 2.0, WALK_MAX_ACC = 25.0, SPEED_NOISE_FLOOR = 1.2
private let SIGMA_A_MIN = 0.8, SIGMA_A_MAX = 4.0, GAP_RESET_MS: Int64 = 60000
private let SPARSE_DT = 2.5, DT_SAMPLES = 5, DT_MAX_S = 20.0
private let DOP_CHECK_MIN_MS: Int64 = 5000, DOP_CHECK_FACTOR = 0.3, DOP_CHECK_MAX_ACC = 20.0, GO_FIX_ACC = 15.0
private let ACQ_MAX_ACC = 25.0, ACQ_MIN_FIXES = 5, ACQ_MIN_MS: Int64 = 12000, ACQ_MAX_MS: Int64 = 20000, ACQ_MIN_FIXES_SPARSE = 3
private let ACQ_INLIER_MIN_M = 8.0, ACQ_INLIER_MAX_M = 20.0, ACQ_INLIER_K = 1.5, ACQ_MIN_SHARE = 0.6, ACQ_MAX_RMS = 12.0, ACQ_STEP_FIXES = 2
private let CAND_MAX_ACC = 20.0, CAND_NEAR_M = 7.0, CAND_VISIT_M = 4.5, CAND_AGREE_M = 7.0
private let CAND_MIN_FIXES = 25, CAND_MIN_MS: Int64 = 120000, CAND_MAX_RMS = 4.5, CAND_RMS_ACC_K = 0.75
private let CAND_NEAR_RESET = 3, CAND_NEAR_WIN_MS: Int64 = 20000, CAND_START_FIXES = 8
private let FAST_ACC_MAX = 5.0, FAST_MIN_MS: Int64 = 12000, FAST_MIN_FIXES = 8, FAST_DIST_K = 2.0, FAST_NEAR_M = 5.5, FAST_NEAR_K = 2.0
private let SHOWN_EASE_MIN_M = 1.5, M_LAT = 110540.0

private struct Vec { var x: Double, y: Double }
private final class Axis { var p: Double, v: Double, Ppp: Double, Ppv: Double, Pvv: Double
    init(_ p: Double, _ v: Double, _ a: Double, _ b: Double, _ c: Double) { self.p = p; self.v = v; Ppp = a; Ppv = b; Pvv = c } }
private struct WP { var p: Vec; var w: Double }
private struct Rec { var p: Vec; var w: Double; var at: Int64; var speed: Double? }
private struct Acq { var p: Vec; var w: Double; var at: Int64; var speed: Double?; var acc: Double }
private struct Far { var p: Vec; var at: Int64; var dopStill: Bool; var afterGap: Bool }
private struct PFar { var p: Vec; var at: Int64; var acc: Double? }
private struct Cand { var p: Vec; var at: Int64; var acc: Double }
private struct Cluster { var c: Vec; var inl: [Acq]; var rms: Double }
private enum FMode { case initial, moving, still }

private func hyp(_ a: Double, _ b: Double) -> Double { (a * a + b * b).squareRoot() }
private func dist(_ a: Vec, _ b: Vec) -> Double { hyp(a.x - b.x, a.y - b.y) }

final class DriftFilter {
    private var lat0 = 0.0, lng0 = 0.0, haveOrigin = false
    private func toXY(_ lat: Double, _ lng: Double) -> Vec { Vec(x: (lng - lng0) * cos(lat0 * .pi / 180) * 111320, y: (lat - lat0) * M_LAT) }
    private func toLL(_ v: Vec) -> LatLng { LatLng(lat: lat0 + v.y / M_LAT, lng: lng0 + v.x / (cos(lat0 * .pi / 180) * 111320)) }

    private var mode = FMode.initial
    private var kx: Axis?, ky: Axis?
    private var lastAt: Int64?, lastSatAt: Int64?, initRoughAt: Int64?
    private var last: FilteredFix?
    private var lastBearing: Double?
    private var anchor = Vec(x: 0, y: 0), shown = Vec(x: 0, y: 0)
    private var rms2 = 36.0
    private var stillSince: Int64?
    private var fastHist: [Bool] = [], far: [Far] = [], pendingFar: [PFar] = [], recent: [Rec] = [], acq: [Acq] = []
    private var acqStepHits = 0
    private var initAt: Int64?
    private var cand: [Cand] = []
    private var candMiss = 0
    private var candNear: [Int64] = []
    private var dts: [Double] = []
    private var dopDistrust = false
    private var note: String?

    private func f1(_ x: Double) -> String { String(format: "%.1f", x).replacingOccurrences(of: ".", with: ",") }
    private func say(_ t: String) { note = note != nil ? "\(note!) · \(t)" : t }

    private func predict(_ a: Axis, _ dt: Double, _ sa: Double) {
        let q = sa * sa
        a.p += a.v * dt
        let ppp = a.Ppp + 2 * dt * a.Ppv + dt * dt * a.Pvv + q * pow(dt, 4) / 4
        let ppv = a.Ppv + dt * a.Pvv + q * pow(dt, 3) / 2
        let pvv = a.Pvv + q * dt * dt
        a.Ppp = ppp; a.Ppv = ppv; a.Pvv = pvv
    }
    private func updPos(_ a: Axis, _ z: Double, _ r: Double) {
        let s = a.Ppp + r, kp = a.Ppp / s, kv = a.Ppv / s, y = z - a.p
        a.p += kp * y; a.v += kv * y
        let ppp = (1 - kp) * a.Ppp, ppv = (1 - kp) * a.Ppv, pvv = a.Pvv - kv * a.Ppv
        a.Ppp = ppp; a.Ppv = ppv; a.Pvv = pvv
    }
    private func updVel(_ a: Axis, _ z: Double, _ r: Double) {
        let s = a.Pvv + r, kp = a.Ppv / s, kv = a.Pvv / s, y = z - a.v
        a.p += kp * y; a.v += kv * y
        let ppp = a.Ppp - kp * a.Ppv, ppv = a.Ppv - kp * a.Pvv, pvv = a.Pvv - kv * a.Pvv
        a.Ppp = ppp; a.Ppv = ppv; a.Pvv = pvv
    }
    private func wmean(_ pts: [WP]) -> Vec {
        var sw = 0.0, sx = 0.0, sy = 0.0
        for q in pts { sw += q.w; sx += q.p.x * q.w; sy += q.p.y * q.w }
        return sw > 0 ? Vec(x: sx / sw, y: sy / sw) : Vec(x: 0, y: 0)
    }
    private func mean(_ pts: [Vec]) -> Vec { wmean(pts.map { WP(p: $0, w: 1) }) }
    private func geoMedian(_ pts: [WP]) -> Vec {
        var c = wmean(pts)
        for _ in 0..<25 {
            var sw = 0.0, sx = 0.0, sy = 0.0
            for q in pts { let k = q.w / max(0.5, dist(q.p, c)); sw += k; sx += q.p.x * k; sy += q.p.y * k }
            let n = Vec(x: sx / sw, y: sy / sw)
            let moved = dist(n, c); c = n
            if moved < 0.01 { break }
        }
        return c
    }
    private func rmsAround(_ pts: [Vec], _ c: Vec) -> Double { (pts.reduce(0) { $0 + pow($1.x - c.x, 2) + pow($1.y - c.y, 2) } / Double(max(1, pts.count))).squareRoot() }
    private func acqCluster(_ pts: [Acq], _ minFixes: Int) -> Cluster? {
        if pts.count < minFixes { return nil }
        let c0 = geoMedian(pts.map { WP(p: $0.p, w: $0.w) })
        let accs = pts.map { $0.acc }.sorted()
        let thr = min(ACQ_INLIER_MAX_M, max(ACQ_INLIER_MIN_M, ACQ_INLIER_K * accs[accs.count / 2]))
        let inl = pts.filter { dist($0.p, c0) <= thr }
        if inl.count < minFixes || Double(inl.count) < ACQ_MIN_SHARE * Double(pts.count) { return nil }
        if Double(inl.last!.at - inl.first!.at) < Double(ACQ_MIN_MS) * 0.75 { return nil }
        let c = wmean(inl.map { WP(p: $0.p, w: $0.w) })
        let rms = rmsAround(inl.map { $0.p }, c)
        if rms > ACQ_MAX_RMS { return nil }
        if inl.contains(where: { $0.speed == nil }) {
            let third = max(1, inl.count / 3)
            let c1 = wmean(inl.prefix(third).map { WP(p: $0.p, w: $0.w) }), c2 = wmean(inl.suffix(third).map { WP(p: $0.p, w: $0.w) })
            if dist(c1, c2) > 3 + 0.5 * rms { return nil }
        }
        return Cluster(c: c, inl: inl, rms: rms)
    }
    private func dtEst() -> Double { if dts.isEmpty { return 1 }; let q = dts.sorted(); return q[q.count / 2] }
    private func robustSpread(_ pts: [Vec], _ c: Vec) -> Double {
        let d = pts.map { dist($0, c) }.sorted()
        let lim = max(6, 3 * d[d.count / 2])
        return rmsAround(pts.filter { dist($0, c) <= lim }, c)
    }
    private func candFlat(_ pts: [Vec], _ rms: Double) -> Bool {
        let n = pts.count / 3
        if n < 2 { return false }
        let c1 = mean(Array(pts.prefix(n))), c2 = mean(Array(pts[n..<(2 * n)])), c3 = mean(Array(pts.suffix(n)))
        let tol = 1.5 + (2.5 * max(rms, 1)) / Double(n).squareRoot()
        return hyp(c2.x - (c1.x + c3.x) / 2, c2.y - (c1.y + c3.y) / 2) <= tol && dist(c3, c1) <= 2 * tol
    }
    private func resetCand() { cand = []; candMiss = 0; candNear = [] }
    private func candCenter() -> Vec { mean(cand.map { $0.p }) }

    private func emit(_ fix: RawFix, _ pos: LatLng, _ at: Int64, hasSpeed: Bool = false, speed: Double? = nil, hasBearing: Bool = false, bearing: Double? = nil) -> FilteredFix {
        let still = mode == .still
        let out = FilteredFix(lat: pos.lat, lng: pos.lng, acc: fix.acc, speed: hasSpeed ? speed : fix.speed, bearing: hasBearing ? bearing : fix.bearing, at: at,
                              src: fix.src, stepping: fix.stepping, mode: still ? "still" : "moving", stoppedSince: still ? stillSince : nil,
                              note: note, anchor: still ? toLL(anchor) : nil, distrust: dopDistrust)
        note = nil; last = out
        return out
    }
    private func toMoving(_ pos: Vec, _ posVar: Double) {
        mode = .moving; stillSince = nil
        kx = Axis(pos.x, 0, posVar, 0, 4); ky = Axis(pos.y, 0, posVar, 0, 4)
        fastHist = []; far = []; pendingFar = []; recent = []; acq = []; acqStepHits = 0; resetCand()
    }
    private func toStill(_ pos: Vec, _ spread2: Double, _ since: Int64) {
        mode = .still; stillSince = since; anchor = pos; shown = pos; rms2 = max(spread2, 9)
        fastHist = []; far = []; pendingFar = []; acq = []; acqStepHits = 0; resetCand()
    }

    func filter(_ fix: RawFix) -> FilteredFix {
        let at = fix.at ?? Int64(Date().timeIntervalSince1970 * 1000)
        let prevLast = last
        if let la = lastAt, at <= la, let pl = prevLast { return pl }

        let satQuality = fix.src != "network" && fix.acc != nil && fix.acc! < SAT_ACC
        let rough = fix.src == "network" || fix.acc == nil || fix.acc! > ROUGH_ACC
        let satFresh = lastSatAt != nil && at - lastSatAt! < SAT_FRESH_MS
        if rough && satFresh, var pl = prevLast { pl.at = at; pl.note = nil; pl.dropped = true; return pl }
        if satQuality { lastSatAt = max(lastSatAt ?? at, at) }

        if !haveOrigin { lat0 = fix.lat; lng0 = fix.lng; haveOrigin = true }
        let z = toXY(fix.lat, fix.lng)
        let sigma = max(ACC_FLOOR, (fix.acc ?? 15) * ACC_TRUST)
        let w = 1 / (sigma * sigma)
        let dt = lastAt == nil ? 1.0 : min(30, max(0.2, Double(at - lastAt!) / 1000))
        var sp: Double? = (fix.speed != nil && fix.speed!.isFinite && fix.src != "network") ? fix.speed : nil
        if sp != nil, let sa = fix.speedAcc, sa > 1 { sp = nil }
        let dopplerOk = sp != nil && (fix.acc == nil || fix.acc! <= ROUGH_ACC)
        if let b = fix.bearing, b.isFinite, sp == nil || sp! > 1 { lastBearing = b }
        let prevAt = lastAt
        if let pa = prevAt {
            let gap = Double(at - pa) / 1000
            if gap <= DT_MAX_S { dts.append(max(0.2, gap)); if dts.count > DT_SAMPLES { dts.removeFirst() } }
        }
        let dtS = dtEst(), sparse = dtS >= SPARSE_DT

        // Indítás
        if mode == .initial {
            if rough && (initRoughAt == nil || at - initRoughAt! < INIT_ROUGH_MS) {
                if initRoughAt == nil { initRoughAt = at }
                lastAt = at
                return emit(fix, LatLng(lat: fix.lat, lng: fix.lng), at)
            }
            lastAt = at
            if rough || (sp != nil && sp! >= STILL_SPEED) {
                say(rough ? "Indításkor csak durva (hálózati) jel van: nincs horgony, a Kalman-szűrő viszi"
                          : "Indításkor már mozgást mér a Doppler (\(f1(sp! * 3.6)) km/h): nincs horgony")
                toMoving(z, sigma * sigma)
                return emit(fix, LatLng(lat: fix.lat, lng: fix.lng), at)
            }
            if initAt == nil { initAt = at }
            if let a = fix.acc, a <= ACQ_MAX_ACC {
                acq.append(Acq(p: z, w: w, at: at, speed: sp, acc: a))
                if acq.count > 40 { acq.removeFirst() }
                if sp == nil && fix.stepping == true { acqStepHits += 1 }
            }
            let est = acq.isEmpty ? z : geoMedian(acq.map { WP(p: $0.p, w: $0.w) })
            if acqStepHits >= ACQ_STEP_FIXES {
                say("Indításkor járás-jelzés: mozgásnak veszi"); toMoving(est, sigma * sigma); return emit(fix, toLL(est), at)
            }
            if let cl = acqCluster(acq, sparse ? ACQ_MIN_FIXES_SPARSE : ACQ_MIN_FIXES), at - acq[0].at >= ACQ_MIN_MS {
                say("Horgony felvéve indításkor: \(cl.inl.count) egyező fix, szórás \(f1(cl.rms)) m")
                toStill(cl.c, cl.rms * cl.rms, cl.inl[0].at)
                recent = cl.inl.suffix(8).map { Rec(p: $0.p, w: $0.w, at: $0.at, speed: $0.speed) }
                return emit(fix, toLL(shown), at, hasSpeed: true, speed: 0)
            }
            if Double(at - initAt!) >= max(Double(ACQ_MAX_MS), 8 * dtS * 1000) {
                say("Indításkor sem 20 s alatt nem állt össze stabil klaszter: a Kalman-szűrő viszi tovább")
                toMoving(est, sigma * sigma); return emit(fix, toLL(est), at)
            }
            return emit(fix, toLL(est), at, hasSpeed: true, speed: nil)
        }

        // ÁLLÁS
        if mode == .still {
            let d = dist(z, anchor)
            let rms = min(20, rms2.squareRoot())
            recent.append(Rec(p: z, w: w, at: at, speed: sp)); if recent.count > 8 { recent.removeFirst() }
            let dopStill = dopplerOk && sp! < STILL_SPEED
            if dopStill || (dopplerOk && sp! >= FAST_SPEED) { dopDistrust = false }
            let back = recent[max(0, recent.count - 6)]
            let movedRecently = recent.count >= 4 && dist(z, back.p) >= max(STEP_MOVE_MIN_M, STEP_MOVE_ACC_K * (fix.acc ?? 6))
            let dopGo = dopplerOk && sp! >= GO_SPEED && !(dopDistrust && sp! < FAST_SPEED) && (sp! >= FAST_SPEED || movedRecently || fix.stepping == true)
            let stepEv = fix.stepping == true && !dopStill && (!dopplerOk || movedRecently)
            fastHist.append(dopGo || stepEv); if fastHist.count > 3 { fastHist.removeFirst() }
            let bothSensors = dopGo && fix.stepping == true && (fix.acc ?? 999) <= GO_FIX_ACC
            let hits = fastHist.filter { $0 }.count
            var leave = hits >= GO_FIXES || (dopplerOk && sp! >= FAST_SPEED) || bothSensors
            var relocate: Vec?
            var why = ""
            if leave {
                if dopplerOk && sp! >= FAST_SPEED { why = "gyors Doppler (\(f1(sp! * 3.6)) km/h)" }
                else if bothSensors { why = "Doppler és járás-jelzés együtt" }
                else { why = "Doppler/járás-jelzés az utolsó 3 fixből \(hits)-on" }
            }
            let farThr = max(FAR_M, 3 * min(25, max(fix.acc ?? 15, rms)))
            if !leave {
                if d > farThr {
                    if !far.isEmpty { let fc = mean(far.map { $0.p }); if dist(z, fc) > FAR_AGREE_M { far = [] } }
                    far.append(Far(p: z, at: at, dopStill: dopStill, afterGap: prevAt != nil && at - prevAt! > 20000))
                    let allStill = far.allSatisfy { $0.dopStill }
                    let stillCount = min(15, Int((Double(FAR_STILL_MS) / 1000 / dtS).rounded(.up)))
                    if allStill && far.count >= stillCount && at - far[0].at >= FAR_STILL_MS {
                        relocate = mean(far.map { $0.p }); leave = true
                        why = "a pozíció tartósan \(f1(dist(relocate!, anchor))) m-re van a horgonytól (\(far.count) egyező fix)"
                    }
                } else if d < farThr * 0.6 { far = [] }
            }
            if !leave && !dopStill && (fix.acc ?? 999) <= WALK_MAX_ACC && recent.count >= 4 {
                let r4 = Array(recent.suffix(4))
                if Double(r4[3].at - r4[0].at) <= max(8000, 3.5 * dtS * 1000) {
                    let c = wmean(r4.map { WP(p: $0.p, w: $0.w) })
                    let dir = Vec(x: c.x - anchor.x, y: c.y - anchor.y)
                    let dl = hyp(dir.x, dir.y)
                    let thr = max(WALK_EXIT_METERS, NOISE_K * rms)
                    if dl >= thr {
                        let u = Vec(x: dir.x / dl, y: dir.y / dl)
                        let proj = r4.map { ($0.p.x - anchor.x) * u.x + ($0.p.y - anchor.y) * u.y }
                        let lat = r4.map { abs(-($0.p.x - anchor.x) * u.y + ($0.p.y - anchor.y) * u.x) }
                        let lateral = (lat.reduce(0) { $0 + $1 * $1 } / Double(lat.count)).squareRoot()
                        let persistent = proj.sorted()[1] >= 0.5 * thr
                        leave = persistent && proj[3] >= proj[0] + 1 && proj[3] >= thr && lateral <= 0.6 * dl
                        if leave { relocate = c; why = "tartós, egyirányú elmozdulás \(f1(dl)) m (sebességadat nélkül)" }
                    }
                }
            }
            if !leave {
                let walkEv = dopGo || stepEv
                if fix.src != "network" && (fix.acc ?? 999) <= CAND_MAX_ACC && !walkEv {
                    let nearThr = (fix.acc ?? 999) <= FAST_ACC_MAX ? max(FAST_NEAR_M, FAST_NEAR_K * (fix.acc ?? 3)) : max(CAND_NEAR_M, fix.acc ?? 10)
                    let visitThr = max(CAND_VISIT_M, 0.6 * (fix.acc ?? 10))
                    if d >= nearThr && d < farThr {
                        if cand.isEmpty { cand.append(Cand(p: z, at: at, acc: fix.acc ?? 10)) }
                        else {
                            let cc = candCenter()
                            if dist(z, cc) <= CAND_AGREE_M { cand.append(Cand(p: z, at: at, acc: fix.acc ?? 10)) }
                            else { candMiss += 1; if Double(candMiss) > 2 + 0.25 * Double(cand.count) { resetCand(); cand.append(Cand(p: z, at: at, acc: fix.acc ?? 10)) } }
                        }
                        if cand.count > 300 { cand.removeFirst() }
                    } else if d < visitThr && !cand.isEmpty {
                        let win = max(Double(CAND_NEAR_WIN_MS), 4 * dtS * 1000)
                        candNear = candNear.filter { Double(at - $0) <= win }; candNear.append(at)
                        if candNear.count >= (dtS >= 2 ? 2 : CAND_NEAR_RESET) { resetCand() }
                    }
                    let inCluster = !cand.isEmpty && cand.last!.at == at
                    if !cand.isEmpty {
                        let good = cand.filter { $0.acc <= FAST_ACC_MAX }
                        let fastMin = max(5, min(FAST_MIN_FIXES, Int((0.8 * Double(FAST_MIN_MS) / 1000 / dtS).rounded(.down))))
                        if inCluster && good.count >= fastMin && at - good[0].at >= FAST_MIN_MS && at - good.last!.at <= 5000 {
                            let gc = mean(good.map { $0.p })
                            let grms = rmsAround(good.map { $0.p }, gc), gmv = dist(gc, anchor)
                            let ga = good.map { $0.acc }.sorted(), gacc = ga[good.count / 2]
                            if gmv >= max(FAST_NEAR_M, FAST_DIST_K * gacc) && grms <= max(2, CAND_RMS_ACC_K * gacc) && candFlat(good.map { $0.p }, grms) {
                                say("Gyors horgonykorrekció \(f1(gmv)) m-rel: \(good.count) pontos fix (±\(Int(gacc)) m) \(Int((Double(at - good[0].at) / 1000).rounded())) s alatt")
                                anchor = gc; resetCand(); far = []
                            }
                        }
                    }
                    let candMin = max(8, min(CAND_MIN_FIXES, Int((0.8 * Double(CAND_MIN_MS) / 1000 / dtS).rounded(.down))))
                    if inCluster && cand.count >= candMin && at - cand[0].at >= CAND_MIN_MS {
                        let cc = candCenter()
                        let crms = rmsAround(cand.map { $0.p }, cc), mv = dist(cc, anchor)
                        let accs = cand.map { $0.acc }.sorted()
                        let rmsLimit = max(CAND_MAX_RMS, CAND_RMS_ACC_K * accs[accs.count / 2])
                        if crms <= rmsLimit && candFlat(cand.map { $0.p }, crms) {
                            say("Horgonykorrekció \(f1(mv)) m-rel: \(cand.count) egyező fix \(Int((Double(at - cand[0].at) / 1000).rounded())) s alatt")
                            anchor = cc; resetCand(); far = []
                        }
                    }
                }
                let gap = dist(anchor, shown)
                if gap > 0 {
                    let step = min(gap, max(SHOWN_EASE_MIN_M, 0.25 * gap))
                    shown = step >= gap ? anchor : Vec(x: shown.x + (anchor.x - shown.x) * step / gap, y: shown.y + (anchor.y - shown.y) * step / gap)
                }
                let dl = min(d, 1.5 * rms + 3)
                rms2 = 0.95 * rms2 + 0.05 * dl * dl
                lastAt = at
                return emit(fix, toLL(shown), at, hasSpeed: true, speed: 0, hasBearing: true, bearing: lastBearing)
            }
            say("Kilépés az állásból: \(why)")
            if let rl = relocate, !far.isEmpty, far.allSatisfy({ $0.dopStill }) {
                say("Áthelyeződés \(f1(dist(rl, anchor))) m-rel (a Doppler végig állást mondott)")
                toStill(rl, rms2, far[0].at)
                lastAt = at
                return emit(fix, toLL(shown), at, hasSpeed: true, speed: 0, hasBearing: true, bearing: lastBearing)
            }
            var v0 = Vec(x: 0, y: 0)
            if let s = sp, let b = fix.bearing, s >= GO_SPEED { v0 = Vec(x: s * sin(b * .pi / 180), y: s * cos(b * .pi / 180)) }
            var start = relocate ?? anchor
            var startVar = relocate != nil ? sigma * sigma : max(rms2, 9)
            if relocate == nil && cand.count >= CAND_START_FIXES && at - cand.last!.at <= 15000 {
                let cc = candCenter(), cr = rmsAround(cand.map { $0.p }, cc)
                if cr <= CAND_MAX_RMS { start = cc; startVar = max(cr * cr, 9) }
            }
            toMoving(start, startVar)
            kx!.v = v0.x; ky!.v = v0.y
        }

        // MOZGÁS (Kalman)
        if let pa = prevAt, at - pa > GAP_RESET_MS { say("Hosszú jelszünet után a követés újraindult"); toMoving(z, sigma * sigma) }
        let distrustBefore = dopDistrust, sp0 = sp
        if let s = sp, s < STILL_SPEED { dopDistrust = false }
        else if let s = sp, s >= FAST_SPEED { dopDistrust = false }
        else if let s = sp, fix.stepping != true, (fix.acc ?? 999) <= DOP_CHECK_MAX_ACC {
            let span = max(8000, 3 * dtS * 1000)
            let pts: [(Vec, Int64)] = recent.filter { Double(at - $0.at) <= span }.map { ($0.p, $0.at) } + [(z, at)]
            var verdict = "unknown"
            if pts.count >= 5 && at - pts[0].1 >= DOP_CHECK_MIN_MS {
                let n = max(1, pts.count / 3)
                let head = Array(pts.prefix(n)), tail = Array(pts.suffix(n))
                let c1 = mean(head.map { $0.0 }), c2 = mean(tail.map { $0.0 })
                let el = (tail.reduce(0.0) { $0 + Double($1.1) } / Double(n) - head.reduce(0.0) { $0 + Double($1.1) } / Double(n)) / 1000
                if el >= 3 {
                    let margin = max(max(2, DOP_CHECK_FACTOR * s * el), 1.2 * robustSpread(pts.map { $0.0 }, geoMedian(pts.map { WP(p: $0.0, w: 1) })))
                    let disp = dist(c1, c2)
                    verdict = disp < margin ? "bad" : (disp >= 1.5 * margin ? "ok" : "unknown")
                }
            }
            if verdict == "bad" { dopDistrust = true } else if verdict == "ok" { dopDistrust = false }
            if s >= GO_SPEED && dopDistrust { sp = 0 }
        }
        if !distrustBefore && dopDistrust { say("A Doppler \(f1((sp0 ?? 0) * 3.6)) km/h-t mond, de a pozíciók nem mozdulnak: nem vesszük figyelembe") }
        else if distrustBefore && !dopDistrust { say("A Doppler újra hiteles") }
        let kxx = kx!, kyy = ky!
        let v = hyp(kxx.v, kyy.v)
        let sa = min(SIGMA_A_MAX, max(SIGMA_A_MIN, 0.5 + 0.35 * v))
        predict(kxx, dt, sa); predict(kyy, dt, sa)
        let rm = sigma * sigma
        let nis = pow(z.x - kxx.p, 2) / (kxx.Ppp + rm) + pow(z.y - kyy.p, 2) / (kyy.Ppp + rm)
        let supported = sp != nil && sp! >= 2
        if nis > 16 && !supported {
            if let pl = pendingFar.last, dist(z, pl.p) <= FAR_AGREE_M { pendingFar.append(PFar(p: z, at: at, acc: fix.acc)) }
            else { pendingFar = [PFar(p: z, at: at, acc: fix.acc)] }
            let pg = pendingFar.filter { $0.acc != nil && $0.acc! <= 25 }
            if pg.count >= 3 && pg.last!.at - pg[0].at >= 5000 {
                let j = mean(pg.map { $0.p })
                kxx.p = j.x; kyy.p = j.y; kxx.v = 0; kyy.v = 0; kxx.Ppp = rm; kyy.Ppp = rm; kxx.Pvv = 4; kyy.Pvv = 4; kxx.Ppv = 0; kyy.Ppv = 0
                say("Pozícióugrás elfogadva (\(pg.count) egyező fix, \(Int((Double(pg.last!.at - pg[0].at) / 1000).rounded())) s)")
                pendingFar = []; recent = []; lastAt = at
                return emit(fix, toLL(j), at, hasSpeed: true, speed: sp ?? 0, hasBearing: true, bearing: fix.bearing ?? lastBearing)
            }
            say("Kiugró fix visszatartva (tartós klaszter megerősítésére vár)")
            lastAt = at
            return emit(fix, toLL(Vec(x: kxx.p, y: kyy.p)), at, hasSpeed: true, speed: sp ?? hyp(kxx.v, kyy.v), hasBearing: true, bearing: fix.bearing ?? lastBearing)
        }
        pendingFar = []
        updPos(kxx, z.x, rm); updPos(kyy, z.y, rm)
        if let s = sp {
            if s >= 0.7, let b = fix.bearing, b.isFinite {
                let br = b * .pi / 180, r = 0.8 * 0.8 + pow(0.15 * s, 2)
                updVel(kxx, s * sin(br), r); updVel(kyy, s * cos(br), r)
            } else if s < GO_SPEED {
                let r = s < STILL_SPEED ? 0.3 * 0.3 : 0.5 * 0.5
                updVel(kxx, 0, r); updVel(kyy, 0, r)
            } else {
                let cur = hyp(kxx.v, kyy.v)
                if cur > 0.1 { let k = min(1, s / cur); kxx.v *= k; kyy.v *= k }
            }
        }
        recent.append(Rec(p: z, w: w, at: at, speed: sp)); if recent.count > 24 { recent.removeFirst() }
        let longWin = max(recent.contains(where: { $0.speed == nil }) ? Double(NO_SPEED_ENTER_MS) : Double(ENTER_MS), 4 * dtS * 1000)
        let wnd = recent.filter { Double(at - $0.at) <= longWin }
        if wnd.count >= ENTER_FIXES && Double(at - wnd[0].at) >= longWin * 0.8 {
            let slow = wnd.allSatisfy { $0.speed == nil || $0.speed! <= STILL_SPEED + 0.3 }
            let c = geoMedian(wnd.map { WP(p: $0.p, w: $0.w) })
            let rms = robustSpread(wnd.map { $0.p }, c)
            let third = max(1, wnd.count / 3)
            let c1 = wmean(wnd.prefix(third).map { WP(p: $0.p, w: $0.w) }), c2 = wmean(wnd.suffix(third).map { WP(p: $0.p, w: $0.w) })
            let net = dist(c1, c2)
            let doppler = wnd.allSatisfy { $0.speed != nil }
            if slow && rms <= (doppler ? 60 : 45) && (doppler || net <= 6 + 0.5 * rms) {
                say("Állásba lépett: \(wnd.count) fix, szórás \(f1(rms)) m, \(doppler ? "Doppler-állás" : "sebességadat nélkül"); horgony a nyers pontok mediánjára")
                toStill(c, rms * rms, wnd[0].at)
                lastAt = at
                return emit(fix, toLL(shown), at, hasSpeed: true, speed: 0, hasBearing: true, bearing: lastBearing)
            }
        }
        lastAt = at
        let pos = toLL(Vec(x: kxx.p, y: kyy.p))
        let spd = hyp(kxx.v, kyy.v)
        var displaySpeed = 0.0
        if let s = sp, dopplerOk, (fix.acc ?? 999) <= WALK_MAX_ACC { displaySpeed = s >= STILL_SPEED ? s : 0 }
        else {
            let win = Array(recent.suffix(6))
            var est = 0.0
            if win.count >= 4 {
                let half = win.count / 2
                let a = Array(win.prefix(half)), b = Array(win.suffix(half))
                let ca = wmean(a.map { WP(p: $0.p, w: $0.w) }), cb = wmean(b.map { WP(p: $0.p, w: $0.w) })
                let ta = a.reduce(0.0) { $0 + Double($1.at) } / Double(a.count), tb = b.reduce(0.0) { $0 + Double($1.at) } / Double(b.count)
                let disp = dist(ca, cb), el = max(0.5, (tb - ta) / 1000)
                let margin = max(2.5, 0.6 * (fix.acc ?? 15))
                if disp >= margin && disp / el >= SPEED_NOISE_FLOOR { est = min(spd, disp / el) }
            }
            displaySpeed = est >= SPEED_NOISE_FLOOR ? est : 0
        }
        let bearing: Double? = displaySpeed >= 0.8 ? (atan2(kxx.v, kyy.v) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360) : (fix.bearing ?? lastBearing)
        return emit(fix, pos, at, hasSpeed: true, speed: displaySpeed, hasBearing: true, bearing: bearing)
    }
}
