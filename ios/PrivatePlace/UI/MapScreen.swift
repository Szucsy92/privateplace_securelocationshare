import SwiftUI
import CoreLocation

struct ToastMsg: Identifiable { let id = UUID(); var kind: String; var text: String; var description: String? = nil; var action: (String, () -> Void)? = nil; var ms: Double = 4 }
enum DialogKind: String { case welcome, permissions, rooms, settings, share, join }
let SELF = "self"

private struct WindowKey: PreferenceKey { static var defaultValue: CGRect = .zero; static func reduce(value: inout CGRect, nextValue: () -> CGRect) { value = nextValue() } }

private func kmh(_ s: Double?) -> String { guard let s = s, !s.isNaN else { return "– km/h" }; return "\(max(0, Int((s * 3.6).rounded()))) km/h" }
private func personStatus(_ p: RemotePerson, _ now: Int64) -> String {
    if !p.online { return "" }; if !p.sharing { return "nem oszt meg" }
    guard let at = p.at else { return "" }
    if p.stoppedSince != nil { return kmh(0) }
    return now - at >= 15000 ? kmh(nil) : kmh(p.speed)
}

struct AppRoot: View {
    @EnvironmentObject var app: AppModel
    var body: some View { MapScreen().environment(\.pal, app.prefs.mapTheme == "dark" ? darkPalette : lightPalette) }
}

