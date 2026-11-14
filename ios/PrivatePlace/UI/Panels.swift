import SwiftUI
import PhotosUI
import AVFoundation
import CoreLocation

/// Kép → 128×128 középre vágott JPEG data URL (≤ 80 000 jel).
func avatarDataURL(from data: Data) -> String? {
    guard let img = UIImage(data: data) else { return nil }
    let side = min(img.size.width, img.size.height); let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
    let out = UIGraphicsImageRenderer(size: CGSize(width: 128, height: 128), format: fmt).image { _ in
        img.draw(in: CGRect(x: -(img.size.width - side) / 2 * 128 / side, y: -(img.size.height - side) / 2 * 128 / side, width: img.size.width * 128 / side, height: img.size.height * 128 / side)) }
    guard let jpg = out.jpegData(compressionQuality: 0.82) else { return nil }
    let s = "data:image/jpeg;base64," + jpg.base64EncodedString()
    return s.count <= 80_000 ? s : nil
}
private func roomHex(_ c: String?) -> Color { Color(hex: SELECTION_COLORS.first { $0.key == c }?.hex ?? SELECTION_COLORS[0].hex) }

// ───────── Profilűrlap ─────────
struct ProfileForm: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var initial: LocalProfile?; var submitLabel: String; var color = SELF_COLOR; var title: String? = nil; var descriptionText: String? = nil; var compact = false
    var onSave: (LocalProfile) -> Void
    @State private var name = "", avatar: String?, item: PhotosPickerItem?
    var form: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                PhotosPicker(selection: $item, matching: .images) {
                    ZStack {
                        Circle().fill(pal.surfaceStrong)
                        if let i = decodeDataURL(avatar) { Image(uiImage: i).resizable().scaledToFill().clipShape(Circle()) } else { LIcon("image-plus", size: 20, tint: pal.mutedForeground) }
                    }.frame(width: 54, height: 54).clipShape(Circle()).overlay(Circle().stroke(Color(hex: color), lineWidth: 3))
                }
                VStack(alignment: .leading, spacing: 4) {
                    PillInput(placeholder: "A neved", text: $name, max: 40)
                    if avatar != nil { Button { avatar = nil } label: { Txt("Kép eltávolítása", size: 12, color: pal.mutedForeground, underline: true).padding(.horizontal, 8) }.buttonStyle(.plain) }
                }
            }
            PPButton(enabled: !name.trimmingCharacters(in: .whitespaces).isEmpty, action: { let c = String(name.trimmingCharacters(in: .whitespaces).prefix(40)); if !c.isEmpty { onSave(LocalProfile(name: c, avatar: avatar)) } }) { BtnText(text: submitLabel, color: $0) }
        }
        .onAppear { name = initial?.name ?? ""; avatar = initial?.avatar }
        .onChange(of: item) { it in Task { if let d = try? await it?.loadTransferable(type: Data.self) { if let s = avatarDataURL(from: d) { avatar = s } else { app.toast("error", "Ezt a képet nem sikerült betölteni.") } } } }
    }
    var body: some View {
        if compact { form } else { VStack(spacing: 0) { PanelHeader(title: title ?? "", description: descriptionText); form.padding(.horizontal, 20).padding(.bottom, 20) } }
    }
}

// ───────── Ablak-kezelő ─────────
struct DialogHost: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var dialog: DialogKind
    @Binding var settingsView: String; @Binding var shareToken: String?; @Binding var pendingJoin: Invitation?; @Binding var exitConfirm: Bool
    var onDialog: (DialogKind?) -> Void; var onPick: ((String, String?)) -> Void; var selfTrackClear: () -> Void

    var body: some View {
        let selfColor = app.personColors[SELF_COLOR_KEY] ?? SELF_COLOR
        GlassDialog(dismissable: dialog != .welcome, onDismiss: { withAnimation(harmonika) { onDialog(nil) }; pendingJoin = nil; app.invite = nil }) {
            Group {
                if exitConfirm && dialog == .welcome {
                    PanelHeader(title: "Kilépsz az alkalmazásból?", description: "A helymegosztás leáll. A térkép használatához meg kell adnod a nevedet.")
                    HStack(spacing: 8) { Spacer(); TextBtn(text: "Mégsem", variant: .outline, fill: false) { exitConfirm = false }; TextBtn(text: "Kilépés", variant: .destructive, icon: "log-out", fill: false) { exit(0) } }.padding(20)
                } else {
                    switch dialog {
                    case .welcome:
                        ProfileForm(initial: nil, submitLabel: "Kezdés", title: "Üdv a Private Place-ben", descriptionText: "Nincs regisztráció és nincs jelszó. A neved és a képed csak ezen a telefonon tárolódik, és csak a szobatársaid látják.") { p in
                            app.saveProfile(p); onDialog(app.permissionsAsked ? (pendingJoin != nil ? .join : nil) : .permissions) }
                    case .permissions:
                        PermissionsPanel(onAskAddressAgain: { app.updatePrefs { $0.addressConsent = "ask" }; onDialog(nil) }, onDone: { app.permissionsAsked = true; app.engine.evaluate(); onDialog(pendingJoin != nil ? .join : nil) })
                    case .join:
                        JoinPanel(initial: pendingJoin, onJoin: { t, n, c, k in app.joinRoom(token: t, name: n, color: c, ownerKey: k); pendingJoin = nil; app.invite = nil; onDialog(nil) }, onReject: { pendingJoin = nil; app.invite = nil; onDialog(nil) })
                    case .share:
                        if let r = app.rooms.first(where: { $0.token == shareToken }) { SharePanel(room: r) { onDialog(.rooms) } }
                    case .rooms:
                        RoomsPanel(onShare: { shareToken = $0; onDialog(.share) }, onNew: { let r = app.createRoom(); shareToken = r.token; onDialog(.share) }, onJoin: { onDialog(.join) })
                    case .settings:
                        switch settingsView {
                        case "places": PlacesPanel(onBack: { settingsView = "main" }, onPick: onPick)
                        case "trails": TrailsPanel(onBack: { settingsView = "main" }, onClearSelf: selfTrackClear)
                        default: SettingsMain(selfColor: selfColor, onTrails: { settingsView = "trails" }, onPlaces: { settingsView = "places" }, onPermissions: { onDialog(.permissions) }, onResetHints: { app.updatePrefs { $0.hint = 0 }; onDialog(nil) })
                        }
                    }
                }
            }.id("\(dialog.rawValue)|\(settingsView)|\(exitConfirm)").transition(.opacity)
        }.animation(harmonika, value: "\(dialog.rawValue)|\(settingsView)|\(exitConfirm)")
    }
}

