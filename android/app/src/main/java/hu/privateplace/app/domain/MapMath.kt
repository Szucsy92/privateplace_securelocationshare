package hu.privateplace.app.domain

import kotlin.math.*

data class LatLng(val lat: Double, val lng: Double)

/** Irányszög (fok, 0 = észak, óramutató járása szerint) két pont között. */
fun bearingDegrees(a: LatLng, b: LatLng): Double {
    val fi1 = Math.toRadians(a.lat); val fi2 = Math.toRadians(b.lat)
    val dl = Math.toRadians(b.lng - a.lng)
    val y = sin(dl) * cos(fi2)
    val x = cos(fi1) * sin(fi2) - sin(fi1) * cos(fi2) * cos(dl)
    return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
}

fun lerpPoint(a: LatLng, b: LatLng, k: Double): LatLng {
    val t = k.coerceIn(0.0, 1.0)
    return LatLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t)
}

fun animationDurationMs(prevT: Long?, nextT: Long): Long =
    if (prevT == null) 800 else (nextT - prevT).coerceIn(400, 2000)

/** Távolság méterben (haversine). */
fun distanceMeters(a: LatLng, b: LatLng): Double {
    val r = 6371000.0
    val dLat = Math.toRadians(b.lat - a.lat); val dLng = Math.toRadians(b.lng - a.lng)
    val s = sin(dLat / 2).pow(2) + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLng / 2).pow(2)
    return 2 * r * asin(min(1.0, sqrt(s)))
}

fun angleDelta(from: Double, to: Double): Double = ((((to - from) % 360) + 540) % 360) - 180

fun smoothAngle(current: Double, target: Double, factor: Double): Double =
    current + angleDelta(current, target) * factor.coerceIn(0.0, 1.0)

fun headingFromTrack(points: List<LatLng>, minMeters: Double = 3.0): Double? {
    val last = points.lastOrNull() ?: return null
    for (i in points.size - 2 downTo 0) if (distanceMeters(points[i], last) >= minMeters) return bearingDegrees(points[i], last)
    return null
}