struct MapScreen: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    @StateObject private var bridge = MapBridge()
    @State private var dialog: DialogKind?
    @State private var settingsView = "main", shareToken: String?, pendingJoin: Invitation?
    @State private var follow: FollowReq?
    @State private var exitConfirm = false, addressAskHidden = false, transportDemo = false
    @State private var selfTrack: [TrackPoint] = []
    @State private var window = CGRect.zero
    @State private var clock: Int64 = nowMs()
    @State private var pickTarget: (String, String?)?
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        let me = app.engine.state, net = app.peers
        let selfColor = app.personColors[SELF_COLOR_KEY] ?? SELF_COLOR
        let coll = Locale(identifier: "hu_HU")
        let remote = net.people.values.map { p -> RemotePerson in var q = p; if let c = app.personColors[p.deviceId] { q.color = c }; return q }
            .sorted { a, b in a.online != b.online ? a.online : a.name.compare(b.name, locale: coll) == .orderedAscending }
        var mapPeople: [MapPerson] = []
        if let pr = app.profile, !selfTrack.isEmpty { mapPeople.append(MapPerson(id: SELF, name: pr.name, avatar: pr.avatar, color: selfColor, points: selfTrack, isSelf: true, heading: me.heading, battery: me.battery, stoppedSince: me.stoppedSince, speed: me.speed)) }
        for p in remote where p.sharing && !p.points.isEmpty { mapPeople.append(MapPerson(id: p.deviceId, name: p.name, avatar: p.avatar, color: p.color, points: p.points, heading: p.heading, battery: p.battery.map(Int.init), stoppedSince: p.stoppedSince, speed: p.speed)) }
        let onlineCount = remote.filter { $0.online }.count
        let selfFresh = me.at.map { clock - $0 < 15000 } ?? false
        let status = !me.sharing ? "off" : me.error != nil ? "lost" : !selfFresh ? "search" : "live"
        let askAddress = dialog == nil && app.prefs.addressConsent == "ask" && !addressAskHidden && app.profile != nil

        ZStack {
            pal.background.ignoresSafeArea()
            LiveMapView(people: mapPeople, follow: follow, showTrails: app.prefs.showTrails, trailIds: app.prefs.trailIds, orientation: app.prefs.orientation, dark: app.prefs.mapTheme == "dark", window: window, bridge: bridge).ignoresSafeArea()
            VStack(spacing: 8) {
                header(status, onlineCount)
                ZStack {
                    Color.clear
                    mapOverlays(me, mapPeople, askAddress, net)
                }
                .overlay(RoundedRectangle(cornerRadius: 28).stroke(pal.glassEdge, lineWidth: 1)).clipShape(RoundedRectangle(cornerRadius: 28))
                .background(GeometryReader { g in Color.clear.preference(key: WindowKey.self, value: g.frame(in: .global)) })
                railView(remote, me, selfColor, selfFresh)
            }.padding(.top, 8).padding(.horizontal, 8)
            if app.profile != nil && dialog == nil && app.prefs.hint < HINTS.count {
                HintBubbles(step: app.prefs.hint, onNext: { app.updatePrefs { $0.hint += 1 } }, onSkip: { app.updatePrefs { $0.hint = HINTS.count } }, onDemo: { transportDemo = $0 })
            }
            ToastHost()
            if let d = dialog { DialogHost(dialog: d, settingsView: $settingsView, shareToken: $shareToken, pendingJoin: $pendingJoin, exitConfirm: $exitConfirm, onDialog: { dialog = $0 },
                                           onPick: { t in pickTarget = t; dialog = nil }, selfTrackClear: { selfTrack = clearTrackHistory(selfTrack) }) }
        }
        .onPreferenceChange(WindowKey.self) { window = $0 }
        .onReceive(tick) { _ in clock = nowMs() }
        .onAppear { dialog = app.profile == nil ? .welcome : (app.invite != nil ? .join : nil); pendingJoin = app.invite }
        .onChange(of: app.invite?.token) { _ in if let i = app.invite { pendingJoin = i; if app.profile != nil { withAnimation(harmonika) { dialog = .join } } } }
        .onChange(of: me.at) { _ in if let p = me.point, let at = me.at { selfTrack = appendTrackPoint(selfTrack, TrackPoint(lat: p.lat, lng: p.lng, t: at), now: nowMs()) } }
        .onChange(of: app.shareRequest) { dev in
            guard let dev = dev else { return }; app.shareRequest = nil
            let who = app.peers.people[dev]?.name ?? "Egy szobatársad"
            if app.engine.state.sharing { app.toast("info", "\(who) kérte a helyzetedet – a megosztás már be van kapcsolva.") }
            else { app.toast("info", "\(who) szeretné látni, merre vagy", description: "Egy koppintással bekapcsolhatod a megosztást.", action: ("Megosztás", { app.engine.requestWhenInUse(); app.engine.setSharing(true) }), ms: 15) }
        }
        .task(id: askAddress) { if askAddress { try? await Task.sleep(nanoseconds: 30_000_000_000); addressAskHidden = true } }
        .animation(harmonika, value: dialog)
    }

    // ── Fejléc ──
    private func header(_ status: String, _ online: Int) -> some View {
        HStack(spacing: 8) {
            Txt("Private Place", size: 16, weight: 700, display: true, lines: 1, lineHeight: 24).frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 6) {
                SharingControl(status: status) { setSharing(!app.engine.state.sharing) }
                Button { dialog = .rooms } label: {
                    ZStack(alignment: .topTrailing) {
                        LIcon("users", size: 20, tint: online > 0 ? pal.primary : nil).frame(width: 36, height: 36)
                        if online > 0 { Txt("\(online)", size: 10, weight: 600, color: pal.primaryForeground).padding(.horizontal, 4).frame(minWidth: 17, minHeight: 17).background(pal.primary, in: Capsule()).offset(x: 2, y: -2) }
                    }.indicator(online > 0)
                }.buttonStyle(.plain)
                Button { settingsView = "main"; dialog = .settings } label: { LIcon("settings-2", size: 20, tint: dialog == .settings ? pal.primary : nil).frame(width: 36, height: 36).indicator(dialog == .settings) }.buttonStyle(.plain)
            }
        }.padding(.horizontal, 12).padding(.vertical, 8).glass(20)
    }
    private func setSharing(_ on: Bool) {
        if on && !app.engine.granted { settingsView = "main"; withAnimation(harmonika) { dialog = .permissions }; return }
        app.engine.setSharing(on)
        if on { app.requestNotifications() }
    }

    // ── Térképablak felett ──
    private func mapOverlays(_ me: SelfState, _ people: [MapPerson], _ askAddress: Bool, _ net: PeerManager) -> some View {
        ZStack {
            if pickTarget != nil { pickOverlay }
            VStack { HStack { Spacer()
                VStack(spacing: 8) {
                    Button { let n = app.prefs.orientation == "north" ? "heading" : "north"; app.updatePrefs { $0.orientation = n }
                        if n == "heading" && follow == nil && people.contains(where: { $0.id == SELF }) { follow = FollowReq(id: SELF, request: (follow?.request ?? 0) + 1) } } label: {
                        Group { if app.prefs.orientation == "heading" { LIcon("navigation-2", size: 20, tint: pal.primary) } else { Txt("N", size: 14, weight: 700, display: true) } }
                            .rotationEffect(.degrees(bridge.compassRot)).frame(width: 44, height: 44).glassCapsule().indicator(app.prefs.orientation == "heading") }.buttonStyle(.plain)
                    Button { app.updatePrefs { $0.mapTheme = $0.mapTheme == "dark" ? "light" : "dark" } } label: { LIcon(app.prefs.mapTheme == "dark" ? "sun" : "moon", size: 16).frame(width: 44, height: 44).glassCapsule() }.buttonStyle(.plain)
                } }.padding(12); Spacer() }
            VStack { Spacer(); HStack(alignment: .bottom, spacing: 8) {
                let own = follow == nil || follow?.id == SELF
                TransportControl(mode: own ? me.transport : (follow.flatMap { net.people[$0.id]?.transport }), own: own, manual: me.manualTransport != nil, demo: transportDemo) { app.engine.setManualTransport($0) }
                if askAddress {
                    HStack(spacing: 2) {
                        Txt("Cím megjelenítése?", size: 12, weight: 600, lineHeight: 15).frame(maxWidth: .infinity, alignment: .leading)
                        Button { app.updatePrefs { $0.addressConsent = "no" } } label: { Txt("Nem", size: 12, weight: 500).padding(.horizontal, 12).frame(height: 32) }.buttonStyle(.plain)
                        Button { app.updatePrefs { $0.addressConsent = "yes" } } label: { Txt("Igen", size: 12, weight: 500, color: pal.primary).padding(.horizontal, 12).frame(height: 32).indicator(true) }.buttonStyle(.plain)
                    }.padding(EdgeInsets(top: 4, leading: 14, bottom: 4, trailing: 6)).frame(minHeight: 48).glassCapsule().padding(.trailing, 52).transition(.opacity)
                } else { Spacer() }
            }.padding(.horizontal, 12).padding(.bottom, 16) }
            if let sel = bridge.selected, let pos = bridge.bubblePos, let person = people.first(where: { $0.id == sel }) {
                GeometryReader { g in
                    PersonBubble(person: person, selfPerson: people.first { $0.isSelf }, clock: clock)
                        .fixedSize().background(GeometryReader { b in Color.clear.preference(key: BubbleSizeKey.self, value: b.size) })
                        .modifier(BubblePosition(pos: CGPoint(x: pos.x - window.minX, y: pos.y - window.minY), below: bridge.bubbleBelow, container: g.size))
                }
            }
        }
    }
    private var pickOverlay: some View {
        ZStack {
            ZStack { Rectangle().fill(Color(hex: "#EF4444")).frame(width: 2, height: 40); Rectangle().fill(Color(hex: "#EF4444")).frame(width: 40, height: 2); Circle().fill(Color(hex: "#EF4444")).frame(width: 8, height: 8).overlay(Circle().stroke(Color.white, lineWidth: 1)) }
            VStack { HStack(spacing: 8) {
                Txt("Told a térképet úgy, hogy a célkereszt a valódi helyed legyen, majd koppints az „Ide” gombra.", size: 12, lineHeight: 16)
                TextBtn(text: "Mégse", variant: .outline, small: true, fill: false) { pickTarget = nil; dialog = .settings; settingsView = "places" }
                TextBtn(text: "Ide", small: true, fill: false) { confirmPick() }
            }.padding(12).glass(Radius2xl).padding(.horizontal, 12).padding(.top, 8); Spacer() }
        }
    }
    private func confirmPick() {
        guard let t = pickTarget, let c = bridge.center() else { app.toast("warning", "A térkép még nem áll készen."); return }
        let ll = LatLng(lat: c.latitude, lng: c.longitude)
        app.savePlaces(app.places.map { p in
            guard p.id == t.0 else { return p }; var q = p
            if let sid = t.1 { q.spots = q.spots.map { s in var x = s; if s.id == sid { x.lat = ll.lat; x.lng = ll.lng; x.bias = nil; x.learnedAt = nil; x.samples = 0 }; return x } }
            else { q.spots.append(newSpot(ll, label: "Pont \(q.spots.count + 1)")) }
            return q })
        pickTarget = nil; dialog = .settings; settingsView = "places"
    }

    // ── Személysáv ──
    private func railView(_ remote: [RemotePerson], _ me: SelfState, _ selfColor: String, _ selfFresh: Bool) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 9.6) {
                if let pr = app.profile {
                    PersonCapsule(name: "Én", avatar: pr.avatar, fallback: pr.name, color: selfColor, active: follow?.id == SELF, dot: selfFresh ? "on" : (me.error != nil ? "warn" : "wait"), status: me.at != nil ? kmh(me.speed) : "") { toggleFollow(SELF) }
                }
                ForEach(remote) { p in
                    PersonCapsule(name: p.name, avatar: app.peers.avatars[p.deviceId] ?? p.avatar, fallback: p.name, color: p.color, active: follow?.id == p.deviceId,
                                  dot: !p.online ? "warn" : !p.sharing ? "off" : (p.at.map { clock - $0 < 15000 } ?? false) ? "on" : "wait", status: personStatus(p, clock)) { toggleFollow(p.deviceId) }
                }
                if remote.isEmpty { PersonCapsule(name: "Meghívó", avatar: nil, fallback: "+", color: "#94A3B8", active: false, dot: "none", status: "Szoba", invite: true) { dialog = .rooms } }
            }.padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 15)
        }.padding(.horizontal, -8).mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.05), .init(color: .black, location: 0.95), .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing))
    }
    private func toggleFollow(_ id: String) {
        if follow?.id == id { follow = nil; return }
        let hasPos = id == SELF ? !selfTrack.isEmpty : (app.peers.people[id]?.sharing == true && !(app.peers.people[id]?.points.isEmpty ?? true))
        if !hasPos {
            if id == SELF {
                if app.engine.state.error == "denied" { withAnimation(harmonika) { dialog = .permissions } }
                else { app.engine.requestWhenInUse(); app.engine.evaluate(); app.toast("info", "Újra keresem a helyzetedet. Ellenőrizd, hogy a telefon helymeghatározása be van-e kapcsolva.") }
            } else { let n = app.peers.people[id]?.name ?? "Ő"; app.toast("info", "\(n) most nem osztja meg a helyzetét", action: ("Kérés", { askToShare(id) })) }
            return
        }
        follow = FollowReq(id: id, request: (follow?.request ?? 0) + 1)
    }
    private func askToShare(_ dev: String) {
        guard let p = app.peers.people[dev], p.online else { app.toast("info", "Ő most nincs online, ezért nem tudod megkérni."); return }
        if app.peers.requestShare(dev) { app.toast("success", "Kérés elküldve \(p.name) részére.") }
    }
}

