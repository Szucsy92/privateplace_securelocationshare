package hu.privateplace.app.location

import android.content.Context
import hu.privateplace.app.data.Prefs
import hu.privateplace.app.data.Store
import hu.privateplace.app.domain.*
import hu.privateplace.app.p2p.PeerManager
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class SelfState(
    val point: LatLng? = null, val rawPoint: LatLng? = null, val acc: Double? = null, val speed: Double? = null,
    val heading: Double? = null, val at: Long? = null, val still: Boolean = false, val stoppedSince: Long? = null,
    val transport: TransportMode = TransportMode.WALK, val manualTransport: TransportMode? = null,
    val sharing: Boolean = false, val sharingSince: Long? = null, val battery: Int? = null,
    val tracking: Boolean = false, val error: String? = null, val gpsIntervalMs: Long = ACTIVE_GPS_MS,
    val placeShiftM: Double = 0.0,
    /** Érzékelők: fizikailag mozdulatlan-e a telefon, és milyen hálózaton van (Wi-Fi / mobiladat). */
    val physicallyStill: Boolean = false, val net: NetKind = NetKind.NONE, val metered: Boolean = false,
    val hasStepSensor: Boolean = false,
)

/**
 * A saját helyzet teljes folyamata: nyers fix → drift-szűrő → saját helyek korrekciója → megjelenítés és (megosztásnál) küldés.
 * Az alkalmazás szintjén él (nem az Activity-n), így a megosztás zárolt képernyőnél is fut, amíg az előtér-szolgáltatás tartja a folyamatot.
 */
