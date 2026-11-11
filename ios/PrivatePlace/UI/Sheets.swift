import SwiftUI
import AVFoundation
import CoreLocation

private let LINK_BASE = "privateplace://join"   // a megosztott link az alkalmazást nyitja (https-hez saját domain + Universal Link kell)

/// Egyszerre egy szakasz nyitott; a többi automatikusan összecsukódik.
private struct OpenState { var id: String?; mutating func toggle(_ x: String) { id = id == x ? nil : x } }

struct RoomsSheet: View {
    @EnvironmentObject var app: AppModel
    @State private var newName = "", newColor = DEFAULT_ROOM_COLOR, code = "", error: String?
    @State private var scanning = false, confirm: String?, asked = Set<String>()
    @State private var open = OpenState()

    private func join(_ t: String) {
        if let inv = parseRoomInput(t) { app.joinRoom(inv); code = ""; error = nil; scanning = false; app.invite = nil; open.id = inv.token } else { error = "Érvénytelen kód" }
    }
    var body: some View {
        SheetScaffold(title: "Szobák") {
            Accordion(title: "Új szoba", open: open.id == "new", onToggle: { open.toggle("new"); confirm = nil }) {
                PillField(hint: "Szoba neve", text: $newName)
                HStack(spacing: 8) {
                    ForEach(SELECTION_COLORS, id: \.key) { c in
                        Circle().fill(Color(hex: c.hex)).frame(width: c.key == newColor ? 32 : 26, height: c.key == newColor ? 32 : 26).onTapGesture { withAnimation(harmonika) { newColor = c.key } }
                    }
                    Spacer()
                    Button("Létrehozás") { let r = app.createRoom(name: newName, color: newColor); newName = ""; withAnimation(harmonika) { open.id = r.token } }
                        .buttonStyle(.borderedProminent).disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            Accordion(title: "Csatlakozás", subtitle: "Kód, link vagy QR", open: open.id == "join", onToggle: { open.toggle("join"); confirm = nil }) {
                PillField(hint: "ABCDE-FGHJK-…", text: $code).textInputAutocapitalization(.characters).autocorrectionDisabled()
                if let e = error { Text(e).font(.caption).foregroundColor(.red) }
                if scanning { QrScanner { join($0) }.frame(height: 240).clipShape(RoundedRectangle(cornerRadius: 16)).transition(.opacity) }
                HStack {
                    Button("Csatlakozás") { join(code) }.buttonStyle(.borderedProminent).disabled(code.isEmpty)
                    Button(scanning ? "Bezár" : "QR beolvasása") {
                        if scanning { withAnimation(harmonika) { scanning = false } }
                        else { AVCaptureDevice.requestAccess(for: .video) { ok in DispatchQueue.main.async { withAnimation(harmonika) { scanning = ok } } } }
                    }.buttonStyle(.bordered)
                }
            }
            ForEach(app.rooms, id: \.token) { r in roomView(r) }
        }
        .onAppear { if let inv = app.invite { code = roomShareCode(inv.token, inv.ownerKey); open.id = "join" } }
    }

    @ViewBuilder private func roomView(_ r: SavedRoom) -> some View {
        let members = app.peers.roster[r.token] ?? [], online = app.peers.roomMembers[r.token] ?? []
        Accordion(title: r.name, subtitle: "\(online.count) online · \(members.count) tag\(r.owner ? " · gazda" : "")", open: open.id == r.token,
                  onToggle: { open.toggle(r.token); confirm = nil },
                  leading: { Circle().fill(Color(hex: SELECTION_COLORS.first { $0.key == r.color }?.hex ?? SELF_COLOR)).frame(width: 14, height: 14) }) {
            QrImage(text: roomQrValue(r.token, r.ownerKey)).frame(width: 200, height: 200).frame(maxWidth: .infinity)
            Text(roomShareCode(r.token, r.ownerKey)).font(.system(size: 11)).foregroundColor(.muted).textSelection(.enabled)
            HStack {
                Button("Másolás") { UIPasteboard.general.string = roomShareCode(r.token, r.ownerKey) }.buttonStyle(.bordered)
                ShareLink(item: buildRoomLink(base: LINK_BASE, token: r.token, name: r.name, color: r.color, ownerKey: r.ownerKey)) { Text("Küldés") }.buttonStyle(.bordered)
            }
            ForEach(members, id: \.deviceId) { m in
                HStack {
                    Circle().fill(online.contains(m.deviceId) ? Color.mint : .gray).frame(width: 8, height: 8)
                    Text(m.name).font(.subheadline).foregroundColor(.white); Spacer()
                    if online.contains(m.deviceId) { Button(asked.contains(m.deviceId) ? "Elküldve" : "Kérés") { if app.peers.requestShare(m.deviceId) { asked.insert(m.deviceId) } }.buttonStyle(.borderless) }
                    else { Button("Töröl") { app.peers.forgetMember(r.token, m.deviceId) }.buttonStyle(.borderless) }
                    if r.owner { Button("Eltávolít", role: .destructive) { app.kick(r.token, m.deviceId) }.buttonStyle(.borderless) }
                }
            }
            if confirm == r.token {
                Text(r.owner ? "Törlöd a szobát? A kapcsolódó tagok értesülnek." : "Kilépsz a szobából?").font(.footnote).foregroundColor(.white)
                HStack { Button(r.owner ? "Törlés" : "Kilépés", role: .destructive) { app.deleteOrLeave(r.token); confirm = nil }; Button("Mégse") { withAnimation(harmonika) { confirm = nil } } }.buttonStyle(.borderless)
            } else { Button(r.owner ? "Szoba törlése" : "Kilépés a szobából", role: .destructive) { withAnimation(harmonika) { confirm = r.token } }.buttonStyle(.borderless) }
        }
    }
}

enum SettingsTab: String, CaseIterable, Identifiable { case general = "Általános", places = "Helyek", perms = "Engedélyek"; var id: String { rawValue } }

struct SettingsSheet: View {
    @EnvironmentObject var app: AppModel
    @State var tab: SettingsTab
    var body: some View {
        SheetScaffold {
            HStack(spacing: 4) {
                ForEach(SettingsTab.allCases) { t in
                    Button { withAnimation(harmonika) { tab = t } } label: {
                        Text(t.rawValue).font(.footnote.weight(t == tab ? .semibold : .regular)).foregroundColor(.white).frame(maxWidth: .infinity).padding(.vertical, 8)
                            .background(t == tab ? Color.mint.opacity(0.3) : .clear, in: Capsule())
                    }.buttonStyle(.plain)
                }
            }.padding(4).glass(22)
            TabContent(tab: tab) { t in
                VStack(spacing: 10) {
                    switch t { case .general: GeneralTab(); case .places: PlacesTab(); case .perms: PermsTab() }
                }
            }
        }
    }
}

private struct GeneralTab: View {
    @EnvironmentObject var app: AppModel
    @State private var name = "", open = OpenState(id: "profile")
    var body: some View {
        let changed = !name.trimmingCharacters(in: .whitespaces).isEmpty && name.trimmingCharacters(in: .whitespaces) != app.profile?.name
        Accordion(title: "Profil", subtitle: app.profile?.name, open: open.id == "profile", onToggle: { open.toggle("profile") }) {
            ProfileRow(name: $name, avatar: app.profile?.avatar, onAvatar: { a in app.saveProfile(LocalProfile(name: app.profile?.name ?? name, avatar: a)) }) {
                if changed { Button { withAnimation(harmonika) { app.saveProfile(LocalProfile(name: name.trimmingCharacters(in: .whitespaces), avatar: app.profile?.avatar)) } } label: { Image(systemName: "checkmark.circle.fill").font(.title3).foregroundColor(.mint) }.transition(.scale.combined(with: .opacity)) }
            }.animation(harmonika, value: changed)
        }
        .onAppear { name = app.profile?.name ?? "" }
        Accordion(title: "Térkép", open: open.id == "map", onToggle: { open.toggle("map") }) {
            Toggle("Útvonalak mutatása", isOn: Binding(get: { app.prefs.showTrails }, set: { v in app.updatePrefs { $0.showTrails = v } })).font(.subheadline).foregroundColor(.white)
            Toggle("Cím lekérése OSM-ből (koordináta kimegy)", isOn: Binding(get: { app.prefs.addressConsent == "yes" }, set: { v in app.updatePrefs { $0.addressConsent = v ? "yes" : "no" } })).font(.subheadline).foregroundColor(.white)
            if app.prefs.showTrails { ForEach(Array(app.peers.people.values), id: \.deviceId) { p in Button("\(p.name) útvonalának törlése") { app.peers.clearTrail(p.deviceId) }.font(.footnote) } }
        }
        let info = Bundle.main.infoDictionary
        Accordion(title: "Verzió", subtitle: "\(info?["CFBundleShortVersionString"] as? String ?? "dev") (#\(info?["CFBundleVersion"] as? String ?? "0"))", open: open.id == "version", onToggle: { open.toggle("version") }) {
            Text("iPhone-on az app nem frissíti önmagát: az új .ipa-t a GitHub kiadások között találod; Sideloadly vagy AltStore telepíti a régi fölé.").font(.footnote).foregroundColor(.muted)
        }
        Accordion(title: "Súgó", open: open.id == "help", onToggle: { open.toggle("help") }) {
            Text("A rövid súgóbuborékok újra végigvezetnek a főbb gombokon.").font(.footnote).foregroundColor(.muted)
            Button("Súgó újra") { app.updatePrefs { $0.hint = 0 } }.buttonStyle(.bordered)
        }
    }
}

private struct PermsTab: View {
    @EnvironmentObject var app: AppModel
    @State private var open = OpenState()
    var body: some View {
        let s = app.engine.authStatus, acc = app.engine.accuracyAuth
        item("loc", "Helyzet", s == .authorizedAlways || s == .authorizedWhenInUse, "A saját pozíciód a térképen.", "Engedélyezés") { app.engine.requestWhenInUse() }
        item("always", "Mindig (háttérben is)", s == .authorizedAlways, "Lezárt képernyőnél is megosztáshoz: Beállítások → Hely → Mindig.", "Beállítás") { s == .notDetermined ? app.engine.requestWhenInUse() : app.engine.requestAlways() }
        item("prec", "Pontos helyzet", acc == .fullAccuracy, "Beállítások → Hely → Pontos helyzet bekapcsolása.", "Megnyitás") { openSettings() }
        item("notif", "Értesítések", false, "A megosztáskérésekhez.", "Engedélyezés") { app.requestNotifications() }
        Button("Rendszerbeállítások megnyitása") { openSettings() }.buttonStyle(.bordered)
    }
    private func openSettings() { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
    private func item(_ id: String, _ title: String, _ ok: Bool, _ hint: String, _ label: String, _ act: @escaping () -> Void) -> some View {
        Accordion(title: title, subtitle: ok ? "Engedélyezve" : "Nincs engedélyezve", open: open.id == id, onToggle: { open.toggle(id) },
                  leading: { Circle().fill(ok ? Color.mint : Color(hex: "#FB7185")).frame(width: 10, height: 10) }) {
            Text(hint).font(.footnote).foregroundColor(.muted)
            if !ok { Button(label, action: act).buttonStyle(.borderedProminent) }
        }
    }
}

private struct PlacesTab: View {
    @EnvironmentObject var app: AppModel
    @State private var name = "", msg: String?, open = OpenState()
    private func update(_ id: String, _ f: (inout Place) -> Void) { var p = app.places; if let i = p.firstIndex(where: { $0.id == id }) { f(&p[i]); app.savePlaces(p) } }
    var body: some View {
        Text("Jelöld ki, hol állsz valójában: az app megtanulja, mennyit téved ott a GPS.").font(.caption).foregroundColor(.muted).frame(maxWidth: .infinity, alignment: .leading)
        PillField(hint: "Új hely neve", text: $name)
        Button("Hozzáadás a jelenlegi pozícióval") {
            guard let raw = app.engine.state.rawPoint else { msg = "Még nincs pozíció"; return }
            var p = newPlace(name); p.spots = [newSpot(raw, label: "Pont 1")]; app.savePlaces(app.places + [p]); name = ""; withAnimation(harmonika) { open.id = p.id }
        }.buttonStyle(.borderedProminent).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty).frame(maxWidth: .infinity, alignment: .leading)
        if let m = msg { Text(m).font(.caption).foregroundColor(.muted).frame(maxWidth: .infinity, alignment: .leading) }
        ForEach(app.places) { p in
            Accordion(title: p.name, subtitle: "sugár \(Int(p.radius)) m · \(p.spots.filter { $0.bias != nil }.count)/\(p.spots.count) pont tanult", open: open.id == p.id, onToggle: { open.toggle(p.id) }) {
                Slider(value: Binding(get: { p.radius }, set: { v in update(p.id) { $0.radius = min(MAX_RADIUS, max(MIN_RADIUS, v)) } }), in: MIN_RADIUS...MAX_RADIUS)
                ForEach(p.spots) { s in
                    let learned = s.bias.map { b in "eltérés: " + describeVector(LatLng(lat: s.lat, lng: s.lng), offsetPoint(LatLng(lat: s.lat, lng: s.lng), e: b.e, n: b.n)) + " (\(s.samples) fix)" } ?? "még nem tanult"
                    Text((s.label.isEmpty ? "Pont" : s.label) + " · " + learned).font(.footnote).foregroundColor(.white)
                    HStack(spacing: 4) {
                        Button("Tanulás") {
                            switch learnBias(s, recent: app.engine.recentFixes) {
                            case .ok(let ns): update(p.id) { pl in pl.spots = pl.spots.map { $0.id == s.id ? ns : $0 } }; msg = "Megtanulva"
                            case .fail(let r): msg = "Nem tanulható: \(r)"
                            }
                        }.buttonStyle(.bordered)
                        ForEach([("É", 0.0, 1.0), ("K", 1.0, 0.0), ("D", 0.0, -1.0), ("Ny", -1.0, 0.0)], id: \.0) { l, de, dn in
                            Button("1 m \(l)") { update(p.id) { pl in pl.spots = pl.spots.map { $0.id == s.id ? nudgeSpot($0, de: de, dn: dn) : $0 } } }.buttonStyle(.bordered).font(.caption2)
                        }
                    }
                }
                Button("Hely törlése", role: .destructive) { withAnimation(harmonika) { app.savePlaces(app.places.filter { $0.id != p.id }) } }.buttonStyle(.borderless)
            }
        }
    }
}
