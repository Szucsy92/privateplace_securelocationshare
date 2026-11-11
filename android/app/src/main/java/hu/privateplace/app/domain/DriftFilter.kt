package hu.privateplace.app.domain

import java.util.Locale
import kotlin.math.*

/**
 * Drift-szűrő („horgony + bizonyíték” állapotgép) – a TypeScript `stationary.ts` pontos portja.
 * ÁLLÁS: pontossággal súlyozott horgony; kilépés csak bizonyítékkal (Doppler, járás-jelzés, tartós elmozdulás).
 * MOZGÁS: állandó sebesség modellű Kalman-szűrő, Doppler-sebességgel javítva.
 */
data class RawFix(
    val lat: Double, val lng: Double, val acc: Double? = null, val speed: Double? = null,
    val speedAcc: Double? = null, val bearing: Double? = null, val at: Long? = null,
    val src: String? = null,            // "gps" | "network"
    val stepping: Boolean? = null,
)

data class FilteredFix(
    val lat: Double, val lng: Double, val acc: Double?, val speed: Double?, val bearing: Double?, val at: Long,
    val src: String?, val stepping: Boolean?,
    val mode: String,                   // "still" | "moving"
    val stoppedSince: Long?, val note: String?, val anchor: LatLng?, val distrust: Boolean, val dropped: Boolean = false,
)

private const val SAT_ACC = 20.0
private const val ROUGH_ACC = 30.0
private const val SAT_FRESH_MS = 22000L
private const val INIT_ROUGH_MS = 8000L
private const val ACC_FLOOR = 6.0
private const val ACC_TRUST = 1.3
private const val STILL_SPEED = 0.5
private const val GO_SPEED = 0.55
private const val FAST_SPEED = 2.5
private const val STEP_MOVE_MIN_M = 2.0
private const val STEP_MOVE_ACC_K = 0.4
private const val GO_FIXES = 2
private const val ENTER_MS = 5000L
private const val ENTER_FIXES = 4
private const val NO_SPEED_ENTER_MS = 20000L
private const val FAR_M = 30.0
private const val FAR_AGREE_M = 25.0
private const val FAR_STILL_MS = 45000L
private const val WALK_EXIT_METERS = 8.0
private const val NOISE_K = 2.0
private const val WALK_MAX_ACC = 25.0
private const val SPEED_NOISE_FLOOR = 1.2
private const val SIGMA_A_MIN = 0.8
private const val SIGMA_A_MAX = 4.0
private const val GAP_RESET_MS = 60000L
private const val SPARSE_DT = 2.5
private const val DT_SAMPLES = 5
private const val DT_MAX_S = 20.0
private const val DOP_CHECK_MIN_MS = 5000L
private const val DOP_CHECK_FACTOR = 0.3
private const val DOP_CHECK_MAX_ACC = 20.0
private const val GO_FIX_ACC = 15.0
private const val ACQ_MAX_ACC = 25.0
private const val ACQ_MIN_FIXES = 5
private const val ACQ_MIN_MS = 12000L
private const val ACQ_MAX_MS = 20000L
private const val ACQ_MIN_FIXES_SPARSE = 3
private const val ACQ_INLIER_MIN_M = 8.0
private const val ACQ_INLIER_MAX_M = 20.0
private const val ACQ_INLIER_K = 1.5
private const val ACQ_MIN_SHARE = 0.6
private const val ACQ_MAX_RMS = 12.0
private const val ACQ_STEP_FIXES = 2
private const val CAND_MAX_ACC = 20.0
private const val CAND_NEAR_M = 7.0
private const val CAND_VISIT_M = 4.5
private const val CAND_AGREE_M = 7.0
private const val CAND_MIN_FIXES = 25
private const val CAND_MIN_MS = 120000L
private const val CAND_MAX_RMS = 4.5
private const val CAND_RMS_ACC_K = 0.75
private const val CAND_NEAR_RESET = 3
private const val CAND_NEAR_WIN_MS = 20000L
private const val CAND_START_FIXES = 8
private const val FAST_ACC_MAX = 5.0
private const val FAST_MIN_MS = 12000L
private const val FAST_MIN_FIXES = 8
private const val FAST_DIST_K = 2.0
private const val FAST_NEAR_M = 5.5
private const val FAST_NEAR_K = 2.0
private const val SHOWN_EASE_MIN_M = 1.5
private const val M_LAT = 110540.0

