package hu.privateplace.app.ui

import android.content.Context
import android.graphics.*
import android.os.Build
import android.view.MotionEvent
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import hu.privateplace.app.PrivatePlaceApp
import hu.privateplace.app.domain.*
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng as MLatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.expressions.Expression.get
import org.maplibre.android.style.layers.*
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.sources.GeoJsonSource
import kotlin.math.abs
import kotlin.math.roundToInt

data class MapPerson(
    val id: String, val name: String, val avatar: String?, val color: String, val points: List<TrackPoint>, val isSelf: Boolean = false,
    val heading: Double? = null, val battery: Int? = null, val stoppedSince: Long? = null, val speed: Double? = null,
)
class FollowReq(val id: String, val request: Int)
/** A térképablak kamerája: a háttérben lévő elmosott (zárt) térkép ezt követi. */
class SharedCamera { var lat by mutableDoubleStateOf(47.4979); var lng by mutableDoubleStateOf(19.0402); var zoom by mutableDoubleStateOf(12.0); var bearing by mutableDoubleStateOf(0.0) }

const val MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark"   // ugyanaz a stílus, mint a webes verzióban; a színeket a téma szerint átszínezzük
private const val FOCUS_ZOOM = 15.6
private const val FOLLOW_RESUME_MS = 4000L
private const val TRAIL_GAP_MS = 30_000L   // ennél hosszabb mérés nélküli szakaszt nem kötünk össze egyenes vonallal
private fun trailSegments(pts: List<TrackPoint>): List<List<TrackPoint>> {
    val out = ArrayList<List<TrackPoint>>(); var cur = ArrayList<TrackPoint>()
    for (p in pts) { if (cur.isNotEmpty() && p.t - cur.last().t > TRAIL_GAP_MS) { if (cur.size > 1) out.add(cur); cur = ArrayList() }; cur.add(p) }
    if (cur.size > 1) out.add(cur)
    return out
}
private const val LABEL_SCALE = 1.25f
private const val LABEL_HALO_WIDTH = 2f

// ───────── Térképszínek (styles.css --map-*) ─────────
private class MapColors(val bg: String, val water: String, val building: String, val buildingEdge: String, val road: String, val roadMajor: String,
                        val roadCasing: String, val park: String, val label: String, val halo: String)
private val DARK_COLORS = MapColors("#1f2233", "#214a60", "#373d62", "#636b9c", "#6f7799", "#b794f6", "#171a2a", "#28433c", "#eef0fa", "#171a2a")
private val LIGHT_COLORS = MapColors("#e4dccb", "#9ccbd6", "#cfc2aa", "#a39580", "#f6f0e2", "#f5c842", "#bdb3a0", "#c3d9b3", "#2c3347", "#f1eadb")

private val baseTextSize = HashMap<String, Any?>()

private fun toJson(o: Any?): Any? = when (o) { is Array<*> -> JSONArray().also { a -> o.forEach { a.put(toJson(it)) } }; else -> o }
private fun scaleTextSize(size: Any?, k: Float): Any? {
    if (size is Number) return size.toFloat() * k
    if (size is JSONArray) {
        val op = size.optString(0)
        val out = JSONArray()
        for (i in 0 until size.length()) {
            val x = size.get(i)
            val scale = when { op.startsWith("interpolate") -> i >= 4 && i % 2 == 0; op == "step" -> i >= 2 && i % 2 == 0; else -> false }
            out.put(if (scale) scaleTextSize(x, k) else x)
        }
        return out
    }
    return size
}

