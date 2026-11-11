package hu.privateplace.app.p2p

import org.json.JSONObject

/** Szoba-szintű, átvitelfüggetlen felület: a PeerManager csak ezt ismeri (WebRTC adatcsatorna alatta). */
interface RoomListener {
    fun onPeerJoin(peerId: String)
    fun onPeerLeave(peerId: String)
    /** action: "hello" | "loc" | "ctrl" | "ask"; data: JSONObject / JSONObject.NULL / Boolean */
    fun onMessage(action: String, data: Any?, peerId: String)
    fun onError(message: String)
}

interface PeerRoom {
    val peers: Set<String>
    fun send(action: String, data: Any?, targets: Collection<String>? = null)
    fun leave()
}

interface PeerTransport { fun join(token: String, listener: RoomListener): PeerRoom }

fun frame(action: String, data: Any?): ByteArray = JSONObject().put("a", action).put("d", data ?: JSONObject.NULL).toString().toByteArray(Charsets.UTF_8)
