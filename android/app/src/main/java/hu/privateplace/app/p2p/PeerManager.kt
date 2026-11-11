package hu.privateplace.app.p2p

import android.os.Handler
import android.os.Looper
import hu.privateplace.app.data.LocalProfile
import hu.privateplace.app.data.Store
import hu.privateplace.app.domain.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONObject

data class RemotePerson(
    val deviceId: String, val name: String = "Névtelen", val avatar: String? = null, val color: String = colorForDevice(deviceId),
    val points: List<TrackPoint> = emptyList(), val speed: Double? = null, val acc: Double? = null, val at: Long? = null,
    val heading: Double? = null, val battery: Double? = null, val since: Long? = null, val online: Boolean = true,
    val sharing: Boolean = false, val transport: TransportMode? = null, val measurementAt: Long? = null, val stoppedSince: Long? = null,
)

data class PeerState(
    val people: Map<String, RemotePerson> = emptyMap(), val roomPeers: Map<String, Int> = emptyMap(),
    val roomMembers: Map<String, List<String>> = emptyMap(), val roster: Rosters = emptyMap(),
    val avatars: Avatars = emptyMap(), val connectIssues: Int = 0,
)

/**
 * A szobák közvetlen kapcsolatai és a beérkező üzenetek feldolgozása (a TypeScript `usePeerNetwork` portja).
 * Minden metódust a fő szálról kell hívni.
 */
