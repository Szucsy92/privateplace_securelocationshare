package hu.privateplace.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.PowerManager
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import hu.privateplace.app.BuildConfig
import hu.privateplace.app.PrivatePlaceApp
import hu.privateplace.app.data.LocalProfile
import hu.privateplace.app.domain.*

private val roomHex = mapOf("mint" to "#14B8A6", "violet" to "#818CF8", "rose" to "#FB7185", "amber" to "#FBBF24", "sky" to "#38BDF8")
private fun roomColor(c: String?) = parseColor(roomHex[c] ?: roomHex.getValue("mint"))
private val roomNames = mapOf("mint" to "Menta Zöld", "violet" to "Elektromos Levendula", "rose" to "Selyem Barack", "amber" to "Napfény Citromsárga", "sky" to "Jégkék")

// ───────── Profilűrlap (ProfileForm) ─────────
@Composable
fun ProfileForm(initial: LocalProfile?, submitLabel: String, color: String = SELF_COLOR, title: String? = null, description: String? = null, compact: Boolean = false, onSave: (LocalProfile) -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var avatar by remember { mutableStateOf(initial?.avatar) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { u ->
        if (u != null) { val a = avatarFromUri(ctx, u); if (a != null) avatar = a else g.toast("error", "Ezt a képet nem sikerült betölteni.") } }
    @Composable fun body() = Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(54.dp).clip(CircleShape).background(pal.surfaceStrong, CircleShape).border(3.dp, parseColor(color), CircleShape)
                .clickable { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, contentAlignment = Alignment.Center) {
                val bmp = remember(avatar) { decodeDataUrl(avatar) }
                if (bmp != null) androidx.compose.foundation.Image(bmp.asImageBitmap(), "Profilkép választása", Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
                else LIcon("image-plus", size = 20.dp, tint = pal.mutedForeground)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                PillInput(name, { name = it }, "A neved", max = 40)
                if (avatar != null) Txt("Kép eltávolítása", size = 12f, color = pal.mutedForeground, underline = true, modifier = Modifier.padding(horizontal = 8.dp).clickable { avatar = null })
            }
        }
        PPButton({ val clean = name.trim().take(40); if (clean.isNotEmpty()) onSave(LocalProfile(clean, avatar)) }, Modifier.fillMaxWidth(), enabled = name.isNotBlank()) { BtnText(submitLabel, it) }
    }
    if (compact) body() else { PanelHeader(title ?: "", description ?: ""); Box(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 20.dp)) { body() } }
}

// ───────── Ablak-kezelő ─────────
@Composable
fun DialogHost(
    dialog: DialogKind?, settingsView: String, onSettingsView: (String) -> Unit, shareToken: String?, onShareToken: (String?) -> Unit,
    pendingJoin: Invitation?, onPendingJoin: (Invitation?) -> Unit, exitConfirm: Boolean, onExitConfirm: (Boolean) -> Unit,
    actions: PermissionActions, permTick: Int, onDialog: (DialogKind?) -> Unit, onPick: (Pair<String, String?>) -> Unit, onResetHints: () -> Unit,
    onInviteDone: () -> Unit, onExit: () -> Unit, selfColor: String, selfTrackClear: () -> Unit,
) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val profile by g.profile.collectAsState()
    val avail by g.availableUpdate.collectAsState(); val updDismissed by g.updateDismissed.collectAsState()
    val updStatus by g.updateStatus.collectAsState(); val updPct by g.updatePercent.collectAsState()

    if (dialog != null) GlassDialog(onDismiss = {
        if (dialog == DialogKind.WELCOME) onExitConfirm(true) else { onDialog(null); onPendingJoin(null); onInviteDone() }
    }, dismissable = dialog != DialogKind.WELCOME) {
        ViewSwitch(listOf(dialog, if (dialog == DialogKind.SETTINGS) settingsView else "", exitConfirm).joinToString("|")) { key ->
            Column {
                when {
                    exitConfirm && dialog == DialogKind.WELCOME -> {
                        PanelHeader("Kilépsz az alkalmazásból?", "A helymegosztás leáll. A térkép használatához meg kell adnod a nevedet.")
                        Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                            TextBtn("Mégsem", { onExitConfirm(false) }, variant = Variant.Outline)
                            TextBtn("Kilépés", onExit, variant = Variant.Destructive, icon = "log-out")
                        }
                    }
                    dialog == DialogKind.WELCOME -> ProfileForm(null, "Kezdés", title = "Üdv a Private Place-ben",
                        description = "Nincs regisztráció és nincs jelszó. A neved és a képed csak ezen a telefonon tárolódik, és csak a szobatársaid látják.") { p ->
                        g.saveProfile(p); onDialog(if (g.store.permissionsAsked) (if (pendingJoin != null) DialogKind.JOIN else null) else DialogKind.PERMISSIONS)
                    }
                    dialog == DialogKind.PERMISSIONS -> PermissionsPanel(actions, permTick, onAskAddressAgain = { g.updatePrefs { it.copy(addressConsent = "ask") }; onDialog(null) }, onDone = {
                        g.store.permissionsAsked = true; g.engine.setPermissionGranted(Perms.anyLocation(ctx)); g.engine.evaluate(); onDialog(if (pendingJoin != null) DialogKind.JOIN else null) })
                    dialog == DialogKind.JOIN -> JoinPanel(pendingJoin, actions, onJoin = { t, n, c, k -> g.joinRoom(t, n, c, k); onPendingJoin(null); onDialog(null) }, onReject = { onPendingJoin(null); onDialog(null) })
                    dialog == DialogKind.SHARE && shareToken != null -> SharePanel(g.rooms.collectAsState().value.firstOrNull { it.token == shareToken }) { onDialog(DialogKind.ROOMS) }
                    dialog == DialogKind.ROOMS -> RoomsPanel(onShare = { onShareToken(it); onDialog(DialogKind.SHARE) }, onNew = { val r = g.createRoom(); onShareToken(r.token); onDialog(DialogKind.SHARE) }, onJoin = { onDialog(DialogKind.JOIN) })
                    dialog == DialogKind.SETTINGS && profile != null -> when (settingsView) {
                        "places" -> PlacesPanel(onBack = { onSettingsView("main") }, onPick = onPick)
                        "trails" -> TrailsPanel(onBack = { onSettingsView("main") }, selfTrackClear)
                        else -> SettingsMain(selfColor, onTrails = { onSettingsView("trails") }, onPlaces = { onSettingsView("places") }, onPermissions = { onDialog(DialogKind.PERMISSIONS) }, onResetHints = onResetHints)
                    }
                    else -> {}
                }
            }
        }
    }

    // Új frissítés (OTA)
    val upd = avail
    if (upd != null && !updDismissed && dialog != DialogKind.WELCOME && dialog != DialogKind.PERMISSIONS) GlassDialog(onDismiss = { g.dismissUpdate() }, dismissable = updStatus != "downloading", maxWidth = 340.dp) {
        PanelHeader("Új frissítés elérhető", when (updStatus) { "downloading" -> "Letöltés…${updPct?.let { " $it%" } ?: ""}"
            "permission" -> "Engedélyezd a telepítést a Private Place számára, majd koppints újra a Letöltésre."; else -> null })
        Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            TextBtn("Később", { g.dismissUpdate() }, variant = Variant.Outline, enabled = updStatus != "downloading")
            TextBtn("Letöltés", { g.startUpdate() }, enabled = updStatus != "downloading")
        }
    }
}