// ───────── Megosztás-kapcsoló ─────────
struct SharingControl: View {
    @Environment(\.pal) private var pal
    var status: String; var onToggle: () -> Void
    @State private var expanded = false, k: CGFloat = 0
    var body: some View {
        let on = status != "off"
        let signal = status == "live" ? Color(hex: "#14B8A6") : status == "search" ? Color(hex: "#FBBF24") : status == "lost" ? Color(hex: "#FB7185") : pal.mutedForeground
        let label = ["off": "Megosztás ki", "live": "Megosztás be", "search": "Helyzet keresése…", "lost": "Nincs jel"][status] ?? ""
        Button(action: onToggle) {
            HStack(spacing: 6) {
                LIcon(status == "off" ? "play" : "pause", size: 18, tint: on ? Color(hex: "#14B8A6") : signal)
                if expanded { Txt(label, size: 11, color: on ? Color(hex: "#14B8A6") : signal, lines: 1) }
            }.padding(.horizontal, 10).frame(width: expanded ? 164 : 40, height: 40, alignment: .leading)
        }.buttonStyle(.plain).background((on ? pal.glassBg.mix(Color(hex: "#14B8A6"), 0.18) : pal.glassBg), in: Capsule()).overlay(Capsule().stroke(pal.glassEdge, lineWidth: 1))
        .background(Capsule().stroke(signal.opacity(0.45 * (1 - Double(k))), lineWidth: 7 * k).opacity(on ? 1 : 0))
        .onChange(of: status) { _ in flash() }.onAppear { flash(); withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) { k = 1 } }
    }
    private func flash() { withAnimation(.easeOut(duration: 0.22)) { expanded = true }; DispatchQueue.main.asyncAfter(deadline: .now() + 3) { withAnimation(.easeOut(duration: 0.22)) { expanded = false } } }
}

