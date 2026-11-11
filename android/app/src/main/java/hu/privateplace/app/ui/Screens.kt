package hu.privateplace.app.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import hu.privateplace.app.PrivatePlaceApp
import hu.privateplace.app.data.LocalProfile
import hu.privateplace.app.data.lookupAddress
import hu.privateplace.app.domain.*
import hu.privateplace.app.location.SelfState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import hu.privateplace.app.p2p.RemotePerson
import kotlinx.coroutines.launch

enum class Sheet { ROOMS, SETTINGS }

fun decodeDataUrl(url: String?): Bitmap? = runCatching {
    val b = Base64.decode(url!!.substringAfter("base64,"), Base64.DEFAULT); BitmapFactory.decodeByteArray(b, 0, b.size)
}.getOrNull()

/** Kép → 128×128 középre vágott JPEG data URL (≤ 80 000 jel, ahogy a protokoll megköveteli). */
fun avatarFromUri(ctx: android.content.Context, uri: Uri): String? = runCatching {
    val src = ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it) }
    val side = minOf(src.width, src.height)
    val sq = Bitmap.createBitmap(src, (src.width - side) / 2, (src.height - side) / 2, side, side)
    val out = Bitmap.createScaledBitmap(sq, 128, 128, true)
    val bos = java.io.ByteArrayOutputStream(); out.compress(Bitmap.CompressFormat.JPEG, 82, bos)
    "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
}.getOrNull()?.takeIf { it.length <= 80_000 }

@Composable
fun Avatar(name: String, color: String, avatar: String?, size: Int = 40) {
    val bmp = remember(avatar) { decodeDataUrl(avatar) }
    Box(Modifier.size(size.dp).clip(CircleShape).background(parseColor(color)).border(2.dp, Color.White.copy(alpha = .8f), CircleShape), contentAlignment = Alignment.Center) {
        if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text(name.take(1).uppercase(), color = Color(0xFF0B1425), fontWeight = FontWeight.Bold, fontSize = (size / 2.4).sp)
    }
}

@Composable
fun AppRoot(actions: PermissionActions, invite: Invitation?, onInviteDone: () -> Unit, permTick: Int, onExit: () -> Unit) {
    val g = (LocalContext.current.applicationContext as PrivatePlaceApp).graph
    val profile by g.profile.collectAsState()
    if (profile == null) Onboarding { g.saveProfile(it) } else MapScreen(actions, invite, onInviteDone, permTick, onExit)
}

@Composable
fun Onboarding(onDone: (LocalProfile) -> Unit) {
    var name by remember { mutableStateOf("") }; var avatar by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().background(Navy).systemBarsPadding().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Üdv a Private Place-ben", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text("Nincs fiók, nincs szerver. A neved és a képed csak a szobatársaidhoz jut el.", color = Muted, fontSize = 13.sp)
        Spacer(Modifier.height(18.dp))
        ProfileRow(name, { name = it }, avatar, { avatar = it })
        Spacer(Modifier.height(14.dp))
        Button({ onDone(LocalProfile(name.trim(), avatar)) }, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Tovább") }
    }
}

