package hu.privateplace.app.domain

/** Szobánkénti tagnévsor: csak helyi adat, másnak nem küldjük el, másoktól nem vesszük át. */
data class RosterEntry(val deviceId: String, val name: String, val firstSeen: Long, val lastSeen: Long)
typealias Rosters = Map<String, List<RosterEntry>>
typealias Avatars = Map<String, String>

const val MAX_ROSTER_PER_ROOM = 200
const val MAX_AVATAR_STORE_CHARS = 1_000_000

fun upsertMember(r: Rosters, token: String, deviceId: String, name: String, now: Long, self: String?): Rosters {
    if (deviceId == self || !isDeviceId(deviceId)) return r
    val list = r[token] ?: emptyList()
    val ex = list.firstOrNull { it.deviceId == deviceId }
    if (ex != null && ex.name == name && now - ex.lastSeen < 1000) return r
    val next = if (ex != null) list.map { if (it.deviceId == deviceId) it.copy(name = name, lastSeen = maxOf(it.lastSeen, now)) else it }
    else (list + RosterEntry(deviceId, name, now, now)).takeLast(MAX_ROSTER_PER_ROOM)
    return r + (token to next)
}
fun touchMember(r: Rosters, token: String, deviceId: String, now: Long): Rosters {
    val list = r[token] ?: return r
    if (list.none { it.deviceId == deviceId }) return r
    return r + (token to list.map { if (it.deviceId == deviceId) it.copy(lastSeen = maxOf(it.lastSeen, now)) else it })
}
fun removeMember(r: Rosters, token: String, deviceId: String): Rosters {
    val list = r[token] ?: return r
    if (list.none { it.deviceId == deviceId }) return r
    return r + (token to list.filter { it.deviceId != deviceId })
}
fun dropRoster(r: Rosters, token: String): Rosters = if (token in r) r - token else r
fun keepRosters(r: Rosters, tokens: Collection<String>): Rosters = r.filterKeys { it in tokens }

/** A sorrend a frissesség (LinkedHashMap beszúrási sorrend): túl nagy tárolónál a legrégebbi képek törlődnek. */
fun setAvatar(a: Avatars, deviceId: String, avatar: String?): Avatars {
    if (avatar == null) return if (deviceId in a) a - deviceId else a
    if (a[deviceId] == avatar) return a
    val m = LinkedHashMap(a); m.remove(deviceId); m[deviceId] = avatar
    var total = m.values.sumOf { it.length }
    val it = m.entries.iterator()
    while (total > MAX_AVATAR_STORE_CHARS && it.hasNext()) { val e = it.next(); if (e.key != deviceId) { total -= e.value.length; it.remove() } }
    return m
}
fun keepAvatars(a: Avatars, ids: Set<String>): Avatars = a.filterKeys { it in ids }