class SharingEngine(private val ctx: Context, private val store: Store, private val location: LocationSource, private val peers: () -> PeerManager) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(SelfState())
    val state: StateFlow<SelfState> = _state.asStateFlow()
    val recentFixes = ArrayDeque<FixLite>()

    private var filter = DriftFilter()
    private var job: Job? = null
    private var visible = false; private var granted = false
    private var stepping = false; private var compass: Double? = null
    private var headingState = HeadingState(HeadingSource.GPS, null)
    private var transportState = TransportState(TransportMode.WALK, null, 0)
    private var lastSent = 0L; private var curInterval = ACTIVE_GPS_MS
    private var places: List<Place> = store.loadPlaces()
    private var anchorForWake: LatLng? = null
    private var physicallyStill = false; private var envWakeUntil = 0L
    private var stepsAllowed = false
    private val sensors = DeviceSensors(ctx, object : SensorListenerOut {
        override fun onHeading(trueHeading: Double) { compass = trueHeading; updateLiveHeading(trueHeading) }
        override fun onWalking(walking: Boolean) { stepping = walking }
        override fun onPhysicallyStill(still: Boolean) { physicallyStill = still; _state.update { it.copy(physicallyStill = still) } }
        override fun onSignificantMotion() { motionWake() }
        override fun onBattery(percent: Int?) { _state.update { it.copy(battery = percent) } }
    })
    private val env = EnvironmentSignals(ctx, { kind, metered, regained ->
        _state.update { it.copy(net = kind, metered = metered) }
        if (regained) peers().wake()          // Wi-Fi ↔ mobiladat váltás: újracsatlakozás + újraközlés
    }, { motionWake() })

    /** Mozgásra utaló, GPS-től független jel (jelentős mozgás, Wi-Fi/cella/Bluetooth-környezet változás): ritkított mérésből azonnal 1 mp. */
    private fun motionWake() {
        envWakeUntil = System.currentTimeMillis() + 60_000
        if (curInterval > ACTIVE_GPS_MS && shouldTrack()) restartWithInterval(ACTIVE_GPS_MS)
    }
    private var lastMagneticFix: LatLng? = null

    /** Saját irány a térképnek: lassú mozgásnál/állva az iránytű mintaütemében (~30 Hz) simítva, nem csak fixenként (1 mp) frissül,
     *  így a követő kamera forgatása folyamatos. Gyors mozgásnál a GPS-irány (onFix). */
    @Volatile var liveHeading: Double? = null; private set
    private var liveHeadingAt = 0L
    private fun updateLiveHeading(raw: Double) {
        if (headingState.source == HeadingSource.GPS && headingState.angle != null) return
        val t = android.os.SystemClock.elapsedRealtime(); val dt = (t - liveHeadingAt).coerceIn(1L, 200L); liveHeadingAt = t
        val prev = liveHeading
        liveHeading = if (prev == null) raw else ((smoothAngle(prev, raw, 1 - Math.exp(-dt / 150.0)) % 360) + 360) % 360
    }

    /** Lépésérzékelő (ACTIVITY_RECOGNITION) engedély állapota; változáskor az érzékelők újraindulnak. */
    fun setStepsAllowed(a: Boolean) { if (a == stepsAllowed) return; stepsAllowed = a; if (_state.value.tracking) { sensors.stop(); sensors.start(a); _state.update { it.copy(hasStepSensor = sensors.hasStepDetector) } } }

    fun setPlaces(p: List<Place>) { places = p }
    fun setPermissionGranted(g: Boolean) { granted = g; evaluate() }
    fun setVisible(v: Boolean) { visible = v; evaluate() }
    fun setManualTransport(m: TransportMode?) {
        transportState = updateTransport(transportState, _state.value.speed, System.currentTimeMillis(), m)
        _state.update { it.copy(manualTransport = m, transport = transportState.mode) }
    }
    fun setSharing(on: Boolean) {
        if (_state.value.sharing == on) return
        _state.update { it.copy(sharing = on, sharingSince = if (on) System.currentTimeMillis() else null) }
        store.savePrefs(store.loadPrefs().copy(sharing = on))
        if (!on) peers().sendLocation(null) else { lastSent = 0 }
        evaluate()
    }

    private fun shouldTrack() = granted && (visible || _state.value.sharing)

    fun evaluate() {
        if (shouldTrack()) startTracking(interval = curInterval) else stopTracking()
    }

    private fun startTracking(interval: Long) {
        if (job?.isActive == true) return
        sensors.start(stepsAllowed); env.start()
        _state.update { it.copy(tracking = true, error = null, hasStepSensor = sensors.hasStepDetector) }
        job = scope.launch {
            location.fixes(interval) { visible }.catch { e -> _state.update { s -> s.copy(error = if (e is SecurityException) "denied" else "error") } }
                .collect { onFix(it) }
        }
    }

    private fun stopTracking() {
        job?.cancel(); job = null; sensors.stop(); env.stop(); physicallyStill = false
        filter = DriftFilter(); anchorForWake = null; recentFixes.clear()
        _state.update { it.copy(tracking = false) }
    }

    private fun restartWithInterval(ms: Long) {
        if (ms == curInterval) return
        curInterval = ms; _state.update { it.copy(gpsIntervalMs = ms) }
        job?.cancel(); job = null
        if (shouldTrack()) startTracking(ms)
    }

    private fun onFix(raw: RawFix) {
        val now = System.currentTimeMillis()
        val at = raw.at ?: now
        if (now - at > 30_000 || at > now + 60_000 || !raw.lat.isFinite() || !raw.lng.isFinite()) return
        // Járás-jelzés: gyorsulásmérős járásminta VAGY friss lépésesemény (a lépésérzékelő független, alacsony fogyasztású bizonyíték)
        val stepEvidence = stepping || sensors.steps.active(now)
        val f = filter.filter(raw.copy(stepping = stepEvidence))
        if (f.dropped) return
        val still = f.mode == "still"
        if (still) recentFixes.addLast(FixLite(raw.lat, raw.lng, raw.acc)) else recentFixes.clear()
        while (recentFixes.size > 40) recentFixes.removeFirst()
        val applied = applyPlaces(places, LatLng(f.lat, f.lng))
        // Mágneses elhajlás: az iránytű a valódi északhoz igazítva (a pozíció ismeretében, ritkán frissítve)
        if (lastMagneticFix == null || distanceMeters(lastMagneticFix!!, LatLng(f.lat, f.lng)) > 20_000) {
            lastMagneticFix = LatLng(f.lat, f.lng)
            sensors.declination = android.hardware.GeomagneticField(f.lat.toFloat(), f.lng.toFloat(), 0f, now).declination.toDouble()
        }
        headingState = hybridHeading(headingState, f.speed, f.bearing, compass)
        if (headingState.source == HeadingSource.GPS && headingState.angle != null) liveHeading = headingState.angle
        transportState = updateTransport(transportState, f.speed, now, _state.value.manualTransport)
        anchorForWake = f.anchor
        val s = _state.value
        val next = s.copy(point = applied.point, rawPoint = LatLng(f.lat, f.lng), acc = f.acc, speed = f.speed, heading = headingState.angle,
            at = at, still = still, stoppedSince = f.stoppedSince, transport = transportState.mode, placeShiftM = applied.shiftM, error = null)
        _state.value = next

        val pm = peers()
        if (next.sharing && shouldPublishLocation(true, now, lastSent, publishIntervalMs(visible, still))) {
            lastSent = now
            pm.sendLocation(LocationMessage(applied.point.lat, applied.point.lng, at, f.acc, f.speed, headingState.angle, next.battery?.toDouble(),
                next.sharingSince, f.stoppedSince, transportState.mode))   // eredeti mérési idő: elavult mérést nem álcázunk frissnek
        }
        // Energia: látható képernyőnél 1 mp; háttérben néző nélkül 5 mp; tartósan állva néző mellett 3 mp.
        // Csak akkor ritkítunk, ha a telefon fizikailag sem mozog (testmozgás-érzékelő), és nem jött friss mozgásjel.
        val calm = still && f.stoppedSince != null && now - f.stoppedSince >= CALM_AFTER_MS && !stepEvidence && now > envWakeUntil
        var want = desiredGpsIntervalMs(PowerContext(visible, next.sharing, pm.hasViewers(), calm))
        if (want > ACTIVE_GPS_MS && (stepEvidence || now <= envWakeUntil || movementWake(f.lat, f.lng, raw.speed, raw.acc, f.anchor))) want = ACTIVE_GPS_MS
        restartWithInterval(want)
    }

    fun shutdown() { stopTracking(); scope.cancel() }
}
