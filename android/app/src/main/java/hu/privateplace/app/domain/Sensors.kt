package hu.privateplace.app.domain

import kotlin.math.sqrt

/**
 * Járás-szerű mozgás gyorsulásmérőből (tiszta függvény): elég nagy ingadozás (RMS) és lépésütemnek megfelelő átmenetszám.
 * Nem GPS, ezért a pozícióhibától független bizonyíték az induláshoz.
 */
fun looksLikeWalking(mags: List<Double>, hz: Double): Boolean {
    if (mags.size < hz) return false
    val mean = mags.average()
    val dev = mags.map { it - mean }
    val rms = sqrt(dev.sumOf { it * it } / dev.size)
    var cross = 0
    for (i in 1 until dev.size) if ((dev[i - 1] < 0) != (dev[i] < 0)) cross++
    val perSec = cross / (mags.size / hz)
    return rms >= 0.65 && perSec >= 2.4 && perSec <= 5.5
}

/** Igaz, ha az utóbbi ~3 s-ban járás-szerű mozgás volt (a hívó a SensorEvent-eket adja be; 2 mp-es ablak, 0,5 mp-enkénti kiértékelés). */
class WalkingDetector(private val onWalking: (Boolean) -> Unit) {
    private val samples = ArrayDeque<Pair<Long, Double>>()
    private var walking = false; private var lastPositive = 0L; private var positives = 0; private var lastEval = 0L
    private fun set(v: Boolean) { if (v != walking) { walking = v; onWalking(v) } }
    fun onSample(now: Long, x: Double, y: Double, z: Double) {
        samples.addLast(now to sqrt(x * x + y * y + z * z))
        while (samples.isNotEmpty() && now - samples.first().first > 2000) samples.removeFirst()
        if (now - lastEval < 500 || samples.size < 20) return
        lastEval = now
        val hz = samples.size / maxOf(0.5, (samples.last().first - samples.first().first) / 1000.0)
        if (looksLikeWalking(samples.map { it.second }, hz)) { positives++; lastPositive = now } else positives = 0
        if (positives >= 2) set(true) else if (now - lastPositive > 3000) set(false)
    }
}
