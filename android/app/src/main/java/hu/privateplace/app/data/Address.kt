package hu.privateplace.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class AddressInfo(val title: String, val near: String?)

/** Csak a felhasználó beleegyezése után hívjuk: a koordináta harmadik félnek (OSM Nominatim) kerül átadásra. */
suspend fun lookupAddress(lat: Double, lng: Double): AddressInfo = withContext(Dispatchers.IO) {
    val q = mapOf("format" to "jsonv2", "lat" to lat.toString(), "lon" to lng.toString(), "zoom" to "18", "accept-language" to "hu", "addressdetails" to "1", "extratags" to "1")
        .entries.joinToString("&") { "${it.key}=${URLEncoder.encode(it.value, "UTF-8")}" }
    val c = URL("https://nominatim.openstreetmap.org/reverse?$q").openConnection() as HttpURLConnection
    c.setRequestProperty("User-Agent", "PrivatePlace-Native/1.0"); c.connectTimeout = 8000; c.readTimeout = 8000
    val root = JSONObject(c.inputStream.bufferedReader().readText())
    val a = root.optJSONObject("address") ?: error("nincs találat")
    fun s(o: JSONObject?, k: String) = o?.optString(k)?.trim()?.takeIf { it.isNotEmpty() }?.take(120)
    val extra = root.optJSONObject("extratags")
    val ref = s(extra, "ref")?.split(";")?.first()?.trim()
    val kind = root.optString("type")
    val motorway = kind == "motorway" || kind == "motorway_link"
    val major = motorway || kind == "trunk" || kind == "trunk_link" || kind == "primary"
    val road = s(a, "road") ?: s(a, "pedestrian") ?: s(a, "footway") ?: s(a, "neighbourhood") ?: s(root, "name") ?: s(a, "village")
    var title = road
    if (major && ref != null) title = if (motorway) (if (road != null && Regex("autópálya", RegexOption.IGNORE_CASE).containsMatchIn(road)) road else "$ref autópálya")
    else if (ref.all { it.isDigit() }) "$ref. sz. főút" else ref
    if (title == null) error("nincs útnév")
    if (Regex("^\\d{1,5}$").matches(title)) title = "$title. sz. út"
    val number = s(a, "house_number")
    if (number != null && !major) title = "$title $number"
    val place = s(a, "city") ?: s(a, "town") ?: s(a, "village") ?: s(a, "hamlet") ?: s(a, "municipality") ?: s(a, "suburb") ?: s(a, "county")
    AddressInfo(title, if (place != null && !title.contains(place)) "$place közelében" else null)
}