struct TransportControl: View {
    @Environment(\.pal) private var pal
    var mode: TransportMode?; var own: Bool; var manual: Bool; var demo: Bool; var onSelect: (TransportMode?) -> Void
    @State private var open = false
    var body: some View {
        let expanded = (open && own) || demo; let cur = mode ?? .walk
        func icon(_ m: TransportMode) -> String { m == .walk ? "footprints" : m == .bike ? "bike" : "car" }
        HStack(spacing: 2) {
            if !expanded { Button { if own { withAnimation(harmonika) { open = true } } } label: { LIcon(icon(cur), size: 16).frame(width: 36, height: 36) }.buttonStyle(.plain) }
            else { ForEach(TransportMode.allCases, id: \.self) { m in
                Button { onSelect(manual && cur == m ? nil : m); withAnimation(harmonika) { open = false } } label: { LIcon(icon(m), size: 16, tint: cur == m ? pal.primary : nil).frame(width: 36, height: 36) }.buttonStyle(.plain) } }
        }.padding(3).frame(width: expanded ? 128 : 48, height: 48, alignment: .leading).glassCapsule().animation(.easeOut(duration: 0.22), value: expanded)
    }
}

struct PersonCapsule: View {
    @Environment(\.pal) private var pal
    var name: String; var avatar: String?; var fallback: String; var color: String; var active: Bool; var dot: String; var status: String; var invite = false; var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 9.6) {
                CapsuleAvatar(name: fallback, avatar: avatar, color: Color(hex: color), size: 54, plus: invite, glow: active)
                VStack(alignment: .leading, spacing: 0) {
                    Txt(name, size: 14, weight: 600, lines: 1)
                    if !status.isEmpty { Txt(status, size: 11, color: pal.mutedForeground, lines: 1, lineHeight: 16) }
                    if dot != "none" { StatusDot(state: dot).padding(.top, 4) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.padding(EdgeInsets(top: 5, leading: 8, bottom: 5, trailing: 14)).frame(width: 176, height: 72)
        }.buttonStyle(PressScale()).background(pal.glassBg, in: Capsule()).background(Capsule().fill(.ultraThinMaterial)).background(active ? pal.signal.opacity(0.12) : .clear, in: Capsule())
        .overlay(Capsule().stroke(active ? pal.signal.opacity(0.55) : pal.glassEdge, lineWidth: 1)).shadow(color: active ? pal.signal.opacity(0.4) : pal.shade.opacity(0.45), radius: 10, y: 6)
    }
}
struct PressScale: ButtonStyle { func makeBody(configuration: Configuration) -> some View { configuration.label.scaleEffect(configuration.isPressed ? 0.97 : 1) } }

