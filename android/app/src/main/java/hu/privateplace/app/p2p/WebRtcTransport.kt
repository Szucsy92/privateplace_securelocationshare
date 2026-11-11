package hu.privateplace.app.p2p

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import org.webrtc.*
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap

data class TurnConfig(val urls: List<String>, val username: String?, val credential: String?)

/**
 * Közvetlen telefon–telefon kapcsolat: WebRTC adatcsatorna, jelzés Nostr-reléken. A kisebb azonosítójú fél ajánlatot tesz.
 * Minden callback a fő szálon érkezik.
 */
class WebRtcTransport(
    context: Context, private val relays: List<String>, private val turn: TurnConfig? = null,
) : PeerTransport {
    private val main = Handler(Looper.getMainLooper())
    private val http = defaultHttp()
    private val factory: PeerConnectionFactory

    init {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context.applicationContext).createInitializationOptions())
        factory = PeerConnectionFactory.builder().createPeerConnectionFactory()
    }

    private fun iceServers(): List<PeerConnection.IceServer> {
        val l = mutableListOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer())
        if (turn != null && turn.urls.isNotEmpty()) l += PeerConnection.IceServer.builder(turn.urls)
            .setUsername(turn.username ?: "").setPassword(turn.credential ?: "").createIceServer()
        return l
    }

    override fun join(token: String, listener: RoomListener): PeerRoom = Room(token, listener)

    private inner class Link(val peerId: String, val pc: PeerConnection, val startedAt: Long = System.currentTimeMillis()) {
        @Volatile var channel: DataChannel? = null
        @Volatile var open = false
    }

    private inner class Room(token: String, val listener: RoomListener) : PeerRoom {
        private val selfId = java.util.UUID.randomUUID().toString().replace("-", "").take(24)
        private val crypto = RoomCrypto(token)
        private val links = ConcurrentHashMap<String, Link>()
        private val signaling = NostrSignaling(relays, crypto, http, { s -> main.post { onSignal(s) } }, { })
        @Volatile private var left = false
        private val announce = object : Runnable {
            override fun run() {
                if (left) return
                // Amíg nincs kapcsolat, sűrűbben jelentkezünk; utána ritkábban (új tagok megtalálására)
                signaling.publish(JSONObject().put("t", "hi").put("from", selfId))
                reap()
                main.postDelayed(this, if (links.values.any { it.open }) 12_000 else 4_000)
            }
        }
        override val peers: Set<String> get() = links.values.filter { it.open }.map { it.peerId }.toSet()

        init { signaling.start(); main.postDelayed(announce, 1500) }

        private fun reap() {
            val now = System.currentTimeMillis()
            for (l in links.values) if (!l.open && now - l.startedAt > 25_000) drop(l.peerId, false)
        }

        private fun newLink(peerId: String, initiator: Boolean): Link {
            val cfg = PeerConnection.RTCConfiguration(iceServers()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
            lateinit var link: Link
            val gathered = java.util.concurrent.atomic.AtomicBoolean(false)
            val observer = object : PeerConnection.Observer {
                override fun onSignalingChange(s: PeerConnection.SignalingState?) {}
                override fun onIceConnectionChange(s: PeerConnection.IceConnectionState?) {
                    if (s == PeerConnection.IceConnectionState.FAILED || s == PeerConnection.IceConnectionState.CLOSED || s == PeerConnection.IceConnectionState.DISCONNECTED)
                        main.post { drop(peerId, true) }
                }
                override fun onIceConnectionReceivingChange(b: Boolean) {}
                override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) {
                    if (s == PeerConnection.IceGatheringState.COMPLETE) main.post { sendLocalDescription(link, gathered) }
                }
                override fun onIceCandidate(c: IceCandidate?) {}
                override fun onIceCandidatesRemoved(c: Array<out IceCandidate>?) {}
                override fun onAddStream(s: MediaStream?) {}
                override fun onRemoveStream(s: MediaStream?) {}
                override fun onDataChannel(dc: DataChannel) { if (!initiator) attach(link, dc) }
                override fun onRenegotiationNeeded() {}
            }
            val pc = factory.createPeerConnection(cfg, observer) ?: throw IllegalStateException("PeerConnection")
            link = Link(peerId, pc)
            links[peerId] = link
            // Biztonsági időkorlát: ha az ICE-gyűjtés nem fejeződik be, a eddigi jelöltekkel küldjük
            main.postDelayed({ sendLocalDescription(link, gathered) }, 5_000)
            return link
        }

        private fun sendLocalDescription(link: Link, once: java.util.concurrent.atomic.AtomicBoolean) {
            if (left || links[link.peerId] !== link || !once.compareAndSet(false, true)) return
            val d = link.pc.localDescription ?: return
            signaling.publish(JSONObject().put("t", if (d.type == SessionDescription.Type.OFFER) "offer" else "answer")
                .put("from", selfId).put("to", link.peerId).put("sdp", d.description))
        }

        private fun attach(link: Link, dc: DataChannel) {
            link.channel = dc
            dc.registerObserver(object : DataChannel.Observer {
                override fun onBufferedAmountChange(p: Long) {}
                override fun onStateChange() {
                    if (dc.state() == DataChannel.State.OPEN) main.post {
                        if (!link.open && links[link.peerId] === link) { link.open = true; listener.onPeerJoin(link.peerId) }
                    } else if (dc.state() == DataChannel.State.CLOSED) main.post { drop(link.peerId, true) }
                }
                override fun onMessage(b: DataChannel.Buffer) {
                    val bytes = ByteArray(b.data.remaining()).also { b.data.get(it) }
                    main.post {
                        runCatching { val o = JSONObject(String(bytes, Charsets.UTF_8)); listener.onMessage(o.getString("a"), o.opt("d"), link.peerId) }
                    }
                }
            })
        }

        private fun onSignal(s: JSONObject) {
            if (left) return
            val from = s.optString("from"); if (from.isEmpty() || from == selfId) return
            val to = s.optString("to", "")
            if (to.isNotEmpty() && to != selfId) return
            when (s.optString("t")) {
                "hi" -> if (!links.containsKey(from) && selfId < from) startOffer(from)
                "offer" -> if (to == selfId) acceptOffer(from, s.optString("sdp"))
                "answer" -> if (to == selfId) links[from]?.pc?.setRemoteDescription(NoopSdp(), SessionDescription(SessionDescription.Type.ANSWER, s.optString("sdp")))
            }
        }

        private fun startOffer(peerId: String) {
            runCatching {
                val link = newLink(peerId, true)
                attach(link, link.pc.createDataChannel("pp", DataChannel.Init().apply { ordered = true })!!)
                link.pc.createOffer(object : NoopSdp() {
                    override fun onCreateSuccess(d: SessionDescription) { link.pc.setLocalDescription(NoopSdp(), d) }
                }, MediaConstraints())
            }.onFailure { listener.onError(it.message ?: "offer") }
        }

        private fun acceptOffer(peerId: String, sdp: String) {
            links[peerId]?.let { if (it.open) return; drop(peerId, false) }
            runCatching {
                val link = newLink(peerId, false)
                link.pc.setRemoteDescription(object : NoopSdp() {
                    override fun onSetSuccess() {
                        link.pc.createAnswer(object : NoopSdp() {
                            override fun onCreateSuccess(d: SessionDescription) { link.pc.setLocalDescription(NoopSdp(), d) }
                        }, MediaConstraints())
                    }
                }, SessionDescription(SessionDescription.Type.OFFER, sdp))
            }.onFailure { listener.onError(it.message ?: "answer") }
        }

        private fun drop(peerId: String, notify: Boolean) {
            val l = links.remove(peerId) ?: return
            runCatching { l.channel?.close(); l.pc.close(); l.pc.dispose() }
            if (notify && l.open) listener.onPeerLeave(peerId)
        }

        override fun send(action: String, data: Any?, targets: Collection<String>?) {
            val bytes = frame(action, data)
            for (l in links.values) {
                if (!l.open || (targets != null && l.peerId !in targets)) continue
                runCatching { l.channel?.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false)) }
            }
        }

        override fun leave() {
            left = true; main.removeCallbacks(announce)
            signaling.close()
            for (id in links.keys.toList()) drop(id, false)
        }
    }
}

open class NoopSdp : SdpObserver {
    override fun onCreateSuccess(d: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(e: String?) {}
    override fun onSetFailure(e: String?) {}
}
