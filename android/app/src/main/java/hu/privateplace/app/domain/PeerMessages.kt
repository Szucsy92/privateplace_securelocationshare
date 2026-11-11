package hu.privateplace.app.domain

import org.json.JSONObject

/** A telefonok között közvetlenül küldött üzenetek és azok ellenőrzése – minden bejövő adat itt validálódik. */
data class HelloMessage(val deviceId: String, val name: String, val avatar: String?, val want: Boolean = false)

data class LocationMessage(
    val lat: Double, val lng: Double, val t: Long, val acc: Double?, val speed: Double?,
    val heading: Double? = null, val battery: Double? = null, val since: Long? = null,
    val stoppedSince: Long? = null, val transport: TransportMode? = null,
)

/** Ok(null) = a küldő kikapcsolta a megosztást. */
sealed class ParsedLoc { object Invalid : ParsedLoc(); data class Ok(val msg: LocationMessage?) : ParsedLoc() }

private const val MAX_AVATAR_CHARS = 80_000
private val DEVICE_ID = Regex("^[A-Za-z0-9_-]{8,64}$")
private val AVATAR = Regex("^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")
private val TOKEN20 = Regex("^[A-HJ-NP-Z2-9]{20}$")
private val SIG = Regex("^[A-Za-z0-9_-]{80,100}$")

fun isDeviceId(s: String) = DEVICE_ID.matches(s)

private fun num(o: JSONObject, k: String): Double? = (o.opt(k) as? Number)?.toDouble()?.takeIf { it.isFinite() }

fun parseHello(d: Any?): HelloMessage? {
    val o = d as? JSONObject ?: return null
    val id = o.opt("deviceId") as? String ?: return null
    if (!DEVICE_ID.matches(id)) return null
    val name = (o.opt("name") as? String)?.trim()?.take(40) ?: ""
    val av = (o.opt("avatar") as? String)?.takeIf { it.length <= MAX_AVATAR_CHARS && AVATAR.matches(it) }
    return HelloMessage(id, name.ifEmpty { "Névtelen" }, av, o.opt("want") == true)
}

fun parseLocation(d: Any?, now: Long = System.currentTimeMillis()): ParsedLoc {
    if (d == null || d == JSONObject.NULL) return ParsedLoc.Ok(null)
    val o = d as? JSONObject ?: return ParsedLoc.Invalid
    val lat = num(o, "lat") ?: return ParsedLoc.Invalid
    val lng = num(o, "lng") ?: return ParsedLoc.Invalid
    val tD = num(o, "t") ?: return ParsedLoc.Invalid
    val t = tD.toLong()
    // Értelmetlen időbélyeg nem kerülhet az állapotba (a „legújabb mérés” védelme minden valódi mérést eldobna).
    if (t < 0 || t > now + 5 * 60_000) return ParsedLoc.Invalid
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return ParsedLoc.Invalid
    val acc = num(o, "acc")?.takeIf { it >= 0 }
    val speed = num(o, "speed")?.takeIf { it >= 0 }
    val heading = num(o, "heading")?.takeIf { it >= 0 && it < 360 }
    val battery = num(o, "battery")?.takeIf { it in 0.0..100.0 }
    val since = num(o, "since")?.toLong()?.takeIf { it in 0..t }
    val stopped = num(o, "stoppedSince")?.toLong()?.takeIf { it in 0..t }
    return ParsedLoc.Ok(LocationMessage(lat, lng, t, acc, speed, heading, battery, since, stopped, TransportMode.fromWire(o.opt("transport"))))
}

fun LocationMessage?.toJson(): Any = if (this == null) JSONObject.NULL else JSONObject().apply {
    put("lat", lat); put("lng", lng); put("t", t)
    put("acc", acc ?: JSONObject.NULL); put("speed", speed ?: JSONObject.NULL)
    put("heading", heading ?: JSONObject.NULL); put("battery", battery ?: JSONObject.NULL)
    put("since", since ?: JSONObject.NULL); put("stoppedSince", stoppedSince ?: JSONObject.NULL)
    transport?.let { put("transport", it.wire) }
}

fun HelloMessage.toJson() = JSONObject().apply {
    put("deviceId", deviceId); put("name", name); put("avatar", avatar ?: JSONObject.NULL); if (want) put("want", true)
}

/** Megosztáskérés: csak a pontosan `true` érték érvényes. */
fun parseShareRequest(d: Any?) = d == true

data class RoomControl(val kind: String, val token: String, val target: String?, val at: Long, val nonce: String, val signature: String) {
    fun toJson() = JSONObject().apply {
        put("kind", kind); put("token", token); put("target", target ?: JSONObject.NULL)
        put("at", at); put("nonce", nonce); put("signature", signature)
    }
}

fun parseRoomControl(d: Any?, now: Long = System.currentTimeMillis()): RoomControl? {
    val o = d as? JSONObject ?: return null
    val kind = o.opt("kind") as? String
    if (kind != "close" && kind != "kick") return null
    val token = o.opt("token") as? String ?: return null
    if (!TOKEN20.matches(token)) return null
    val rawTarget = o.opt("target")
    val target: String? = if (kind == "close") { if (rawTarget != null && rawTarget != JSONObject.NULL) return null; null }
    else (rawTarget as? String)?.takeIf { DEVICE_ID.matches(it) } ?: return null
    val at = (o.opt("at") as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 && it <= now + 60000 }?.toLong() ?: return null
    val nonce = (o.opt("nonce") as? String)?.takeIf { DEVICE_ID.matches(it) } ?: return null
    val sig = (o.opt("signature") as? String)?.takeIf { SIG.matches(it) } ?: return null
    return RoomControl(kind, token, target, at, nonce, sig)
}

val SELECTION_COLORS = linkedMapOf("mint" to "#14B8A6", "violet" to "#818CF8", "rose" to "#FB7185", "amber" to "#FBBF24", "sky" to "#38BDF8")
val COLOR_NAMES = mapOf("mint" to "Menta Zöld", "violet" to "Elektromos Levendula", "rose" to "Selyem Barack", "amber" to "Napfény Citromsárga", "sky" to "Jégkék")
val SELF_COLOR = SELECTION_COLORS.getValue("mint")

fun colorForDevice(deviceId: String): String {
    var h = 0L
    for (ch in deviceId) h = (h * 31 + ch.code) and 0xFFFFFFFFL
    val palette = SELECTION_COLORS.values.toList()
    return palette[(h % palette.size).toInt()]
}