private data class Vec(val x: Double, val y: Double)
private class Axis(var p: Double, var v: Double, var Ppp: Double, var Ppv: Double, var Pvv: Double)
private data class WP(val p: Vec, val w: Double)
private data class Rec(val p: Vec, val w: Double, val at: Long, val speed: Double?)
private data class Acq(val p: Vec, val w: Double, val at: Long, val speed: Double?, val acc: Double)
private data class Far(val p: Vec, val at: Long, val dopStill: Boolean, val afterGap: Boolean)
private data class PFar(val p: Vec, val at: Long, val acc: Double?)
private data class Cand(val p: Vec, val at: Long, val acc: Double)
private class Cluster(val c: Vec, val inl: List<Acq>, val rms: Double)
private enum class Mode { INIT, MOVING, STILL }

class DriftFilter {
    private var lat0 = 0.0; private var lng0 = 0.0; private var haveOrigin = false
    private fun toXY(lat: Double, lng: Double) = Vec((lng - lng0) * cos(Math.toRadians(lat0)) * 111320.0, (lat - lat0) * M_LAT)
    private fun toLL(v: Vec) = LatLng(lat0 + v.y / M_LAT, lng0 + v.x / (cos(Math.toRadians(lat0)) * 111320.0))

    private var mode = Mode.INIT
    private var kx: Axis? = null; private var ky: Axis? = null
    private var lastAt: Long? = null; private var lastSatAt: Long? = null; private var initRoughAt: Long? = null
    private var last: FilteredFix? = null
    private var lastBearing: Double? = null
    private var anchor = Vec(0.0, 0.0); private var shown = Vec(0.0, 0.0)
    private var rms2 = 36.0
    private var stillSince: Long? = null
    private var fastHist = ArrayList<Boolean>()
    private var far = ArrayList<Far>()
    private var pendingFar = ArrayList<PFar>()
    private var recent = ArrayList<Rec>()
    private var acq = ArrayList<Acq>()
    private var acqStepHits = 0
    private var initAt: Long? = null
    private var cand = ArrayList<Cand>()
    private var candMiss = 0
    private var candNear = ArrayList<Long>()
    private var dts = ArrayList<Double>()
    private var dopDistrust = false
    private var note: String? = null

    private fun f1(x: Double) = String.format(Locale.US, "%.1f", x).replace('.', ',')
    private fun say(t: String) { note = if (note != null) "$note · $t" else t }

    private fun predict(a: Axis, dt: Double, sa: Double) {
        val q = sa * sa
        a.p += a.v * dt
        val ppp = a.Ppp + 2 * dt * a.Ppv + dt * dt * a.Pvv + q * dt.pow(4) / 4
        val ppv = a.Ppv + dt * a.Pvv + q * dt.pow(3) / 2
        val pvv = a.Pvv + q * dt * dt
        a.Ppp = ppp; a.Ppv = ppv; a.Pvv = pvv
    }
    private fun updPos(a: Axis, z: Double, r: Double) {
        val s = a.Ppp + r; val kp = a.Ppp / s; val kv = a.Ppv / s; val y = z - a.p
        a.p += kp * y; a.v += kv * y
        val ppp = (1 - kp) * a.Ppp; val ppv = (1 - kp) * a.Ppv; val pvv = a.Pvv - kv * a.Ppv
        a.Ppp = ppp; a.Ppv = ppv; a.Pvv = pvv
    }
    private fun updVel(a: Axis, z: Double, r: Double) {
        val s = a.Pvv + r; val kp = a.Ppv / s; val kv = a.Pvv / s; val y = z - a.v
        a.p += kp * y; a.v += kv * y
        val ppp = a.Ppp - kp * a.Ppv; val ppv = a.Ppv - kp * a.Pvv; val pvv = a.Pvv - kv * a.Pvv
        a.Ppp = ppp; a.Ppv = ppv; a.Pvv = pvv
    }
    private fun wmean(pts: List<WP>): Vec {
        var sw = 0.0; var sx = 0.0; var sy = 0.0
        for (q in pts) { sw += q.w; sx += q.p.x * q.w; sy += q.p.y * q.w }
        return if (sw > 0) Vec(sx / sw, sy / sw) else Vec(0.0, 0.0)
    }
    private fun mean(pts: List<Vec>) = wmean(pts.map { WP(it, 1.0) })
    private fun geoMedian(pts: List<WP>): Vec {
        var c = wmean(pts)
        for (i in 0 until 25) {
            var sw = 0.0; var sx = 0.0; var sy = 0.0
            for (q in pts) { val k = q.w / max(0.5, hypot(q.p.x - c.x, q.p.y - c.y)); sw += k; sx += q.p.x * k; sy += q.p.y * k }
            val n = Vec(sx / sw, sy / sw)
            val moved = hypot(n.x - c.x, n.y - c.y)
            c = n
            if (moved < 0.01) break
        }
        return c
    }
    private fun rmsAround(pts: List<Vec>, c: Vec) = sqrt(pts.sumOf { (it.x - c.x).pow(2) + (it.y - c.y).pow(2) } / max(1, pts.size))

