package hu.privateplace.app.ui

import android.view.MotionEvent
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import hu.privateplace.app.domain.LatLng as LL
import hu.privateplace.app.domain.TrackPoint
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression.get
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource

data class MapMarker(val id: String, val label: String, val color: String, val at: LL, val self: Boolean, val faded: Boolean = false)
data class MapTrail(val id: String, val color: String, val points: List<TrackPoint>)

const val STYLE_DARK = "https://tiles.openfreemap.org/styles/dark"
const val STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron"

/** MapLibre Native Compose-ba ágyazva; a jelölők és nyomvonalak GeoJSON-forrásból rajzolódnak (egyetlen réteg, nem nézetenként). */
@Composable
fun MapLibreView(
    markers: List<MapMarker>, trails: List<MapTrail>, dark: Boolean,
    follow: LL?, followTick: Int, bearing: Double?, onTapMarker: (String?) -> Unit, modifier: Modifier = Modifier,
) {
    val ctx = LocalContext.current; val owner = LocalLifecycleOwner.current
    val mapView = remember { MapLibre.getInstance(ctx); MapView(ctx) }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var styleReady by remember { mutableStateOf(false) }
    val tap by rememberUpdatedState(onTapMarker)

    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> when (e) {
            Lifecycle.Event.ON_START -> mapView.onStart(); Lifecycle.Event.ON_RESUME -> mapView.onResume()
            Lifecycle.Event.ON_PAUSE -> mapView.onPause(); Lifecycle.Event.ON_STOP -> mapView.onStop()
            Lifecycle.Event.ON_DESTROY -> mapView.onDestroy(); else -> {} } }
        owner.lifecycle.addObserver(obs)
        mapView.onCreate(null)
        if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) mapView.onStart()
        if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) mapView.onResume()
        onDispose { owner.lifecycle.removeObserver(obs) }
    }

    LaunchedEffect(Unit) {
        mapView.getMapAsync { m ->
            map = m
            m.uiSettings.isLogoEnabled = false; m.uiSettings.isAttributionEnabled = true; m.uiSettings.isCompassEnabled = false
            m.addOnMapClickListener { p ->
                val px = m.projection.toScreenLocation(p)
                val f = m.queryRenderedFeatures(px, "people-circles").firstOrNull()
                tap(f?.getStringProperty("id")); true
            }
        }
    }

    LaunchedEffect(map, dark) {
        val m = map ?: return@LaunchedEffect
        styleReady = false
        m.setStyle(Style.Builder().fromUri(if (dark) STYLE_DARK else STYLE_LIGHT)) { s ->
            s.addSource(GeoJsonSource("trails")); s.addSource(GeoJsonSource("people"))
            s.addLayer(LineLayer("trail-lines", "trails").withProperties(lineColor(get("color")), lineWidth(3f), lineOpacity(0.7f)))
            s.addLayer(CircleLayer("people-circles", "people").withProperties(circleRadius(12f), circleColor(get("color")),
                circleStrokeColor("#FFFFFF"), circleStrokeWidth(2.5f), circleOpacity(get("opacity"))))
            s.addLayer(SymbolLayer("people-labels", "people").withProperties(textField(get("label")), textSize(11f), textFont(arrayOf("Noto Sans Regular")),
                textOffset(arrayOf(0f, 2.1f)), textColor(if (dark) "#E2E8F0" else "#0B1425"), textHaloColor(if (dark) "#0B1425" else "#FFFFFF"), textHaloWidth(1.4f)))
            styleReady = true
        }
    }

    LaunchedEffect(markers, trails, styleReady) {
        val s = map?.style ?: return@LaunchedEffect
        if (!styleReady) return@LaunchedEffect
        val people = JSONObject().put("type", "FeatureCollection").put("features", JSONArray(markers.map {
            JSONObject().put("type", "Feature").put("geometry", JSONObject().put("type", "Point").put("coordinates", JSONArray(listOf(it.at.lng, it.at.lat))))
                .put("properties", JSONObject().put("id", it.id).put("label", it.label).put("color", it.color).put("opacity", if (it.faded) 0.45 else 1.0)) }))
        val lines = JSONObject().put("type", "FeatureCollection").put("features", JSONArray(trails.filter { it.points.size >= 2 }.map { t ->
            JSONObject().put("type", "Feature").put("geometry", JSONObject().put("type", "LineString").put("coordinates", JSONArray(t.points.map { JSONArray(listOf(it.lng, it.lat)) })))
                .put("properties", JSONObject().put("color", t.color)) }))
        (s.getSource("people") as? GeoJsonSource)?.setGeoJson(people.toString())
        (s.getSource("trails") as? GeoJsonSource)?.setGeoJson(lines.toString())
    }

    // Követés: minden kérés (followTick) újra középre állít, a követett pont mozgását is követi
    LaunchedEffect(follow, followTick, bearing) {
        val m = map ?: return@LaunchedEffect
        val t = follow ?: return@LaunchedEffect
        val pos = CameraPosition.Builder().target(LatLng(t.lat, t.lng)).zoom(maxOf(m.cameraPosition.zoom, 16.0)).bearing(bearing ?: 0.0).build()
        m.animateCamera(CameraUpdateFactory.newCameraPosition(pos), 800)
    }

    AndroidView(factory = { mapView }, modifier = modifier)
}