private fun statusLine(p: RemotePerson, now: Long): String {
    if (!p.online) return "nincs kapcsolat"
    if (!p.sharing) return "nem oszt meg"
    val parts = mutableListOf<String>()
    val sp = p.speed
    parts += if (p.stoppedSince != null) "áll ${((now - p.stoppedSince) / 60000).coerceAtLeast(0)} perce" else if (sp != null && sp >= 0.8) "${(sp * 3.6).toInt()} km/h" else "mozgásban"
    p.battery?.let { parts += "${it.toInt()}%" }
    return parts.joinToString(" · ")
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MapScreen(actions: PermissionActions, invite: Invitation?, onInviteDone: () -> Unit, permTick: Int, onExit: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val scope = rememberCoroutineScope()
    val self by g.engine.state.collectAsState(); val peer by g.peers.state.collectAsState()
    val prefs by g.prefs.collectAsState(); val rooms by g.rooms.collectAsState(); val colors by g.personColors.collectAsState()
    val profile by g.profile.collectAsState()
    var sheet by remember { mutableStateOf<Sheet?>(null) }
    var settingsTab by remember { mutableStateOf(SettingsTab.GENERAL) }
    val avail by g.availableUpdate.collectAsState(); val updDismissed by g.updateDismissed.collectAsState()
    val updStatus by g.updateStatus.collectAsState(); val updPct by g.updatePercent.collectAsState()
    var followId by remember { mutableStateOf<String?>(null) }; var followTick by remember { mutableIntStateOf(0) }
    var selected by remember { mutableStateOf<String?>(null) }
    var address by remember { mutableStateOf<String?>(null) }
    var exitAsk by remember { mutableStateOf(false) }
    var colorFor by remember { mutableStateOf<String?>(null) }
    var closedMsg by remember { mutableStateOf<String?>(null) }
    val now = System.currentTimeMillis()

    LaunchedEffect(permTick) { g.engine.setPermissionGranted(Perms.anyLocation(ctx)); if (!Perms.anyLocation(ctx) && prefs.sharing.not()) { settingsTab = SettingsTab.PERMS; sheet = Sheet.SETTINGS } }
    LaunchedEffect(permTick) { g.checkForUpdate(false) }   // induláskor és előtérbe lépéskor (legfeljebb 10 percenként)
    LaunchedEffect(Unit) { g.closedRooms.collect { (_, why) -> closedMsg = if (why == "kicked") "A gazda eltávolított a szobából." else "A gazda törölte a szobát." } }
    BackHandler { if (sheet != null) sheet = null else exitAsk = true }

    val visiblePeople = peer.people.values.filter { p -> rooms.any { r -> p.deviceId in (peer.roomMembers[r.token] ?: emptyList()) } || p.online }.sortedBy { it.name }
    fun colorOf(id: String, base: String) = colors[id] ?: base
    val selfColor = colors[SELF_COLOR_KEY] ?: SELF_COLOR

    val markers = buildList {
        self.point?.let { add(MapMarker("self", profile?.name ?: "Én", selfColor, it, true)) }
        for (p in visiblePeople) { val pt = p.points.lastOrNull() ?: continue; if (p.sharing) add(MapMarker(p.deviceId, p.name, colorOf(p.deviceId, p.color), LatLng(pt.lat, pt.lng), false, !p.online)) }
    }
    val trails = if (prefs.showTrails) visiblePeople.filter { it.deviceId in prefs.trailIds || prefs.trailIds.isEmpty() }.map { MapTrail(it.deviceId, colorOf(it.deviceId, it.color), it.points) } else emptyList()
    val followPoint = when (followId) { null -> null; "self" -> self.point; else -> peer.people[followId]?.points?.lastOrNull()?.let { LatLng(it.lat, it.lng) } }
    val camBearing = if (prefs.orientation == "heading") self.heading else 0.0

    Box(Modifier.fillMaxSize().background(Navy)) {
        MapLibreView(markers, trails, prefs.mapTheme == "dark", followPoint, followTick, camBearing,
            onTapMarker = { id -> selected = id; address = null }, modifier = Modifier.fillMaxSize())

        Column(Modifier.fillMaxSize().systemBarsPadding().padding(10.dp), verticalArrangement = Arrangement.SpaceBetween) {
            // Fejléc: megosztás kapcsoló + gyors gombok
            Row(Modifier.fillMaxWidth().glass(28).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                val viewers = peer.roomPeers.values.sum()
                FilledIconButton({
                    if (!self.sharing) { if (!Perms.anyLocation(ctx)) { settingsTab = SettingsTab.PERMS; sheet = Sheet.SETTINGS; return@FilledIconButton }; g.engine.setPermissionGranted(true) }
                    g.engine.setSharing(!self.sharing)
                }, colors = IconButtonDefaults.filledIconButtonColors(containerColor = if (self.sharing) Mint else Color(0xFF334155))) {
                    Icon(if (self.sharing) Icons.Default.Pause else Icons.Default.PlayArrow, if (self.sharing) "Megosztás leállítása" else "Megosztás indítása", tint = Color.White)
                }
                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                    Text(if (self.sharing) "Megosztás be" else "Megosztás ki", fontWeight = FontWeight.SemiBold)
                    Text(when { self.error == "denied" -> "Nincs helyengedély"; self.error != null -> "Nem sikerült a helymeghatározás"; self.sharing -> "$viewers kapcsolat"; else -> "Csak te látod a helyzeted" },
                        fontSize = 12.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton({ sheet = Sheet.ROOMS }) { Icon(Icons.Default.Groups, "Szobák") }
                IconButton({ g.updatePrefs { it.copy(orientation = if (it.orientation == "heading") "north" else "heading") } }) { Icon(Icons.Default.Explore, if (prefs.orientation == "heading") "Haladási irány felül" else "Észak felül") }
                IconButton({ g.updatePrefs { it.copy(mapTheme = if (it.mapTheme == "dark") "light" else "dark") } }) { Icon(if (prefs.mapTheme == "dark") Icons.Default.LightMode else Icons.Default.DarkMode, "Térkép témája") }
                IconButton({ sheet = Sheet.SETTINGS }) { Icon(Icons.Default.Settings, "Beállítások") }
            }

            Column(Modifier.animateContentSize(tween(ANIM_MS, easing = AnimEasing)), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.align(Alignment.End), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    SmallFloatingActionButton({ followId = "self"; followTick++ }, containerColor = Color(0xFF16233D)) { Icon(Icons.Default.MyLocation, "Ugrás a saját helyre") }
                }
                // Közlekedési mód: automatikus vagy kézi
                Row(Modifier.glass(20).padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf(null to "Auto", TransportMode.WALK to "Gyalog", TransportMode.BIKE to "Bicikli", TransportMode.CAR to "Autó").forEach { (m, label) ->
                        FilterChip(self.manualTransport == m, { g.engine.setManualTransport(m) }, { Text(label, fontSize = 12.sp) })
                    }
                }
                if (selected != null && selected != "self") {
                    val p = peer.people[selected]
                    if (p != null) Row(Modifier.fillMaxWidth().animateContentSize(tween(ANIM_MS, easing = AnimEasing)).glass(20).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name, fontWeight = FontWeight.SemiBold)
                            Text(address ?: when (prefs.addressConsent) { "yes" -> "Cím keresése…"; else -> "Koppints a címért (OSM-szolgáltatás kapja a koordinátát)" }, fontSize = 12.sp, color = Muted)
                        }
                        TextButton({
                            val pt = p.points.lastOrNull() ?: return@TextButton
                            scope.launch { address = runCatching { lookupAddress(pt.lat, pt.lng).let { a -> listOfNotNull(a.title, a.near).joinToString(" · ") } }.getOrDefault("Nincs találat") }
                            g.updatePrefs { it.copy(addressConsent = "yes") }
                        }) { Text("Cím") }
                        TextButton({ followId = p.deviceId; followTick++ }) { Text("Követ") }
                    }
                }
                // Emberek sávja
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        PersonCapsule(profile?.name ?: "Én", selfColor, profile?.avatar, if (self.sharing) "megosztás be" else "ki", followId == "self",
                            onClick = { followId = "self"; followTick++ }, onLong = { colorFor = SELF_COLOR_KEY })
                    }
                    items(visiblePeople, key = { it.deviceId }) { p ->
                        PersonCapsule(p.name, colorOf(p.deviceId, p.color), peer.avatars[p.deviceId] ?: p.avatar, statusLine(p, now), followId == p.deviceId,
                            onClick = { followId = p.deviceId; selected = p.deviceId; address = null; followTick++ }, onLong = { colorFor = p.deviceId }, faded = !p.online)
                    }
                }
            }
        }
    }

    when (sheet) {
        Sheet.ROOMS -> RoomsSheet(actions, invite = invite, onInviteDone = onInviteDone) { sheet = null }
        Sheet.SETTINGS -> SettingsSheet(settingsTab, permTick, actions) { sheet = null }
        null -> {}
    }
    // Súgóbuborékok: kompakt, egyenként
    if (profile != null && sheet == null && prefs.hint < HINTS.size) Box(Modifier.fillMaxSize()) {
        HintBubble(prefs.hint, { g.updatePrefs { it.copy(hint = prefs.hint + 1) } }, { g.updatePrefs { it.copy(hint = HINTS.size) } })
    }
    // OTA: új frissítés
    val upd = avail
    if (upd != null && !updDismissed && sheet == null) AlertDialog(onDismissRequest = { g.dismissUpdate() }, title = { Text("Új frissítés elérhető") },
        text = { Column(Modifier.animateContentSize(tween(ANIM_MS, easing = AnimEasing))) {
            Text(when (updStatus) { "downloading" -> "Letöltés…${updPct?.let { " $it%" } ?: ""}"
                "permission" -> "Engedélyezd a telepítést a Private Place számára, majd koppints újra a Letöltésre."
                else -> "Verzió: ${upd.version}" }) } },
        confirmButton = { TextButton({ g.startUpdate() }, enabled = updStatus != "downloading") { Text("Letöltés") } },
        dismissButton = { TextButton({ g.dismissUpdate() }, enabled = updStatus != "downloading") { Text("Később") } })
    // Meghívó (link/QR megnyitásakor)
    if (invite != null && sheet != Sheet.ROOMS) AlertDialog(onDismissRequest = onInviteDone, title = { Text("Meghívást kaptál") },
        text = { Text("Csatlakozol a(z) „${invite.name ?: "Szoba"}” szobához?") },
        confirmButton = { TextButton({ g.joinRoom(invite); onInviteDone() }) { Text("Csatlakozás") } },
        dismissButton = { TextButton(onInviteDone) { Text("Elutasítás") } })
    if (exitAsk) AlertDialog(onDismissRequest = { exitAsk = false }, title = { Text("Kilépsz az alkalmazásból?") },
        text = { Text("A helymegosztás leáll.") },
        confirmButton = { TextButton({ g.engine.setSharing(false); onExit() }) { Text("Kilépés") } },
        dismissButton = { TextButton({ exitAsk = false }) { Text("Mégse") } })
    closedMsg?.let { AlertDialog(onDismissRequest = { closedMsg = null }, confirmButton = { TextButton({ closedMsg = null }) { Text("Rendben") } }, text = { Text(it) }) }
    colorFor?.let { id -> AlertDialog(onDismissRequest = { colorFor = null }, confirmButton = { TextButton({ colorFor = null }) { Text("Kész") } },
        title = { Text("Jelölő színe (csak itt látszik)") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PERSON_COLOR_OPTIONS.chunked(4).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { row.forEach { o ->
                    Box(Modifier.size(40.dp).clip(CircleShape).background(parseColor(o.value)).clickable { g.setPersonColor(id, o.value); colorFor = null }) } } }
                TextButton({ g.setPersonColor(id, null); colorFor = null }) { Text("Alapszín") }
            } }) }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PersonCapsule(name: String, color: String, avatar: String?, status: String, active: Boolean, onClick: () -> Unit, onLong: () -> Unit, faded: Boolean = false) {
    Row(Modifier.glass(28).then(if (active) Modifier.border(2.dp, parseColor(color), RoundedCornerShape(28.dp)) else Modifier)
        .combinedClickable(onClick = onClick, onLongClick = onLong).padding(8.dp).widthIn(max = 220.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.then(if (faded) Modifier.background(Color.Transparent) else Modifier)) { Avatar(name, color, avatar, 36) }
        Column(Modifier.padding(start = 8.dp, end = 6.dp)) {
            Text(name, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(status, fontSize = 11.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