// ───────── Engedélyek ─────────
private struct PermInfo { var key: String; var label: String; var hint: String; var icon: String }
private let PERMS: [PermInfo] = [
    PermInfo(key: "location", label: "Pontos helyzet", hint: "A saját pozíciód a térképen. A rendszerablakban válaszd a „Pontos” lehetőséget.", icon: "map-pin"),
    PermInfo(key: "always", label: "Helyzet lezárt képernyőnél", hint: "Beállítások → Hely → Mindig.", icon: "lock-keyhole"),
    PermInfo(key: "notifications", label: "Értesítések", hint: "Megosztáskérések és a megosztás állapota.", icon: "bell"),
    PermInfo(key: "camera", label: "Kamera", hint: "A szobák QR-kódjának beolvasásához.", icon: "camera"),
]
private struct PermissionsPanel: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var onAskAddressAgain: () -> Void; var onDone: () -> Void
    @State private var notif = false, requested = Set<String>(), busy = false
    func state(_ k: String) -> String {
        let s = app.engine.authStatus, acc = app.engine.accuracyAuth
        switch k {
        case "location": return (s == .authorizedAlways || s == .authorizedWhenInUse) ? (acc == .fullAccuracy ? "granted" : "limited") : (s == .denied || s == .restricted ? "denied" : "prompt")
        case "always": return s == .authorizedAlways ? "granted" : (requested.contains(k) || s == .denied ? "denied" : "prompt")
        case "notifications": return notif ? "granted" : (requested.contains(k) ? "denied" : "prompt")
        default: return AVCaptureDevice.authorizationStatus(for: .video) == .authorized ? "granted" : (AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined ? "prompt" : "denied")
        }
    }
    func request(_ k: String) {
        requested.insert(k)
        switch k {
        case "location": app.engine.requestWhenInUse()
        case "always": app.engine.requestAlways()
        case "notifications": app.requestNotifications(); DispatchQueue.main.asyncAfter(deadline: .now() + 1) { refresh() }
        default: AVCaptureDevice.requestAccess(for: .video) { _ in }
        }
    }
    func refresh() { UNUserNotificationCenter.current().getNotificationSettings { s in DispatchQueue.main.async { notif = s.authorizationStatus == .authorized } } }
    func ask(_ k: String) { let st = state(k); if st == "denied" || st == "limited" { openSettings() } else { request(k) } }
    func openSettings() { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
    var body: some View {
        let states = Dictionary(uniqueKeysWithValues: PERMS.map { ($0.key, state($0.key)) })
        let allGranted = states.values.allSatisfy { $0 == "granted" }
        VStack(spacing: 0) {
            PanelHeader(title: "Engedélyek", description: "Hogy a Private Place rendesen működjön, ezekhez kér hozzáférést. Semmi nem kerül központi helyre.")
            ElasticScroll(maxHeight: 420) {
                VStack(spacing: 10) {
                    ForEach(PERMS, id: \.key) { info in
                        let st = states[info.key] ?? "prompt"; let granted = st == "granted"
                        HStack(spacing: 12) {
                            LIcon(info.icon, size: 20, tint: granted ? pal.primary : nil).frame(width: 40, height: 40).indicator(granted)
                            VStack(alignment: .leading, spacing: 0) {
                                Txt(info.label, size: 14, weight: 600, lineHeight: 20)
                                Txt(st == "limited" ? "Most csak hozzávetőleges. Koppints a Pontosításra, és kapcsold be a „Pontos hely”-et." : info.hint, size: 12, color: pal.mutedForeground, lineHeight: 16)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            if granted { HStack(spacing: 6) { StatusDot(state: "on"); Txt("Kész", size: 11, color: pal.mutedForeground) } }
                            else { PPButton(variant: st == "denied" ? .outline : .primary, small: true, enabled: !busy, action: { ask(info.key) }) { BtnText(text: st == "limited" ? "Pontosítás" : st == "denied" ? "Beállítás" : "Engedélyezés", color: $0, small: true) }.fixedSize() }
                        }.padding(12).glassInset()
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        CheckRow(label: "Pontos cím lekérése (OpenStreetMap)", checked: app.prefs.addressConsent == "yes") { v in app.updatePrefs { $0.addressConsent = v ? "yes" : "no" } }
                        PPButton(variant: .ghost, small: true, height: 32, action: onAskAddressAgain) { BtnText(text: "Címkérdés újra megjelenítése", color: $0, small: true) }
                    }.padding(12).glassInset()
                }.padding(.horizontal, 20).padding(.bottom, 4)
            }
            HStack(spacing: 8) {
                PPButton(enabled: !busy && !allGranted, action: {
                    busy = true
                    Task { for info in PERMS where state(info.key) == "prompt" { request(info.key); try? await Task.sleep(nanoseconds: 1_200_000_000) }; busy = false }
                }) { c in LIcon("shield-check", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: busy ? "Kérés…" : "Összes engedélyezése", color: c) }
                PPButton(variant: .outline, enabled: !busy, action: onDone) { BtnText(text: allGranted ? "Kész" : "Tovább", color: $0) }
            }.padding(EdgeInsets(top: 16, leading: 20, bottom: 20, trailing: 20))
        }.onAppear { refresh() }
    }
}

// ───────── Csatlakozás ─────────
private struct JoinPanel: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var initial: Invitation?; var onJoin: (String, String?, String?, String?) -> Void; var onReject: () -> Void
    @State private var value = "", scanning = false
    var body: some View {
        let parsed = parseRoomInput(value)
        VStack(spacing: 0) {
            PanelHeader(title: initial != nil ? "Meghívást kaptál" : "Csatlakozás szobához",
                        description: initial != nil ? "Csatlakozol a(z) „\(initial?.name ?? "meghívott")” szobához? Ott kölcsönösen láthatjátok egymást, ha bekapcsoljátok a megosztást." : "Olvasd be a QR-kódot, vagy írd be a kapott kódot, illetve linket.")
            ElasticScroll(maxHeight: 480) {
                VStack(spacing: 12) {
                    if scanning { QrScanner { text in scanning = false; if parseRoomInput(text) != nil { value = text } else { app.toast("error", "Ez a QR-kód nem Private Place meghívó.") } }.transition(.opacity) }
                    PillInput(placeholder: "ABCDE-FGHJK-…", text: $value, max: 400).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    PPButton(variant: .outline, action: {
                        if scanning { withAnimation(harmonika) { scanning = false } }
                        else { AVCaptureDevice.requestAccess(for: .video) { ok in DispatchQueue.main.async { withAnimation(harmonika) { scanning = ok } } } }
                    }) { c in LIcon(scanning ? "scan-line" : "camera", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: scanning ? "Beolvasás leállítása" : "QR-kód beolvasása", color: c) }
                    if let p = parsed, p.ownerKey == nil, !(p.token == initial?.token && initial?.ownerKey != nil) {
                        Txt("Gazdakulcs nélkül a szoba törlése és az eltávolítások nem érkeznek meg hozzád. Olvasd be a QR-kódot, vagy másold be a teljes megosztott kódot.", size: 12, color: pal.mutedForeground, align: .center, lineHeight: 16)
                    }
                    PPButton(enabled: parsed != nil, action: {
                        guard let p = parsed else { app.toast("error", "Ez nem érvényes szobakód vagy link."); return }
                        onJoin(p.token, p.name ?? initial?.name, p.color ?? initial?.color, p.ownerKey ?? (p.token == initial?.token ? initial?.ownerKey : nil))
                    }) { BtnText(text: "Csatlakozás", color: $0) }
                    PPButton(variant: .ghost, action: onReject) { BtnText(text: "Elutasítás", color: $0) }
                }.padding(.horizontal, 20).padding(.bottom, 20)
            }
        }.onAppear { if let i = initial { value = formatRoomToken(i.token) } }
    }
}

