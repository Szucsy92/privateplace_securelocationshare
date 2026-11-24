package hu.privateplace.app.p2p

import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Jelzés (SDP csere) nyilvános Nostr-reléken át: ephemeral (29333) események, a tartalom AES-GCM-mel titkosított.
 * Saját szerver nem kell. A relék listája BuildConfig-ból cserélhető.
 */
class NostrSignaling(
    private val relays: List<String>, private val crypto: RoomCrypto, private val http: OkHttpClient,
    private val onSignal: (JSONObject) -> Unit, private val onStatus: (connected: Int) -> Unit,
) {
    private val sk = Schnorr.newSecretKey()
    private val pk = Schnorr.publicKey(sk).toHex()
    private val sockets = ConcurrentHashMap<String, WebSocket>()
    private val open = ConcurrentHashMap.newKeySet<String>()
    private val seen = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var closed = false
    private val subId = "pp" + Schnorr.sha256(pk.toByteArray()).toHex().take(10)

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }

    fun start() { relays.forEach { connect(it, 0) } }

    private fun connect(url: String, attempt: Int) {
        if (closed) return
        val ws = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                open.add(url); onStatus(open.size)
                val since = System.currentTimeMillis() / 1000 - 30
                webSocket.send(JSONArray().put("REQ").put(subId).put(JSONObject().put("kinds", JSONArray().put(KIND)).put("#x", JSONArray().put(crypto.topic)).put("since", since)).toString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val a = JSONArray(text)
                    if (a.optString(0) != "EVENT") return
                    val ev = a.getJSONObject(2)
                    val id = ev.getString("id")
                    if (ev.getString("pubkey") == pk || !seen.add(id)) return
                    if (seen.size > 2000) seen.clear()
                    val plain = crypto.decrypt(ev.getString("content")) ?: return
                    onSignal(JSONObject(plain))
                }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry(url, attempt)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = retry(url, attempt)
        })
        sockets[url] = ws
    }

    private fun retry(url: String, attempt: Int) {
        open.remove(url); onStatus(open.size)
        if (closed) return
        Thread { try { Thread.sleep(minOf(30_000L, 2000L shl minOf(attempt, 4))) } catch (_: InterruptedException) {}; connect(url, attempt + 1) }.apply { isDaemon = true }.start()
    }

    fun publish(signal: JSONObject) {
        val createdAt = System.currentTimeMillis() / 1000
        val content = crypto.encrypt(signal.toString())
        val tags = JSONArray().put(JSONArray().put("x").put(crypto.topic))
        val serialized = JSONArray().put(0).put(pk).put(createdAt).put(KIND).put(tags).put(content).toString()
        val idBytes = Schnorr.sha256(serialized.toByteArray(Charsets.UTF_8))
        val ev = JSONObject().put("id", idBytes.toHex()).put("pubkey", pk).put("created_at", createdAt).put("kind", KIND)
            .put("tags", tags).put("content", content).put("sig", Schnorr.sign(sk, idBytes).toHex())
        val msg = JSONArray().put("EVENT").put(ev).toString()
        for (u in open) sockets[u]?.send(msg)
    }

    val connectedRelays get() = open.size

    fun close() {
        closed = true
        sockets.values.forEach { runCatching { it.send(JSONArray().put("CLOSE").put(subId).toString()); it.close(1000, null) } }
        sockets.clear(); open.clear()
    }

    companion object { const val KIND = 29333 }
}

fun defaultHttp(): OkHttpClient = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()
