package hu.privateplace.app.domain

import kotlin.math.sqrt

/**
 * Testmozgás-érzékelés tiszta logikája (a gyorsulásmérő nyers mintáiból). Nem GPS: a pozícióhibától független bizonyíték.
 * - [StillnessDetector]: a telefon fizikailag mozdulatlan (asztalon, zsebben álló emberen) → a GPS-zaj nem mozgás.
 * - [StepWindow]: lépésesemények (TYPE_STEP_DETECTOR) frissessége → "stepping" jelzés a drift-szűrőnek.
 */
class StillnessDetector(private val onChange: (Boolean) -> Unit) {
    private val samples = ArrayDeque<Pair<Long, Double>>()
    var still = false; private set
    private var stillCandidateAt = 0L

    fun onSample(now: Long, x: Double, y: Double, z: Double) {
        samples.addLast(now to sqrt(x * x + y * y + z * z))
        while (samples.isNotEmpty() && now - samples.first().first > 3000) samples.removeFirst()
        if (samples.size < 15 || now - samples.first().first < 2500) return
        val mean = samples.sumOf { it.second } / samples.size
        val sd = sqrt(samples.sumOf { (it.second - mean) * (it.second - mean) } / samples.size)
        if (sd < STILL_SD) {
            if (stillCandidateAt == 0L) stillCandidateAt = now
            if (!still && now - stillCandidateAt >= STILL_HOLD_MS) { still = true; onChange(true) }
        } else if (sd > MOVE_SD) {
            stillCandidateAt = 0L
            if (still) { still = false; onChange(false) }
        }
    }

    companion object { const val STILL_SD = 0.12; const val MOVE_SD = 0.30; const val STILL_HOLD_MS = 4000L }
}

/** Igaz, ha az utóbbi [windowMs]-ban volt lépésesemény. */
class StepWindow(private val windowMs: Long = 2500L) {
    private var last = 0L
    fun hit(now: Long) { last = now }
    fun active(now: Long) = last != 0L && now - last <= windowMs
}

/** Két ujjlenyomat (azonosító-halmaz) hasonlósága: Jaccard-index, 0..1; üres/üres = 1. */
fun fingerprintSimilarity(a: Set<String>, b: Set<String>): Double {
    if (a.isEmpty() && b.isEmpty()) return 1.0
    val inter = a.count { it in b }
    val union = a.size + b.size - inter
    return if (union == 0) 1.0 else inter.toDouble() / union
}

/** Környezeti jelcsatornák (Wi-Fi, mobilcella, közeli Bluetooth-eszközök) változásából következtet elmozdulásra. */
class EnvironmentTracker(private val onMoved: () -> Unit, private val minChannels: Int = 2) {
    private val last = HashMap<String, Set<String>>()
    private val changed = HashMap<String, Long>()

    /** Egy csatorna új pillanatképe. Elmozdulás: legalább [minChannels] csatorna érdemben megváltozott az utóbbi 90 mp-ben. */
    fun observe(channel: String, ids: Set<String>, now: Long, minSize: Int = 2) {
        val prev = last.put(channel, ids)
        if (prev == null) return
        val differs = if (channel == CELL) ids.isNotEmpty() && prev.isNotEmpty() && prev.intersect(ids).isEmpty()
        else (prev.size >= minSize || ids.size >= minSize) && fingerprintSimilarity(prev, ids) < 0.34
        if (differs) changed[channel] = now
        changed.values.removeAll { now - it > 90_000L }
        if (changed.size >= minChannels) { changed.clear(); onMoved() }
    }

    fun reset() { last.clear(); changed.clear() }
    companion object { const val WIFI = "wifi"; const val CELL = "cell"; const val BLE = "ble" }
}