/** A webes applyMapContrast portja: víz, épületek, parkok, utak, feliratok átszínezése a téma szerint; feliratok +25%. */
fun applyMapContrast(style: Style, dark: Boolean) {
    val c = if (dark) DARK_COLORS else LIGHT_COLORS
    for (layer in style.layers) {
        val id = layer.id
        runCatching {
            when (layer) {
                is BackgroundLayer -> layer.setProperties(backgroundColor(c.bg))
                is FillLayer -> {
                    if (id == "water") layer.setProperties(fillColor(c.water))
                    if (id == "building") layer.setProperties(fillColor(c.building), fillOutlineColor(c.buildingEdge), fillOpacity(1f))
                    if (id == "landuse_park" || id == "landcover_wood") layer.setProperties(fillColor(c.park))
                }
                is LineLayer -> if (id.startsWith("highway_") || id.startsWith("road_"))
                    layer.setProperties(lineColor(if (id.contains("casing")) c.roadCasing else if (id.contains("major") || id.contains("motorway")) c.roadMajor else c.road), lineOpacity(1f))
                is SymbolLayer -> if (!layer.textField.isNull) {
                    layer.setProperties(textColor(c.label), textHaloColor(c.halo), textHaloWidth(LABEL_HALO_WIDTH))
                    if (!baseTextSize.containsKey(id)) {
                        val ts = layer.textSize
                        baseTextSize[id] = if (ts.isExpression) JSONArray(toJson(ts.expression!!.toArray()).toString()) else if (ts.isValue) ts.value else null
                    }
                    when (val scaled = scaleTextSize(baseTextSize[id], LABEL_SCALE)) {
                        is Float -> layer.setProperties(textSize(scaled))
                        is JSONArray -> layer.setProperties(textSize(Expression.raw(scaled.toString())))
                    }
                }
                else -> {}
            }
        }
    }
}

@Composable
fun rememberMapView(): MapView {
    val ctx = LocalContext.current; val owner = LocalLifecycleOwner.current
    val view = remember {
        MapLibre.getInstance(ctx)
        MapView(ctx, MapLibreMapOptions.createFromAttributes(ctx).textureMode(true).logoEnabled(false).compassEnabled(false).rotateGesturesEnabled(false).tiltGesturesEnabled(false))
    }
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> when (e) {
            Lifecycle.Event.ON_START -> view.onStart(); Lifecycle.Event.ON_RESUME -> view.onResume()
            Lifecycle.Event.ON_PAUSE -> view.onPause(); Lifecycle.Event.ON_STOP -> view.onStop(); Lifecycle.Event.ON_DESTROY -> view.onDestroy(); else -> {} } }
        owner.lifecycle.addObserver(obs); view.onCreate(null)
        val st = owner.lifecycle.currentState
        if (st.isAtLeast(Lifecycle.State.STARTED)) view.onStart(); if (st.isAtLeast(Lifecycle.State.RESUMED)) view.onResume()
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    return view
}

private data class CamState(val lat: Double, val lng: Double, val zoom: Double, val bearing: Double)

/** A térképablakon kívül látható elmosott háttér: ugyanaz a térkép, a térképablak kameráját követi (a webes „veil” + tükör-canvas megfelelője). */
@Composable
fun BlurredBackdrop(cam: SharedCamera, dark: Boolean, window: IntArray?, modifier: Modifier = Modifier) {
    val view = rememberMapView()
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    LaunchedEffect(Unit) { view.getMapAsync { m -> m.uiSettings.setAllGesturesEnabled(false); m.uiSettings.isAttributionEnabled = false; map = m } }
    LaunchedEffect(map, dark) { map?.setStyle(Style.Builder().fromUri(MAP_STYLE_URL)) { applyMapContrast(it, dark) } }
    LaunchedEffect(map, window) { val w = window; if (map != null && w != null) map!!.setPadding(w[0], w[1], w[2], w[3]) }
    // A kamera állapotát snapshotFlow-n át olvassuk: így a háttér nem rekomponálódik és a korutin nem indul újra minden képkockán,
    // a mozgás pedig ugyanabban a ritmusban követi a térképablakot (zoomnál nincs kései, "ugráló" háttér).
    LaunchedEffect(map) {
        val m = map ?: return@LaunchedEffect
        snapshotFlow { CamState(cam.lat, cam.lng, cam.zoom, cam.bearing) }.collect { c ->
            m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder().target(MLatLng(c.lat, c.lng)).zoom(c.zoom).bearing(c.bearing).build()))
        }
    }
    AndroidView({ view }, modifier)
}