struct CapsuleAvatar: View {
    @Environment(\.pal) private var pal
    var name: String; var avatar: String?; var color: Color; var size: CGFloat; var plus = false; var glow = false
    var body: some View {
        ZStack {
            Circle().fill(pal.surfaceStrong)
            if plus { LIcon("plus", size: 24, tint: pal.mutedForeground) }
            else if let img = decodeDataURL(avatar) { Image(uiImage: img).resizable().scaledToFill().clipShape(Circle()) }
            else { Txt(String((name.isEmpty ? "?" : name).prefix(1)).uppercased(), size: 18.4, weight: 600) }
        }.frame(width: size, height: size).clipShape(Circle()).overlay(Circle().stroke(color, lineWidth: 3)).shadow(color: glow ? pal.glow : .clear, radius: 10)
    }
}

func decodeDataURL(_ url: String?) -> UIImage? {
    guard let u = url, let r = u.range(of: "base64,"), let d = Data(base64Encoded: String(u[r.upperBound...])) else { return nil }
    return UIImage(data: d)
}

// ───────── Személy-buborék ─────────
private struct BubbleSizeKey: PreferenceKey { static var defaultValue: CGSize = .zero; static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() } }
private struct BubblePosition: ViewModifier {
    var pos: CGPoint; var below: Bool; var container: CGSize
    @State private var size: CGSize = .zero
    func body(content: Content) -> some View {
        content.onPreferenceChange(BubbleSizeKey.self) { size = $0 }
            .position(x: min(max(pos.x, 8 + size.width / 2), max(8 + size.width / 2, container.width - 8 - size.width / 2)),
                      y: below ? pos.y + 32 + size.height / 2 : pos.y - 32 - size.height / 2)
    }
}
struct PersonBubble: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var person: MapPerson; var selfPerson: MapPerson?; var clock: Int64
    @State private var address: AddressInfo?, done = false, err: String?, lastQ: (Double, Double, Date)?, failed = false
    var body: some View {
        let allowed = app.prefs.addressConsent == "yes"
        let last = person.points.last, own = selfPerson?.points.last
        let moving = person.stoppedSince == nil && person.speed != nil
        let distance: Double? = (!person.isSelf && own != nil && last != nil) ? distanceMeters(LatLng(lat: own!.lat, lng: own!.lng), LatLng(lat: last!.lat, lng: last!.lng)) : nil
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                LIcon("battery", size: 12); Txt(person.battery.map { "\($0)%" } ?? "–", size: 11)
                if !person.isSelf { Txt("·", size: 11); Txt(distance == nil ? "–" : distance! < 1000 ? "\(Int(distance!.rounded())) m" : String(format: "%.1f km", distance! / 1000).replacingOccurrences(of: ".", with: ","), size: 11) }
            }
            if allowed {
                Txt(address?.title ?? (done ? "Cím nem elérhető\(err.map { " (\($0))" } ?? "")" : "Cím keresése…"), size: 12, weight: 600, lines: 1, align: .center, lineHeight: 16).padding(.vertical, 3)
                if let n = address?.near { Txt(n, size: 11, color: pal.mutedForeground, align: .center) }
            } else {
                Button { app.updatePrefs { $0.addressConsent = "yes" } } label: { HStack(spacing: 4) { LIcon("map-pin", size: 12); Txt("Cím lekérése", size: 11, weight: 500) }.frame(height: 24).padding(.horizontal, 8) }.buttonStyle(.plain)
            }
            Txt(stopLabel(since: person.stoppedSince, now: clock, moving: moving), size: 11, color: pal.mutedForeground)
        }.padding(.horizontal, 10).padding(.vertical, 8).frame(minWidth: 144, maxWidth: 320).glass(12)
        .task(id: "\(allowed)|\(last?.lat ?? 0)|\(last?.lng ?? 0)") {
            guard allowed, let l = last else { return }
            if let q = lastQ, (Date().timeIntervalSince(q.2) < 15 || (distanceMeters(LatLng(lat: q.0, lng: q.1), LatLng(lat: l.lat, lng: l.lng)) < 25 && !failed)) { return }
            lastQ = (l.lat, l.lng, Date())
            do { address = try await lookupAddress(lat: l.lat, lng: l.lng); failed = false; err = nil } catch { failed = true; err = error.localizedDescription; address = nil }
            done = true
        }
    }
}

