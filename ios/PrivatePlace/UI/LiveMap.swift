import SwiftUI
import MapLibre
import CoreLocation

struct MapPerson: Equatable {
    var id: String, name: String, avatar: String?, color: String, points: [TrackPoint], isSelf = false
    var heading: Double? = nil, battery: Int? = nil, stoppedSince: Int64? = nil, speed: Double? = nil
}
struct FollowReq: Equatable { var id: String; var request: Int }

/// A térképből a SwiftUI felé: iránytű, kijelölt személy, buborék helye, térkép-közép.
final class MapBridge: ObservableObject {
    @Published var compassRot: Double = 0
    @Published var selected: String?
    @Published var bubblePos: CGPoint?
    @Published var bubbleBelow = false
    var center: () -> CLLocationCoordinate2D? = { nil }
}

let MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark"    // ugyanaz a stílus, mint a webes verzióban; a színeket a téma szerint átszínezzük
private let FOCUS_ZOOM = 15.6, FOLLOW_RESUME_MS = 4000.0, LABEL_SCALE = 1.25, LABEL_HALO_WIDTH = 2.0

private struct MapColors { var bg, water, building, buildingEdge, road, roadMajor, roadCasing, park, label, halo: String }
private let DARK_COLORS = MapColors(bg: "#1f2233", water: "#214a60", building: "#373d62", buildingEdge: "#636b9c", road: "#6f7799", roadMajor: "#b794f6", roadCasing: "#171a2a", park: "#28433c", label: "#eef0fa", halo: "#171a2a")
private let LIGHT_COLORS = MapColors(bg: "#e4dccb", water: "#9ccbd6", building: "#cfc2aa", buildingEdge: "#a39580", road: "#f6f0e2", roadMajor: "#f5c842", roadCasing: "#bdb3a0", park: "#c3d9b3", label: "#2c3347", halo: "#f1eadb")

private func ui(_ hex: String) -> UIColor { UIColor(Color(hex: hex)) }
private func scaleSize(_ v: Any, _ k: Double) -> Any {
    if let n = v as? NSNumber { return n.doubleValue * k }
    guard let arr = v as? [Any], let op = arr.first as? String else { return v }
    return arr.enumerated().map { i, x -> Any in
        let scale = op.hasPrefix("interpolate") ? (i >= 4 && i % 2 == 0) : (op == "step" ? (i >= 2 && i % 2 == 0) : false)
        return scale ? scaleSize(x, k) : x
    }
}
private var baseSizes: [String: Any] = [:]

/// A webes applyMapContrast portja: víz, épületek, parkok, utak, feliratok átszínezése a téma szerint; feliratok +25%.
func applyMapContrast(_ style: MLNStyle, dark: Bool) {
    let c = dark ? DARK_COLORS : LIGHT_COLORS
    for layer in style.layers {
        let id = layer.identifier
        if let l = layer as? MLNBackgroundStyleLayer { l.backgroundColor = NSExpression(forConstantValue: ui(c.bg)) }
        else if let l = layer as? MLNFillStyleLayer {
            if id == "water" { l.fillColor = NSExpression(forConstantValue: ui(c.water)) }
            if id == "building" { l.fillColor = NSExpression(forConstantValue: ui(c.building)); l.fillOutlineColor = NSExpression(forConstantValue: ui(c.buildingEdge)); l.fillOpacity = NSExpression(forConstantValue: 1) }
            if id == "landuse_park" || id == "landcover_wood" { l.fillColor = NSExpression(forConstantValue: ui(c.park)) }
        } else if let l = layer as? MLNLineStyleLayer, id.hasPrefix("highway_") || id.hasPrefix("road_") {
            l.lineColor = NSExpression(forConstantValue: ui(id.contains("casing") ? c.roadCasing : (id.contains("major") || id.contains("motorway")) ? c.roadMajor : c.road)); l.lineOpacity = NSExpression(forConstantValue: 1)
        } else if let l = layer as? MLNSymbolStyleLayer, l.text != nil {
            l.textColor = NSExpression(forConstantValue: ui(c.label)); l.textHaloColor = NSExpression(forConstantValue: ui(c.halo)); l.textHaloWidth = NSExpression(forConstantValue: LABEL_HALO_WIDTH)
            if baseSizes[id] == nil, let e = l.textFontSize { baseSizes[id] = e.mgl_jsonExpressionObject }
            if let base = baseSizes[id] { l.textFontSize = NSExpression(mglJSONObject: scaleSize(base, LABEL_SCALE)) }
        }
    }
}

