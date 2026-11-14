package hu.privateplace.app.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import hu.privateplace.app.BuildConfig
import hu.privateplace.app.PrivatePlaceApp
import hu.privateplace.app.data.LocalProfile
import hu.privateplace.app.data.lookupAddress
import hu.privateplace.app.domain.*
import hu.privateplace.app.p2p.RemotePerson
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.Collator
import java.util.Locale

data class ToastMsg(val kind: String, val text: String, val description: String? = null, val action: Pair<String, () -> Unit>? = null, val ms: Long = 4000)
enum class DialogKind { WELCOME, PERMISSIONS, VIEWERS, ROOMS, SETTINGS, SHARE, JOIN }
const val SELF = "self"

@Composable
fun rememberClock(): State<Long> = produceState(System.currentTimeMillis()) { while (true) { delay(1000); value = System.currentTimeMillis() } }

@Composable
fun AppRoot(actions: PermissionActions, invite: Invitation?, onInviteDone: () -> Unit, permTick: Int, onExit: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val prefs by g.prefs.collectAsState()
    val fonts = remember { loadFonts(ctx) }
    CompositionLocalProvider(LocalPalette provides (if (prefs.mapTheme == "dark") DarkPalette else LightPalette), LocalFonts provides fonts) {
        MapScreen(actions, invite, onInviteDone, permTick, onExit)
    }
}

private fun kmh(speed: Double?) = if (speed == null || speed.isNaN()) "– km/h" else "${maxOf(0, Math.round(speed * 3.6).toInt())} km/h"
private fun personStatus(p: RemotePerson, now: Long): String {
    if (!p.online) return ""
    if (!p.sharing) return "nem oszt meg"
    val at = p.at ?: return ""
    if (p.stoppedSince != null) return kmh(0.0)
    if (now - at >= 15000) return kmh(null)
    return kmh(p.speed)
}

