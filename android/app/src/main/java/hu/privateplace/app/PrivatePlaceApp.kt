package hu.privateplace.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import hu.privateplace.app.data.InstallState
import hu.privateplace.app.data.LocalProfile
import hu.privateplace.app.data.Updater
import hu.privateplace.app.data.Store
import hu.privateplace.app.domain.*
import hu.privateplace.app.location.LocationSource
import hu.privateplace.app.location.SharingEngine
import hu.privateplace.app.location.SharingService
import hu.privateplace.app.p2p.PeerManager
import hu.privateplace.app.p2p.TurnConfig
import hu.privateplace.app.p2p.WebRtcTransport
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

class PrivatePlaceApp : Application() {
    lateinit var graph: AppGraph
    override fun onCreate() { super.onCreate(); graph = AppGraph(this) }
}

/** Kézi függőség-összekötés (nincs DI-keretrendszer): az alkalmazás szintjén élő objektumok. */
class AppGraph(val app: Application) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val store = Store(app)
    val deviceId: String = store.deviceId()
    val exitRequests = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val closedRooms = MutableSharedFlow<Pair<String, String>>(extraBufferCapacity = 8)

    val rooms = MutableStateFlow(store.loadRooms())
    val profile = MutableStateFlow(store.loadProfile())
    val prefs = MutableStateFlow(store.loadPrefs())
    val personColors = MutableStateFlow(store.loadPersonColors())
    val places = MutableStateFlow(store.loadPlaces())

    // OTA-frissítés (GitHub Releases): induláskor, előtérbe lépéskor (legfeljebb 10 percenként) és kézzel a Beállításokban
    val updater = Updater(app)
    val availableUpdate = MutableStateFlow<hu.privateplace.app.domain.AppRelease?>(null)
    val updateDismissed = MutableStateFlow(false)
    val updateStatus = MutableStateFlow("idle")          // idle | downloading | permission
    val updatePercent = MutableStateFlow<Int?>(null)
    val updateCheck = MutableStateFlow("idle")           // idle | checking | latest | error
    private var lastCheckAt = 0L

    fun checkForUpdate(manual: Boolean) {
        val repo = BuildConfig.RELEASE_REPOSITORY
        if (!validRepository(repo)) { if (manual) updateCheck.value = "error"; return }
        if (!manual && System.currentTimeMillis() - lastCheckAt < 10 * 60_000) return
        lastCheckAt = System.currentTimeMillis()
        if (manual) updateCheck.value = "checking"
        scope.launch {
            runCatching { updater.latest(repo) }.onSuccess { r ->
                if (r != null && needsUpdate(updater.installedVersionCode(), r.versionCode)) { availableUpdate.value = r; updateDismissed.value = false; updateCheck.value = "idle" }
                else updateCheck.value = if (manual) "latest" else "idle"
            }.onFailure { updateCheck.value = if (manual) "error" else "idle" }
        }
    }
    fun startUpdate() {
        val r = availableUpdate.value ?: return
        if (updateStatus.value == "downloading") return
        updateStatus.value = "downloading"; updatePercent.value = null
        scope.launch {
            when (updater.downloadAndInstall(r.apk) { updatePercent.value = it }) {
                InstallState.INSTALLING -> { updateStatus.value = "idle"; updateDismissed.value = true }
                InstallState.NEEDS_PERMISSION -> updateStatus.value = "permission"
                InstallState.FAILED -> { updateStatus.value = "idle"; updateDismissed.value = true; updater.openInBrowser(r.apk) }   // tartalék: böngésző
            }
        }
    }
    fun dismissUpdate() { if (updateStatus.value != "downloading") updateDismissed.value = true }

    private val turn = BuildConfig.TURN_URLS.takeIf { it.isNotBlank() }?.let { TurnConfig(it.split(","), BuildConfig.TURN_USERNAME.ifBlank { null }, BuildConfig.TURN_CREDENTIAL.ifBlank { null }) }
    private val transport by lazy { WebRtcTransport(app, BuildConfig.NOSTR_RELAYS.split(","), turn) }
    val peers: PeerManager = PeerManager(store, transport, { t, r -> onRoomGone(t, r) }, { dev -> notifyShareAsk(dev) })
    val engine = SharingEngine(app, store, LocationSource(app)) { peers }

    init {
        peers.sync(rooms.value, deviceId, profile.value)
        engine.setPlaces(places.value)
        scope.launch {
            engine.state.map { it.sharing }.distinctUntilChanged().collect { on ->
                val i = Intent(app, SharingService::class.java)
                if (on) ContextCompat.startForegroundService(app, i) else app.stopService(i)
            }
        }
        // Újraindított folyamat: ha a megosztás be volt kapcsolva, folytatjuk (az előtér-szolgáltatás újraindítása után)
        if (prefs.value.sharing) { engine.setPermissionGranted(true); engine.setSharing(true) }
    }

    private fun resync() = peers.sync(rooms.value, deviceId, profile.value)
    private fun setRooms(r: List<SavedRoom>) { rooms.value = r; store.saveRooms(r); resync() }

    fun saveProfile(p: LocalProfile) { profile.value = p; store.saveProfile(p); resync() }
    fun updatePrefs(f: (hu.privateplace.app.data.Prefs) -> hu.privateplace.app.data.Prefs) { prefs.value = f(prefs.value); store.savePrefs(prefs.value) }
    fun setPersonColor(id: String, color: String?) { personColors.value = setPersonColor(personColors.value, id, color); store.savePersonColors(personColors.value) }
    fun savePlaces(p: List<Place>) { places.value = p; store.savePlaces(p); engine.setPlaces(p) }

    fun createRoom(name: String, color: String): SavedRoom {
        val a = createRoomAuthority()
        val room = SavedRoom(generateRoomToken(), name.trim().take(40).ifEmpty { "Szoba" }, true, System.currentTimeMillis(), color, a.ownerKey, a.ownerPrivateKey)
        setRooms(addRoom(rooms.value, room)); return room
    }
    fun joinRoom(inv: Invitation) {
        if (rooms.value.any { it.token == inv.token }) return
        setRooms(addRoom(rooms.value, SavedRoom(inv.token, inv.name ?: "Szoba", false, System.currentTimeMillis(), inv.color ?: DEFAULT_ROOM_COLOR, inv.ownerKey)))
    }
    fun customizeRoom(token: String, name: String, color: String) = setRooms(customizeRoom(rooms.value, token, name, color))
    /** Gazdánál aláírt „close” megy a tagoknak, majd helyben törlődik; tagnál csak a helyi kilépés. */
    fun deleteOrLeave(token: String) {
        val r = rooms.value.firstOrNull { it.token == token } ?: return
        if (r.owner && r.ownerPrivateKey != null && r.ownerKey != null) peers.sendControl(signRoomControl(token, RoomAuthority(r.ownerKey, r.ownerPrivateKey), "close", null))
        peers.forgetRoom(token)
        setRooms(removeRoom(rooms.value, token))
    }
    fun kick(token: String, dev: String) {
        val r = rooms.value.firstOrNull { it.token == token } ?: return
        if (!r.owner || r.ownerPrivateKey == null || r.ownerKey == null) return
        peers.sendControl(signRoomControl(token, RoomAuthority(r.ownerKey, r.ownerPrivateKey), "kick", dev))
    }
    private fun onRoomGone(token: String, reason: String) { setRooms(removeRoom(rooms.value, token)); closedRooms.tryEmit(token to reason) }

    private fun notifyShareAsk(dev: String) {
        val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("asks", "Megosztáskérések", NotificationManager.IMPORTANCE_HIGH))
        val name = peers.state.value.people[dev]?.name ?: "Valaki"
        val open = android.app.PendingIntent.getActivity(app, 0, Intent(app, hu.privateplace.app.ui.MainActivity::class.java), android.app.PendingIntent.FLAG_IMMUTABLE)
        nm.notify(dev.hashCode(), NotificationCompat.Builder(app, "asks").setSmallIcon(R.drawable.ic_stat).setContentTitle("Megosztást kér")
            .setContentText("$name szeretné látni a helyzetedet").setContentIntent(open).setAutoCancel(true).build())
    }
}
