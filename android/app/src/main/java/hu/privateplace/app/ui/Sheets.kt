package hu.privateplace.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import hu.privateplace.app.BuildConfig
import hu.privateplace.app.PrivatePlaceApp
import hu.privateplace.app.data.LocalProfile
import hu.privateplace.app.domain.*

private const val LINK_BASE = "privateplace://join"   // a megosztott link az alkalmazást nyitja (https-hez saját domain + App Link kell)

/** Kompakt profilsor: kis kerek kép (kamera-jelvénnyel) + egysoros név. A mentés ikon csak módosításkor jelenik meg. */
@Composable
fun ProfileRow(name: String, onName: (String) -> Unit, avatar: String?, onAvatar: (String) -> Unit, color: String = SELF_COLOR, trailing: (@Composable () -> Unit)? = null) {
    val ctx = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { u -> if (u != null) avatarFromUri(ctx, u)?.let(onAvatar) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(44.dp).clickable { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
            Avatar(name.ifBlank { "?" }, color, avatar, 40)
            Box(Modifier.align(Alignment.BottomEnd).size(16.dp).clip(CircleShape).background(Mint), contentAlignment = Alignment.Center) { Icon(Icons.Default.PhotoCamera, "Profilkép", Modifier.size(10.dp), tint = Color.White) }
        }
        BasicTextField(name, { onName(it.take(40)) }, singleLine = true, textStyle = TextStyle(color = Color.White, fontSize = 15.sp), cursorBrush = SolidColor(Mint),
            modifier = Modifier.weight(1f).clip(RoundedCornerShape(22.dp)).background(Color(0x14FFFFFF)).padding(horizontal = 14.dp, vertical = 11.dp),
            decorationBox = { inner -> if (name.isEmpty()) Text("A neved", color = Muted, fontSize = 15.sp); inner() })
        trailing?.invoke()
    }
}