// ───────── Engedélyek ─────────
private data class PermInfo(val key: String, val label: String, val hint: String, val icon: String)
private val PERMS = listOf(
    PermInfo("location", "Pontos helyzet", "A saját pozíciód a térképen. A rendszerablakban válaszd a „Pontos” lehetőséget.", "map-pin"),
    PermInfo("backgroundLocation", "Helyzet lezárt képernyőnél", "A megnyíló beállításokban: Engedélyek → Hely → Mindig engedélyezés.", "lock-keyhole"),
    PermInfo("notifications", "Értesítések", "Jelzi, ha a megosztás a háttérben is fut.", "bell"),
    PermInfo("camera", "Kamera", "A szobák QR-kódjának beolvasásához.", "camera"),
    PermInfo("battery", "Akkumulátor-kímélés kikapcsolása", "Hogy a telefon ne állítsa le a megosztást, amíg zsebben van.", "battery-charging"),
)

@Composable
private fun PermissionsPanel(actions: PermissionActions, tick: Int, onAskAddressAgain: () -> Unit, onDone: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val prefs by g.prefs.collectAsState()
    var requested by remember { mutableStateOf(setOf<String>()) }
    var busyAll by remember { mutableStateOf(false) }
    fun state(k: String): String = when (k) {
        "location" -> if (Perms.fine(ctx)) "granted" else if (Perms.anyLocation(ctx)) "limited" else if ("location" in requested) "denied" else "prompt"
        "backgroundLocation" -> if (Perms.background(ctx)) "granted" else if (!Perms.anyLocation(ctx)) "prompt" else if (k in requested) "denied" else "prompt"
        "notifications" -> if (Perms.notifications(ctx)) "granted" else if (k in requested) "denied" else "prompt"
        "camera" -> if (Perms.camera(ctx)) "granted" else if (k in requested) "denied" else "prompt"
        else -> if ((ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName)) "granted" else "manual"
    }
    fun request(k: String) {
        requested = requested + k
        when (k) {
            "location" -> actions.requestLocation(); "backgroundLocation" -> actions.requestBackground(); "notifications" -> actions.requestNotifications()
            "camera" -> actions.requestCamera {}; else -> Perms.openBatterySettings(ctx)
        }
    }
    fun askOne(k: String) { if (state(k) == "denied") Perms.openSettings(ctx) else if (state(k) == "limited") Perms.openSettings(ctx) else request(k) }
    val states = PERMS.associate { it.key to state(it.key) }
    val allGranted = states.values.all { it == "granted" || it == "manual" }
    // „Összes engedélyezése”: mindig a következő hiányzót kéri, amint az előző válasz megérkezett
    LaunchedEffect(tick, busyAll) {
        if (!busyAll) return@LaunchedEffect
        val next = PERMS.firstOrNull { state(it.key) == "prompt" && it.key !in requested }
        if (next == null) busyAll = false else request(next.key)
    }
    PanelHeader("Engedélyek", "Hogy a Private Place rendesen működjön, ezekhez kér hozzáférést. Semmi nem kerül központi helyre.")
    ElasticScroll(Modifier.padding(horizontal = 20.dp), maxHeight = 420.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 4.dp)) {
            for (info in PERMS) {
                val st = states.getValue(info.key); val granted = st == "granted"; val denied = st == "denied"
                Row(Modifier.fillMaxWidth().glassInset().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(40.dp).indicator(granted), contentAlignment = Alignment.Center) { LIcon(info.icon, size = 20.dp, tint = if (granted) pal.primary else pal.foreground) }
                    Column(Modifier.weight(1f)) {
                        Txt(info.label, size = 14f, weight = 600, lineHeight = 20f)
                        Txt(if (st == "limited") "Most csak hozzávetőleges. Koppints a Pontosításra, és kapcsold be a „Pontos hely”-et." else info.hint, size = 12f, color = pal.mutedForeground, lineHeight = 16f)
                    }
                    if (granted) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { StatusDot("on"); Txt("Kész", size = 11f, color = pal.mutedForeground) }
                    else PPButton({ askOne(info.key) }, variant = if (denied) Variant.Outline else Variant.Default, small = true, enabled = !busyAll) {
                        BtnText(if (st == "limited") "Pontosítás" else if (st == "manual" || denied) "Beállítás" else "Engedélyezés", it, true) }
                }
            }
            Column(Modifier.fillMaxWidth().glassInset().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                CheckRow("Pontos cím lekérése (OpenStreetMap)", prefs.addressConsent == "yes", { v -> g.updatePrefs { it.copy(addressConsent = if (v) "yes" else "no") } })
                PPButton(onAskAddressAgain, variant = Variant.Ghost, small = true, height = 32.dp) { BtnText("Címkérdés újra megjelenítése", it, true) }
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PPButton({ busyAll = true; requested = emptySet() }, Modifier.weight(1f), enabled = !busyAll && !allGranted) { c -> LIcon("shield-check", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText(if (busyAll) "Kérés…" else "Összes engedélyezése", c) }
        PPButton(onDone, Modifier.weight(1f), variant = Variant.Outline, enabled = !busyAll) { BtnText(if (allGranted) "Kész" else "Tovább", it) }
    }
}