// ───────── Jelölők (map-avatar) ─────────
private func markerImage(_ p: MapPerson, _ pal: Palette) -> UIImage {
    let size = CGSize(width: 48, height: 48)
    return UIGraphicsImageRenderer(size: size).image { ctx in
        let r = CGRect(origin: .zero, size: size)
        UIColor(pal.glassStrong).withAlphaComponent(1).setFill(); ctx.cgContext.fillEllipse(in: r.insetBy(dx: 1, dy: 1))
        let inner = r.insetBy(dx: 6, dy: 6)
        if let img = decodeDataURL(p.avatar) {
            ctx.cgContext.saveGState(); UIBezierPath(ovalIn: inner).addClip()
            let s = min(img.size.width, img.size.height)
            let rect = CGRect(x: inner.minX - (img.size.width - s) / 2 * inner.width / s, y: inner.minY - (img.size.height - s) / 2 * inner.height / s, width: img.size.width * inner.width / s, height: img.size.height * inner.height / s)
            img.draw(in: rect); ctx.cgContext.restoreGState()
        } else {
            let t = NSString(string: String((p.name.isEmpty ? "?" : p.name).prefix(1)).uppercased())
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 18, weight: .semibold), .foregroundColor: UIColor(pal.foreground)]
            let sz = t.size(withAttributes: attrs); t.draw(at: CGPoint(x: r.midX - sz.width / 2, y: r.midY - sz.height / 2), withAttributes: attrs)
        }
        UIColor(Color(hex: p.color)).setStroke(); let ring = UIBezierPath(ovalIn: r.insetBy(dx: 1.5, dy: 1.5)); ring.lineWidth = 3; ring.stroke()
    }
}
private func arrowImage(_ color: String) -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: 74, height: 74)).image { _ in
        UIColor(Color(hex: color)).setFill(); let p = UIBezierPath(); p.move(to: CGPoint(x: 37, y: 0)); p.addLine(to: CGPoint(x: 42, y: 9)); p.addLine(to: CGPoint(x: 32, y: 9)); p.close(); p.fill()
    }
}

private struct MState { var lat: Double, lng: Double, key: String; var from: CLLocationCoordinate2D?; var to: CLLocationCoordinate2D?; var start = 0.0; var dur = 0.0 }

struct LiveMapView: UIViewRepresentable {
    @Environment(\.pal) private var pal
    var people: [MapPerson]; var follow: FollowReq?; var showTrails: Bool; var trailIds: [String]; var orientation: String; var dark: Bool
    var window: CGRect; var bridge: MapBridge