class PeerManager(
    private val store: Store, private val transport: PeerTransport,
    private val onRoomClosed: (token: String, reason: String) -> Unit,   // "closed" | "kicked"
    private val onShareRequest: (deviceId: String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val _state = MutableStateFlow(PeerState(roster = store.loadRosters(), avatars = store.loadAvatars()))
    val state: StateFlow<PeerState> = _state.asStateFlow()

    private class Joined(val room: PeerRoom, val joinedAt: Long = System.currentTimeMillis()) { val peers = mutableSetOf<String>() }
    private val joined = HashMap<String, Joined>()
    private val peerDevice = HashMap<String, String>()
    private val pendingLoc = HashMap<String, LocationMessage?>()
    private val pendingSet = HashSet<String>()
    private val roomDevices = HashMap<String, MutableSet<String>>()
    private val wantHello = HashMap<String, Long>()
    private val tries = HashMap<String, Int>()
    private var rooms: List<SavedRoom> = emptyList()
    private var deviceId: String? = null
    private var hello: HelloMessage? = null
    private var lastLoc: LocationMessage? = null
    private var sharingOn = false
    private val nullTimers = mutableListOf<Runnable>()

    private val heartbeat = object : Runnable {
        override fun run() {
            val latest = lastLoc
            if (latest != null && freshLocation(latest, System.currentTimeMillis()) != null)
                for (j in joined.values) if (j.peers.isNotEmpty()) j.room.send("loc", latest.toJson())
            main.postDelayed(this, 5000)
        }
    }
    private val watchdog = object : Runnable { override fun run() { reconnectStalled(false); main.postDelayed(this, 15000) } }
    init { main.postDelayed(heartbeat, 5000); main.postDelayed(watchdog, 15000) }

    private fun isKicked(token: String, dev: String) = store.loadControls().any { it.kind == "kick" && it.token == token && it.target == dev }

    private fun updateRoster(change: (Rosters) -> Rosters) {
        val cur = _state.value.roster; val next = change(cur)
        if (next === cur || next == cur) return
        store.saveRosters(next)
        val members = next.values.flatten().map { it.deviceId }.toSet()
        val av = keepAvatars(_state.value.avatars, members)
        if (av != _state.value.avatars) store.saveAvatars(av)
        _state.update { it.copy(roster = next, avatars = av) }
    }
    private fun updateAvatars(change: (Avatars) -> Avatars) {
        val cur = _state.value.avatars; val next = change(cur)
        if (next == cur) return
        store.saveAvatars(next); _state.update { it.copy(avatars = next) }
    }

    private fun refreshCounts() {
        val counts = HashMap<String, Int>(); val members = HashMap<String, List<String>>()
        for ((token, j) in joined) {
            counts[token] = j.peers.size
            members[token] = j.peers.mapNotNull { peerDevice[it] }.filter { !isKicked(token, it) }.distinct()
        }
        _state.update { it.copy(roomPeers = counts, roomMembers = members) }
    }
    private fun peerInAnyRoom(peerId: String) = joined.values.any { peerId in it.peers }

    /** Szobák, saját azonosító és profil összehangolása: hiányzó szobák csatlakoznak, megszűntek kilépnek. */
    fun sync(newRooms: List<SavedRoom>, device: String?, profile: LocalProfile?) {
        rooms = newRooms; deviceId = device
        val oldHello = hello
        hello = if (profile != null && device != null) HelloMessage(device, profile.name, profile.avatar) else null
        if (hello == null) { for (t in joined.keys.toList()) leaveRoom(t, true); return }
        val wanted = newRooms.map { it.token }.toSet()
        for (t in joined.keys.toList()) if (t !in wanted) leaveRoom(t, true)
        for (t in wanted) if (t !in joined) joinRoom(t)
        if (oldHello != null && oldHello != hello) for (j in joined.values) j.room.send("hello", hello!!.toJson())
    }

    private fun joinRoom(token: String) {
        val holder = arrayOfNulls<Joined>(1)
        val room = runCatching {
            transport.join(token, object : RoomListener {
                override fun onPeerJoin(peerId: String) { main.post { holder[0]?.let { peerJoined(token, it, peerId) } } }
                override fun onPeerLeave(peerId: String) { main.post { holder[0]?.let { peerLeft(token, it, peerId) } } }
                override fun onMessage(action: String, data: Any?, peerId: String) { main.post { holder[0]?.let { handle(token, it, action, data, peerId) } } }
                override fun onError(message: String) { main.post { _state.update { it.copy(connectIssues = it.connectIssues + 1) } } }
            })
        }.getOrElse { _state.update { s -> s.copy(connectIssues = s.connectIssues + 1) }; return }
        val j = Joined(room); holder[0] = j; joined[token] = j
        refreshCounts()
    }

    private fun peerJoined(token: String, j: Joined, peerId: String) {
        j.peers.add(peerId); tries.remove(token); refreshCounts()
        hello?.let { j.room.send("hello", it.toJson(), listOf(peerId)) }
        val a = announcement(lastLoc, System.currentTimeMillis())
        if (a is Announcement.Send) j.room.send("loc", a.msg.toJson(), listOf(peerId))
        // A gazda aláírt eltávolításait továbbadjuk: a lemaradt tagok (és az eltávolított) is értesülnek.
        store.loadControls().filter { it.kind == "kick" && it.token == token }.takeLast(20).forEach { j.room.send("ctrl", it.toJson(), listOf(peerId)) }
    }

    private fun peerLeft(token: String, j: Joined, peerId: String) {
        peerDevice[peerId]?.let { dev -> updateRoster { touchMember(it, token, dev, System.currentTimeMillis()) } }
        j.peers.remove(peerId); pendingLoc.remove(peerId); pendingSet.remove(peerId); refreshCounts()
        if (peerInAnyRoom(peerId)) return
        val dev = peerDevice.remove(peerId); wantHello.remove(peerId)
        if (dev != null) _state.update { s -> s.people[dev]?.let { s.copy(people = s.people + (dev to it.copy(online = false))) } ?: s }
    }

    private fun handle(token: String, j: Joined, action: String, data: Any?, peerId: String) {
        when (action) {
            "hello" -> {
                if (peerId !in j.peers) return
                val h = parseHello(data) ?: return
                if (h.deviceId == deviceId) return
                if (isKicked(token, h.deviceId)) { j.peers.remove(peerId); refreshCounts(); return }
                peerDevice[peerId] = h.deviceId
                updateRoster { upsertMember(it, token, h.deviceId, h.name, System.currentTimeMillis(), deviceId) }
                if (_state.value.roster[token]?.any { it.deviceId == h.deviceId } == true) updateAvatars { setAvatar(it, h.deviceId, h.avatar) }
                roomDevices.getOrPut(token) { mutableSetOf() }.add(h.deviceId)
                _state.update { s -> val p = s.people[h.deviceId] ?: RemotePerson(h.deviceId); s.copy(people = s.people + (h.deviceId to p.copy(name = h.name, avatar = h.avatar, online = true))) }
                refreshCounts()
                if (h.want) hello?.let { j.room.send("hello", it.toJson(), listOf(peerId)) }
                if (peerId in pendingSet) { val pend = pendingLoc.remove(peerId); pendingSet.remove(peerId); applyLocation(h.deviceId, pend) }
            }
            "loc" -> {
                if (peerId !in j.peers) return
                val parsed = parseLocation(data) as? ParsedLoc.Ok ?: return
                val dev = peerDevice[peerId]
                if (dev == null) {
                    pendingLoc[peerId] = parsed.msg; pendingSet.add(peerId)
                    val now = System.currentTimeMillis()
                    val h = hello
                    if (h != null && now - (wantHello[peerId] ?: 0) > 4000) { wantHello[peerId] = now; j.room.send("hello", h.copy(want = true).toJson(), listOf(peerId)) }
                    return
                }
                applyLocation(dev, parsed.msg)
            }
            "ctrl" -> {
                val c = parseRoomControl(data) ?: return
                val saved = rooms.firstOrNull { it.token == token }
                if (c.token != token || saved?.ownerKey == null) return
                if (!verifyRoomControl(c, saved.ownerKey)) return
                if (c.kind == "close") { updateRoster { dropRoster(it, token) }; onRoomClosed(token, "closed") }
                else if (c.target == deviceId) { store.rememberControl(c); updateRoster { dropRoster(it, token) }; onRoomClosed(token, "kicked") }
                else if (c.target != null) { store.rememberControl(c); dropDevice(token, c.target) }
            }
            "ask" -> {
                if (peerId !in j.peers || !parseShareRequest(data)) return
                peerDevice[peerId]?.let(onShareRequest)
            }
        }
    }

    private fun applyLocation(dev: String, m: LocationMessage?) {
        _state.update { s ->
            val p = s.people[dev] ?: RemotePerson(dev)
            val next: RemotePerson = if (m == null) p.copy(sharing = false, online = true, points = emptyList(), at = null, heading = null, since = null, measurementAt = null)
            else {
                val now = System.currentTimeMillis()
                if (p.measurementAt != null && m.t < p.measurementAt) return@update s
                if (!acceptMeasurement(p.measurementAt, m)) p.copy(online = true, heading = m.heading ?: p.heading, battery = m.battery ?: p.battery, transport = m.transport ?: p.transport, stoppedSince = m.stoppedSince ?: p.stoppedSince)
                else {
                    val age = maxOf(0L, now - m.t)
                    p.copy(sharing = true, online = true, points = appendTrackPoint(p.points, TrackPoint(m.lat, m.lng, now - age), now),
                        speed = m.speed, acc = m.acc, at = now - age, measurementAt = m.t, heading = m.heading, battery = m.battery ?: p.battery,
                        since = if (m.since != null) now - (m.t - m.since) else p.since ?: now, transport = m.transport ?: p.transport, stoppedSince = m.stoppedSince)
                }
            }
            s.copy(people = s.people + (dev to next))
        }
    }

    private fun dropDevice(token: String, dev: String) {
        updateRoster { removeMember(it, token, dev) }
        val j = joined[token] ?: return
        roomDevices[token]?.remove(dev)
        for (pid in j.peers.toList()) if (peerDevice[pid] == dev) j.peers.remove(pid)
        val elsewhere = peerDevice.any { (pid, d) -> d == dev && peerInAnyRoom(pid) }
        if (!elsewhere) _state.update { it.copy(people = it.people - dev) }
        refreshCounts()
    }

    private fun leaveRoom(token: String, removePeople: Boolean) {
        val j = joined.remove(token) ?: return
        runCatching { j.room.leave() }
        val devs = HashSet<String>(roomDevices.remove(token) ?: emptySet())
        for (pid in j.peers) peerDevice[pid]?.let(devs::add)
        val stillThere = { d: String -> roomDevices.values.any { d in it } || peerDevice.any { (pid, dd) -> dd == d && peerInAnyRoom(pid) } }
        val gone = devs.filter { !stillThere(it) }
        for (pid in j.peers) if (!peerInAnyRoom(pid)) { peerDevice.remove(pid); pendingLoc.remove(pid); pendingSet.remove(pid); wantHello.remove(pid) }
        if (gone.isNotEmpty()) _state.update { s ->
            val m = s.people.toMutableMap()
            for (d in gone) { val p = m[d] ?: continue; if (removePeople) m.remove(d) else m[d] = p.copy(online = false) }
            s.copy(people = m)
        }
        refreshCounts()
    }

    /** Elakadt szobák újracsatlakoztatása visszalépéssel (háttérbe kerülés, hálózatváltás után). */
    private fun reconnectStalled(force: Boolean) {
        val now = System.currentTimeMillis()
        for ((token, j) in joined.entries.toList()) {
            if (j.peers.isNotEmpty()) { tries.remove(token); continue }
            val t = tries[token] ?: 0
            val wait = if (force) 8000L else minOf(30_000L * (1L shl t), 180_000L)
            if (now - j.joinedAt < wait) continue
            tries[token] = t + 1
            leaveRoom(token, false); joinRoom(token)
        }
    }

    /** Alkalmazás előtérbe lépésekor / hálózat visszatérésekor. */
    fun wake() {
        val a = announcement(lastLoc, System.currentTimeMillis())
        for (j in joined.values) {
            hello?.let { j.room.send("hello", it.toJson()) }
            if (a is Announcement.Send) j.room.send("loc", a.msg.toJson())
        }
        reconnectStalled(true)
    }

    fun sendLocation(m: LocationMessage?) {
        lastLoc = m
        nullTimers.forEach(main::removeCallbacks); nullTimers.clear()
        broadcast(m)
        // A „megosztás leállt” jelzés elveszhet: röviden megismételjük, amíg a megosztás ki van kapcsolva.
        if (m == null) for (ms in longArrayOf(1500, 5000)) {
            val r = Runnable { if (lastLoc == null) broadcast(null) }
            nullTimers.add(r); main.postDelayed(r, ms)
        }
    }
    private fun broadcast(m: LocationMessage?) { for (j in joined.values) if (j.peers.isNotEmpty()) j.room.send("loc", m.toJson()) }

    fun hasViewers() = joined.values.any { it.peers.isNotEmpty() }

    /** Aláírt tulajdonosi művelet elküldése és helyi alkalmazása. */
    fun sendControl(c: RoomControl) {
        if (c.kind == "kick" && c.target == deviceId) return
        joined[c.token]?.takeIf { it.peers.isNotEmpty() }?.room?.send("ctrl", c.toJson())
        main.postDelayed({
            if (c.kind == "kick" && c.target != null) { store.rememberControl(c); dropDevice(c.token, c.target) }
        }, 400)
    }

    fun forgetRoom(token: String) = updateRoster { dropRoster(it, token) }
    fun forgetMember(token: String, dev: String) = updateRoster { removeMember(it, token, dev) }

    fun requestShare(dev: String): Boolean {
        var sent = false
        for (j in joined.values) {
            val targets = j.peers.filter { peerDevice[it] == dev }
            if (targets.isEmpty()) continue
            j.room.send("ask", true, targets); sent = true
        }
        return sent
    }
    fun clearTrail(dev: String) = _state.update { s -> s.people[dev]?.let { s.copy(people = s.people + (dev to it.copy(points = clearTrackHistory(it.points)))) } ?: s }

    fun shutdown() { main.removeCallbacks(heartbeat); main.removeCallbacks(watchdog); for (t in joined.keys.toList()) leaveRoom(t, true) }
}
