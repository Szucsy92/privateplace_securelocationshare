package hu.privateplace.app.domain

import java.net.URLDecoder
import java.net.URLEncoder
import java.security.SecureRandom

/** Titkos szobák: a szoba azonosítója egyben a titkos kulcs is. */
const val ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const val ROOM_TOKEN_LENGTH = 20
val ROOM_COLORS = listOf("mint", "violet", "rose", "amber", "sky")
const val DEFAULT_ROOM_COLOR = "mint"
fun isRoomColor(v: String?) = v != null && v in ROOM_COLORS

/** ownerPrivateKey: PKCS#8 (base64url), csak a gazda telefonján, az alkalmazás privát tárolójában. */
data class SavedRoom(
    val token: String, val name: String, val owner: Boolean, val createdAt: Long,
    val color: String = DEFAULT_ROOM_COLOR, val ownerKey: String? = null, val ownerPrivateKey: String? = null,
)

data class Invitation(val token: String, val name: String?, val color: String? = null, val ownerKey: String? = null)

private val OWNER_KEY = Regex("^[A-Za-z0-9_-]{87}$")
fun isOwnerKey(s: String?) = s != null && OWNER_KEY.matches(s)

fun generateRoomToken(random: (Int) -> ByteArray = { n -> ByteArray(n).also { SecureRandom().nextBytes(it) } }): String {
    val b = random(ROOM_TOKEN_LENGTH)
    return buildString { for (i in 0 until ROOM_TOKEN_LENGTH) append(ROOM_ALPHABET[(b[i].toInt() and 0xff) % ROOM_ALPHABET.length]) }
}

/** A QR a szoba kulcsát és a gazda nyilvános ellenőrző kulcsát tartalmazza. */
fun roomQrValue(token: String, ownerKey: String?) = if (isOwnerKey(ownerKey)) "$token.$ownerKey" else token
fun formatRoomToken(token: String) = token.chunked(5).joinToString("-")
fun roomShareCode(token: String, ownerKey: String?) = if (isOwnerKey(ownerKey)) "${formatRoomToken(token)}.$ownerKey" else formatRoomToken(token)

private fun normalizeToken(raw: String): String? {
    val cleaned = raw.uppercase().replace(Regex("[^A-Z0-9]"), "")
    if (cleaned.length != ROOM_TOKEN_LENGTH || cleaned.any { it !in ROOM_ALPHABET }) return null
    return cleaned
}

private fun parseQuery(q: String): Map<String, String> =
    q.split("&").filter { it.contains("=") }.associate { it.substringBefore("=").let { k -> URLDecoder.decode(k, "UTF-8") } to URLDecoder.decode(it.substringAfter("="), "UTF-8") }

/** Link (`...#szoba=…&nev=…&szin=…&gazda=…`), `TOKEN.gazdaKulcs` vagy sima kód értelmezése. */
fun parseRoomInput(input: String): Invitation? {
    val text = input.trim()
    if (text.isEmpty()) return null
    val hash = text.indexOf('#')
    if (hash >= 0) {
        val p = runCatching { parseQuery(text.substring(hash + 1)) }.getOrDefault(emptyMap())
        val raw = p["szoba"]
        if (!raw.isNullOrEmpty()) {
            val token = normalizeToken(raw) ?: return null
            val color = p["szin"]; val owner = p["gazda"]
            return Invitation(token, p["nev"]?.takeIf { it.isNotEmpty() }?.take(40),
                if (isRoomColor(color)) color else null, if (isOwnerKey(owner)) owner else null)
        }
    }
    val dot = text.lastIndexOf('.')
    if (dot > 0) {
        val key = text.substring(dot + 1).trim()
        val token = normalizeToken(text.substring(0, dot))
        return if (token != null && isOwnerKey(key)) Invitation(token, null, null, key) else null
    }
    return normalizeToken(text)?.let { Invitation(it, null) }
}

fun buildRoomLink(base: String, token: String, name: String? = null, color: String? = null, ownerKey: String? = null): String {
    fun e(s: String) = URLEncoder.encode(s, "UTF-8")
    val parts = mutableListOf("szoba=${e(token)}")
    if (!name.isNullOrEmpty()) parts.add("nev=${e(name)}")
    if (isRoomColor(color)) parts.add("szin=${e(color!!)}")
    if (isOwnerKey(ownerKey)) parts.add("gazda=${e(ownerKey!!)}")
    return "${base.trimEnd('/')}/#${parts.joinToString("&")}"
}

fun addRoom(rooms: List<SavedRoom>, room: SavedRoom) = if (rooms.any { it.token == room.token }) rooms else rooms + room
fun removeRoom(rooms: List<SavedRoom>, token: String) = rooms.filter { it.token != token }
fun customizeRoom(rooms: List<SavedRoom>, token: String, name: String, color: String): List<SavedRoom> {
    val clean = name.trim().take(40)
    if (clean.isEmpty() || !isRoomColor(color)) return rooms
    return rooms.map { if (it.token == token) it.copy(name = clean, color = color) else it }
}