    func makeCoordinator() -> Coordinator { Coordinator(bridge) }
    func makeUIView(context: Context) -> VeilContainer {
        let v = VeilContainer(); let c = context.coordinator
        v.map.delegate = c; v.map.logoView.isHidden = true; v.map.compassView.isHidden = true
        v.map.allowsRotating = false; v.map.allowsTilting = false; v.map.minimumZoomLevel = 2
        v.map.setCenter(CLLocationCoordinate2D(latitude: 47.4979, longitude: 19.0402), zoomLevel: 12, animated: false)
        v.map.addGestureRecognizer(UITapGestureRecognizer(target: c, action: #selector(Coordinator.tapped(_:))))
        c.view = v; c.start()
        bridge.center = { [weak v] in v?.map.centerCoordinate }
        return v
    }
    func updateUIView(_ v: VeilContainer, context: Context) {
        let c = context.coordinator
        c.people = people; c.follow = follow; c.showTrails = showTrails; c.trailIds = trailIds; c.orientation = orientation; c.pal = pal
        v.update(window: window, dark: dark, pal: pal)
        if c.dark != dark { c.dark = dark; c.loadStyle(v.map) }
        if c.lastRequest != follow?.request { c.lastRequest = follow?.request; c.holdUntil = 0; c.flying = false }
        c.sync()
    }
    static func dismantleUIView(_ v: VeilContainer, coordinator: Coordinator) { coordinator.stop() }

    /// A térkép + elmosott „veil” a térképablakon kívül (a webes clip-path: evenodd + backdrop-filter megfelelője).
    final class VeilContainer: UIView {
        let map = MLNMapView(frame: .zero)
        private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        private let tint = UIView(); private let gradient = CAGradientLayer()
        private let maskLayer = CAShapeLayer(); private let maskLayer2 = CAShapeLayer()
        private var win = CGRect.zero
        override init(frame: CGRect) {
            super.init(frame: frame)
            addSubview(map); addSubview(blur); addSubview(tint)
            blur.isUserInteractionEnabled = false; tint.isUserInteractionEnabled = false
            maskLayer.fillRule = .evenOdd; maskLayer2.fillRule = .evenOdd
            blur.layer.mask = maskLayer; tint.layer.mask = maskLayer2
        }
        required init?(coder: NSCoder) { fatalError() }
        override func layoutSubviews() { super.layoutSubviews(); map.frame = bounds; blur.frame = bounds; tint.frame = bounds; relayout() }
        func update(window: CGRect, dark: Bool, pal: Palette) {
            win = window
            blur.effect = UIBlurEffect(style: dark ? .systemUltraThinMaterialDark : .systemUltraThinMaterialLight)
            tint.backgroundColor = UIColor(pal.veilColor).withAlphaComponent(0.38)
            relayout()
        }
        private func relayout() {
            guard win.width > 0 else { return }
            let path = UIBezierPath(rect: bounds); path.append(UIBezierPath(roundedRect: win, cornerRadius: 28)); path.usesEvenOddFillRule = true
            maskLayer.path = path.cgPath; maskLayer2.path = path.cgPath
            // a kamera középpontja a térképablak közepe legyen
            map.contentInset = UIEdgeInsets(top: win.minY, left: win.minX, bottom: max(0, bounds.height - win.maxY), right: max(0, bounds.width - win.maxX))
        }
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var bridge: MapBridge; weak var view: VeilContainer?
        var people: [MapPerson] = [], follow: FollowReq?, showTrails = false, trailIds: [String] = [], orientation = "north"
        var pal = darkPalette; var dark: Bool?; var ready = false; var lastRequest: Int?
        var flying = false, holdUntil = 0.0, didCenter = false
        private var markers: [String: MState] = [:], headings: [String: Double] = [:], images = Set<String>()
        private var link: CADisplayLink?; private var lastStep = 0.0
        init(_ b: MapBridge) { bridge = b }
        func start() { link = CADisplayLink(target: self, selector: #selector(step)); link?.add(to: .main, forMode: .common) }
        func stop() { link?.invalidate(); link = nil }

        func loadStyle(_ m: MLNMapView) { ready = false; images = []; m.styleURL = URL(string: MAP_STYLE_URL) }
        func mapView(_ m: MLNMapView, didFinishLoading style: MLNStyle) {
            applyMapContrast(style, dark: dark ?? true)
            let trails = MLNShapeSource(identifier: "trails", shape: nil, options: nil), people = MLNShapeSource(identifier: "people", shape: nil, options: nil), pulse = MLNShapeSource(identifier: "self-pulse", shape: nil, options: nil)
            style.addSource(trails); style.addSource(people); style.addSource(pulse)
            for (id, w, o, b) in [("trails-glow", 13.0, 0.28, 5.0), ("trails", 4.0, 0.96, 0.15)] {
                let l = MLNLineStyleLayer(identifier: id, source: trails)
                l.lineColor = NSExpression(forKeyPath: "color"); l.lineWidth = NSExpression(forConstantValue: w); l.lineOpacity = NSExpression(forConstantValue: o); l.lineBlur = NSExpression(forConstantValue: b)
                l.lineCap = NSExpression(forConstantValue: "round"); l.lineJoin = NSExpression(forConstantValue: "round"); style.addLayer(l)
            }
            let pl = MLNCircleStyleLayer(identifier: "self-pulse", source: pulse); pl.circleColor = NSExpression(forConstantValue: UIColor(Color(hex: "#14B8A6")))
            pl.circleRadius = NSExpression(forConstantValue: 24); pl.circleOpacity = NSExpression(forConstantValue: 0); style.addLayer(pl)
            let ar = MLNSymbolStyleLayer(identifier: "people-arrows", source: people); ar.iconImageName = NSExpression(forKeyPath: "arrow"); ar.iconRotation = NSExpression(forKeyPath: "rot")
            ar.iconRotationAlignment = NSExpression(forConstantValue: "map"); ar.iconAllowsOverlap = NSExpression(forConstantValue: true); ar.iconIgnoresPlacement = NSExpression(forConstantValue: true); style.addLayer(ar)
            let ic = MLNSymbolStyleLayer(identifier: "people-icons", source: people); ic.iconImageName = NSExpression(forKeyPath: "img")
            ic.iconAllowsOverlap = NSExpression(forConstantValue: true); ic.iconIgnoresPlacement = NSExpression(forConstantValue: true); style.addLayer(ic)
            ready = true; sync()
        }
        func mapView(_ m: MLNMapView, regionWillChangeWith reason: MLNCameraChangeReason, animated: Bool) {
            if !reason.contains(.programmatic) && !reason.contains(.transitionCancelled) { holdUntil = .infinity }
        }
        func mapViewRegionIsChanging(_ m: MLNMapView) { DispatchQueue.main.async { self.bridge.compassRot = -m.direction } }
        func mapViewDidBecomeIdle(_ m: MLNMapView) { flying = false; if holdUntil == .infinity { holdUntil = Date().timeIntervalSince1970 * 1000 + FOLLOW_RESUME_MS } }
        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let m = view?.map else { return }
            let f = m.visibleFeatures(at: g.location(in: m), styleLayerIdentifiers: ["people-icons"]).first
            let id = f?.attribute(forKey: "id") as? String
            bridge.selected = (id == nil || id == bridge.selected) ? nil : id
        }

        /// Új adatok: jelölők, képek, nyomvonalak.
        func sync() {
            guard ready, let m = view?.map, let style = m.style else { return }
            let alive = Set(people.map { $0.id }); markers = markers.filter { alive.contains($0.key) }; headings = headings.filter { alive.contains($0.key) }
            let now = Date().timeIntervalSince1970 * 1000
            for p in people {
                guard let last = p.points.last else { continue }
                let key = "\(p.avatar?.hashValue ?? 0)|\(p.name)|\(p.color)|\(dark ?? true)"
                if let h = p.heading ?? headingFromTrack(p.points.map { LatLng(lat: $0.lat, lng: $0.lng) }) { headings[p.id] = h }
                if !images.contains("p:" + key) { style.setImage(markerImage(p, pal), forName: "p:" + key); images.insert("p:" + key) }
                if !images.contains("a:" + p.color) { style.setImage(arrowImage(p.color), forName: "a:" + p.color); images.insert("a:" + p.color) }
                if var s = markers[p.id] {
                    s.key = key
                    let target = s.to ?? CLLocationCoordinate2D(latitude: s.lat, longitude: s.lng)
                    if abs(target.latitude - last.lat) > 1e-9 || abs(target.longitude - last.lng) > 1e-9 {
                        s.from = CLLocationCoordinate2D(latitude: s.lat, longitude: s.lng); s.to = CLLocationCoordinate2D(latitude: last.lat, longitude: last.lng); s.start = now
                        s.dur = Double(animationDurationMs(p.points.count > 1 ? p.points[p.points.count - 2].t : nil, last.t))
                    }
                    markers[p.id] = s
                } else { markers[p.id] = MState(lat: last.lat, lng: last.lng, key: key) }
            }
            let feats: [[String: Any]] = (showTrails || !trailIds.isEmpty ? people.filter { (showTrails || trailIds.contains($0.id)) && $0.points.count > 1 } : []).map {
                ["type": "Feature", "properties": ["color": $0.color], "geometry": ["type": "LineString", "coordinates": $0.points.map { [$0.lng, $0.lat] }]] }
            (style.source(withIdentifier: "trails") as? MLNShapeSource)?.shape = shape(feats)
            if !didCenter, let me = people.first(where: { $0.isSelf && !$0.points.isEmpty })?.points.last {
                didCenter = true; flying = true
                m.setCenter(CLLocationCoordinate2D(latitude: me.lat, longitude: me.lng), zoomLevel: FOCUS_ZOOM, animated: true)
            }
        }
        private func shape(_ f: [[String: Any]]) -> MLNShape? {
            guard let d = try? JSONSerialization.data(withJSONObject: ["type": "FeatureCollection", "features": f]) else { return nil }
            return try? MLNShape(data: d, encoding: String.Encoding.utf8.rawValue)
        }

        /// A webes step(): animáció, követés, északra simítás, buborék helye.
        @objc func step() {
            guard ready, let m = view?.map, let style = m.style else { return }
            let nowMs = Date().timeIntervalSince1970 * 1000
            let animating = markers.values.contains { $0.to != nil }
            let idle = !animating && follow == nil && !flying && !(orientation == "north" && abs(m.direction) > 0.05)
            if idle && bridge.selected == nil && nowMs - lastStep < 66 { return }
            lastStep = nowMs
            for (id, var s) in markers { guard let to = s.to, let from = s.from else { continue }
                let k = min(1, max(0, (nowMs - s.start) / max(1, s.dur)))
                let pos = lerpPoint(LatLng(lat: from.latitude, lng: from.longitude), LatLng(lat: to.latitude, lng: to.longitude), k)
                s.lat = pos.lat; s.lng = pos.lng; if k >= 1 { s.to = nil; s.from = nil }; markers[id] = s }
            let bearing = m.direction
            var feats: [[String: Any]] = []; var selfPos: MState?
            for p in people { guard let s = markers[p.id] else { continue }
                if p.isSelf { selfPos = s }
                feats.append(["type": "Feature", "geometry": ["type": "Point", "coordinates": [s.lng, s.lat]],
                              "properties": ["id": p.id, "img": "p:" + s.key, "arrow": "a:" + p.color, "rot": (orientation == "heading" && headings[p.id] != nil) ? headings[p.id]! - bearing : -1000.0]]) }
            (style.source(withIdentifier: "people") as? MLNShapeSource)?.shape = shape(feats)
            if let sp = selfPos, let layer = style.layer(withIdentifier: "self-pulse") as? MLNCircleStyleLayer {
                let k = (nowMs.truncatingRemainder(dividingBy: 2200)) / 2200
                (style.source(withIdentifier: "self-pulse") as? MLNShapeSource)?.shape = shape([["type": "Feature", "geometry": ["type": "Point", "coordinates": [sp.lng, sp.lat]], "properties": [:]]])
                layer.circleRadius = NSExpression(forConstantValue: 24 + 14 * k); layer.circleOpacity = NSExpression(forConstantValue: 0.5 * (1 - k))
            }
            if let id = bridge.selected, let s = markers[id] {
                let pt = m.convert(CLLocationCoordinate2D(latitude: s.lat, longitude: s.lng), toPointTo: m)
                DispatchQueue.main.async { self.bridge.bubblePos = pt; self.bridge.bubbleBelow = pt.y < 110 + (m.contentInset.top) }
            } else if bridge.bubblePos != nil { DispatchQueue.main.async { self.bridge.bubblePos = nil } }
            if flying { return }
            if let f = follow {
                guard let s = markers[f.id] else { return }
                let target = orientation == "heading" ? (headings[f.id] ?? bearing) : 0
                if holdUntil != 0 {
                    if nowMs < holdUntil { return }
                    holdUntil = 0; flying = true
                    m.setCenter(CLLocationCoordinate2D(latitude: s.lat, longitude: s.lng), zoomLevel: m.zoomLevel, direction: target, animated: true); return
                }
                let nb = abs(target - bearing) < 0.05 ? target : smoothAngle(bearing, target, 0.07)
                let c = m.centerCoordinate
                if abs(c.latitude - s.lat) > 1e-8 || abs(c.longitude - s.lng) > 1e-8 || nb != bearing {
                    m.setCenter(CLLocationCoordinate2D(latitude: s.lat, longitude: s.lng), zoomLevel: m.zoomLevel, direction: nb, animated: false)
                }
            } else if orientation == "north" && abs(bearing) > 0.05 { m.direction = smoothAngle(bearing, 0, 0.12) }
        }
    }
}
