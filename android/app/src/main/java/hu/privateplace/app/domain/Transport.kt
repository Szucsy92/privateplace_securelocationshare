package hu.privateplace.app.domain

enum class TransportMode(val wire: String) {
    WALK("walk"), BIKE("bike"), CAR("car");
    companion object { fun fromWire(v: Any?): TransportMode? = values().firstOrNull { it.wire == v } }
}

data class TransportState(val mode: TransportMode, val candidate: TransportMode?, val candidateAt: Long)

const val TRANSPORT_HOLD_MS = 7000L

/** speed: m/s. Becslés, nem járműazonosítás. */
fun updateTransport(previous: TransportState, speed: Double?, now: Long, manual: TransportMode? = null): TransportState {
    if (manual != null) return TransportState(manual, null, now)
    if (speed == null || !speed.isFinite() || speed < 0.8) return previous.copy(candidate = null, candidateAt = now)
    val kmh = speed * 3.6
    val target = if (kmh >= 28) TransportMode.CAR else if (kmh >= 14) TransportMode.BIKE else TransportMode.WALK
    if (target == previous.mode) return previous.copy(candidate = null, candidateAt = now)
    if (target != previous.candidate) return previous.copy(candidate = target, candidateAt = now)
    if (now - previous.candidateAt >= TRANSPORT_HOLD_MS) return TransportState(target, null, now)
    return previous
}