@Composable
fun MapScreen(actions: PermissionActions, invite: Invitation?, onInviteDone: () -> Unit, permTick: Int, onExit: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val scope = rememberCoroutineScope()
    val self by g.engine.state.collectAsState(); val net by g.peers.state.collectAsState()
    val prefs by g.prefs.collectAsState(); val rooms by g.rooms.collectAsState(); val colors by g.personColors.collectAsState(); val profile by g.profile.collectAsState()
    val clock by rememberClock()
    var dialog by remember { mutableStateOf<DialogKind?>(when { g.profile.value == null -> DialogKind.WELCOME; invite != null -> DialogKind.JOIN; else -> null }) }
    var settingsView by remember { mutableStateOf("main") }
    var shareToken by remember { mutableStateOf<String?>(null) }
    var pendingJoin by remember { mutableStateOf(invite) }
    var follow by remember { mutableStateOf<FollowReq?>(null) }
    var exitConfirm by remember { mutableStateOf(false) }
    var addressAskHidden by remember { mutableStateOf(false) }
    var selfTrack by remember { mutableStateOf(listOf<TrackPoint>()) }
    var compassRot by remember { mutableFloatStateOf(0f) }
    val cam = remember { SharedCamera() }
    var window by remember { mutableStateOf<IntArray?>(null) }
    var transportDemo by remember { mutableStateOf(false) }
    val toasts = remember { mutableStateListOf<ToastMsg>() }
    var pickTarget by remember { mutableStateOf<Pair<String, String?>?>(null) }
    val centerRef = remember { mutableStateOf<(() -> org.maplibre.android.geometry.LatLng?)?>(null) }
    val selfColor = colors[SELF_COLOR_KEY] ?: SELF_COLOR
    val addressAllowed = prefs.addressConsent == "yes"

    // Meghívó nyitása közben (új intent) a csatlakozás ablak jelenik meg
    LaunchedEffect(invite) { if (invite != null) { pendingJoin = invite; if (profile != null) dialog = DialogKind.JOIN } }
    LaunchedEffect(permTick) { g.checkForUpdate(false) }
    LaunchedEffect(self.at) {
        val p = self.point; val at = self.at
        if (p != null && at != null) selfTrack = appendTrackPoint(selfTrack, TrackPoint(p.lat, p.lng, at), System.currentTimeMillis())
    }
    LaunchedEffect(Unit) { g.toasts.collect { toasts.add(it) } }
    LaunchedEffect(Unit) { g.shareRequests.collect { dev ->
        val who = g.peers.state.value.people[dev]?.name ?: "Egy szobatársad"
        if (g.engine.state.value.sharing) toasts.add(ToastMsg("info", "$who kérte a helyzetedet – a megosztás már be van kapcsolva."))
        else toasts.add(ToastMsg("info", "$who szeretné látni, merre vagy", "Egy koppintással bekapcsolhatod a megosztást.", "Megosztás" to { g.engine.setPermissionGranted(Perms.anyLocation(ctx)); g.engine.setSharing(true) }, 15000))
    } }
    val askAddress = dialog == null && prefs.addressConsent == "ask" && !addressAskHidden && profile != null
    LaunchedEffect(askAddress) { if (askAddress) { delay(30000); addressAskHidden = true } }

    val remote = remember(net.people, colors) {
        val coll = Collator.getInstance(Locale("hu"))
        net.people.values.map { p -> colors[p.deviceId]?.let { p.copy(color = it) } ?: p }.sortedWith(compareBy<RemotePerson>({ !it.online }).thenComparator { a, b -> coll.compare(a.name, b.name) })
    }
    val mapPeople = remember(profile, selfTrack, remote, self.heading, self.battery, self.speed, selfColor, self.stoppedSince) {
        buildList {
            if (profile != null && selfTrack.isNotEmpty()) add(MapPerson(SELF, profile!!.name, profile!!.avatar, selfColor, selfTrack, true, self.heading, self.battery, self.stoppedSince, self.speed))
            for (p in remote) if (p.sharing && p.points.isNotEmpty()) add(MapPerson(p.deviceId, p.name, p.avatar, p.color, p.points, false, p.heading, p.battery?.toInt(), p.stoppedSince, p.speed))
        }
    }
    fun hasPosition(id: String) = mapPeople.any { it.id == id }
    val onlineCount = remote.count { it.online }
    val selfFresh = self.at?.let { clock - it < 15000 } ?: false
    val sharingStatus = if (!self.sharing) "off" else if (self.error != null) "lost" else if (!selfFresh) "search" else "live"
    fun askToShare(dev: String) {
        val p = net.people[dev]
        if (p?.online != true) { g.toast("info", "Ő most nincs online, ezért nem tudod megkérni."); return }
        if (g.peers.requestShare(dev)) g.toast("success", "Kérés elküldve ${p.name} részére.")
    }
    fun toggleFollow(id: String) {
        if (follow?.id == id) { follow = null; return }
        if (!hasPosition(id)) {
            if (id == SELF) {
                if (self.error == "denied") dialog = DialogKind.PERMISSIONS
                else { g.engine.setPermissionGranted(Perms.anyLocation(ctx)); g.engine.evaluate(); g.toast("info", "Újra keresem a helyzetedet. Ellenőrizd, hogy a telefon helymeghatározása be van-e kapcsolva.") }
            } else toasts.add(ToastMsg("info", "${net.people[id]?.name ?: "Ő"} most nem osztja meg a helyzetét", null, "Kérés" to { askToShare(id) }))
            return
        }
        follow = FollowReq(id, (follow?.request ?: 0) + 1)
    }
    fun setSharing(v: Boolean) {
        if (v && !Perms.anyLocation(ctx)) { dialog = DialogKind.PERMISSIONS; return }
        g.engine.setPermissionGranted(Perms.anyLocation(ctx)); g.engine.setSharing(v)
        if (v && !Perms.notifications(ctx)) actions.requestNotifications()
    }
    BackHandlerCompat(dialog, exitConfirm, { dialog = null; pendingJoin = null; onInviteDone() }, { exitConfirm = true })

    val density = LocalDensity.current
    Box(Modifier.fillMaxSize().background(pal.background).drawBehind {
        drawRect(Brush.radialGradient(listOf(Color(0xFF14B8A6).copy(alpha = .12f), Color.Transparent), Offset(0f, 0f), size.width * 1.2f))
        drawRect(Brush.radialGradient(listOf(Color(0xFF3B82F6).copy(alpha = .14f), Color.Transparent), Offset(size.width, size.height), size.width))
    }) {
        // Elmosott háttér a térképablakon kívül (veil)
        Box(Modifier.fillMaxSize()) {
            BlurredBackdrop(cam, prefs.mapTheme == "dark", window, Modifier.fillMaxSize().then(if (android.os.Build.VERSION.SDK_INT >= 31) Modifier.blur(10.5.dp) else Modifier))
            Box(Modifier.fillMaxSize().background(pal.veilColor.copy(alpha = .38f)))
            Box(Modifier.fillMaxSize().drawBehind {
                drawRect(Brush.radialGradient(listOf(Color(0xFF14B8A6).copy(alpha = .10f), Color.Transparent), Offset(0f, 0f), size.width * 1.2f))
                drawRect(Brush.radialGradient(listOf(Color(0xFF3B82F6).copy(alpha = .14f), Color.Transparent), Offset(size.width, size.height), size.width))
            })
        }

        Column(Modifier.fillMaxSize().statusBarsPadding().padding(top = 8.dp, start = 8.dp, end = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // ── Fejléc ──
            Row(Modifier.fillMaxWidth().glass(20.dp).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt("Private Place", Modifier.weight(1f), size = 16f, weight = 700, display = true, maxLines = 1, lineHeight = 24f)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    SharingControl(sharingStatus) { setSharing(!self.sharing) }
                    Box(Modifier.size(36.dp).indicator(onlineCount > 0).clip(CircleShape).clickable { dialog = DialogKind.ROOMS }, contentAlignment = Alignment.Center) {
                        LIcon("users", size = 20.dp, tint = if (onlineCount > 0) pal.primary else pal.foreground)
                        if (onlineCount > 0) Box(Modifier.align(Alignment.TopEnd).offset(2.dp, (-2).dp).defaultMinSize(minWidth = 17.dp).height(17.dp).background(pal.primary, CircleShape).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
                            Txt("$onlineCount", size = 10f, weight = 600, color = pal.primaryForeground) }
                    }
                    Box(Modifier.size(36.dp).indicator(dialog == DialogKind.SETTINGS).clip(CircleShape).clickable { settingsView = "main"; dialog = DialogKind.SETTINGS }, contentAlignment = Alignment.Center) {
                        LIcon("settings-2", size = 20.dp, tint = if (dialog == DialogKind.SETTINGS) pal.primary else pal.foreground) }
                }
            }

            // ── Térképablak ──
            val panelShape = RoundedCornerShape(28.dp)
            Box(Modifier.weight(1f).fillMaxWidth().shadow(10.dp, panelShape, ambientColor = pal.shade.copy(.4f), spotColor = pal.shade.copy(.4f)).clip(panelShape).border(1.dp, pal.glassEdge, panelShape)
                .onGloballyPositioned { c ->
                    val pos = c.positionInRoot(); val root = c.findRootCoordinates().size
                    window = intArrayOf(pos.x.toInt(), pos.y.toInt(), maxOf(0, root.width - pos.x.toInt() - c.size.width), maxOf(0, root.height - pos.y.toInt() - c.size.height))
                }) {
                LiveMap(mapPeople, follow, prefs.showTrails, prefs.trailIds, prefs.orientation, prefs.mapTheme == "dark", cam, { compassRot = it }, addressAllowed,
                    { g.updatePrefs { it.copy(addressConsent = "yes") } }, Modifier.fillMaxSize(), centerRef)
                // belső árnyék-gyűrű
                Box(Modifier.fillMaxSize().border(1.dp, pal.tint.copy(alpha = .06f), panelShape))

                // Iránytű
                Box(Modifier.align(Alignment.TopEnd).padding(top = 12.dp, end = 12.dp).size(44.dp).glass(shape = CircleShape).indicator(prefs.orientation == "heading").clip(CircleShape)
                    .clickable {
                        val next = if (prefs.orientation == "north") "heading" else "north"
                        g.updatePrefs { it.copy(orientation = next) }
                        if (next == "heading" && follow == null && hasPosition(SELF)) follow = FollowReq(SELF, (follow?.request ?: 0) + 1)
                    }, contentAlignment = Alignment.Center) {
                    Box(Modifier.rotate(compassRot)) {
                        if (prefs.orientation == "heading") LIcon("navigation-2", size = 20.dp, tint = pal.primary) else Txt("N", size = 14f, weight = 700, display = true)
                    }
                }
                // Téma
                Box(Modifier.align(Alignment.TopEnd).padding(top = 64.dp, end = 12.dp).size(44.dp).glass(shape = CircleShape).clip(CircleShape)
                    .clickable { g.updatePrefs { it.copy(mapTheme = if (it.mapTheme == "dark") "light" else "dark") } }, contentAlignment = Alignment.Center) {
                    LIcon(if (prefs.mapTheme == "dark") "sun" else "moon", size = 16.dp) }

                // Közlekedés
                key(follow?.id ?: SELF) {
                    val own = follow == null || follow?.id == SELF
                    TransportControl(if (!own) net.people[follow!!.id]?.transport?.wire?.let { TransportMode.fromWire(it) } else self.transport, own, self.manualTransport != null, transportDemo,
                        Modifier.align(Alignment.BottomStart).padding(bottom = 16.dp, start = 12.dp)) { mode -> g.engine.setManualTransport(mode) }
                }
                // Cím-kérdés
                if (askAddress) Row(Modifier.align(Alignment.BottomStart).padding(bottom = 16.dp, start = 72.dp, end = 64.dp).fillMaxWidth().heightIn(min = 48.dp).glass(shape = CircleShape).padding(start = 14.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.End) {
                    Txt("Cím megjelenítése?", Modifier.weight(1f), size = 12f, weight = 600, lineHeight = 15f)
                    PPButton({ g.updatePrefs { it.copy(addressConsent = "no") } }, variant = Variant.Ghost, small = true) { BtnText("Nem", it, true) }
                    PPButton({ g.updatePrefs { it.copy(addressConsent = "yes") } }, Modifier.indicator(true), variant = Variant.Ghost, small = true) { BtnText("Igen", pal.primary, true) }
                }
                // Térképes kijelölés (saját helyek)
                pickTarget?.let { t -> PickOverlay({ pickTarget = null; dialog = DialogKind.SETTINGS; settingsView = "places" }) {
                    val c = centerRef.value?.invoke()
                    if (c != null) {
                        val places = g.places.value
                        g.savePlaces(places.map { p -> if (p.id != t.first) p else if (t.second == null) p.copy(spots = p.spots + newSpot(LatLng(c.latitude, c.longitude), "Pont ${p.spots.size + 1}"))
                            else p.copy(spots = p.spots.map { s -> if (s.id == t.second) s.copy(lat = c.latitude, lng = c.longitude, bias = null, learnedAt = null, samples = 0) else s }) })
                    } else g.toast("warning", "A térkép még nem áll készen.")
                    pickTarget = null; dialog = DialogKind.SETTINGS; settingsView = "places"
                } }
            }

            // ── Személysáv ──
            Box(Modifier.fillMaxWidth().layout { m, c -> val p = m.measure(c.copy(maxWidth = c.maxWidth + 16.dp.roundToPx())); layout(c.maxWidth, p.height) { p.place(-8.dp.roundToPx(), 0) } }) {
                val fade = Brush.horizontalGradient(0f to Color.Transparent, 0.05f to Color.Black, 0.95f to Color.Black, 1f to Color.Transparent)
                LazyRow(Modifier.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }.drawWithContent { drawContent(); drawRect(fade, blendMode = BlendMode.DstIn) },
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 14.dp, bottom = maxOf(15.dp, with(density) { WindowInsets.navigationBars.getBottom(this).toDp() } + 8.dp)),
                    horizontalArrangement = Arrangement.spacedBy(9.6.dp)) {
                    if (profile != null) item { PersonCapsule("Én", profile!!.avatar, profile!!.name, selfColor, follow?.id == SELF,
                        if (selfFresh) "on" else if (self.error != null) "warn" else "wait", if (self.at != null) kmh(self.speed) else "") { toggleFollow(SELF) } }
                    items(remote, key = { it.deviceId }) { p ->
                        PersonCapsule(p.name, p.avatar, p.name, p.color, follow?.id == p.deviceId,
                            if (!p.online) "warn" else if (!p.sharing) "off" else if (p.at != null && clock - p.at < 15000) "on" else "wait", personStatus(p, clock)) { toggleFollow(p.deviceId) }
                    }
                    if (remote.isEmpty()) item { PersonCapsule("Meghívó", null, "+", "", false, "none", "Szoba", invite = true) { dialog = DialogKind.ROOMS } }
                }
            }
        }

        // ── Súgóbuborékok ──
        if (profile != null && dialog == null && prefs.hint < HINTS.size) HintBubbles(prefs.hint, { g.updatePrefs { it.copy(hint = prefs.hint + 1) } }, { g.updatePrefs { it.copy(hint = HINTS.size) } }, { transportDemo = it })

        // ── Értesítések (sonner, üveg) ──
        ToastHost(toasts)

        // ── Ablakok ──
        DialogHost(dialog, settingsView, { settingsView = it }, shareToken, { shareToken = it }, pendingJoin, { pendingJoin = it }, exitConfirm, { exitConfirm = it }, actions, permTick,
            onDialog = { dialog = it }, onPick = { t -> pickTarget = t; dialog = null }, onResetHints = { g.updatePrefs { it.copy(hint = 0) }; dialog = null }, onInviteDone = onInviteDone, onExit = onExit, selfColor = selfColor,
            selfTrackClear = { selfTrack = clearTrackHistory(selfTrack) })
    }
}