@Composable
fun RoomsSheet(actions: PermissionActions, invite: Invitation?, onInviteDone: () -> Unit, onClose: () -> Unit) {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val rooms by g.rooms.collectAsState(); val peer by g.peers.state.collectAsState()
    var newName by remember { mutableStateOf("") }; var newColor by remember { mutableStateOf(DEFAULT_ROOM_COLOR) }
    var code by remember { mutableStateOf(invite?.let { roomShareCode(it.token, it.ownerKey) } ?: "") }
    var scanning by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }
    val open = rememberOpenSection(if (invite != null) "join" else null)
    var confirm by remember { mutableStateOf<String?>(null) }; var asked by remember { mutableStateOf(setOf<String>()) }
    fun toggle(id: String) { open.value = if (open.value == id) null else id; confirm = null }
    fun join(text: String) { val inv = parseRoomInput(text); if (inv == null) error = "Érvénytelen kód" else { g.joinRoom(inv); code = ""; error = null; scanning = false; open.value = inv.token; onInviteDone() } }

    SheetFrame("Szobák", onClose) {
        Accordion("Új szoba", open.value == "new", { toggle("new") }) {
            ProfileRowLikeField(newName, { newName = it }, "Szoba neve")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                ROOM_COLORS.forEach { c -> Box(Modifier.size(if (c == newColor) 32.dp else 26.dp).clip(CircleShape).background(parseColor(SELECTION_COLORS.getValue(c))).clickable { newColor = c }) }
                Spacer(Modifier.weight(1f))
                Button({ val r = g.createRoom(newName, newColor); newName = ""; open.value = r.token }, enabled = newName.isNotBlank()) { Text("Létrehozás") }
            }
        }
        Accordion("Csatlakozás", open.value == "join", { toggle("join") }, subtitle = "Kód, link vagy QR") {
            ProfileRowLikeField(code, { code = it; error = null }, "ABCDE-FGHJK-…")
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            if (scanning) Box(Modifier.fillMaxWidth().height(240.dp).clip(RoundedCornerShape(16.dp))) { QrScanner({ join(it) }, Modifier.fillMaxSize()) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button({ join(code) }, enabled = code.isNotBlank()) { Text("Csatlakozás") }
                OutlinedButton({ if (scanning) scanning = false else actions.requestCamera { scanning = true } }) { Text(if (scanning) "Bezár" else "QR beolvasása") }
            }
        }
        rooms.forEach { r ->
            val members = peer.roster[r.token] ?: emptyList(); val online = peer.roomMembers[r.token] ?: emptyList()
            Accordion(r.name, open.value == r.token, { toggle(r.token) }, subtitle = "${online.size} online · ${members.size} tag${if (r.owner) " · gazda" else ""}",
                leading = { Box(Modifier.size(14.dp).clip(CircleShape).background(parseColor(SELECTION_COLORS[r.color] ?: SELF_COLOR))) }) {
                QrImage(roomQrValue(r.token, r.ownerKey), Modifier.size(200.dp).align(Alignment.CenterHorizontally))
                Text(roomShareCode(r.token, r.ownerKey), fontSize = 11.sp, color = Muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton({ (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("kód", roomShareCode(r.token, r.ownerKey))) }) { Text("Másolás") }
                    OutlinedButton({ ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, buildRoomLink(LINK_BASE, r.token, r.name, r.color, r.ownerKey)), "Meghívó küldése")) }) { Text("Küldés") }
                }
                members.forEach { m ->
                    val isOn = m.deviceId in online
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(if (isOn) Mint else Muted))
                        Text(m.name, Modifier.weight(1f).padding(start = 8.dp), fontSize = 14.sp)
                        if (isOn) TextButton({ if (g.peers.requestShare(m.deviceId)) asked = asked + m.deviceId }) { Text(if (m.deviceId in asked) "Elküldve" else "Kérés") }
                        else TextButton({ g.peers.forgetMember(r.token, m.deviceId) }) { Text("Töröl") }
                        if (r.owner) TextButton({ g.kick(r.token, m.deviceId) }) { Text("Eltávolít", color = MaterialTheme.colorScheme.error) }
                    }
                }
                if (confirm == r.token) {
                    Text(if (r.owner) "Törlöd a szobát? A kapcsolódó tagok értesülnek." else "Kilépsz a szobából?", fontSize = 13.sp)
                    Row { TextButton({ g.deleteOrLeave(r.token); confirm = null }) { Text(if (r.owner) "Törlés" else "Kilépés") }; TextButton({ confirm = null }) { Text("Mégse") } }
                } else TextButton({ confirm = r.token }) { Text(if (r.owner) "Szoba törlése" else "Kilépés a szobából", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

@Composable
private fun ProfileRowLikeField(v: String, onChange: (String) -> Unit, hint: String) =
    BasicTextField(v, onChange, singleLine = true, textStyle = TextStyle(color = Color.White, fontSize = 15.sp), cursorBrush = SolidColor(Mint),
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Color(0x14FFFFFF)).padding(horizontal = 14.dp, vertical = 11.dp),
        decorationBox = { inner -> if (v.isEmpty()) Text(hint, color = Muted, fontSize = 15.sp); inner() })

enum class SettingsTab(val label: String) { GENERAL("Általános"), PLACES("Helyek"), PERMS("Engedélyek") }

@Composable
fun SettingsSheet(initial: SettingsTab, permTick: Int, actions: PermissionActions, onClose: () -> Unit) {
    var tab by remember { mutableStateOf(initial) }
    SheetFrame(null, onClose) {
        Row(Modifier.fillMaxWidth().glass(22).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            SettingsTab.values().forEach { t ->
                Box(Modifier.weight(1f).clip(RoundedCornerShape(18.dp)).background(if (t == tab) Mint.copy(alpha = .3f) else Color.Transparent).clickable { tab = t }.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                    Text(t.label, fontSize = 13.sp, fontWeight = if (t == tab) FontWeight.SemiBold else FontWeight.Normal)
                }
            }
        }
        TabContent(tab) { t -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { when (t) {
            SettingsTab.GENERAL -> GeneralTab()
            SettingsTab.PLACES -> PlacesTab()
            SettingsTab.PERMS -> PermsTab(permTick, actions)
        } } }
    }
}

@Composable
private fun GeneralTab() {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val profile by g.profile.collectAsState(); val prefs by g.prefs.collectAsState()
    val people by g.peers.state.collectAsState(); val check by g.updateCheck.collectAsState(); val avail by g.availableUpdate.collectAsState()
    var name by remember { mutableStateOf(profile?.name ?: "") }
    val open = rememberOpenSection("profile")
    fun toggle(id: String) { open.value = if (open.value == id) null else id }
    val changed = name.isNotBlank() && name.trim() != profile?.name
    Accordion("Profil", open.value == "profile", { toggle("profile") }, subtitle = profile?.name) {
        ProfileRow(name, { name = it }, profile?.avatar, { a -> g.saveProfile(LocalProfile(profile?.name ?: name, a)) }, trailing = {
            if (changed) IconButton({ g.saveProfile(LocalProfile(name.trim(), profile?.avatar)) }) { Icon(Icons.Default.Check, "Név mentése", tint = Mint) }
        })
    }
    Accordion("Térkép", open.value == "map", { toggle("map") }) {
        SwitchRow("Útvonalak mutatása", prefs.showTrails) { v -> g.updatePrefs { it.copy(showTrails = v) } }
        SwitchRow("Cím lekérése OSM-ből (koordináta kimegy)", prefs.addressConsent == "yes") { v -> g.updatePrefs { it.copy(addressConsent = if (v) "yes" else "no") } }
        if (prefs.showTrails) people.people.values.forEach { p -> TextButton({ g.peers.clearTrail(p.deviceId) }) { Text("${p.name} útvonalának törlése", fontSize = 13.sp) } }
    }
    Accordion("Frissítés", open.value == "update", { toggle("update") }, subtitle = "Verzió ${g.updater.installedVersionName()} (#${g.updater.installedVersionCode()})") {
        Text(when { avail != null -> "Új verzió érhető el: ${avail!!.version}"; check == "checking" -> "Keresés…"; check == "latest" -> "A legújabb verziót használod."
            check == "error" -> if (BuildConfig.RELEASE_REPOSITORY.isBlank()) "Ebben a buildben nincs kiadási forrás beállítva." else "Nem sikerült ellenőrizni."; else -> "Itt kézzel is rákereshetsz." }, fontSize = 13.sp, color = Muted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton({ g.checkForUpdate(true) }, enabled = check != "checking") { Text("Frissítés keresése") }
            if (avail != null) Button({ g.updateDismissed.value = false; g.startUpdate() }) { Text("Letöltés") }
        }
    }
    Accordion("Súgó", open.value == "help", { toggle("help") }) {
        Text("A rövid súgóbuborékok újra végigvezetnek a főbb gombokon.", fontSize = 13.sp, color = Muted)
        OutlinedButton({ g.updatePrefs { it.copy(hint = 0) } }) { Text("Súgó újra") }
    }
}

@Composable
private fun SwitchRow(label: String, v: Boolean, onChange: (Boolean) -> Unit) =
    Row(verticalAlignment = Alignment.CenterVertically) { Text(label, Modifier.weight(1f), fontSize = 14.sp); Switch(v, onChange) }

@Composable
private fun PermsTab(tick: Int, actions: PermissionActions) {
    val ctx = LocalContext.current
    val open = rememberOpenSection()
    @Composable fun item(id: String, title: String, ok: Boolean, hint: String, label: String, act: () -> Unit) =
        Accordion(title, open.value == id, { open.value = if (open.value == id) null else id }, subtitle = if (ok) "Engedélyezve" else "Nincs engedélyezve",
            leading = { Box(Modifier.size(10.dp).clip(CircleShape).background(if (ok) Mint else Color(0xFFFB7185))) }) {
            Text(hint, fontSize = 13.sp, color = Muted)
            if (!ok) Button(act) { Text(label) }
        }
    key(tick) {
        item("loc", "Pontos helyzet", Perms.fine(ctx), "A saját pozíciód a térképen. A rendszerablakban a „Pontos” lehetőséget válaszd.", "Engedélyezés", actions.requestLocation)
        item("bg", "Helyzet lezárt képernyőnél", Perms.background(ctx), "Beállítások → Engedélyek → Hely → Mindig engedélyezés.", "Beállítás", actions.requestBackground)
        item("notif", "Értesítések", Perms.notifications(ctx), "A megosztás értesítéséhez és a megosztáskérésekhez.", "Engedélyezés", actions.requestNotifications)
        item("batt", "Akkumulátor-optimalizálás", false, "Kapcsold ki az appra, hogy a rendszer ne állítsa le a megosztást.", "Megnyitás") { Perms.openBatterySettings(ctx) }
        OutlinedButton({ Perms.openSettings(ctx) }) { Text("Rendszerbeállítások megnyitása") }
    }
}

@Composable
private fun PlacesTab() {
    val ctx = LocalContext.current; val g = (ctx.applicationContext as PrivatePlaceApp).graph
    val places by g.places.collectAsState(); val self by g.engine.state.collectAsState()
    var name by remember { mutableStateOf("") }; var msg by remember { mutableStateOf<String?>(null) }
    val open = rememberOpenSection()
    fun update(id: String, f: (Place) -> Place) = g.savePlaces(places.map { if (it.id == id) f(it) else it })
    Text("Jelöld ki, hol állsz valójában: az app megtanulja, mennyit téved ott a GPS.", fontSize = 12.sp, color = Muted)
    BasicTextField(name, { name = it.take(60) }, singleLine = true, textStyle = TextStyle(color = Color.White, fontSize = 15.sp), cursorBrush = SolidColor(Mint),
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Color(0x14FFFFFF)).padding(horizontal = 14.dp, vertical = 11.dp),
        decorationBox = { inner -> if (name.isEmpty()) Text("Új hely neve", color = Muted, fontSize = 15.sp); inner() })
    Button({ val raw = self.rawPoint; if (raw == null) msg = "Még nincs pozíció" else { val p = newPlace(name); g.savePlaces(places + p.copy(spots = listOf(newSpot(raw, "Pont 1")))); name = ""; open.value = p.id } }, enabled = name.isNotBlank()) { Text("Hozzáadás a jelenlegi pozícióval") }
    msg?.let { Text(it, color = Muted, fontSize = 12.sp) }
    places.forEach { p ->
        Accordion(p.name, open.value == p.id, { open.value = if (open.value == p.id) null else p.id }, subtitle = "sugár ${p.radius.toInt()} m · ${p.spots.count { it.bias != null }}/${p.spots.size} pont tanult") {
            Slider(p.radius.toFloat(), { v -> update(p.id) { it.copy(radius = v.toDouble().coerceIn(MIN_RADIUS, MAX_RADIUS)) } }, valueRange = MIN_RADIUS.toFloat()..MAX_RADIUS.toFloat())
            p.spots.forEach { s ->
                Text((s.label.ifBlank { "Pont" }) + " · " + (s.bias?.let { b -> "eltérés: " + describeVector(LatLng(s.lat, s.lng), offsetPoint(LatLng(s.lat, s.lng), b.e, b.n)) + " (${s.samples} fix)" } ?: "még nem tanult"), fontSize = 13.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    OutlinedButton({
                        when (val r = learnBias(s, g.engine.recentFixes.toList())) {
                            is LearnResult.Ok -> { update(p.id) { pl -> pl.copy(spots = pl.spots.map { if (it.id == s.id) r.spot else it }) }; msg = "Megtanulva" }
                            is LearnResult.Fail -> msg = "Nem tanulható: ${r.reason}"
                        }
                    }, contentPadding = PaddingValues(horizontal = 12.dp)) { Text("Tanulás", fontSize = 12.sp) }
                    listOf("É" to (0.0 to 1.0), "K" to (1.0 to 0.0), "D" to (0.0 to -1.0), "Ny" to (-1.0 to 0.0)).forEach { (l, d) ->
                        OutlinedButton({ update(p.id) { pl -> pl.copy(spots = pl.spots.map { if (it.id == s.id) nudgeSpot(it, d.first, d.second) else it }) } }, contentPadding = PaddingValues(horizontal = 8.dp)) { Text("1 m $l", fontSize = 11.sp) }
                    }
                }
            }
            TextButton({ g.savePlaces(places.filter { it.id != p.id }) }) { Text("Hely törlése", color = MaterialTheme.colorScheme.error) }
        }
    }
}
