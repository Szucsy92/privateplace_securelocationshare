package hu.privateplace.app.data

import android.content.Context
import hu.privateplace.app.domain.*
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom

data class LocalProfile(val name: String, val avatar: String?)
data class Prefs(
    val sharing: Boolean = false, val showTrails: Boolean = false, val trailIds: List<String> = emptyList(),
    val orientation: String = "north", val mapTheme: String = "dark", val addressConsent: String = "ask", val debug: Boolean = false,
    val hint: Int = 0,                  // súgóbuborékok: következő lépés (>= összes → kész)
)

/** Helyi tárolás: az alkalmazás privát SharedPreferences-e (JSON). Nincs fiók, nincs központi tárolás. */
class Store(context: Context) {
    private val sp = context.getSharedPreferences("privateplace", Context.MODE_PRIVATE)
    private fun get(k: String) = sp.getString(k, null)
    private fun put(k: String, v: String) = sp.edit().putString(k, v).apply()

    fun loadProfile(): LocalProfile? = runCatching {
        val o = JSONObject(get("profile") ?: return null)
        val n = o.optString("name").trim(); if (n.isEmpty()) null else LocalProfile(n, o.optString("avatar").ifEmpty { null })
    }.getOrNull()
    fun saveProfile(p: LocalProfile) = put("profile", JSONObject().put("name", p.name).put("avatar", p.avatar ?: JSONObject.NULL).toString())

    fun deviceId(): String {
        val cur = get("device"); if (cur != null && isDeviceId(cur)) return cur
        val b = ByteArray(16).also { SecureRandom().nextBytes(it) }
        return b.joinToString("") { "%02x".format(it) }.also { put("device", it) }
    }

    fun loadPrefs(): Prefs = runCatching {
        val o = JSONObject(get("prefs") ?: return Prefs())
        Prefs(o.optBoolean("sharing"), o.optBoolean("showTrails"),
            o.optJSONArray("trailIds")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList(),
            o.optString("orientation", "north"), o.optString("mapTheme", "dark"), o.optString("addressConsent", "ask"), o.optBoolean("debug"), o.optInt("hint", 0))
    }.getOrDefault(Prefs())
    fun savePrefs(p: Prefs) = put("prefs", JSONObject().put("sharing", p.sharing).put("showTrails", p.showTrails)
        .put("trailIds", JSONArray(p.trailIds)).put("orientation", p.orientation).put("mapTheme", p.mapTheme)
        .put("addressConsent", p.addressConsent).put("debug", p.debug).put("hint", p.hint).toString())

    fun loadRooms(): List<SavedRoom> = runCatching {
        val a = JSONArray(get("rooms") ?: return emptyList())
        (0 until a.length()).mapNotNull { i ->
            val o = a.getJSONObject(i); val t = o.optString("token")
            if (t.length != ROOM_TOKEN_LENGTH || t.any { it !in ROOM_ALPHABET }) null
            else SavedRoom(t, o.optString("name", "Szoba"), o.optBoolean("owner"), o.optLong("createdAt"),
                o.optString("color").takeIf { isRoomColor(it) } ?: DEFAULT_ROOM_COLOR,
                o.optString("ownerKey").ifEmpty { null }, o.optString("ownerPrivateKey").ifEmpty { null })
        }
    }.getOrDefault(emptyList())
    fun saveRooms(r: List<SavedRoom>) = put("rooms", JSONArray(r.map {
        JSONObject().put("token", it.token).put("name", it.name).put("owner", it.owner).put("createdAt", it.createdAt)
            .put("color", it.color).put("ownerKey", it.ownerKey ?: JSONObject.NULL).put("ownerPrivateKey", it.ownerPrivateKey ?: JSONObject.NULL)
    }).toString())

    fun loadRosters(): Rosters = runCatching {
        val o = JSONObject(get("rosters") ?: return emptyMap())
        o.keys().asSequence().associateWith { k ->
            val a = o.getJSONArray(k)
            (0 until a.length()).mapNotNull { i -> a.getJSONObject(i).let { e ->
                val id = e.optString("deviceId"); if (isDeviceId(id)) RosterEntry(id, e.optString("name"), e.optLong("firstSeen"), e.optLong("lastSeen")) else null } }.takeLast(MAX_ROSTER_PER_ROOM)
        }
    }.getOrDefault(emptyMap())
    fun saveRosters(r: Rosters) = put("rosters", JSONObject(r.mapValues { (_, l) -> JSONArray(l.map {
        JSONObject().put("deviceId", it.deviceId).put("name", it.name).put("firstSeen", it.firstSeen).put("lastSeen", it.lastSeen) }) }).toString())

    fun loadAvatars(): Avatars = runCatching { JSONObject(get("avatars") ?: return emptyMap()).let { o -> o.keys().asSequence().associateWith { o.getString(it) } } }.getOrDefault(emptyMap())
    fun saveAvatars(a: Avatars) = put("avatars", JSONObject(a).toString())

    fun loadPersonColors(): Map<String, String> = runCatching {
        JSONObject(get("personColors") ?: return emptyMap()).let { o -> o.keys().asSequence().associateWith { o.getString(it) }.filter { isPersonColor(it.value) } }
    }.getOrDefault(emptyMap())
    fun savePersonColors(c: Map<String, String>) = put("personColors", JSONObject(c).toString())

    fun loadControls(): List<RoomControl> = runCatching {
        val a = JSONArray(get("controls") ?: return emptyList()); (0 until a.length()).mapNotNull { parseRoomControl(a.getJSONObject(it), Long.MAX_VALUE / 2) }
    }.getOrDefault(emptyList())
    fun rememberControl(c: RoomControl) {
        val cur = loadControls(); if (cur.any { it.nonce == c.nonce }) return
        put("controls", JSONArray((cur + c).takeLast(500).map { it.toJson() }).toString())
    }

    fun loadPlaces(): List<Place> = runCatching {
        val a = JSONArray(get("places") ?: return emptyList())
        (0 until a.length()).map { i -> val p = a.getJSONObject(i)
            Place(p.getString("id"), p.optString("name"), p.optString("icon"), p.optString("note"),
                p.optDouble("radius", DEFAULT_RADIUS).coerceIn(MIN_RADIUS, MAX_RADIUS), p.getJSONArray("spots").let { s ->
                    (0 until s.length()).map { j -> val o = s.getJSONObject(j)
                        Spot(o.getString("id"), o.optString("label"), o.getDouble("lat"), o.getDouble("lng"),
                            o.optJSONObject("bias")?.let { Bias(it.getDouble("e"), it.getDouble("n")) },
                            if (o.has("learnedAt") && !o.isNull("learnedAt")) o.getLong("learnedAt") else null, o.optInt("samples")) } }, p.optLong("createdAt")) }.take(50)
    }.getOrDefault(emptyList())
    fun savePlaces(l: List<Place>) = put("places", JSONArray(l.map { p -> JSONObject().put("id", p.id).put("name", p.name).put("icon", p.icon)
        .put("note", p.note).put("radius", p.radius).put("createdAt", p.createdAt).put("spots", JSONArray(p.spots.map { s ->
            JSONObject().put("id", s.id).put("label", s.label).put("lat", s.lat).put("lng", s.lng).put("learnedAt", s.learnedAt ?: JSONObject.NULL)
                .put("samples", s.samples).put("bias", s.bias?.let { JSONObject().put("e", it.e).put("n", it.n) } ?: JSONObject.NULL) })) }).toString())

    var hintsSeen: Set<String>
        get() = sp.getStringSet("hints", emptySet()) ?: emptySet()
        set(v) { sp.edit().putStringSet("hints", v).apply() }
}
