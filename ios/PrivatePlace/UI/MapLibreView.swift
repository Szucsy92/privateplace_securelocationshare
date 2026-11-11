import SwiftUI
import MapLibre

struct MapMarker: Equatable { var id: String, label: String, color: String, at: LatLng, faded = false }
struct MapTrail: Equatable { var id: String, color: String, points: [TrackPoint] }

/// MapLibre Native (iOS) SwiftUI-ba ágyazva; a jelölők és nyomvonalak GeoJSON-forrásból, egyetlen rétegen rajzolódnak.
struct MapLibreView: UIViewRepresentable {
    var markers: [MapMarker], trails: [MapTrail], dark: Bool
    var follow: LatLng?, followTick: Int, bearing: Double?
    var onTap: (String?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> MLNMapView {
        let m = MLNMapView(frame: .zero)
        m.delegate = context.coordinator; m.logoView.isHidden = true; m.compassView.isHidden = true
        m.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:))))
        context.coordinator.apply(dark: dark, to: m)
        return m
    }
    func updateUIView(_ m: MLNMapView, context: Context) {
        let c = context.coordinator; c.parent = self
        if c.dark != dark { c.apply(dark: dark, to: m) }
        c.pushData(m)
        if follow != nil && (c.lastTick != followTick || c.lastFollow != follow) {
            c.lastTick = followTick; c.lastFollow = follow
            m.setCenter(CLLocationCoordinate2D(latitude: follow!.lat, longitude: follow!.lng), zoomLevel: max(m.zoomLevel, 16), direction: bearing ?? 0, animated: true)
        }
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var parent: MapLibreView; var dark: Bool?; var ready = false; var lastTick = -1; var lastFollow: LatLng?
        init(_ p: MapLibreView) { parent = p }
        func apply(dark: Bool, to m: MLNMapView) {
            self.dark = dark; ready = false
            m.styleURL = URL(string: dark ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/positron")
        }
        func mapView(_ m: MLNMapView, didFinishLoading style: MLNStyle) {
            let trails = MLNShapeSource(identifier: "trails", shape: nil, options: nil), people = MLNShapeSource(identifier: "people", shape: nil, options: nil)
            style.addSource(trails); style.addSource(people)
            let lines = MLNLineStyleLayer(identifier: "trail-lines", source: trails)
            lines.lineColor = NSExpression(forKeyPath: "color"); lines.lineWidth = NSExpression(forConstantValue: 3); lines.lineOpacity = NSExpression(forConstantValue: 0.7)
            style.addLayer(lines)
            let circles = MLNCircleStyleLayer(identifier: "people-circles", source: people)
            circles.circleRadius = NSExpression(forConstantValue: 12); circles.circleColor = NSExpression(forKeyPath: "color")
            circles.circleStrokeColor = NSExpression(forConstantValue: UIColor.white); circles.circleStrokeWidth = NSExpression(forConstantValue: 2.5)
            circles.circleOpacity = NSExpression(forKeyPath: "opacity")
            style.addLayer(circles)
            let labels = MLNSymbolStyleLayer(identifier: "people-labels", source: people)
            labels.text = NSExpression(forKeyPath: "label"); labels.textFontSize = NSExpression(forConstantValue: 11)
            labels.textFontNames = NSExpression(forConstantValue: ["Noto Sans Regular"]); labels.textOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0, dy: 2.1)))
            labels.textColor = NSExpression(forConstantValue: parent.dark ? UIColor(white: 0.9, alpha: 1) : UIColor(red: 0.04, green: 0.08, blue: 0.15, alpha: 1))
            labels.textHaloColor = NSExpression(forConstantValue: parent.dark ? UIColor(red: 0.04, green: 0.08, blue: 0.15, alpha: 1) : UIColor.white); labels.textHaloWidth = NSExpression(forConstantValue: 1.4)
            style.addLayer(labels)
            ready = true; pushData(m)
        }
        func pushData(_ m: MLNMapView) {
            guard ready, let style = m.style else { return }
            func shape(_ features: [[String: Any]]) -> MLNShape? {
                guard let d = try? JSONSerialization.data(withJSONObject: ["type": "FeatureCollection", "features": features]) else { return nil }
                return try? MLNShape(data: d, encoding: String.Encoding.utf8.rawValue)
            }
            let people = parent.markers.map { ["type": "Feature", "geometry": ["type": "Point", "coordinates": [$0.at.lng, $0.at.lat]],
                                               "properties": ["id": $0.id, "label": $0.label, "color": $0.color, "opacity": $0.faded ? 0.45 : 1.0]] as [String: Any] }
            let lines = parent.trails.filter { $0.points.count >= 2 }.map { ["type": "Feature", "geometry": ["type": "LineString", "coordinates": $0.points.map { [$0.lng, $0.lat] }],
                                                                           "properties": ["color": $0.color]] as [String: Any] }
            (style.source(withIdentifier: "people") as? MLNShapeSource)?.shape = shape(people)
            (style.source(withIdentifier: "trails") as? MLNShapeSource)?.shape = shape(lines)
        }
        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let m = g.view as? MLNMapView else { return }
            let f = m.visibleFeatures(at: g.location(in: m), styleLayerIdentifiers: ["people-circles"]).first
            parent.onTap(f?.attribute(forKey: "id") as? String)
        }
    }
}