@Composable
private fun BackHandlerCompat(dialog: DialogKind?, exitConfirm: Boolean, closeDialog: () -> Unit, askExit: () -> Unit) {
    androidx.activity.compose.BackHandler(enabled = dialog == null) { askExit() }
}

// ───────── Megosztás-kapcsoló (SharingControl) ─────────
@Composable
fun SharingControl(status: String, onToggle: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    LaunchedEffect(status) { expanded = true; delay(3000); expanded = false }
    val w by animateDpAsState(if (expanded) 164.dp else 40.dp, tween(220), label = "sc")
    val label = mapOf("off" to "Megosztás ki", "live" to "Megosztás be", "search" to "Helyzet keresése…", "lost" to "Nincs jel")[status] ?: ""
    val signal = when (status) { "live" -> Color(0xFF14B8A6); "search" -> Color(0xFFFBBF24); "lost" -> Color(0xFFFB7185); else -> pal.mutedForeground }
    val t = rememberInfiniteTransition(label = "sig")
    val k by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1800, easing = LinearOutSlowInEasing)), label = "k")
    val on = status != "off"
    val bg = if (on) lerp(pal.glassBg, Color(0xFF14B8A6), .18f) else pal.glassBg
    Row(Modifier.width(w).height(40.dp).drawBehind { if (on) drawCircle(signal.copy(alpha = .45f * (1 - k)), radius = size.height / 2 + 7.dp.toPx() * k, center = center) }
        .clip(CircleShape).background(bg, CircleShape).border(1.dp, pal.glassEdge, CircleShape).clickable(onClick = onToggle).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically) {
        LIcon(if (status == "off") "play" else "pause", size = 18.dp, tint = if (on) Color(0xFF14B8A6) else signal)
        if (w > 60.dp) { Spacer(Modifier.width(6.dp)); Txt(label, size = 11f, color = if (on) Color(0xFF14B8A6) else signal, maxLines = 1) }
    }
}