// ───────── Csatlakozás ─────────
@Composable
private fun JoinPanel(initial: Invitation?, actions: PermissionActions, onJoin: (String, String?, String?, String?) -> Unit, onReject: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    var value by remember { mutableStateOf(initial?.let { formatRoomToken(it.token) } ?: "") }
    var scanning by remember { mutableStateOf(false) }
    val parsed = remember(value) { parseRoomInput(value) }
    val name = parsed?.name ?: initial?.name
    val avail by g.availableUpdate.collectAsState()
    PanelHeader(if (initial != null) "Meghívást kaptál" else "Csatlakozás szobához",
        if (initial != null) "Csatlakozol a(z) „${initial.name ?: "meghívott"}” szobához? Ott kölcsönösen láthatjátok egymást, ha bekapcsoljátok a megosztást." else "Olvasd be a QR-kódot, vagy írd be a kapott kódot, illetve linket.")
    ElasticScroll(Modifier.padding(horizontal = 20.dp), maxHeight = 480.dp) {
        Column(Modifier.padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (scanning) QrScanner({ text -> scanning = false; if (parseRoomInput(text) != null) value = text else g.toast("error", "Ez a QR-kód nem Private Place meghívó.") })
            PillInput(value, { value = it }, "ABCDE-FGHJK-…", max = 400)
            PPButton({ if (scanning) scanning = false else actions.requestCamera { scanning = true } }, Modifier.fillMaxWidth(), variant = Variant.Outline) { c ->
                LIcon(if (scanning) "scan-line" else "camera", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText(if (scanning) "Beolvasás leállítása" else "QR-kód beolvasása", c) }
            if (avail != null) PPButton({ g.updateDismissed.value = false; g.startUpdate() }, Modifier.fillMaxWidth()) { BtnText("Frissítés letöltése", it) }
            if (parsed != null && parsed.ownerKey == null && !(parsed.token == initial?.token && initial.ownerKey != null))
                Txt("Gazdakulcs nélkül a szoba törlése és az eltávolítások nem érkeznek meg hozzád. Olvasd be a QR-kódot, vagy másold be a teljes megosztott kódot.", size = 12f, color = pal.mutedForeground, align = TextAlign.Center, lineHeight = 16f, modifier = Modifier.fillMaxWidth())
            PPButton({ val p = parsed; if (p != null) onJoin(p.token, name, p.color ?: initial?.color, p.ownerKey ?: if (p.token == initial?.token) initial.ownerKey else null) else g.toast("error", "Ez nem érvényes szobakód vagy link.") },
                Modifier.fillMaxWidth(), enabled = parsed != null) { BtnText(if (avail != null) "Csatlakozás frissítés nélkül" else "Csatlakozás", it) }
            PPButton(onReject, Modifier.fillMaxWidth(), variant = Variant.Ghost) { BtnText("Elutasítás", it) }
        }
    }
}

// ───────── Megosztás (QR) ─────────
@Composable
private fun SharePanel(room: SavedRoom?, onDone: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    if (room == null) return
    val code = formatRoomToken(room.token)
    val shareCode = roomShareCode(room.token, room.ownerKey)
    BackHeader(room.name, onDone)
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val shape = RoundedCornerShape(24.dp)
        Box(Modifier.fillMaxWidth().shadow(18.dp, shape, ambientColor = pal.glow, spotColor = pal.glow).clip(shape).background(Color.White, shape).padding(6.dp)) {
            RoundedQr(roomQrValue(room.token, room.ownerKey), roomColor(room.color), Modifier.fillMaxWidth())
        }
        Column(Modifier.fillMaxWidth().glassInset().padding(horizontal = 12.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Txt("SZOBAKÓD", size = 9f, color = pal.mutedForeground, letterSpacing = 1.8f, lineHeight = 12f)
            Txt(code, size = 14f, weight = 700, display = true, letterSpacing = 0.7f)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PPButton({ (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("kód", shareCode)); g.toast("success", "Kód másolva") },
                Modifier.weight(1f), variant = Variant.Outline, small = true, height = 36.dp) { c -> LIcon("copy", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Kód másolása", c, true) }
            PPButton({ ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, "Private Place meghívó")
                .putExtra(Intent.EXTRA_TEXT, "Szobakód: $shareCode"), null)) }, Modifier.weight(1f), small = true, height = 36.dp) { c -> LIcon("share-2", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Küldés", c, true) }
        }
        Txt("Csak az látja a helyzetedet, akinek ezt elküldöd. Bármikor törölheted a szobát.", size = 10f, color = pal.mutedForeground, align = TextAlign.Center, lineHeight = 12.5f)
    }
}

// ───────── Szobák ─────────
private data class Member(val deviceId: String, val name: String, val avatar: String?, val color: String, val custom: Boolean, val online: Boolean, val lastSeen: Long)
private fun lastSeenText(at: Long, now: Long): String {
    val min = maxOf(0L, (now - at) / 60000).toInt()
    if (min < 1) return "épp most"; if (min < 60) return "$min perce"
    val h = min / 60; if (h < 24) return "$h órája"; return "${h / 24} napja"
}

@Composable
private fun RoomsPanel(onShare: (String) -> Unit, onNew: () -> Unit, onJoin: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val rooms by g.rooms.collectAsState(); val net by g.peers.state.collectAsState(); val colors by g.personColors.collectAsState(); val profile by g.profile.collectAsState()
    PanelHeader("Szobák", "Csak az lát téged, akinek elküldöd a szobád kódját vagy QR-kódját.", compact = true)
    ElasticScroll(Modifier.padding(horizontal = 16.dp), maxHeight = 520.dp) {
        Column(Modifier.padding(top = 16.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (rooms.isEmpty()) Txt("Még nincs szobád. Hozz létre egyet, és küldd el a QR-kódot annak, akivel kölcsönösen látni szeretnétek egymást.", size = 14f, color = pal.mutedForeground,
                modifier = Modifier.fillMaxWidth().glassInset().padding(16.dp))
            for (room in rooms) {
                val online = net.roomMembers[room.token] ?: emptyList()
                val members = (net.roster[room.token] ?: emptyList()).map { e -> Member(e.deviceId, net.people[e.deviceId]?.name ?: e.name, net.avatars[e.deviceId] ?: net.people[e.deviceId]?.avatar,
                    colors[e.deviceId] ?: colorForDevice(e.deviceId), colors[e.deviceId] != null, e.deviceId in online, e.lastSeen) }.sortedWith(compareBy({ !it.online }, { it.name.lowercase() }))
                RoomRow(room, net.roomPeers[room.token] ?: 0, members, profile?.let { Triple(it, colors[SELF_COLOR_KEY] ?: SELF_COLOR, colors[SELF_COLOR_KEY] != null) }, onShare = { onShare(room.token) })
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PPButton(onNew, Modifier.weight(1f), small = true) { c -> LIcon("plus", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Új szoba", c, true) }
        PPButton(onJoin, Modifier.weight(1f), variant = Variant.Outline, small = true) { c -> LIcon("door-open", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Csatlakozás", c, true) }
    }
}

@Composable
private fun RoomRow(room: SavedRoom, peers: Int, members: List<Member>, self: Triple<LocalProfile, String, Boolean>?, onShare: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    var editing by remember { mutableStateOf(false) }; var expanded by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf(room.name) }; var color by remember { mutableStateOf(room.color) }
    var confirm by remember { mutableStateOf(false) }; var picker by remember { mutableStateOf<String?>(null) }
    var kickAsk by remember { mutableStateOf<Member?>(null) }
    val rc = roomColor(room.color)
    Column(Modifier.fillMaxWidth().glassInset(Radius).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(84.dp).clip(CircleShape).background(rc.copy(alpha = .16f).compositeOver(pal.glassBg), CircleShape).border(2.dp, rc, CircleShape)
                .clickable { name = room.name; color = room.color; editing = !editing }.padding(8.dp), contentAlignment = Alignment.Center) {
                Txt(room.name, size = 12f, align = TextAlign.Center, lineHeight = 14.4f, maxLines = 4)
            }
            Box(Modifier.weight(1f).height(80.dp).clip(RoundedCornerShape(50)).clickable { expanded = !expanded }, contentAlignment = Alignment.Center) {
                val rot by animateFloatAsState(if (expanded) 180f else 0f, harmonika(), label = "rot")
                LIcon("chevron-down", Modifier.rotate(rot), size = 16.dp)
            }
            Box(Modifier.size(56.dp).clip(CircleShape).clickable(onClick = onShare), contentAlignment = Alignment.Center) { LIcon("qr-code", size = 32.dp) }
        }
        Expansion(editing) {
            Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Divider()
                PillInput(name, { name = it }, "Szoba neve", max = 40)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (c in ROOM_COLORS) Box(Modifier.weight(1f).height(36.dp).clip(CircleShape).then(if (color == c) Modifier.border(1.dp, pal.ring, CircleShape) else Modifier).clickable { color = c }, contentAlignment = Alignment.Center) {
                        Box(Modifier.size(28.dp).clip(CircleShape).background(roomColor(c), CircleShape).border(1.dp, pal.glassEdge, CircleShape), contentAlignment = Alignment.Center) { if (color == c) LIcon("check", size = 12.dp, tint = Color.White) } }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    IconBtn("x", "Szerkesztés elvetése", { editing = false })
                    PPButton({ if (name.isNotBlank()) { g.customizeRoom(room.token, name, color); editing = false } }, enabled = name.isNotBlank()) { c -> LIcon("check", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Mentés", c) }
                }
            }
        }
        Expansion(expanded) {
            Column(Modifier.padding(top = 12.dp)) {
                Divider()
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Txt("$peers kapcsolódva", size = 12f, color = pal.mutedForeground)
                    IconBtn(if (room.owner) "trash-2" else "log-out", "Törlés", { confirm = true }, tint = pal.destructive)
                }
                if (confirm) Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    Txt(if (room.owner) "Törlöd a szobát? A kapcsolódó tagok értesülnek." else "Kilépsz a szobából?", Modifier.weight(1f), size = 12f)
                    TextBtn("Mégse", { confirm = false }, variant = Variant.Outline, small = true)
                    TextBtn(if (room.owner) "Törlés" else "Kilépés", { g.deleteOrLeave(room.token); confirm = false }, variant = Variant.Destructive, small = true)
                }
                Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (self != null) {
                        MemberLine(self.first.name, self.first.avatar, self.second, "Te", null, "self", true, picker == SELF_COLOR_KEY, onPalette = { picker = if (picker == SELF_COLOR_KEY) null else SELF_COLOR_KEY })
                        Expansion(picker == SELF_COLOR_KEY) { ColorPicker(self.second, self.third) { g.setPersonColor(SELF_COLOR_KEY, it) } }
                    }
                    for (m in members) {
                        MemberLine(m.name, m.avatar, m.color, null, if (!m.online && m.lastSeen > 0) "Utoljára: ${lastSeenText(m.lastSeen, System.currentTimeMillis())}" else null, if (m.online) "on" else "off", m.online, picker == m.deviceId,
                            onPalette = { picker = if (picker == m.deviceId) null else m.deviceId }, onForget = if (!m.online) ({ g.peers.forgetMember(room.token, m.deviceId) }) else null,
                            onKick = if (room.owner && room.ownerPrivateKey != null) ({ kickAsk = m }) else null)
                        Expansion(picker == m.deviceId) { ColorPicker(m.color, m.custom) { g.setPersonColor(m.deviceId, it) } }
                    }
                }
                kickAsk?.let { m -> Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    Txt("Biztosan eltávolítod ${m.name}-t a szobából?", Modifier.weight(1f), size = 12f)
                    TextBtn("Mégse", { kickAsk = null }, variant = Variant.Outline, small = true)
                    TextBtn("Eltávolítás", { g.kick(room.token, m.deviceId); kickAsk = null }, variant = Variant.Destructive, small = true) } }
            }
        }
    }
}

@Composable
private fun MemberLine(name: String, avatar: String?, color: String, sub: String?, lastSeen: String?, dot: String, online: Boolean, pickerOpen: Boolean, onPalette: () -> Unit, onForget: (() -> Unit)? = null, onKick: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CapsuleAvatar(name, avatar, parseColor(color), 36.dp)
        Column(Modifier.weight(1f)) {
            Txt(name, size = 14f, maxLines = 1)
            (sub ?: lastSeen)?.let { Txt(it, size = 10f, color = pal.mutedForeground, lineHeight = 14f) }
        }
        if (dot != "self") StatusDot(dot)
        IconBtn("palette", "Jelölőszín", onPalette, size = 32.dp)
        onForget?.let { IconBtn("trash-2", "Törlés a listából", it, size = 32.dp) }
        onKick?.let { IconBtn("x", "Eltávolítás a szobából", it, size = 32.dp) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ColorPicker(value: String, custom: Boolean, onChange: (String?) -> Unit) {
    FlowRow(Modifier.fillMaxWidth().padding(top = 8.dp).glassInset().padding(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (c in PERSON_COLOR_OPTIONS) {
            val active = c.value.equals(value, true)
            Box(Modifier.size(32.dp).then(if (active) Modifier.border(2.dp, pal.ring, CircleShape) else Modifier).padding(if (active) 2.dp else 0.dp).clip(CircleShape).background(parseColor(c.value), CircleShape)
                .border(1.dp, pal.glassEdge, CircleShape).clickable { onChange(c.value) }, contentAlignment = Alignment.Center) { if (active) LIcon("check", size = 16.dp, tint = Color.Black.copy(alpha = .7f)) }
        }
        if (custom) Box(Modifier.height(32.dp).clip(CircleShape).background(pal.tint.copy(alpha = .05f), CircleShape).border(1.dp, pal.tint.copy(alpha = .12f), CircleShape).clickable { onChange(null) }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) { Txt("Alap", size = 12f) }
    }
}

// ───────── Beállítások ─────────
@Composable
private fun SettingsMain(selfColor: String, onTrails: () -> Unit, onPlaces: () -> Unit, onPermissions: () -> Unit, onResetHints: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val profile by g.profile.collectAsState(); val places by g.places.collectAsState()
    val check by g.updateCheck.collectAsState(); val avail by g.availableUpdate.collectAsState(); val updStatus by g.updateStatus.collectAsState(); val updPct by g.updatePercent.collectAsState()
    PanelHeader("Beállítások", compact = true)
    ElasticScroll(Modifier.padding(horizontal = 16.dp), maxHeight = 640.dp) {
        Column(Modifier.padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.fillMaxWidth().glassInset().padding(12.dp)) {
                ProfileForm(profile, "Profil mentése", selfColor, compact = true) { p -> g.saveProfile(p); g.toast("success", "Profil mentve") }
            }
            @Composable fun navButton(label: String, icon: String?, onClick: () -> Unit) = PPButton(onClick, Modifier.fillMaxWidth(), variant = Variant.Outline, small = true) { c ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Row(verticalAlignment = Alignment.CenterVertically) { if (icon != null) { LIcon(icon, size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)) }; BtnText(label, c, true) }
                    LIcon("chevron-right", size = 16.dp, tint = c) } }
            navButton("Útvonalak rajzolása a térképen", null, onTrails)
            navButton("Saját helyek${if (places.isNotEmpty()) " (${places.size})" else ""}", "map-pin", onPlaces)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PPButton(onPermissions, Modifier.weight(1f), variant = Variant.Outline, small = true) { c -> LIcon("shield-check", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Engedélyek", c, true) }
                PPButton(onResetHints, Modifier.weight(1f), variant = Variant.Outline, small = true) { c -> LIcon("circle-help", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Súgó", c, true) }
            }
            Row(Modifier.fillMaxWidth().glassInset().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) {
                    Txt("Frissítés", size = 14f, weight = 600)
                    Txt(when { check == "checking" -> "Keresés…"; check == "latest" -> "A legújabb verzió van telepítve."; check == "error" -> "A frissítések most nem érhetők el."
                        avail != null -> "Új verzió érhető el (${avail!!.version.ifBlank { "új" }})."; else -> "Új verzió keresése a GitHub kiadásai között." }, size = 12f, color = pal.mutedForeground, lineHeight = 16f)
                }
                if (avail != null && check != "checking") PPButton({ g.updateDismissed.value = true; g.startUpdate() }, small = true, enabled = updStatus != "downloading") { BtnText(if (updStatus == "downloading") "Letöltés…${updPct?.let { " $it%" } ?: ""}" else "Letöltés", it, true) }
                else PPButton({ g.checkForUpdate(true) }, variant = Variant.Outline, small = true, enabled = check != "checking") { BtnText("Keresés", it, true) }
            }
            Txt("Private Place · ${g.updater.installedVersionName()}", size = 11f, color = pal.mutedForeground, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun TrailsPanel(onBack: () -> Unit, onClearSelf: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val prefs by g.prefs.collectAsState(); val net by g.peers.state.collectAsState(); val profile by g.profile.collectAsState()
    val people = buildList { if (profile != null) add(SELF to profile!!.name); net.people.values.filter { it.sharing }.forEach { add(it.deviceId to it.name) } }
    fun checked(id: String) = prefs.showTrails || id in prefs.trailIds
    BackHeader("Útvonalak", onBack)
    ElasticScroll(Modifier.padding(horizontal = 16.dp), maxHeight = 520.dp) {
        Column(Modifier.padding(vertical = 16.dp).fillMaxWidth().glassInset().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            CheckRow("Összes személy", prefs.showTrails, { v -> g.updatePrefs { it.copy(showTrails = v, trailIds = if (v) emptyList() else it.trailIds) } }, Modifier.padding(bottom = 8.dp), weight = 600)
            for ((id, nm) in people) {
                Divider(Modifier.padding(top = 0.dp))
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    CheckRow(nm, checked(id), { v -> g.updatePrefs { p -> val ids = if (p.showTrails) people.map { it.first }.filter { it != id } else p.trailIds.filter { it != id } + (if (v) listOf(id) else emptyList())
                        if (p.showTrails) p.copy(showTrails = false, trailIds = if (v) people.map { it.first } else ids) else p.copy(trailIds = if (v) ids + (if (id in ids) emptyList() else listOf(id)) else ids.filter { it != id }) } }, Modifier.weight(1f))
                    IconBtn("trash-2", "$nm útvonalának törlése", { if (id == SELF) onClearSelf() else g.peers.clearTrail(id); g.toast("success", "$nm útvonala törölve") }, size = 32.dp)
                }
            }
        }
    }
}

// ───────── Saját helyek ─────────
private val STEPS = listOf(0.5, 1.0, 2.0, 5.0)
private val REASONS = mapOf("kevés fix" to "Még kevés a mérés, várj néhány másodpercet.", "pontatlan" to "A GPS most túl pontatlan (±15 m fölött), várj egy kicsit.",
    "mozgás" to "Mozgást érzékeltem: állj meg a ponton, és tartsd nyugodtan a telefont.", "nagy eltérés" to "Az eltérés 60 m fölött van. Ellenőrizd a kijelölt pontot.")

@Composable
private fun PlacesPanel(onBack: () -> Unit, onPick: (Pair<String, String?>) -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val places by g.places.collectAsState()
    var open by remember { mutableStateOf<String?>(null) }; var draft by remember { mutableStateOf<String?>(null) }; var confirm by remember { mutableStateOf<String?>(null) }; var step by remember { mutableStateOf(1.0) }
    val tick by produceState(0) { while (true) { kotlinx.coroutines.delay(1500); value += 1 } }
    val place = open?.let { id -> places.firstOrNull { it.id == id } }
    fun patchPlace(f: (Place) -> Place) { val pl = place ?: return; g.savePlaces(places.map { if (it.id == pl.id) f(it) else it }) }
    fun patchSpot(id: String, f: (Spot) -> Spot) = patchPlace { p -> p.copy(spots = p.spots.map { if (it.id == id) f(it) else it }) }
    fun here(): LatLng? = medianPoint(g.engine.recentFixes.map { LatLng(it.lat, it.lng) })
    if (place == null) {
        BackHeader("Saját helyek", onBack)
        ElasticScroll(Modifier.padding(horizontal = 16.dp), maxHeight = 560.dp) {
            Column(Modifier.padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Txt("Add meg, hol vagy valójában egy helyen belül, és az app megtanulja, mennyit téved ott a telefon. Az adatok csak ezen a telefonon maradnak.", size = 12f, color = pal.mutedForeground, lineHeight = 16f)
                for (p in places) Row(Modifier.fillMaxWidth().glassInset().clickable { open = p.id }.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.width(24.dp), contentAlignment = Alignment.Center) { if (p.icon.isNotEmpty()) Txt(p.icon, size = 18f) else LIcon("map-pin", size = 16.dp) }
                    Column(Modifier.weight(1f)) { Txt(p.name, size = 14f, weight = 600, maxLines = 1); Txt("${p.spots.size} pont · ${p.spots.count { it.bias != null }} tanult", size = 12f, color = pal.mutedForeground) }
                    LIcon("chevron-right", size = 16.dp)
                }
                if (draft == null) PPButton({ draft = "" }, Modifier.fillMaxWidth(), variant = Variant.Outline, small = true) { c -> LIcon("plus", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Hely hozzáadása", c, true) }
                else Column(Modifier.fillMaxWidth().glassInset().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PillInput(draft!!, { draft = it }, "Hely neve (bármi lehet)", max = 60)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PPButton({ draft = null }, Modifier.weight(1f), variant = Variant.Outline, small = true) { BtnText("Mégse", it, true) }
                        PPButton({ val p = newPlace(draft ?: ""); g.savePlaces(places + p); draft = null; open = p.id }, Modifier.weight(1f), small = true, enabled = draft!!.isNotBlank()) { BtnText("Hozzáadás", it, true) }
                    }
                }
            }
        }
        return
    }
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 12.dp, end = 48.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        IconBtn("chevron-left", "Vissza a helyekhez", { open = null; confirm = null }, size = 32.dp, iconSize = 20.dp)
        Txt("${place.icon} ${place.name}".trim(), size = 16f, weight = 700, display = true, maxLines = 1)
    }
    ElasticScroll(Modifier.padding(horizontal = 16.dp), maxHeight = 600.dp) {
        Column(Modifier.padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.fillMaxWidth().glassInset().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.width(64.dp)) { PillInput(place.icon, { v -> patchPlace { it.copy(icon = v) } }, "🏠", max = 8) }
                    Box(Modifier.weight(1f)) { PillInput(place.name, { v -> patchPlace { it.copy(name = v) } }, "Név", max = 60) }
                }
                PillInput(place.note, { v -> patchPlace { it.copy(note = v) } }, "Megjegyzés (nem kötelező)", max = 200)
                Txt("A korrekció hatóköre: ${"%.0f".format(place.radius)} m a tanult ponttól", size = 12f, color = pal.mutedForeground)
                PPSlider(place.radius.toFloat(), { v -> patchPlace { it.copy(radius = v.toDouble()) } }, MIN_RADIUS.toFloat()..MAX_RADIUS.toFloat())
            }
            for (s in place.spots) {
                val h = remember(tick) { here() }
                val expected = s.bias?.let { offsetPoint(LatLng(s.lat, s.lng), it.e, it.n) }
                Column(Modifier.fillMaxWidth().glassInset().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.weight(1f)) { PillInput(s.label, { v -> patchSpot(s.id) { it.copy(label = v) } }, "Pont neve (pl. ágy, konyhapult)", max = 60) }
                        IconBtn("trash-2", "Pont törlése", { patchPlace { p -> p.copy(spots = p.spots.filter { it.id != s.id }) } }, size = 36.dp)
                    }
                    Txt(if (s.bias != null && expected != null) "Tanult: a telefon itt ${describeVector(LatLng(s.lat, s.lng), expected)} tér el (${s.samples} mérésből)." else "Még nem tanult. Állj a ponton, és nyomd meg a Tanulást.", size = 12f, color = pal.mutedForeground, lineHeight = 16f)
                    if (h != null) Txt("A telefon most ${describeVector(LatLng(s.lat, s.lng), h)} mutat a kijelölt ponttól.", size = 12f, color = pal.mutedForeground, lineHeight = 16f)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PPButton({ onPick(place.id to s.id) }, Modifier.weight(1f), variant = Variant.Outline, small = true) { c -> LIcon("crosshair", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Kijelölés", c, true) }
                        PPButton({
                            when (val r = learnBias(s, g.engine.recentFixes.toList())) {
                                is LearnResult.Fail -> g.toast("warning", REASONS[r.reason] ?: "Most nem sikerült.")
                                is LearnResult.Ok -> { patchSpot(s.id) { r.spot }; g.toast("success", "Megtanultam ezt a pontot") }
                            } }, Modifier.weight(1f), small = true) { BtnText("Itt állok: tanulás", it, true) }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Txt("Pontosítás", size = 12f, color = pal.mutedForeground); Spacer(Modifier.weight(1f))
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { for (v in STEPS) PPButton({ step = v }, variant = if (v == step) Variant.Default else Variant.Outline, small = true, height = 28.dp) { BtnText("${v.toString().removeSuffix(".0").replace('.', ',')} m", it, true) } }
                    }
                    Column(Modifier.width(160.dp).align(Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        @Composable fun cell(icon: String?, label: String?, f: () -> Unit) = Box(Modifier.weight(1f).height(36.dp), contentAlignment = Alignment.Center) {
                            if (icon != null) PPButton(f, Modifier.fillMaxWidth(), variant = Variant.Outline, small = true, height = 36.dp) { LIcon(icon, size = 16.dp, tint = it) } else if (label != null) Txt(label, size = 10f, color = pal.mutedForeground) }
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { cell(null, null) {}; cell("chevron-up", null) { patchSpot(s.id) { nudgeSpot(it, 0.0, step) } }; cell(null, null) {} }
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { cell("chevron-left", null) { patchSpot(s.id) { nudgeSpot(it, -step, 0.0) } }; cell(null, "É↑") {}; cell("chevron-right", null) { patchSpot(s.id) { nudgeSpot(it, step, 0.0) } } }
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { cell(null, null) {}; cell("chevron-down", null) { patchSpot(s.id) { nudgeSpot(it, 0.0, -step) } }; cell(null, null) {} }
                    }
                    if (s.bias != null) PPButton({ patchSpot(s.id) { it.copy(bias = null, learnedAt = null, samples = 0) } }, Modifier.fillMaxWidth(), variant = Variant.Ghost, small = true) { BtnText("Tanult eltérés törlése", it, true) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PPButton({ onPick(place.id to null) }, Modifier.weight(1f), variant = Variant.Outline, small = true) { c -> LIcon("plus", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Pont a térképen", c, true) }
                PPButton({ val h = here(); if (h == null) g.toast("warning", "Még nincs mérésem. Várj, amíg a GPS fixál.") else patchPlace { p -> p.copy(spots = p.spots + newSpot(h, "Pont ${p.spots.size + 1}")) } }, Modifier.weight(1f), variant = Variant.Outline, small = true) { c ->
                    LIcon("map-pin", size = 16.dp, tint = c); Spacer(Modifier.width(6.dp)); BtnText("Pont itt", c, true) }
            }
            if (confirm == place.id) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PPButton({ confirm = null }, Modifier.weight(1f), variant = Variant.Outline, small = true) { BtnText("Mégse", it, true) }
                PPButton({ g.savePlaces(places.filter { it.id != place.id }); open = null; confirm = null }, Modifier.weight(1f), variant = Variant.Destructive, small = true) { BtnText("Biztosan törlöm", it, true) }
            } else PPButton({ confirm = place.id }, Modifier.fillMaxWidth(), variant = Variant.Ghost, small = true) { c -> LIcon("trash-2", size = 16.dp, tint = pal.destructive); Spacer(Modifier.width(6.dp)); BtnText("Hely törlése", pal.destructive, true) }
        }
    }
}
