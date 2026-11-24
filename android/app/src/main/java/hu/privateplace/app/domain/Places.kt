package hu.privateplace.app.domain

import kotlin.math.*

/**
 * Saját helyek: a felhasználó megnevez egy helyet, kijelöli, hol áll valójában, az app pedig megtanulja,
 * mennyit téved ott a telefon GPS-e. Minden adat csak ezen a telefonon marad.
 */
data class Bias(val e: Double, val n: Double)
data class Spot(val id: String, val label: String, val lat: Double, val lng: Double, val bias: Bias? = null, val learnedAt: Long? = null, val samples: Int = 0)
data class Place(val id: String, val name: String, val icon: String, val note: String, val radius: Double, val spots: List<Spot>, val createdAt: Long)
data class FixLite(val lat: Double, val lng: Double, val acc: Double?)

const val MIN_RADIUS = 5.0
const val MAX_RADIUS = 100.0
const val DEFAULT_RADIUS = 20.0
private const val MAX_PLACES = 50
private const val MAX_SPOTS = 20
private const val MAX_BIAS_M = 60.0
private const val LEARN_MIN_FIXES = 8
private const val LEARN_MAX_SPREAD_M = 3.0
private const val LEARN_MAX_ACC_M = 15.0
private const val M_PER_DEG = 111320.0

fun newId(): String = java.lang.Long.toString(System.currentTimeMillis(), 36) + java.lang.Long.toString((Math.random() * 1e6).toLong(), 36)

fun offsetPoint(p: LatLng, e: Double, n: Double) =
    LatLng(p.lat + n / M_PER_DEG, p.lng + e / (M_PER_DEG * max(0.01, cos(Math.toRadians(p.lat)))))
fun localVector(a: LatLng, b: LatLng) = Bias((b.lng - a.lng) * M_PER_DEG * cos(Math.toRadians(a.lat)), (b.lat - a.lat) * M_PER_DEG)
fun medianPoint(points: List<LatLng>): LatLng? {
    if (points.isEmpty()) return null
    fun med(v: List<Double>): Double { val s = v.sorted(); val m = s.size shr 1; return if (s.size % 2 == 1) s[m] else (s[m - 1] + s[m]) / 2 }
    return LatLng(med(points.map { it.lat }), med(points.map { it.lng }))
}

fun newPlace(name: String) = Place(newId(), name.trim().take(60).ifEmpty { "Új hely" }, "", "", DEFAULT_RADIUS, emptyList(), System.currentTimeMillis())
fun newSpot(at: LatLng, label: String = "") = Spot(newId(), label.take(60), at.lat, at.lng)
fun nudgeSpot(s: Spot, de: Double, dn: Double): Spot { val p = offsetPoint(LatLng(s.lat, s.lng), de, dn); return s.copy(lat = p.lat, lng = p.lng, bias = null, learnedAt = null, samples = 0) }

sealed class LearnResult { data class Ok(val spot: Spot) : LearnResult(); data class Fail(val reason: String) : LearnResult() }

/** Tanulás: a legutóbbi fixek mediánja és a kijelölt valódi pont különbsége; csak álló, elég pontos fixekből. */
fun learnBias(s: Spot, recent: List<FixLite>, now: Long = System.currentTimeMillis()): LearnResult {
    val good = recent.filter { it.acc == null || it.acc <= LEARN_MAX_ACC_M }
    if (good.size < LEARN_MIN_FIXES) return LearnResult.Fail(if (recent.size < LEARN_MIN_FIXES) "kevés fix" else "pontatlan")
    val c = medianPoint(good.map { LatLng(it.lat, it.lng) })!!
    val spread = sqrt(good.sumOf { distanceMeters(LatLng(it.lat, it.lng), c).pow(2) } / good.size)
    if (spread > LEARN_MAX_SPREAD_M) return LearnResult.Fail("mozgás")
    val bias = localVector(LatLng(s.lat, s.lng), c)
    if (hypot(bias.e, bias.n) > MAX_BIAS_M) return LearnResult.Fail("nagy eltérés")
    return LearnResult.Ok(s.copy(bias = bias, learnedAt = now, samples = good.size))
}

data class Applied(val point: LatLng, val placeId: String?, val spotId: String?, val shiftM: Double)

/** Korrekció: a súly a távolsággal lineárisan csökken (a hely sugaránál 0), ezért nincs ugrás a szélénél. */
fun applyPlaces(places: List<Place>, p: LatLng): Applied {
    var best: Triple<Double, Place, Spot>? = null
    for (place in places) for (spot in place.spots) {
        val b = spot.bias ?: continue
        val expected = offsetPoint(LatLng(spot.lat, spot.lng), b.e, b.n)
        val w = 1 - distanceMeters(p, expected) / place.radius
        if (w > 0 && (best == null || w > best.first)) best = Triple(w, place, spot)
    }
    val bst = best ?: return Applied(p, null, null, 0.0)
    val b = bst.third.bias!!
    return Applied(offsetPoint(p, -b.e * bst.first, -b.n * bst.first), bst.second.id, bst.third.id, hypot(b.e, b.n) * bst.first)
}

private val DIRS = listOf("É", "ÉK", "K", "DK", "D", "DNy", "Ny", "ÉNy")
fun compass(deg: Double) = DIRS[(((deg % 360) + 360) % 360 / 45).roundToInt() % 8]
fun describeVector(a: LatLng, b: LatLng): String {
    val d = distanceMeters(a, b)
    return if (d < 0.5) "egyezik" else "${String.format(java.util.Locale.US, "%.1f", d).replace('.', ',')} m ${compass(bearingDegrees(a, b))}"
}
