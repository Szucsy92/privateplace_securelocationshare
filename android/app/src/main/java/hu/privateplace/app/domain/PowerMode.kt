package hu.privateplace.app.domain

const val ACTIVE_GPS_MS = 1000L
const val STILL_GPS_MS = 3000L
const val IDLE_GPS_MS = 5000L
const val CALM_AFTER_MS = 60_000L
const val MOVING_SPEED = 0.55

data class PowerContext(val visible: Boolean, val sharing: Boolean, val viewers: Boolean, val calm: Boolean)

fun desiredGpsIntervalMs(ctx: PowerContext): Long {
    if (ctx.visible) return ACTIVE_GPS_MS
    if (!(ctx.sharing && ctx.viewers)) return IDLE_GPS_MS
    return if (ctx.calm) STILL_GPS_MS else ACTIVE_GPS_MS
}

/** Ritkított mérésnél a nyers fixből észleli az indulást: ilyenkor azonnal vissza kell váltani 1 mp-re. */
fun movementWake(lat: Double, lng: Double, speed: Double?, acc: Double?, anchor: LatLng?): Boolean {
    if (speed != null && speed.isFinite() && speed >= MOVING_SPEED && (acc == null || acc <= 30)) return true
    if (anchor == null) return false
    val radius = (acc ?: 10.0).coerceIn(10.0, 40.0)
    return distanceMeters(anchor, LatLng(lat, lng)) > radius * 1.5
}