    private fun acqCluster(pts: List<Acq>, minFixes: Int): Cluster? {
        if (pts.size < minFixes) return null
        val c0 = geoMedian(pts.map { WP(it.p, it.w) })
        val accs = pts.map { it.acc }.sorted()
        val thr = min(ACQ_INLIER_MAX_M, max(ACQ_INLIER_MIN_M, ACQ_INLIER_K * accs[accs.size / 2]))
        val inl = pts.filter { hypot(it.p.x - c0.x, it.p.y - c0.y) <= thr }
        if (inl.size < minFixes || inl.size < ACQ_MIN_SHARE * pts.size) return null
        if (inl.last().at - inl.first().at < ACQ_MIN_MS * 0.75) return null
        val c = wmean(inl.map { WP(it.p, it.w) })
        val rms = rmsAround(inl.map { it.p }, c)
        if (rms > ACQ_MAX_RMS) return null
        if (inl.any { it.speed == null }) {
            val third = max(1, inl.size / 3)
            val c1 = wmean(inl.take(third).map { WP(it.p, it.w) }); val c2 = wmean(inl.takeLast(third).map { WP(it.p, it.w) })
            if (hypot(c1.x - c2.x, c1.y - c2.y) > 3 + 0.5 * rms) return null
        }
        return Cluster(c, inl, rms)
    }
    private fun dtEst(): Double { if (dts.isEmpty()) return 1.0; val q = dts.sorted(); return q[q.size / 2] }
    private fun robustSpread(pts: List<Vec>, c: Vec): Double {
        val d = pts.map { hypot(it.x - c.x, it.y - c.y) }.sorted()
        val lim = max(6.0, 3 * d[d.size / 2])
        return rmsAround(pts.filter { hypot(it.x - c.x, it.y - c.y) <= lim }, c)
    }
    private fun candFlat(pts: List<Vec>, rms: Double): Boolean {
        val n = pts.size / 3
        if (n < 2) return false
        val c1 = mean(pts.take(n)); val c2 = mean(pts.subList(n, 2 * n)); val c3 = mean(pts.takeLast(n))
        val tol = 1.5 + (2.5 * max(rms, 1.0)) / sqrt(n.toDouble())
        return hypot(c2.x - (c1.x + c3.x) / 2, c2.y - (c1.y + c3.y) / 2) <= tol && hypot(c3.x - c1.x, c3.y - c1.y) <= 2 * tol
    }
    private fun resetCand() { cand = ArrayList(); candMiss = 0; candNear = ArrayList() }
    private fun candCenter() = mean(cand.map { it.p })

    private fun emit(fix: RawFix, pos: LatLng, at: Long, hasSpeed: Boolean = false, speed: Double? = null, hasBearing: Boolean = false, bearing: Double? = null): FilteredFix {
        val still = mode == Mode.STILL
        val out = FilteredFix(
            lat = pos.lat, lng = pos.lng, acc = fix.acc, speed = if (hasSpeed) speed else fix.speed,
            bearing = if (hasBearing) bearing else fix.bearing, at = at, src = fix.src, stepping = fix.stepping,
            mode = if (still) "still" else "moving", stoppedSince = if (still) stillSince else null,
            note = note, anchor = if (still) toLL(anchor) else null, distrust = dopDistrust,
        )
        note = null
        last = out
        return out
    }
    private fun toMoving(pos: Vec, posVar: Double) {
        mode = Mode.MOVING; stillSince = null
        kx = Axis(pos.x, 0.0, posVar, 0.0, 4.0); ky = Axis(pos.y, 0.0, posVar, 0.0, 4.0)
        fastHist = ArrayList(); far = ArrayList(); pendingFar = ArrayList(); recent = ArrayList(); acq = ArrayList(); acqStepHits = 0; resetCand()
    }
    private fun toStill(pos: Vec, spread2: Double, since: Long) {
        mode = Mode.STILL; stillSince = since
        anchor = pos; shown = pos
        rms2 = max(spread2, 9.0)
        fastHist = ArrayList(); far = ArrayList(); pendingFar = ArrayList(); acq = ArrayList(); acqStepHits = 0; resetCand()
    }