// ───────── Megosztás (QR) ─────────
private struct SharePanel: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var room: SavedRoom; var onDone: () -> Void
    var body: some View {
        let code = formatRoomToken(room.token), share = roomShareCode(room.token, room.ownerKey)
        VStack(spacing: 0) {
            BackHeader(title: room.name, onBack: onDone)
            VStack(spacing: 8) {
                RoundedQr(value: roomQrValue(room.token, room.ownerKey), color: roomHex(room.color)).padding(6).background(Color.white, in: RoundedRectangle(cornerRadius: 24)).shadow(color: pal.glow, radius: 18)
                VStack(spacing: 0) { Txt("SZOBAKÓD", size: 9, color: pal.mutedForeground, tracking: 1.8, lineHeight: 12); Txt(code, size: 14, weight: 700, display: true, tracking: 0.7) }.frame(maxWidth: .infinity).padding(.vertical, 6).glassInset()
                HStack(spacing: 8) {
                    PPButton(variant: .outline, small: true, height: 36, action: { UIPasteboard.general.string = share; app.toast("success", "Kód másolva") }) { c in LIcon("copy", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Kód másolása", color: c, small: true) }
                    ShareLink(item: "Szobakód: \(share)", subject: Text("Private Place meghívó")) {
                        HStack(spacing: 6) { LIcon("share-2", size: 16, tint: pal.primaryForeground); BtnText(text: "Küldés", color: pal.primaryForeground, small: true) }.frame(maxWidth: .infinity, minHeight: 36).background(pal.primary, in: Capsule()) }
                }
                Txt("Csak az látja a helyzetedet, akinek ezt elküldöd. Bármikor törölheted a szobát.", size: 10, color: pal.mutedForeground, align: .center, lineHeight: 12.5)
            }.padding(EdgeInsets(top: 8, leading: 16, bottom: 12, trailing: 16))
        }
    }
}

// ───────── Szobák ─────────
private struct Member: Identifiable { var id: String { deviceId }; var deviceId: String, name: String, avatar: String?, color: String, custom: Bool, online: Bool, lastSeen: Int64 }
private func lastSeenText(_ at: Int64, _ now: Int64) -> String {
    let min = Int(max(0, now - at) / 60000); if min < 1 { return "épp most" }; if min < 60 { return "\(min) perce" }
    let h = min / 60; return h < 24 ? "\(h) órája" : "\(h / 24) napja"
}
private struct RoomsPanel: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var onShare: (String) -> Void; var onNew: () -> Void; var onJoin: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            PanelHeader(title: "Szobák", description: "Csak az lát téged, akinek elküldöd a szobád kódját vagy QR-kódját.", compact: true)
            ElasticScroll(maxHeight: 520) {
                VStack(spacing: 10) {
                    if app.rooms.isEmpty { Txt("Még nincs szobád. Hozz létre egyet, és küldd el a QR-kódot annak, akivel kölcsönösen látni szeretnétek egymást.", size: 14, color: pal.mutedForeground).padding(16).frame(maxWidth: .infinity, alignment: .leading).glassInset() }
                    ForEach(app.rooms, id: \.token) { room in
                        let online = app.peers.roomMembers[room.token] ?? []
                        let members: [Member] = (app.peers.roster[room.token] ?? []).map { e in
                            Member(deviceId: e.deviceId, name: app.peers.people[e.deviceId]?.name ?? e.name, avatar: app.peers.avatars[e.deviceId] ?? app.peers.people[e.deviceId]?.avatar,
                                   color: app.personColors[e.deviceId] ?? colorForDevice(e.deviceId), custom: app.personColors[e.deviceId] != nil, online: online.contains(e.deviceId), lastSeen: e.lastSeen) }
                            .sorted { $0.online != $1.online ? $0.online : $0.name.lowercased() < $1.name.lowercased() }
                        RoomRow(room: room, peers: app.peers.roomPeers[room.token] ?? 0, members: members, onShare: { onShare(room.token) })
                    }
                }.padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 8)
            }
            HStack(spacing: 8) {
                PPButton(small: true, action: onNew) { c in LIcon("plus", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Új szoba", color: c, small: true) }
                PPButton(variant: .outline, small: true, action: onJoin) { c in LIcon("door-open", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Csatlakozás", color: c, small: true) }
            }.padding(EdgeInsets(top: 12, leading: 16, bottom: 16, trailing: 16))
        }
    }
}

private struct RoomRow: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var room: SavedRoom; var peers: Int; var members: [Member]; var onShare: () -> Void
    @State private var editing = false, expanded = false, confirm = false
    @State private var name = "", color = ""
    @State private var picker: String?, kickAsk: Member?
    var body: some View {
        let rc = roomHex(room.color)
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button { name = room.name; color = room.color; withAnimation(harmonika) { editing.toggle() } } label: {
                    Txt(room.name, size: 12, align: .center, lines: 4, lineHeight: 14.4).padding(8).frame(width: 84, height: 84).background(rc.opacity(0.16), in: Circle()).overlay(Circle().stroke(rc, lineWidth: 2))
                }.buttonStyle(.plain)
                Button { withAnimation(harmonika) { expanded.toggle() } } label: { LIcon("chevron-down", size: 16).rotationEffect(.degrees(expanded ? 180 : 0)).frame(maxWidth: .infinity).frame(height: 80).contentShape(Rectangle()) }.buttonStyle(.plain)
                Button(action: onShare) { LIcon("qr-code", size: 32).frame(width: 56, height: 56) }.buttonStyle(.plain)
            }
            Expansion(open: editing) {
                VStack(spacing: 12) {
                    DividerLine().padding(.top, 12)
                    PillInput(placeholder: "Szoba neve", text: $name, max: 40)
                    HStack(spacing: 8) { ForEach(SELECTION_COLORS, id: \.key) { c in
                        Button { color = c.key } label: { Circle().fill(Color(hex: c.hex)).frame(width: 28, height: 28).overlay(Circle().stroke(pal.glassEdge, lineWidth: 1)).overlay { if color == c.key { LIcon("check", size: 12, tint: .white) } }.frame(maxWidth: .infinity, minHeight: 36)
                            .overlay(Capsule().stroke(color == c.key ? pal.ring : .clear, lineWidth: 1)) }.buttonStyle(.plain) } }
                    HStack(spacing: 8) { Spacer(); IconBtn(icon: "x", label: "Szerkesztés elvetése") { withAnimation(harmonika) { editing = false } }
                        PPButton(enabled: !name.trimmingCharacters(in: .whitespaces).isEmpty, action: { app.customizeRoom(room.token, name: name, color: color); withAnimation(harmonika) { editing = false } }) { c in LIcon("check", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Mentés", color: c) }.fixedSize() }
                }
            }
            Expansion(open: expanded) {
                VStack(spacing: 4) {
                    DividerLine().padding(.top, 12)
                    HStack { Txt("\(peers) kapcsolódva", size: 12, color: pal.mutedForeground); Spacer(); IconBtn(icon: room.owner ? "trash-2" : "log-out", label: "Törlés", tint: pal.destructive) { withAnimation(harmonika) { confirm = true } } }.padding(.top, 8)
                    if confirm { HStack(spacing: 8) { Txt(room.owner ? "Törlöd a szobát? A kapcsolódó tagok értesülnek." : "Kilépsz a szobából?", size: 12).frame(maxWidth: .infinity, alignment: .leading)
                        TextBtn(text: "Mégse", variant: .outline, small: true, fill: false) { withAnimation(harmonika) { confirm = false } }
                        TextBtn(text: room.owner ? "Törlés" : "Kilépés", variant: .destructive, small: true, fill: false) { app.deleteOrLeave(room.token); confirm = false } } }
                    if let me = app.profile {
                        let selfColor = app.personColors[SELF_COLOR_KEY] ?? SELF_COLOR
                        memberLine(name: me.name, avatar: me.avatar, color: selfColor, sub: "Te", dot: "self", key: SELF_COLOR_KEY)
                        Expansion(open: picker == SELF_COLOR_KEY) { colorPicker(value: selfColor, custom: app.personColors[SELF_COLOR_KEY] != nil) { app.setPersonColor(SELF_COLOR_KEY, $0) } }
                    }
                    ForEach(members) { m in
                        memberLine(name: m.name, avatar: m.avatar, color: m.color, sub: !m.online && m.lastSeen > 0 ? "Utoljára: \(lastSeenText(m.lastSeen, nowMs()))" : nil, dot: m.online ? "on" : "off", key: m.deviceId,
                                   onForget: m.online ? nil : { app.peers.forgetMember(room.token, m.deviceId) }, onKick: (room.owner && room.ownerPrivateKey != nil) ? { withAnimation(harmonika) { kickAsk = m } } : nil)
                        Expansion(open: picker == m.deviceId) { colorPicker(value: m.color, custom: m.custom) { app.setPersonColor(m.deviceId, $0) } }
                    }
                    if let m = kickAsk { HStack(spacing: 8) { Txt("Biztosan eltávolítod \(m.name)-t a szobából?", size: 12).frame(maxWidth: .infinity, alignment: .leading)
                        TextBtn(text: "Mégse", variant: .outline, small: true, fill: false) { kickAsk = nil }
                        TextBtn(text: "Eltávolítás", variant: .destructive, small: true, fill: false) { app.kick(room.token, m.deviceId); kickAsk = nil } }.padding(.top, 6) }
                }
            }
        }.padding(12).glassInset(Radius)
    }
    private func memberLine(name: String, avatar: String?, color: String, sub: String?, dot: String, key: String, onForget: (() -> Void)? = nil, onKick: (() -> Void)? = nil) -> some View {
        HStack(spacing: 8) {
            CapsuleAvatar(name: name, avatar: avatar, color: Color(hex: color), size: 36)
            VStack(alignment: .leading, spacing: 0) { Txt(name, size: 14, lines: 1); if let s = sub { Txt(s, size: 10, color: pal.mutedForeground, lineHeight: 14) } }.frame(maxWidth: .infinity, alignment: .leading)
            if dot != "self" { StatusDot(state: dot) }
            IconBtn(icon: "palette", label: "Jelölőszín", size: 32) { withAnimation(harmonika) { picker = picker == key ? nil : key } }
            if let f = onForget { IconBtn(icon: "trash-2", label: "Törlés a listából", size: 32, action: f) }
            if let k = onKick { IconBtn(icon: "x", label: "Eltávolítás a szobából", size: 32, action: k) }
        }.padding(.vertical, 4)
    }
    private func colorPicker(value: String, custom: Bool, onChange: @escaping (String?) -> Void) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(32), spacing: 8), count: 6), alignment: .leading, spacing: 8) {
            ForEach(PERSON_COLOR_OPTIONS, id: \.value) { c in
                Button { onChange(c.value) } label: { Circle().fill(Color(hex: c.value)).frame(width: 32, height: 32).overlay(Circle().stroke(pal.glassEdge, lineWidth: 1))
                    .overlay { if c.value.caseInsensitiveCompare(value) == .orderedSame { LIcon("check", size: 16, tint: Color.black.opacity(0.7)) } }
                    .overlay(Circle().stroke(c.value.caseInsensitiveCompare(value) == .orderedSame ? pal.ring : .clear, lineWidth: 2).padding(-3)) }.buttonStyle(.plain)
            }
            if custom { Button { onChange(nil) } label: { Txt("Alap", size: 12).padding(.horizontal, 12).frame(height: 32).background(pal.tint.opacity(0.05), in: Capsule()).overlay(Capsule().stroke(pal.tint.opacity(0.12))) }.buttonStyle(.plain) }
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading).glassInset().padding(.top, 8)
    }
}