// ───────── Súgóbuborékok ─────────
struct Hint { var text: String; var place: String }
let HINTS: [Hint] = [
    Hint(text: "Egy koppintás: megosztás be/ki. Leállítva kíméli az akkut.", place: "share"),
    Hint(text: "Közlekedési mód: magától vált, rábökve te is választhatsz.", place: "transport"),
    Hint(text: "Cím: csak a megnyitott jelölő helye megy a címkeresőhöz. A Beállításokban kapcsolható.", place: "address"),
    Hint(text: "Koppints egy jelölőre: akku, távolság, cím, mióta áll.", place: "marker"),
    Hint(text: "Koppints egy személyre a követéshez. Ha nem oszt meg, innen kérheted.", place: "rail"),
    Hint(text: "Megosztáskérésnél felül üzenet jön – a „Megosztás” gombbal azonnal bekapcsolod.", place: "share"),
]
struct HintBubbles: View {
    @Environment(\.pal) private var pal
    var step: Int; var onNext: () -> Void; var onSkip: () -> Void; var onDemo: (Bool) -> Void
    var body: some View {
        let h = HINTS[min(step, HINTS.count - 1)]
        let (align, pad): (Alignment, EdgeInsets) = {
            switch h.place {
            case "share": return (.topLeading, EdgeInsets(top: 70, leading: 16, bottom: 0, trailing: 0))
            case "transport": return (.bottomLeading, EdgeInsets(top: 0, leading: 16, bottom: 168, trailing: 0))
            case "rail": return (.bottomLeading, EdgeInsets(top: 0, leading: 16, bottom: 120, trailing: 0))
            case "address": return (.bottom, EdgeInsets(top: 0, leading: 0, bottom: 128, trailing: 0))
            default: return (.center, EdgeInsets(top: 0, leading: 0, bottom: 80, trailing: 0)) } }()
        VStack(alignment: .leading, spacing: 8) {
            Txt(h.text, size: 12, lineHeight: 16.5)
            HStack {
                Button { withAnimation(harmonika) { onSkip() } } label: { Txt("Kihagyás", size: 11, color: pal.mutedForeground, underline: true) }.buttonStyle(.plain)
                Spacer()
                Button { withAnimation(harmonika) { onNext() } } label: { Txt(step + 1 < HINTS.count ? "Tovább \(step + 1)/\(HINTS.count)" : "Értem", size: 11.5, weight: 600, color: pal.primaryForeground).padding(.horizontal, 11).padding(.vertical, 4).background(pal.primary, in: Capsule()) }.buttonStyle(.plain)
            }
        }.padding(EdgeInsets(top: 10.4, leading: 12.8, bottom: 10.4, trailing: 12.8)).frame(maxWidth: 240).glass(16, strong: true).id(step).transition(.opacity.combined(with: .scale(scale: 0.98)))
        .padding(pad).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: align).animation(harmonika, value: step)
        .task(id: h.place) {
            guard h.place == "transport" else { return }
            while !Task.isCancelled { try? await Task.sleep(nanoseconds: 750_000_000); onDemo(true); try? await Task.sleep(nanoseconds: 1_000_000_000); onDemo(false) }
            onDemo(false)
        }
    }
}

// ───────── Értesítések ─────────
struct ToastHost: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.pal) private var pal
    var body: some View {
        VStack { Spacer()
            VStack(spacing: 8) {
                ForEach(app.toasts.suffix(3)) { t in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) { Txt(t.text, size: 13, weight: 500, lineHeight: 18); if let d = t.description { Txt(d, size: 13, color: pal.mutedForeground, lineHeight: 18) } }
                        Spacer(minLength: 8)
                        if let (label, act) = t.action { Button { act(); app.toasts.removeAll { $0.id == t.id } } label: { Txt(label, size: 12, weight: 500, color: pal.primaryForeground).padding(.horizontal, 8).padding(.vertical, 4).background(pal.primary, in: RoundedRectangle(cornerRadius: 6)) }.buttonStyle(.plain) }
                    }.padding(16).glass(20, strong: true).transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }.padding(16)
        }.animation(harmonika, value: app.toasts.count).allowsHitTesting(!app.toasts.isEmpty)
    }
}