    fun filter(fix: RawFix): FilteredFix {
        val at = fix.at ?: System.currentTimeMillis()
        val prevLast = last
        if (lastAt != null && at <= lastAt!! && prevLast != null) return prevLast.copy()

        // 1) Pontosság-hierarchia
        val satQuality = fix.src != "network" && fix.acc != null && fix.acc < SAT_ACC
        val rough = fix.src == "network" || fix.acc == null || fix.acc > ROUGH_ACC
        val satFresh = lastSatAt != null && at - lastSatAt!! < SAT_FRESH_MS
        if (rough && satFresh && prevLast != null) return prevLast.copy(at = at, note = null, dropped = true)
        if (satQuality) lastSatAt = max(lastSatAt ?: at, at)

        if (!haveOrigin) { lat0 = fix.lat; lng0 = fix.lng; haveOrigin = true }
        val z = toXY(fix.lat, fix.lng)
        val sigma = max(ACC_FLOOR, (fix.acc ?: 15.0) * ACC_TRUST)
        val w = 1 / (sigma * sigma)
        val dt = if (lastAt == null) 1.0 else min(30.0, max(0.2, (at - lastAt!!) / 1000.0))
        var sp: Double? = if (fix.speed != null && fix.speed.isFinite() && fix.src != "network") fix.speed else null
        if (sp != null && fix.speedAcc != null && fix.speedAcc > 1) sp = null
        val dopplerOk = sp != null && (fix.acc == null || fix.acc <= ROUGH_ACC)
        if (fix.bearing != null && fix.bearing.isFinite() && (sp == null || sp > 1)) lastBearing = fix.bearing
        val prevAt = lastAt
        if (prevAt != null) {
            val gap = (at - prevAt) / 1000.0
            if (gap <= DT_MAX_S) { dts.add(max(0.2, gap)); if (dts.size > DT_SAMPLES) dts.removeAt(0) }
        }
        val dtS = dtEst(); val sparse = dtS >= SPARSE_DT

        // 2) Indítás
        if (mode == Mode.INIT) {
            if (rough && (initRoughAt == null || at - initRoughAt!! < INIT_ROUGH_MS)) {
                if (initRoughAt == null) initRoughAt = at
                lastAt = at
                return emit(fix, LatLng(fix.lat, fix.lng), at)
            }
            lastAt = at
            if (rough || (sp != null && sp >= STILL_SPEED)) {
                say(if (rough) "Indításkor csak durva (hálózati) jel van: nincs horgony, a Kalman-szűrő viszi"
                else "Indításkor már mozgást mér a Doppler (${f1(sp!! * 3.6)} km/h): nincs horgony")
                toMoving(z, sigma * sigma)
                return emit(fix, LatLng(fix.lat, fix.lng), at)
            }
            if (initAt == null) initAt = at
            if (fix.acc != null && fix.acc <= ACQ_MAX_ACC) {
                acq.add(Acq(z, w, at, sp, fix.acc))
                if (acq.size > 40) acq.removeAt(0)
                if (sp == null && fix.stepping == true) acqStepHits++
            }
            val est = if (acq.isNotEmpty()) geoMedian(acq.map { WP(it.p, it.w) }) else z
            if (acqStepHits >= ACQ_STEP_FIXES) {
                say("Indításkor járás-jelzés: mozgásnak veszi"); toMoving(est, sigma * sigma); return emit(fix, toLL(est), at)
            }
            val cl = acqCluster(acq, if (sparse) ACQ_MIN_FIXES_SPARSE else ACQ_MIN_FIXES)
            if (cl != null && at - acq[0].at >= ACQ_MIN_MS) {
                say("Horgony felvéve indításkor: ${cl.inl.size} egyező fix, szórás ${f1(cl.rms)} m")
                toStill(cl.c, cl.rms * cl.rms, cl.inl[0].at)
                recent = ArrayList(cl.inl.takeLast(8).map { Rec(it.p, it.w, it.at, it.speed) })
                return emit(fix, toLL(shown), at, hasSpeed = true, speed = 0.0)
            }
            if (at - initAt!! >= max(ACQ_MAX_MS.toDouble(), 8 * dtS * 1000).toLong()) {
                say("Indításkor sem 20 s alatt nem állt össze stabil klaszter: a Kalman-szűrő viszi tovább")
                toMoving(est, sigma * sigma); return emit(fix, toLL(est), at)
            }
            return emit(fix, toLL(est), at, hasSpeed = true, speed = null)
        }

        /* ---------- ÁLLÁS ---------- */
        if (mode == Mode.STILL) {
            val d = hypot(z.x - anchor.x, z.y - anchor.y)
            val rms = min(20.0, sqrt(rms2))
            recent.add(Rec(z, w, at, sp)); if (recent.size > 8) recent.removeAt(0)
            val dopStill = dopplerOk && sp!! < STILL_SPEED
            if (dopStill || (dopplerOk && sp!! >= FAST_SPEED)) dopDistrust = false

            val back = recent[max(0, recent.size - 6)]
            val movedRecently = recent.size >= 4 && hypot(z.x - back.p.x, z.y - back.p.y) >= max(STEP_MOVE_MIN_M, STEP_MOVE_ACC_K * (fix.acc ?: 6.0))
            val dopGo = dopplerOk && sp!! >= GO_SPEED && !(dopDistrust && sp < FAST_SPEED) &&
                (sp >= FAST_SPEED || movedRecently || fix.stepping == true)
            val stepEv = fix.stepping == true && !dopStill && (!dopplerOk || movedRecently)
            fastHist.add(dopGo || stepEv); if (fastHist.size > 3) fastHist.removeAt(0)
            val bothSensors = dopGo && fix.stepping == true && (fix.acc ?: 999.0) <= GO_FIX_ACC
            var leave = fastHist.count { it } >= GO_FIXES || (dopplerOk && sp!! >= FAST_SPEED) || bothSensors
            var relocate: Vec? = null
            var why = if (leave) {
                if (dopplerOk && sp!! >= FAST_SPEED) "gyors Doppler (${f1(sp * 3.6)} km/h)"
                else if (bothSensors) "Doppler és járás-jelzés együtt"
                else "Doppler/járás-jelzés az utolsó 3 fixből ${fastHist.count { it }}-on"
            } else ""

            val farThr = max(FAR_M, 3 * min(25.0, max(fix.acc ?: 15.0, rms)))
            if (!leave) {
                if (d > farThr) {
                    if (far.isNotEmpty()) { val fc = mean(far.map { it.p }); if (hypot(z.x - fc.x, z.y - fc.y) > FAR_AGREE_M) far = ArrayList() }
                    far.add(Far(z, at, dopStill, prevAt != null && at - prevAt > 20000))
                    val allStill = far.all { it.dopStill }
                    val stillCount = min(15, ceil(FAR_STILL_MS / 1000.0 / dtS).toInt())
                    if (allStill && far.size >= stillCount && at - far[0].at >= FAR_STILL_MS) {
                        relocate = mean(far.map { it.p })
                        leave = true
                        why = "a pozíció tartósan ${f1(hypot(relocate.x - anchor.x, relocate.y - anchor.y))} m-re van a horgonytól (${far.size} egyező fix)"
                    }
                } else if (d < farThr * 0.6) far = ArrayList()
            }

            if (!leave && !dopStill && (fix.acc ?: 999.0) <= WALK_MAX_ACC && recent.size >= 4) {
                val r4 = recent.takeLast(4)
                if (r4[3].at - r4[0].at <= max(8000.0, 3.5 * dtS * 1000)) {
                    val c = wmean(r4.map { WP(it.p, it.w) })
                    val dir = Vec(c.x - anchor.x, c.y - anchor.y)
                    val dl = hypot(dir.x, dir.y)
                    val thr = max(WALK_EXIT_METERS, NOISE_K * rms)
                    if (dl >= thr) {
                        val u = Vec(dir.x / dl, dir.y / dl)
                        val proj = r4.map { (it.p.x - anchor.x) * u.x + (it.p.y - anchor.y) * u.y }
                        val lat = r4.map { abs(-(it.p.x - anchor.x) * u.y + (it.p.y - anchor.y) * u.x) }
                        val lateral = sqrt(lat.sumOf { it * it } / lat.size)
                        val persistent = proj.sorted()[1] >= 0.5 * thr
                        leave = persistent && proj[3] >= proj[0] + 1 && proj[3] >= thr && lateral <= 0.6 * dl
                        if (leave) { relocate = c; why = "tartós, egyirányú elmozdulás ${f1(dl)} m (sebességadat nélkül)" }
                    }
                }
            }

            if (!leave) {
                val walkEv = dopGo || stepEv
                if (fix.src != "network" && (fix.acc ?: 999.0) <= CAND_MAX_ACC && !walkEv) {
                    val nearThr = if ((fix.acc ?: 999.0) <= FAST_ACC_MAX) max(FAST_NEAR_M, FAST_NEAR_K * (fix.acc ?: 3.0)) else max(CAND_NEAR_M, fix.acc ?: 10.0)
                    val visitThr = max(CAND_VISIT_M, 0.6 * (fix.acc ?: 10.0))
                    if (d >= nearThr && d < farThr) {
                        if (cand.isEmpty()) cand.add(Cand(z, at, fix.acc ?: 10.0))
                        else {
                            val cc = candCenter()
                            if (hypot(z.x - cc.x, z.y - cc.y) <= CAND_AGREE_M) cand.add(Cand(z, at, fix.acc ?: 10.0))
                            else if (++candMiss > 2 + 0.25 * cand.size) { resetCand(); cand.add(Cand(z, at, fix.acc ?: 10.0)) }
                        }
                        if (cand.size > 300) cand.removeAt(0)
                    } else if (d < visitThr && cand.isNotEmpty()) {
                        val win = max(CAND_NEAR_WIN_MS.toDouble(), 4 * dtS * 1000)
                        candNear = ArrayList(candNear.filter { at - it <= win }); candNear.add(at)
                        if (candNear.size >= (if (dtS >= 2) 2 else CAND_NEAR_RESET)) resetCand()
                    }
                    val inCluster = cand.isNotEmpty() && cand.last().at == at
                    if (cand.isNotEmpty()) {
                        val good = cand.filter { it.acc <= FAST_ACC_MAX }
                        val fastMin = max(5, min(FAST_MIN_FIXES, floor(0.8 * FAST_MIN_MS / 1000 / dtS).toInt()))
                        if (inCluster && good.size >= fastMin && at - good[0].at >= FAST_MIN_MS && at - good.last().at <= 5000) {
                            val gc = mean(good.map { it.p })
                            val grms = rmsAround(good.map { it.p }, gc); val gmv = hypot(gc.x - anchor.x, gc.y - anchor.y)
                            val ga = good.map { it.acc }.sorted(); val gacc = ga[good.size / 2]
                            if (gmv >= max(FAST_NEAR_M, FAST_DIST_K * gacc) && grms <= max(2.0, CAND_RMS_ACC_K * gacc) && candFlat(good.map { it.p }, grms)) {
                                say("Gyors horgonykorrekció ${f1(gmv)} m-rel: ${good.size} pontos fix (±${gacc.toInt()} m) ${((at - good[0].at) / 1000.0).roundToLong()} s alatt")
                                anchor = gc; resetCand(); far = ArrayList()
                            }
                        }
                    }
                    val candMin = max(8, min(CAND_MIN_FIXES, floor(0.8 * CAND_MIN_MS / 1000 / dtS).toInt()))
                    if (inCluster && cand.size >= candMin && at - cand[0].at >= CAND_MIN_MS) {
                        val cc = candCenter()
                        val crms = rmsAround(cand.map { it.p }, cc); val mv = hypot(cc.x - anchor.x, cc.y - anchor.y)
                        val accs = cand.map { it.acc }.sorted()
                        val rmsLimit = max(CAND_MAX_RMS, CAND_RMS_ACC_K * accs[accs.size / 2])
                        if (crms <= rmsLimit && candFlat(cand.map { it.p }, crms)) {
                            say("Horgonykorrekció ${f1(mv)} m-rel: ${cand.size} egyező fix ${((at - cand[0].at) / 1000.0).roundToLong()} s alatt")
                            anchor = cc; resetCand(); far = ArrayList()
                        }
                    }
                }
                val gap = hypot(anchor.x - shown.x, anchor.y - shown.y)
                if (gap > 0) {
                    val step = min(gap, max(SHOWN_EASE_MIN_M, 0.25 * gap))
                    shown = if (step >= gap) anchor else Vec(shown.x + (anchor.x - shown.x) * step / gap, shown.y + (anchor.y - shown.y) * step / gap)
                }
                val dl = min(d, 1.5 * rms + 3)
                rms2 = 0.95 * rms2 + 0.05 * dl * dl
                lastAt = at
                return emit(fix, toLL(shown), at, hasSpeed = true, speed = 0.0, hasBearing = true, bearing = lastBearing)
            }

            // Kilépés
            say("Kilépés az állásból: $why")
            if (relocate != null && far.isNotEmpty() && far.all { it.dopStill }) {
                say("Áthelyeződés ${f1(hypot(relocate.x - anchor.x, relocate.y - anchor.y))} m-rel (a Doppler végig állást mondott)")
                toStill(relocate, rms2, far[0].at)
                lastAt = at
                return emit(fix, toLL(shown), at, hasSpeed = true, speed = 0.0, hasBearing = true, bearing = lastBearing)
            }
            val v0 = if (sp != null && fix.bearing != null && sp >= GO_SPEED)
                Vec(sp * sin(Math.toRadians(fix.bearing)), sp * cos(Math.toRadians(fix.bearing))) else Vec(0.0, 0.0)
            var start: Vec = relocate ?: anchor
            var startVar = if (relocate != null) sigma * sigma else max(rms2, 9.0)
            if (relocate == null && cand.size >= CAND_START_FIXES && at - cand.last().at <= 15000) {
                val cc = candCenter(); val cr = rmsAround(cand.map { it.p }, cc)
                if (cr <= CAND_MAX_RMS) { start = cc; startVar = max(cr * cr, 9.0) }
            }
            toMoving(start, startVar)
            kx!!.v = v0.x; ky!!.v = v0.y
        }

        /* ---------- MOZGÁS (Kalman) ---------- */
        if (prevAt != null && at - prevAt > GAP_RESET_MS) { say("Hosszú jelszünet után a követés újraindult"); toMoving(z, sigma * sigma) }
        val distrustBefore = dopDistrust; val sp0 = sp
        if (sp != null && sp < STILL_SPEED) dopDistrust = false
        else if (sp != null && sp >= FAST_SPEED) dopDistrust = false
        else if (sp != null && fix.stepping != true && (fix.acc ?: 999.0) <= DOP_CHECK_MAX_ACC) {
            val span = max(8000.0, 3 * dtS * 1000)
            val pts = recent.filter { at - it.at <= span }.map { it.p to it.at } + (z to at)
            var verdict = "unknown"
            if (pts.size >= 5 && at - pts[0].second >= DOP_CHECK_MIN_MS) {
                val n = max(1, pts.size / 3)
                val head = pts.take(n); val tail = pts.takeLast(n)
                val c1 = mean(head.map { it.first }); val c2 = mean(tail.map { it.first })
                val el = (tail.sumOf { it.second.toDouble() } / n - head.sumOf { it.second.toDouble() } / n) / 1000
                if (el >= 3) {
                    val margin = max(max(2.0, DOP_CHECK_FACTOR * sp * el), 1.2 * robustSpread(pts.map { it.first }, geoMedian(pts.map { WP(it.first, 1.0) })))
                    val disp = hypot(c2.x - c1.x, c2.y - c1.y)
                    verdict = if (disp < margin) "bad" else if (disp >= 1.5 * margin) "ok" else "unknown"
                }
            }
            if (verdict == "bad") dopDistrust = true else if (verdict == "ok") dopDistrust = false
            if (sp >= GO_SPEED && dopDistrust) sp = 0.0
        }
        if (!distrustBefore && dopDistrust) say("A Doppler ${f1(sp0!! * 3.6)} km/h-t mond, de a pozíciók nem mozdulnak: nem vesszük figyelembe")
        else if (distrustBefore && !dopDistrust) say("A Doppler újra hiteles")
        val kxx = kx!!; val kyy = ky!!
        val v = hypot(kxx.v, kyy.v)
        val sa = min(SIGMA_A_MAX, max(SIGMA_A_MIN, 0.5 + 0.35 * v))
        predict(kxx, dt, sa); predict(kyy, dt, sa)
        val rm = sigma * sigma
        val nis = (z.x - kxx.p).pow(2) / (kxx.Ppp + rm) + (z.y - kyy.p).pow(2) / (kyy.Ppp + rm)
        val supported = sp != null && sp >= 2
        if (nis > 16 && !supported) {
            val pl = pendingFar.lastOrNull()
            if (pl != null && hypot(z.x - pl.p.x, z.y - pl.p.y) <= FAR_AGREE_M) pendingFar.add(PFar(z, at, fix.acc))
            else pendingFar = arrayListOf(PFar(z, at, fix.acc))
            val pg = pendingFar.filter { it.acc != null && it.acc <= 25 }
            if (pg.size >= 3 && pg.last().at - pg[0].at >= 5000) {
                val j = mean(pg.map { it.p })
                kxx.p = j.x; kyy.p = j.y; kxx.v = 0.0; kyy.v = 0.0; kxx.Ppp = rm; kyy.Ppp = rm; kxx.Pvv = 4.0; kyy.Pvv = 4.0; kxx.Ppv = 0.0; kyy.Ppv = 0.0
                say("Pozícióugrás elfogadva (${pg.size} egyező fix, ${((pg.last().at - pg[0].at) / 1000.0).roundToLong()} s)")
                pendingFar = ArrayList(); recent = ArrayList(); lastAt = at
                return emit(fix, toLL(j), at, hasSpeed = true, speed = sp ?: 0.0, hasBearing = true, bearing = fix.bearing ?: lastBearing)
            }
            say("Kiugró fix visszatartva (tartós klaszter megerősítésére vár)")
            lastAt = at
            return emit(fix, toLL(Vec(kxx.p, kyy.p)), at, hasSpeed = true, speed = sp ?: hypot(kxx.v, kyy.v), hasBearing = true, bearing = fix.bearing ?: lastBearing)
        }
        pendingFar = ArrayList()
        updPos(kxx, z.x, rm); updPos(kyy, z.y, rm)
        if (sp != null) {
            if (sp >= 0.7 && fix.bearing != null && fix.bearing.isFinite()) {
                val b = Math.toRadians(fix.bearing); val r = 0.8 * 0.8 + (0.15 * sp).pow(2)
                updVel(kxx, sp * sin(b), r); updVel(kyy, sp * cos(b), r)
            } else if (sp < GO_SPEED) {
                val r = if (sp < STILL_SPEED) 0.3 * 0.3 else 0.5 * 0.5
                updVel(kxx, 0.0, r); updVel(kyy, 0.0, r)
            } else {
                val cur = hypot(kxx.v, kyy.v)
                if (cur > 0.1) { val k = min(1.0, sp / cur); kxx.v *= k; kyy.v *= k }
            }
        }

        recent.add(Rec(z, w, at, sp)); if (recent.size > 24) recent.removeAt(0)
        val longWin = max(if (recent.any { it.speed == null }) NO_SPEED_ENTER_MS.toDouble() else ENTER_MS.toDouble(), 4 * dtS * 1000)
        val wnd = recent.filter { at - it.at <= longWin }
        if (wnd.size >= ENTER_FIXES && at - wnd[0].at >= longWin * 0.8) {
            val slow = wnd.all { it.speed == null || it.speed <= STILL_SPEED + 0.3 }
            val c = geoMedian(wnd.map { WP(it.p, it.w) })
            val rms = robustSpread(wnd.map { it.p }, c)
            val third = max(1, wnd.size / 3)
            val c1 = wmean(wnd.take(third).map { WP(it.p, it.w) }); val c2 = wmean(wnd.takeLast(third).map { WP(it.p, it.w) })
            val net = hypot(c1.x - c2.x, c1.y - c2.y)
            val doppler = wnd.all { it.speed != null }
            if (slow && rms <= (if (doppler) 60 else 45) && (doppler || net <= 6 + 0.5 * rms)) {
                say("Állásba lépett: ${wnd.size} fix, szórás ${f1(rms)} m, ${if (doppler) "Doppler-állás" else "sebességadat nélkül"}; horgony a nyers pontok mediánjára")
                toStill(c, rms * rms, wnd[0].at)
                lastAt = at
                return emit(fix, toLL(shown), at, hasSpeed = true, speed = 0.0, hasBearing = true, bearing = lastBearing)
            }
        }

        lastAt = at
        val pos = toLL(Vec(kxx.p, kyy.p))
        val spd = hypot(kxx.v, kyy.v)
        val displaySpeed: Double
        if (dopplerOk && sp != null && (fix.acc ?: 999.0) <= WALK_MAX_ACC) {
            displaySpeed = if (sp >= STILL_SPEED) sp else 0.0
        } else {
            val win = recent.takeLast(6)
            var est = 0.0
            if (win.size >= 4) {
                val half = win.size / 2
                val a = win.take(half); val b = win.takeLast(half)
                val ca = wmean(a.map { WP(it.p, it.w) }); val cb = wmean(b.map { WP(it.p, it.w) })
                val ta = a.sumOf { it.at.toDouble() } / a.size; val tb = b.sumOf { it.at.toDouble() } / b.size
                val disp = hypot(cb.x - ca.x, cb.y - ca.y)
                val el = max(0.5, (tb - ta) / 1000)
                val margin = max(2.5, 0.6 * (fix.acc ?: 15.0))
                if (disp >= margin && disp / el >= SPEED_NOISE_FLOOR) est = min(spd, disp / el)
            }
            displaySpeed = if (est >= SPEED_NOISE_FLOOR) est else 0.0
        }
        val bearing = if (displaySpeed >= 0.8) (Math.toDegrees(atan2(kxx.v, kyy.v)) + 360) % 360 else fix.bearing ?: lastBearing
        return emit(fix, pos, at, hasSpeed = true, speed = displaySpeed, hasBearing = true, bearing = bearing)
    }
}
