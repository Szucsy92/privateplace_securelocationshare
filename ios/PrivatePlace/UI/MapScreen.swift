import SwiftUI
import CoreLocation

enum SheetKind: String, Identifiable { case rooms, settings; var id: String { rawValue } }

private func statusLine(_ p: RemotePerson) -> String {
    if !p.online { return "nincs kapcsolat" }
    if !p.sharing { return "nem oszt meg" }
    var parts: [String] = []
    if let s = p.stoppedSince { parts.append("áll \(max(0, (nowMs() - s) / 60000)) perce") }
    else if let sp = p.speed, sp >= 0.8 { parts.append("\(Int(sp * 3.6)) km/h") } else { parts.append("mozgásban") }
    if let b = p.battery { parts.append("\(Int(b))%") }
    return parts.joined(separator: " · ")
}

struct MapScreen: View {
    @EnvironmentObject var app: AppModel
    @State private var sheet: SheetKind?
    @State private var settingsTab = SettingsTab.general
    @State private var followId: String?, followTick = 0
    @State private var selected: String?, address: String?
    @State private var colorFor: String?
    @State private var exitAsk = false

    var body: some View {
        let engine = app.engine, peers = app.peers, me = engine.state
        let people = peers.people.values.sorted { $0.name < $1.name }
        func colorOf(_ id: String, _ base: String) -> String { app.personColors[id] ?? base }
        let selfColor = app.personColors[SELF_COLOR_KEY] ?? SELF_COLOR
        var markers: [MapMarker] = []
        if let p = me.point { markers.append(MapMarker(id: "self", label: app.profile?.name ?? "Én", color: selfColor, at: p)) }
        for p in people where p.sharing { if let t = p.points.last { markers.append(MapMarker(id: p.deviceId, label: p.name, color: colorOf(p.deviceId, p.color), at: LatLng(lat: t.lat, lng: t.lng), faded: !p.online)) } }
        let trails = app.prefs.showTrails ? people.map { MapTrail(id: $0.deviceId, color: colorOf($0.deviceId, $0.color), points: $0.points) } : []
        let followPoint: LatLng? = followId == nil ? nil : (followId == "self" ? me.point : peers.people[followId!]?.points.last.map { LatLng(lat: $0.lat, lng: $0.lng) })

        ZStack {
            MapLibreView(markers: markers, trails: trails, dark: app.prefs.mapTheme == "dark", follow: followPoint, followTick: followTick,
                         bearing: app.prefs.orientation == "heading" ? me.heading : 0, onTap: { selected = $0; address = nil }).ignoresSafeArea()
            VStack(spacing: 8) {
                header(me, peers)
                Spacer()
                HStack { Spacer(); Button { followId = "self"; followTick += 1 } label: { Image(systemName: "location.fill").padding(12).background(Color(hex: "#16233D"), in: Circle()) } }
                transportPicker(me)
                if let id = selected, id != "self", let p = peers.people[id] { selectedCard(p) }
                rail(people, me, selfColor, colorOf)
            }.padding(10).animation(harmonika, value: selected).animation(harmonika, value: address)
        }
        .background(Color.navy)
        .sheet(item: $sheet) { s in
            switch s {
            case .rooms: RoomsSheet().environmentObject(app)
            case .settings: SettingsSheet(tab: settingsTab).environmentObject(app)
            }
        }
        .alert("Meghívást kaptál", isPresented: Binding(get: { app.invite != nil && sheet != .rooms }, set: { if !$0 { app.invite = nil } }), presenting: app.invite) { inv in
            Button("Csatlakozás") { app.joinRoom(inv); app.invite = nil }; Button("Elutasítás", role: .cancel) { app.invite = nil }
        } message: { inv in Text("Csatlakozol a(z) „\(inv.name ?? "Szoba")” szobához?") }
        .alert("Értesítés", isPresented: Binding(get: { app.closedMessage != nil }, set: { if !$0 { app.closedMessage = nil } })) { Button("Rendben", role: .cancel) {} } message: { Text(app.closedMessage ?? "") }
        .sheet(isPresented: Binding(get: { colorFor != nil }, set: { if !$0 { colorFor = nil } })) {
            VStack(spacing: 14) {
                Text("Jelölő színe (csak itt látszik)").font(.headline)
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(44)), count: 4), spacing: 12) {
                    ForEach(PERSON_COLOR_OPTIONS, id: \.value) { o in Circle().fill(Color(hex: o.value)).frame(width: 40, height: 40).onTapGesture { if let id = colorFor { app.setPersonColor(id, o.value) }; colorFor = nil } }
                }
                Button("Alapszín") { if let id = colorFor { app.setPersonColor(id, nil) }; colorFor = nil }
            }.padding().presentationDetents([.height(260)])
        }
        .overlay { if app.profile != nil && sheet == nil && app.prefs.hint < HINTS.count {
            HintBubble(step: app.prefs.hint, onNext: { app.updatePrefs { $0.hint += 1 } }, onSkip: { app.updatePrefs { $0.hint = HINTS.count } })
        } }
        .onAppear { if !app.engine.granted { settingsTab = .perms; sheet = .settings } }
    }

    private func header(_ me: SelfState, _ peers: PeerManager) -> some View {
        HStack(spacing: 8) {
            Button {
                if !app.engine.granted { settingsTab = .perms; sheet = .settings; return }
                app.engine.setSharing(!me.sharing)
            } label: { Image(systemName: me.sharing ? "pause.fill" : "play.fill").foregroundColor(.white).frame(width: 44, height: 44).background(me.sharing ? Color.mint : Color(hex: "#334155"), in: Circle()) }
                .accessibilityLabel(me.sharing ? "Megosztás leállítása" : "Megosztás indítása")
            VStack(alignment: .leading, spacing: 2) {
                Text(me.sharing ? "Megosztás be" : "Megosztás ki").font(.subheadline.weight(.semibold))
                Text(me.error == "denied" ? "Nincs helyengedély" : (me.sharing ? "\(peers.roomPeers.values.reduce(0, +)) kapcsolat" : "Csak te látod a helyzeted")).font(.caption).foregroundColor(.muted).lineLimit(1)
            }
            Spacer()
            Button { sheet = .rooms } label: { Image(systemName: "person.3.fill") }
            Button { app.updatePrefs { $0.orientation = $0.orientation == "heading" ? "north" : "heading" } } label: { Image(systemName: "safari") }
            Button { app.updatePrefs { $0.mapTheme = $0.mapTheme == "dark" ? "light" : "dark" } } label: { Image(systemName: app.prefs.mapTheme == "dark" ? "sun.max" : "moon") }
            Button { settingsTab = .general; sheet = .settings } label: { Image(systemName: "gearshape") }
        }.foregroundColor(.white).padding(8).glass(28)
    }

    private func transportPicker(_ me: SelfState) -> some View {
        HStack(spacing: 6) {
            ForEach([(TransportMode?.none, "Auto"), (.walk, "Gyalog"), (.bike, "Bicikli"), (.car, "Autó")], id: \.1) { m, label in
                Button(label) { app.engine.setManualTransport(m) }.font(.caption)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(me.manualTransport == m ? Color.mint.opacity(0.35) : Color.clear, in: Capsule()).overlay(Capsule().stroke(Color.white.opacity(0.2)))
            }
        }.foregroundColor(.white).padding(6).glass(20)
    }

    private func selectedCard(_ p: RemotePerson) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(p.name).font(.subheadline.weight(.semibold))
                Text(address ?? (app.prefs.addressConsent == "yes" ? "Cím keresése…" : "Koppints a címért (OSM-szolgáltatás kapja a koordinátát)")).font(.caption).foregroundColor(.muted)
            }
            Spacer()
            Button("Cím") {
                guard let t = p.points.last else { return }
                app.updatePrefs { $0.addressConsent = "yes" }
                Task { address = (try? await lookupAddress(lat: t.lat, lng: t.lng)).map { [$0.title, $0.near].compactMap { $0 }.joined(separator: " · ") } ?? "Nincs találat" }
            }
            Button("Követ") { followId = p.deviceId; followTick += 1 }
        }.foregroundColor(.white).padding(12).glass(20).transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    private func rail(_ people: [RemotePerson], _ me: SelfState, _ selfColor: String, _ colorOf: @escaping (String, String) -> String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 8) {
                capsule(app.profile?.name ?? "Én", selfColor, app.profile?.avatar, me.sharing ? "megosztás be" : "ki", followId == "self") { followId = "self"; followTick += 1 } onLong: { colorFor = SELF_COLOR_KEY }
                ForEach(people) { p in
                    capsule(p.name, colorOf(p.deviceId, p.color), app.peers.avatars[p.deviceId] ?? p.avatar, statusLine(p), followId == p.deviceId) {
                        followId = p.deviceId; selected = p.deviceId; address = nil; followTick += 1
                    } onLong: { colorFor = p.deviceId }.opacity(p.online ? 1 : 0.6)
                }
            }
        }
    }
    private func capsule(_ name: String, _ color: String, _ avatar: String?, _ status: String, _ active: Bool, tap: @escaping () -> Void, onLong: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            AvatarView(name: name, color: color, avatar: avatar, size: 36)
            VStack(alignment: .leading, spacing: 1) { Text(name).font(.footnote.weight(.semibold)).lineLimit(1); Text(status).font(.caption2).foregroundColor(.muted).lineLimit(1) }
        }.foregroundColor(.white).padding(8).frame(maxWidth: 220).glass(28)
            .overlay(RoundedRectangle(cornerRadius: 28).stroke(active ? Color(hex: color) : .clear, lineWidth: 2))
            .onTapGesture(perform: tap).onLongPressGesture(perform: onLong)
    }
}