/** Egy jelölő állapota. A képernyő-koordináta és a forgatás Compose-állapot, de csak a layout/rajzolási fázisban olvassuk, ezért nem rekomponál. */
internal class MState(var lat: Double, var lng: Double, var key: String, var animFrom: MLatLng? = null, var animTo: MLatLng? = null, var animStart: Long = 0, var animDur: Long = 0) {
    var sx by mutableFloatStateOf(HIDDEN)
    var sy by mutableFloatStateOf(HIDDEN)
    var rot by mutableFloatStateOf(Float.NaN)
}
internal const val HIDDEN = -10000f

@Composable
fun LiveMap(
    people: List<MapPerson>, follow: FollowReq?, showTrails: Boolean, trailIds: List<String>, orientation: String, dark: Boolean,
    cam: SharedCamera, onCompass: (Float) -> Unit, addressAllowed: Boolean, onAllowAddress: () -> Unit, modifier: Modifier = Modifier,
    centerRef: MutableState<(() -> MLatLng?)?>? = null,
) {
    val ctx = LocalContext.current; val palette = pal; val fonts = LocalFonts.current
    val view = rememberMapView()
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var ready by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<String?>(null) }
    var bubblePos by remember { mutableStateOf<IntOffset?>(null) }
    var bubbleBelow by remember { mutableStateOf(false) }
    val markers = remember { mutableStateMapOf<String, MState>() }
    val headings = remember { HashMap<String, Double>() }
    var flying by remember { mutableStateOf(false) }
    var camMoving by remember { mutableStateOf(false) }
    var holdUntil by remember { mutableLongStateOf(0L) }
    var didCenter by remember { mutableStateOf(false) }
    val peopleNow by rememberUpdatedState(people); val followNow by rememberUpdatedState(follow); val orientNow by rememberUpdatedState(orientation)
    val selectedNow by rememberUpdatedState(selected)
    val engine = remember { (ctx.applicationContext as PrivatePlaceApp).graph.engine }
    fun headingOf(id: String, self: Boolean): Double? = if (self) engine.liveHeading ?: headings[id] else headings[id]

    LaunchedEffect(Unit) {
        // Követés közben az érintés azonnal leállítja a kamera-követést (különben a képkockánkénti moveCamera visszaugrasztja a térképet az ujj alól,
        // és a görgetés / nagyítás nem megy); az ujj felemelése után FOLLOW_RESUME_MS múlva folytatódik a követés. Az eseményt nem nyeljük el.
        view.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> holdUntil = Long.MAX_VALUE
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> holdUntil = System.currentTimeMillis() + FOLLOW_RESUME_MS
            }
            false
        }
        view.getMapAsync { m ->
            m.uiSettings.apply { isRotateGesturesEnabled = false; isTiltGesturesEnabled = false; isCompassEnabled = false; isLogoEnabled = false; isAttributionEnabled = true
                // (i) gomb: a térképkártya jobb alsó sarkában, a jobb és az alsó széltől egyenlő belső margóval
                val edge = (16 * ctx.resources.displayMetrics.density).toInt()
                attributionGravity = android.view.Gravity.BOTTOM or android.view.Gravity.END
                setAttributionMargins(0, 0, edge, edge)
            }
            m.setMinZoomPreference(2.0)
            m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder().target(MLatLng(47.4979, 19.0402)).zoom(12.0).build()))
            m.addOnCameraMoveStartedListener { reason ->
                camMoving = true
                if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) holdUntil = Long.MAX_VALUE
            }
            m.addOnCameraMoveListener {
                val c = m.cameraPosition; cam.lat = c.target!!.latitude; cam.lng = c.target!!.longitude; cam.zoom = c.zoom; cam.bearing = c.bearing; onCompass((-c.bearing).toFloat())
            }
            m.addOnCameraIdleListener { camMoving = false; flying = false; if (holdUntil == Long.MAX_VALUE) holdUntil = System.currentTimeMillis() + FOLLOW_RESUME_MS }
            // a jelölők Compose-rétegben ülnek a térkép fölött, a rájuk koppintást ők maguk kezelik
            m.addOnMapClickListener { selected = null; true }
            centerRef?.value = { m.cameraPosition.target }
            map = m
        }
    }
    LaunchedEffect(map, dark) {
        val m = map ?: return@LaunchedEffect
        ready = false
        m.setStyle(Style.Builder().fromUri(MAP_STYLE_URL)) { style ->
            applyMapContrast(style, dark)
            style.addSource(GeoJsonSource("trails"))
            style.addLayer(LineLayer("trails-glow", "trails").withProperties(lineColor(get("color")), lineWidth(13f), lineOpacity(0.28f), lineBlur(5f), lineCap("round"), lineJoin("round")))
            style.addLayer(LineLayer("trails", "trails").withProperties(lineColor(get("color")), lineWidth(4f), lineOpacity(0.96f), lineBlur(0.15f), lineCap("round"), lineJoin("round")))
            ready = true
        }
    }

    // Jelölők és nyomvonalak
    LaunchedEffect(people, ready, showTrails, trailIds, dark) {
        val m = map ?: return@LaunchedEffect; if (!ready) return@LaunchedEffect
        val style = m.style ?: return@LaunchedEffect
        val alive = people.map { it.id }.toSet()
        markers.keys.retainAll(alive); headings.keys.retainAll(alive)
        for (p in people) {
            val last = p.points.lastOrNull() ?: continue
            val key = "${p.avatar?.hashCode() ?: 0}|${p.name}|${p.color}|$dark"
            (p.heading ?: headingFromTrack(p.points))?.let { headings[p.id] = it }
            val s = markers[p.id]
            if (s == null) markers[p.id] = MState(last.lat, last.lng, key)
            else {
                s.key = key
                val target = s.animTo ?: MLatLng(s.lat, s.lng)
                if (abs(target.latitude - last.lat) > 1e-9 || abs(target.longitude - last.lng) > 1e-9) {
                    val prev = p.points.getOrNull(p.points.size - 2)
                    s.animFrom = MLatLng(s.lat, s.lng); s.animTo = MLatLng(last.lat, last.lng); s.animStart = System.nanoTime() / 1_000_000
                    s.animDur = animationDurationMs(prev?.t, last.t)
                }
            }
        }
        val trailFeatures = if (showTrails || trailIds.isNotEmpty()) people.filter { (showTrails || it.id in trailIds) && it.points.size > 1 }.map { p ->
            JSONObject().put("type", "Feature").put("properties", JSONObject().put("color", p.color))
                .put("geometry", JSONObject().put("type", "MultiLineString").put("coordinates", JSONArray(trailSegments(p.points).map { seg -> JSONArray(seg.map { JSONArray(listOf(it.lng, it.lat)) }) }))) } else emptyList()
        (style.getSource("trails") as? GeoJsonSource)?.setGeoJson(JSONObject().put("type", "FeatureCollection").put("features", JSONArray(trailFeatures)).toString())
        if (!didCenter) people.firstOrNull { it.isSelf && it.points.isNotEmpty() }?.points?.last()?.let {
            didCenter = true; flying = true
            m.animateCamera(CameraUpdateFactory.newLatLngZoom(MLatLng(it.lat, it.lng), FOCUS_ZOOM), 1600)
        }
    }

    // Animáció- és követési ciklus (a webes step())
    LaunchedEffect(map, ready) {
        val m = map ?: return@LaunchedEffect; if (!ready) return@LaunchedEffect
        var lastStep = 0L; var lastFrame = 0L
        while (true) withFrameMillis { nowMs ->
            val style = m.style ?: return@withFrameMillis
            var animating = false
            for (s in markers.values) if (s.animTo != null) { animating = true; break }
            val idle = !animating && !camMoving && followNow == null && !flying && !(orientNow == "north" && abs(m.cameraPosition.bearing) > 0.05)
            if (idle && selectedNow == null && nowMs - lastStep < 66) return@withFrameMillis
            lastStep = nowMs
            val dt = if (lastFrame == 0L) 16.0 else (nowMs - lastFrame).coerceIn(1L, 100L).toDouble(); lastFrame = nowMs
            val tNow = System.nanoTime() / 1_000_000
            for (s in markers.values) {
                val to = s.animTo ?: continue; val from = s.animFrom ?: continue
                val k = ((tNow - s.animStart).toDouble() / s.animDur).coerceIn(0.0, 1.0)
                val pos = lerpPoint(LatLng(from.latitude, from.longitude), LatLng(to.latitude, to.longitude), k)
                s.lat = pos.lat; s.lng = pos.lng
                if (k >= 1.0) { s.animTo = null; s.animFrom = null }
            }
            val bearing = m.cameraPosition.bearing
            // Jelölők: ugyanabban a képkockában vetítjük a képernyőre, mint ahogy a kamera áll, így nem késnek és nem vibrálnak
            for (p in peopleNow) {
                val s = markers[p.id] ?: continue
                val pt = m.projection.toScreenLocation(MLatLng(s.lat, s.lng))
                s.sx = pt.x; s.sy = pt.y
                val h = headingOf(p.id, p.isSelf)
                s.rot = if (orientNow == "heading" && h != null) (h - bearing).toFloat() else Float.NaN
            }
            // Buborék helye
            val sel = selectedNow?.let { markers[it] }
            if (sel != null) {
                val pt = m.projection.toScreenLocation(MLatLng(sel.lat, sel.lng)); bubblePos = IntOffset(pt.x.roundToInt(), pt.y.roundToInt()); bubbleBelow = pt.y < 110 * ctx.resources.displayMetrics.density
            } else bubblePos = null
            if (flying) return@withFrameMillis
            val f = followNow; val o = orientNow
            if (f != null) {
                val s = markers[f.id] ?: return@withFrameMillis
                val target = if (o == "heading") (headingOf(f.id, peopleNow.any { it.id == f.id && it.isSelf }) ?: bearing) else 0.0
                if (holdUntil != 0L) {
                    if (System.currentTimeMillis() < holdUntil) return@withFrameMillis
                    holdUntil = 0; flying = true
                    m.animateCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(m.cameraPosition).target(MLatLng(s.lat, s.lng)).bearing(target).build()), 900)
                    return@withFrameMillis
                }
                // Időalapú (képkocka-függetlenül egyenletes) simítás + 0,4°-os holttartomány: nincs lépcsőzés és remegés
                val nb = if (abs(angleDelta(bearing, target)) < 0.4) bearing else smoothAngle(bearing, target, 1 - Math.exp(-dt / 220.0))
                val c = m.cameraPosition.target!!
                if (abs(c.latitude - s.lat) > 1e-8 || abs(c.longitude - s.lng) > 1e-8 || nb != bearing)
                    m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(m.cameraPosition).target(MLatLng(s.lat, s.lng)).bearing(nb).build()))
            } else if (o == "north" && abs(bearing) > 0.05)
                m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(m.cameraPosition).bearing(smoothAngle(bearing, 0.0, 1 - Math.exp(-dt / 150.0))).build()))
        }
    }
    // Új követési kérés: lágy kameramozgással odacsúszik (a webes flyTo, 1,4 mp); a hold törlődik.
    // Zoom: 14,5 és 18 között megmarad, különben FOCUS_ZOOM.
    LaunchedEffect(follow?.request, follow?.id) {
        holdUntil = 0
        val f = followNow ?: run { flying = false; return@LaunchedEffect }
        val m = map; val s = markers[f.id]
        if (m == null || !ready || s == null) { flying = false; return@LaunchedEffect }
        val z = m.cameraPosition.zoom
        val target = if (orientNow == "heading") (headings[f.id] ?: m.cameraPosition.bearing) else 0.0
        flying = true
        m.animateCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder().target(MLatLng(s.lat, s.lng))
            .zoom(if (z < 14.5 || z > 18.0) FOCUS_ZOOM else z).bearing(target).build()), 1400)
    }

    Box(modifier) {
        AndroidView({ view }, Modifier.fillMaxSize())
        // Jelölők (profilkép, saját pulzáló gyűrű, irányjelző nyíl) a térkép fölött
        for (p in people) key(p.id) {
            markers[p.id]?.let { st -> MapMarker(p, st) { selected = if (selected == p.id) null else p.id } }
        }
        val bp = bubblePos; val sel = selected
        val person = people.firstOrNull { it.id == sel }
        if (bp != null && person != null) PersonBubbleHost(person, people.firstOrNull { it.isSelf }, bp, bubbleBelow, addressAllowed, onAllowAddress)
    }
}