// ───────── Beállítások ─────────
private struct SettingsMain: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var selfColor: String; var onTrails: () -> Void; var onPlaces: () -> Void; var onPermissions: () -> Void; var onResetHints: () -> Void
    var body: some View {
        let info = Bundle.main.infoDictionary
        VStack(spacing: 0) {
            PanelHeader(title: "Beállítások", compact: true)
            ElasticScroll(maxHeight: 640) {
                VStack(spacing: 10) {
                    ProfileForm(initial: app.profile, submitLabel: "Profil mentése", color: selfColor, compact: true) { p in app.saveProfile(p); app.toast("success", "Profil mentve") }.padding(12).glassInset()
                    nav("Útvonalak rajzolása a térképen", nil, onTrails)
                    nav("Saját helyek\(app.places.isEmpty ? "" : " (\(app.places.count))")", "map-pin", onPlaces)
                    HStack(spacing: 8) {
                        PPButton(variant: .outline, small: true, action: onPermissions) { c in LIcon("shield-check", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Engedélyek", color: c, small: true) }
                        PPButton(variant: .outline, small: true, action: onResetHints) { c in LIcon("circle-help", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Súgó", color: c, small: true) }
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Txt("Verzió", size: 14, weight: 600)
                        Txt("\(info?["CFBundleShortVersionString"] as? String ?? "dev") (#\(info?["CFBundleVersion"] as? String ?? "0")). iPhone-on az app nem frissíti önmagát: az új .ipa-t a GitHub kiadásai között találod; Sideloadly vagy AltStore telepíti a régi fölé.", size: 12, color: pal.mutedForeground, lineHeight: 16)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(12).glassInset()
                }.padding(.horizontal, 16).padding(.vertical, 16)
            }
        }
    }
    private func nav(_ label: String, _ icon: String?, _ action: @escaping () -> Void) -> some View {
        PPButton(variant: .outline, small: true, action: action) { c in
            HStack { if let i = icon { LIcon(i, size: 16, tint: c); Spacer().frame(width: 6) }; BtnText(text: label, color: c, small: true); Spacer(); LIcon("chevron-right", size: 16, tint: c) }
        }
    }
}

private struct TrailsPanel: View {
    @EnvironmentObject var app: AppModel
    var onBack: () -> Void; var onClearSelf: () -> Void
    var body: some View {
        var people: [(String, String)] = []
        if let p = app.profile { people.append((SELF, p.name)) }
        for p in app.peers.people.values where p.sharing { people.append((p.deviceId, p.name)) }
        func checked(_ id: String) -> Bool { app.prefs.showTrails || app.prefs.trailIds.contains(id) }
        return VStack(spacing: 0) {
            BackHeader(title: "Útvonalak", onBack: onBack)
            ElasticScroll(maxHeight: 520) {
                VStack(spacing: 4) {
                    CheckRow(label: "Összes személy", checked: app.prefs.showTrails, weight: 600) { v in app.updatePrefs { $0.showTrails = v; if v { $0.trailIds = [] } } }.padding(.bottom, 8)
                    ForEach(people, id: \.0) { id, nm in
                        DividerLine()
                        HStack {
                            CheckRow(label: nm, checked: checked(id)) { v in app.updatePrefs { p in
                                if p.showTrails { p.showTrails = false; p.trailIds = v ? people.map { $0.0 } : people.map { $0.0 }.filter { $0 != id } }
                                else { p.trailIds = v ? (p.trailIds.contains(id) ? p.trailIds : p.trailIds + [id]) : p.trailIds.filter { $0 != id } } } }
                            IconBtn(icon: "trash-2", label: "\(nm) útvonalának törlése", size: 32) { if id == SELF { onClearSelf() } else { app.peers.clearTrail(id) }; app.toast("success", "\(nm) útvonala törölve") }
                        }.padding(.vertical, 4)
                    }
                }.padding(12).glassInset().padding(.horizontal, 16).padding(.vertical, 16)
            }
        }
    }
}

// ───────── Saját helyek ─────────
private let STEPS: [Double] = [0.5, 1, 2, 5]
private let REASONS = ["kevés fix": "Még kevés a mérés, várj néhány másodpercet.", "pontatlan": "A GPS most túl pontatlan (±15 m fölött), várj egy kicsit.",
                       "mozgás": "Mozgást érzékeltem: állj meg a ponton, és tartsd nyugodtan a telefont.", "nagy eltérés": "Az eltérés 60 m fölött van. Ellenőrizd a kijelölt pontot."]
private struct PlacesPanel: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var onBack: () -> Void; var onPick: ((String, String?)) -> Void
    @State private var open: String?, draft: String?, confirm: String?, step = 1.0, tick = 0
    private let timer = Timer.publish(every: 1.5, on: .main, in: .common).autoconnect()
    private func patchPlace(_ f: (inout Place) -> Void) { var ps = app.places; if let id = open, let i = ps.firstIndex(where: { $0.id == id }) { f(&ps[i]); app.savePlaces(ps) } }
    private func patchSpot(_ id: String, _ f: (Spot) -> Spot) { patchPlace { p in p.spots = p.spots.map { $0.id == id ? f($0) : $0 } } }
    private func here() -> LatLng? { medianPoint(app.engine.recentFixes.map { LatLng(lat: $0.lat, lng: $0.lng) }) }
    var body: some View {
        if let pid = open, let place = app.places.first(where: { $0.id == pid }) { detail(place) } else { list }
    }
    private var list: some View {
        VStack(spacing: 0) {
            BackHeader(title: "Saját helyek", onBack: onBack)
            ElasticScroll(maxHeight: 560) {
                VStack(spacing: 10) {
                    Txt("Add meg, hol vagy valójában egy helyen belül, és az app megtanulja, mennyit téved ott a telefon. Az adatok csak ezen a telefonon maradnak.", size: 12, color: pal.mutedForeground, lineHeight: 16).frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(app.places) { p in
                        Button { withAnimation(harmonika) { open = p.id } } label: {
                            HStack(spacing: 12) {
                                Group { if p.icon.isEmpty { LIcon("map-pin", size: 16) } else { Txt(p.icon, size: 18) } }.frame(width: 24)
                                VStack(alignment: .leading, spacing: 0) { Txt(p.name, size: 14, weight: 600, lines: 1); Txt("\(p.spots.count) pont · \(p.spots.filter { $0.bias != nil }.count) tanult", size: 12, color: pal.mutedForeground) }.frame(maxWidth: .infinity, alignment: .leading)
                                LIcon("chevron-right", size: 16)
                            }.padding(12).glassInset()
                        }.buttonStyle(.plain)
                    }
                    if draft == nil { PPButton(variant: .outline, small: true, action: { withAnimation(harmonika) { draft = "" } }) { c in LIcon("plus", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Hely hozzáadása", color: c, small: true) } }
                    else { VStack(spacing: 8) {
                        PillInput(placeholder: "Hely neve (bármi lehet)", text: Binding(get: { draft ?? "" }, set: { draft = $0 }), max: 60)
                        HStack(spacing: 8) {
                            PPButton(variant: .outline, small: true, action: { withAnimation(harmonika) { draft = nil } }) { BtnText(text: "Mégse", color: $0, small: true) }
                            PPButton(small: true, enabled: !(draft ?? "").trimmingCharacters(in: .whitespaces).isEmpty, action: { let p = newPlace(draft ?? ""); app.savePlaces(app.places + [p]); draft = nil; withAnimation(harmonika) { open = p.id } }) { BtnText(text: "Hozzáadás", color: $0, small: true) }
                        }
                    }.padding(12).glassInset() }
                }.padding(.horizontal, 16).padding(.vertical, 16)
            }
        }
    }
    private func detail(_ place: Place) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) { IconBtn(icon: "chevron-left", label: "Vissza a helyekhez", size: 32, iconSize: 20) { withAnimation(harmonika) { open = nil; confirm = nil } }; Txt("\(place.icon) \(place.name)".trimmingCharacters(in: .whitespaces), size: 16, weight: 700, display: true, lines: 1); Spacer() }.padding(EdgeInsets(top: 12, leading: 12, bottom: 8, trailing: 48))
            ElasticScroll(maxHeight: 600) {
                VStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) { PillInput(placeholder: "🏠", text: Binding(get: { place.icon }, set: { v in patchPlace { $0.icon = v } }), max: 8).frame(width: 64)
                            PillInput(placeholder: "Név", text: Binding(get: { place.name }, set: { v in patchPlace { $0.name = v } }), max: 60) }
                        PillInput(placeholder: "Megjegyzés (nem kötelező)", text: Binding(get: { place.note }, set: { v in patchPlace { $0.note = v } }), max: 200)
                        Txt("A korrekció hatóköre: \(Int(place.radius)) m a tanult ponttól", size: 12, color: pal.mutedForeground)
                        Slider(value: Binding(get: { place.radius }, set: { v in patchPlace { $0.radius = v } }), in: MIN_RADIUS...MAX_RADIUS).tint(pal.primary)
                    }.padding(12).glassInset()
                    ForEach(place.spots) { s in spotCard(s, place) }
                    HStack(spacing: 8) {
                        PPButton(variant: .outline, small: true, action: { onPick((place.id, nil)) }) { c in LIcon("plus", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Pont a térképen", color: c, small: true) }
                        PPButton(variant: .outline, small: true, action: { if let h = here() { patchPlace { $0.spots.append(newSpot(h, label: "Pont \($0.spots.count + 1)")) } } else { app.toast("warning", "Még nincs mérésem. Várj, amíg a GPS fixál.") } }) { c in LIcon("map-pin", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Pont itt", color: c, small: true) }
                    }
                    if confirm == place.id { HStack(spacing: 8) {
                        PPButton(variant: .outline, small: true, action: { withAnimation(harmonika) { confirm = nil } }) { BtnText(text: "Mégse", color: $0, small: true) }
                        PPButton(variant: .destructive, small: true, action: { app.savePlaces(app.places.filter { $0.id != place.id }); open = nil; confirm = nil }) { BtnText(text: "Biztosan törlöm", color: $0, small: true) } } }
                    else { PPButton(variant: .ghost, small: true, action: { withAnimation(harmonika) { confirm = place.id } }) { c in LIcon("trash-2", size: 16, tint: pal.destructive); Spacer().frame(width: 6); BtnText(text: "Hely törlése", color: pal.destructive, small: true) } }
                }.padding(.horizontal, 16).padding(.vertical, 16)
            }
        }.onReceive(timer) { _ in tick += 1 }
    }
    private func spotCard(_ s: Spot, _ place: Place) -> some View {
        let h = here(); let expected = s.bias.map { offsetPoint(LatLng(lat: s.lat, lng: s.lng), e: $0.e, n: $0.n) }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) { PillInput(placeholder: "Pont neve (pl. ágy, konyhapult)", text: Binding(get: { s.label }, set: { v in patchSpot(s.id) { var x = $0; x.label = v; return x } }), max: 60)
                IconBtn(icon: "trash-2", label: "Pont törlése") { patchPlace { p in p.spots = p.spots.filter { $0.id != s.id } } } }
            Txt(s.bias != nil && expected != nil ? "Tanult: a telefon itt \(describeVector(LatLng(lat: s.lat, lng: s.lng), expected!)) tér el (\(s.samples) mérésből)." : "Még nem tanult. Állj a ponton, és nyomd meg a Tanulást.", size: 12, color: pal.mutedForeground, lineHeight: 16)
            if let h = h { Txt("A telefon most \(describeVector(LatLng(lat: s.lat, lng: s.lng), h)) mutat a kijelölt ponttól.", size: 12, color: pal.mutedForeground, lineHeight: 16).id(tick) }
            HStack(spacing: 8) {
                PPButton(variant: .outline, small: true, action: { onPick((place.id, s.id)) }) { c in LIcon("crosshair", size: 16, tint: c); Spacer().frame(width: 6); BtnText(text: "Kijelölés", color: c, small: true) }
                PPButton(small: true, action: {
                    switch learnBias(s, recent: app.engine.recentFixes) {
                    case .fail(let r): app.toast("warning", REASONS[r] ?? "Most nem sikerült.")
                    case .ok(let ns): patchSpot(s.id) { _ in ns }; app.toast("success", "Megtanultam ezt a pontot") } }) { BtnText(text: "Itt állok: tanulás", color: $0, small: true) }
            }
            HStack { Txt("Pontosítás", size: 12, color: pal.mutedForeground); Spacer()
                HStack(spacing: 4) { ForEach(STEPS, id: \.self) { v in PPButton(variant: v == step ? .primary : .outline, small: true, height: 28, action: { step = v }) { BtnText(text: "\(String(v).replacingOccurrences(of: ".0", with: "").replacingOccurrences(of: ".", with: ",")) m", color: $0, small: true) }.fixedSize() } } }
            VStack(spacing: 4) {
                HStack(spacing: 4) { Color.clear.frame(height: 36); arrow("chevron-up") { patchSpot(s.id) { nudgeSpot($0, de: 0, dn: step) } }; Color.clear.frame(height: 36) }
                HStack(spacing: 4) { arrow("chevron-left") { patchSpot(s.id) { nudgeSpot($0, de: -step, dn: 0) } }; Txt("É↑", size: 10, color: pal.mutedForeground, align: .center).frame(maxWidth: .infinity, minHeight: 36); arrow("chevron-right") { patchSpot(s.id) { nudgeSpot($0, de: step, dn: 0) } } }
                HStack(spacing: 4) { Color.clear.frame(height: 36); arrow("chevron-down") { patchSpot(s.id) { nudgeSpot($0, de: 0, dn: -step) } }; Color.clear.frame(height: 36) }
            }.frame(width: 160).frame(maxWidth: .infinity)
            if s.bias != nil { PPButton(variant: .ghost, small: true, action: { patchSpot(s.id) { var x = $0; x.bias = nil; x.learnedAt = nil; x.samples = 0; return x } }) { BtnText(text: "Tanult eltérés törlése", color: $0, small: true) } }
        }.padding(12).glassInset()
    }
    private func arrow(_ icon: String, _ f: @escaping () -> Void) -> some View { PPButton(variant: .outline, small: true, height: 36, action: f) { LIcon(icon, size: 16, tint: $0) } }
}