// ───────── Közlekedés (TransportControl) ─────────
@Composable
fun TransportControl(mode: TransportMode?, own: Boolean, manual: Boolean, demo: Boolean, modifier: Modifier, onSelect: (TransportMode?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val current = mode ?: TransportMode.WALK
    val expanded = (open && own) || demo
    val w by animateDpAsState(if (expanded) 128.dp else 48.dp, tween(220), label = "tc")
    fun icon(m: TransportMode) = when (m) { TransportMode.WALK -> "footprints"; TransportMode.BIKE -> "bike"; TransportMode.CAR -> "car" }
    Row(modifier.width(w).height(48.dp).glass(shape = CircleShape).padding(3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        if (!expanded) Box(Modifier.size(36.dp).clip(CircleShape).clickable { if (own) open = true }, contentAlignment = Alignment.Center) { LIcon(icon(current), size = 16.dp) }
        else TransportMode.values().forEach { m ->
            Box(Modifier.size(36.dp).clip(CircleShape).clickable { onSelect(if (manual && current == m) null else m); open = false }, contentAlignment = Alignment.Center) {
                LIcon(icon(m), size = 16.dp, tint = if (current == m) pal.primary else pal.foreground) }
        }
    }
}

// ───────── Személykapszula ─────────
@Composable
fun PersonCapsule(name: String, avatar: String?, fallback: String, color: String, active: Boolean, dot: String, status: String, invite: Boolean = false, onClick: () -> Unit) {
    var pressed by remember { mutableStateOf(false) }
    val c = if (color.startsWith("#")) parseColor(color) else pal.mutedForeground
    val shape = CircleShape
    Row(Modifier.width(176.dp).height(72.dp).scale(if (pressed) .97f else 1f)
        .then(if (active) Modifier.shadow(8.dp, shape, ambientColor = pal.signal.copy(.4f), spotColor = pal.signal.copy(.4f)) else Modifier.shadow(8.dp, shape, ambientColor = pal.shade.copy(.45f), spotColor = pal.shade.copy(.45f)))
        .clip(shape).background(pal.glassBg, shape).background(if (active) pal.signal.copy(alpha = .12f) else Color.Transparent, shape)
        .border(if (invite) 1.dp else 1.dp, if (active) pal.signal.copy(alpha = .55f) else pal.glassEdge, shape)
        .clickable(onClick = onClick).padding(start = 8.dp, end = 14.dp, top = 5.dp, bottom = 5.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.6.dp)) {
        CapsuleAvatar(fallback, avatar, c, 54.dp, plus = invite, glow = active)
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
            Txt(name, size = 14f, weight = 600, maxLines = 1, modifier = Modifier.fillMaxWidth())
            if (status.isNotEmpty()) Txt(status, size = 11f, color = pal.mutedForeground, maxLines = 1, modifier = Modifier.fillMaxWidth(), lineHeight = 16f)
            if (dot != "none") StatusDot(dot, Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
fun CapsuleAvatar(name: String, avatar: String?, color: Color, size: androidx.compose.ui.unit.Dp, plus: Boolean = false, glow: Boolean = false) {
    val bmp = remember(avatar) { decodeDataUrl(avatar) }
    Box(Modifier.size(size).then(if (glow) Modifier.shadow(10.dp, CircleShape, ambientColor = pal.glow, spotColor = pal.glow) else Modifier).clip(CircleShape).background(pal.surfaceStrong, CircleShape)
        .border(3.dp, color, CircleShape), contentAlignment = Alignment.Center) {
        when {
            plus -> LIcon("plus", size = 24.dp, tint = pal.mutedForeground)
            bmp != null -> androidx.compose.foundation.Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
            else -> Txt((name.ifBlank { "?" }).take(1).uppercase(), size = 18.4f, weight = 600)
        }
    }
}

fun decodeDataUrl(url: String?): android.graphics.Bitmap? = runCatching {
    val b = android.util.Base64.decode(url!!.substringAfter("base64,"), android.util.Base64.DEFAULT); android.graphics.BitmapFactory.decodeByteArray(b, 0, b.size)
}.getOrNull()

// ───────── Térképes pont-kijelölés (célkereszt) ─────────
@Composable
fun BoxScope.PickOverlay(onCancel: () -> Unit, onConfirm: () -> Unit) {
    Box(Modifier.align(Alignment.Center).size(40.dp)) {
        Box(Modifier.align(Alignment.Center).width(2.dp).fillMaxHeight().background(Color(0xFFEF4444)))
        Box(Modifier.align(Alignment.Center).height(2.dp).fillMaxWidth().background(Color(0xFFEF4444)))
        Box(Modifier.align(Alignment.Center).size(8.dp).background(Color(0xFFEF4444), CircleShape).border(1.dp, Color.White, CircleShape))
    }
    Row(Modifier.align(Alignment.TopCenter).padding(top = 8.dp, start = 12.dp, end = 12.dp).fillMaxWidth().glass(Radius2xl).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Txt("Told a térképet úgy, hogy a célkereszt a valódi helyed legyen, majd koppints az „Ide” gombra.", Modifier.weight(1f), size = 12f, lineHeight = 16f)
        TextBtn("Mégse", onCancel, variant = Variant.Outline, small = true); TextBtn("Ide", onConfirm, small = true)
    }
}

// ───────── Személy-buborék (PersonBubble) ─────────
@Composable
fun PersonBubbleHost(person: MapPerson, self: MapPerson?, at: IntOffset, below: Boolean, addressAllowed: Boolean, onAllow: () -> Unit) {
    val d = LocalDensity.current
    Box(Modifier.layout { m, c ->
        val p = m.measure(c.copy(minWidth = 0, minHeight = 0, maxWidth = minOf(c.maxWidth - 16.dp.roundToPx(), 320.dp.roundToPx())))
        val minX = 8.dp.roundToPx(); val maxX = c.maxWidth - 8.dp.roundToPx() - p.width
        val x = (at.x - p.width / 2).coerceIn(minX, maxOf(minX, maxX))
        val y = if (below) at.y + 32.dp.roundToPx() else at.y - 32.dp.roundToPx() - p.height
        layout(c.maxWidth, c.maxHeight) { p.place(x, y) }
    }) { PersonBubble(person, self, addressAllowed, onAllow) }
}

@Composable
fun PersonBubble(person: MapPerson, self: MapPerson?, addressAllowed: Boolean, onAllow: () -> Unit) {
    val clock by rememberClock()
    var address by remember { mutableStateOf<hu.privateplace.app.data.AddressInfo?>(null) }
    var done by remember { mutableStateOf(false) }; var err by remember { mutableStateOf<String?>(null) }
    val last = person.points.lastOrNull(); val own = self?.points?.lastOrNull()
    var lastQuery by remember { mutableStateOf<Triple<Double, Double, Long>?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(addressAllowed, last?.lat, last?.lng, clock / 1000) {
        if (!addressAllowed || last == null) return@LaunchedEffect
        val prev = lastQuery
        if (prev != null && (System.currentTimeMillis() - prev.third < 15000 || (distanceMeters(LatLng(prev.first, prev.second), LatLng(last.lat, last.lng)) < 25 && !failed))) return@LaunchedEffect
        lastQuery = Triple(last.lat, last.lng, System.currentTimeMillis())
        runCatching { lookupAddress(last.lat, last.lng) }.onSuccess { failed = false; err = null; address = it; done = true }.onFailure { failed = true; err = it.message ?: "hiba"; address = null; done = true }
    }
    val moving = person.stoppedSince == null && person.speed != null
    val distance = if (!person.isSelf && own != null && last != null) distanceMeters(LatLng(own.lat, own.lng), LatLng(last.lat, last.lng)) else null
    Column(Modifier.widthIn(min = 144.dp).glass(12.dp).padding(horizontal = 10.dp, vertical = 8.dp).then(if (addressAllowed) Modifier else Modifier.clickable(onClick = onAllow)), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            LIcon("battery", size = 12.dp); Txt(person.battery?.let { "$it%" } ?: "–", size = 11f)
            if (!person.isSelf) { Txt("·", size = 11f); Txt(if (distance == null) "–" else if (distance < 1000) "${Math.round(distance)} m" else "%.1f km".format(Locale.US, distance / 1000).replace('.', ','), size = 11f) }
        }
        if (addressAllowed) {
            Txt(address?.title ?: if (done) "Cím nem elérhető${err?.let { " ($it)" } ?: ""}" else "Cím keresése…", size = 12f, weight = 600, maxLines = 1, align = TextAlign.Center, lineHeight = 16f, modifier = Modifier.padding(vertical = 3.dp))
            address?.near?.let { Txt(it, size = 11f, color = pal.mutedForeground, align = TextAlign.Center) }
        } else PPButton(onAllow, variant = Variant.Ghost, small = true, height = 24.dp) { LIcon("map-pin", size = 12.dp, tint = it); Spacer(Modifier.width(4.dp)); BtnText("Cím lekérése", it, true) }
        Txt(stopLabel(person.stoppedSince, clock, moving), size = 11f, color = pal.mutedForeground)
    }
}

// ───────── Súgóbuborékok (kompakt, üveges, nyíllal) ─────────
data class Hint(val text: String, val place: String)
val HINTS = listOf(
    Hint("Egy koppintás: megosztás be/ki. Leállítva kíméli az akkut.", "share"),
    Hint("Közlekedési mód: magától vált, rábökve te is választhatsz.", "transport"),
    Hint("Cím: csak a megnyitott jelölő helye megy a címkeresőhöz. A Beállításokban kapcsolható.", "address"),
    Hint("Koppints egy jelölőre: akku, távolság, cím, mióta áll.", "marker"),
    Hint("Koppints egy személyre a követéshez. Ha nem oszt meg, innen kérheted.", "rail"),
    Hint("Megosztáskérésnél felül üzenet jön – a „Megosztás” gombbal azonnal bekapcsolod.", "share"),
)

@Composable
fun BoxScope.HintBubbles(step: Int, onNext: () -> Unit, onSkip: () -> Unit, onDemo: (Boolean) -> Unit) {
    val hint = HINTS.getOrNull(step) ?: return
    LaunchedEffect(hint.place == "transport") {
        if (hint.place != "transport") return@LaunchedEffect
        try { while (true) { delay(750); onDemo(true); delay(1000); onDemo(false) } } finally { onDemo(false) }
    }
    val shape = RoundedCornerShape(16.dp)
    val (align, pad) = when (hint.place) {
        "share" -> Alignment.TopStart to PaddingValues(start = 16.dp, top = 64.dp)
        "transport" -> Alignment.BottomStart to PaddingValues(start = 16.dp, bottom = 168.dp)
        "rail" -> Alignment.BottomStart to PaddingValues(start = 16.dp, bottom = 120.dp)
        "address" -> Alignment.BottomCenter to PaddingValues(bottom = 128.dp)
        else -> Alignment.Center to PaddingValues(bottom = 80.dp)
    }
    Box(Modifier.align(align).statusBarsPadding().padding(pad).widthIn(max = 240.dp)) {
        AnimatedContent(step, transitionSpec = { (fadeIn(tween(260)) + scaleIn(tween(260), 0.98f)) togetherWith fadeOut(tween(120)) using SizeTransform(clip = false) { _, _ -> harmonika() } }, label = "hint") { s ->
            val h = HINTS[s]
            Column(Modifier.shadow(10.dp, shape).clip(shape).background(pal.glassStrong, shape).border(1.dp, pal.glassEdge, shape).padding(horizontal = 12.8.dp, vertical = 10.4.dp)) {
                Txt(h.text, size = 12f, lineHeight = 16.5f)
                Row(Modifier.padding(top = 8.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Txt("Kihagyás", size = 11f, color = pal.mutedForeground, underline = true, modifier = Modifier.clickable(onClick = onSkip))
                    Box(Modifier.clip(CircleShape).background(pal.primary, CircleShape).clickable(onClick = onNext).padding(horizontal = 11.dp, vertical = 4.dp)) {
                        Txt(if (s + 1 < HINTS.size) "Tovább ${s + 1}/${HINTS.size}" else "Értem", size = 11.5f, weight = 600, color = pal.primaryForeground) }
                }
            }
        }
    }
}

// ───────── Értesítések (glass-toast) ─────────
@Composable
fun BoxScope.ToastHost(toasts: androidx.compose.runtime.snapshots.SnapshotStateList<ToastMsg>) {
    Column(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        toasts.takeLast(3).forEach { t ->
            key(t) {
                LaunchedEffect(Unit) { delay(t.ms); toasts.remove(t) }
                val shape = RoundedCornerShape(20.dp)
                Row(Modifier.fillMaxWidth().shadow(14.dp, shape).clip(shape).background(pal.glassStrong, shape).border(1.dp, pal.glassEdge, shape).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Txt(t.text, size = 13f, weight = 500, lineHeight = 18f); t.description?.let { Txt(it, size = 13f, color = pal.mutedForeground, lineHeight = 18f) } }
                    t.action?.let { (label, act) -> Box(Modifier.padding(start = 8.dp).clip(RoundedCornerShape(6.dp)).background(pal.primary).clickable { act(); toasts.remove(t) }.padding(horizontal = 8.dp, vertical = 4.dp)) {
                        Txt(label, size = 12f, weight = 500, color = pal.primaryForeground) } }
                }
            }
        }
    }
}
