package hu.privateplace.app.ui

import android.content.Context
import android.graphics.*
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

/** A térképablakon kívül látható elmosott háttér: ugyanaz a térkép, a térképablak kameráját követi (a webes „veil” + tükör-canvas megfelelője). */
@Composable
fun BlurredBackdrop(cam: SharedCamera, dark: Boolean, window: IntArray?, modifier: Modifier = Modifier) {
    val view = rememberMapView()
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    LaunchedEffect(Unit) { view.getMapAsync { m -> m.uiSettings.setAllGesturesEnabled(false); m.uiSettings.isAttributionEnabled = false; map = m } }
    LaunchedEffect(map, dark) { map?.setStyle(Style.Builder().fromUri(MAP_STYLE_URL)) { applyMapContrast(it, dark) } }
    LaunchedEffect(map, window) { val w = window; if (map != null && w != null) map!!.setPadding(w[0], w[1], w[2], w[3]) }
    LaunchedEffect(map, cam.lat, cam.lng, cam.zoom, cam.bearing) {
        map?.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder().target(MLatLng(cam.lat, cam.lng)).zoom(cam.zoom).bearing(cam.bearing).build()))
    }
    AndroidView({ view }, modifier)
}

// ───────── Jelölők (map-avatar) ─────────
private fun decodeAvatar(url: String?): Bitmap? = runCatching {
    val b = android.util.Base64.decode(url!!.substringAfter("base64,"), android.util.Base64.DEFAULT); BitmapFactory.decodeByteArray(b, 0, b.size)
}.getOrNull()

private fun markerBitmap(ctx: Context, p: MapPerson, pal: Palette, fonts: Fonts): Bitmap {
    val d = ctx.resources.displayMetrics.density
    val size = (48 * d).roundToInt()
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888); bmp.density = ctx.resources.displayMetrics.densityDpi
    val cv = Canvas(bmp); val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val r = size / 2f
    paint.style = Paint.Style.FILL; paint.color = pal.glassStrong.copy(alpha = 1f).toArgb(); cv.drawCircle(r, r, r - 1f, paint)
    val inner = r - 3 * d - 3 * d
    val av = decodeAvatar(p.avatar)
    if (av != null) {
        val path = Path().apply { addCircle(r, r, inner, Path.Direction.CW) }
        cv.save(); cv.clipPath(path)
        val s = minOf(av.width, av.height)
        cv.drawBitmap(av, Rect((av.width - s) / 2, (av.height - s) / 2, (av.width + s) / 2, (av.height + s) / 2), RectF(r - inner, r - inner, r + inner, r + inner), paint)
        cv.restore()
    } else {
        paint.color = pal.foreground.toArgb(); paint.textSize = 18 * d; paint.textAlign = Paint.Align.CENTER; paint.isFakeBoldText = true
        val tf = runCatching { Typeface.createFromAsset(ctx.assets, "fonts/DMSans.ttf") }.getOrNull(); if (tf != null) paint.typeface = tf
        cv.drawText((p.name.ifBlank { "?" }).take(1).uppercase(), r, r - (paint.descent() + paint.ascent()) / 2, paint)
    }
    paint.style = Paint.Style.STROKE; paint.strokeWidth = 3 * d; paint.color = Color.parseColor(p.color)
    cv.drawCircle(r, r, r - 1.5f * d, paint)
    return bmp
}

private fun arrowBitmap(ctx: Context, color: String): Bitmap {
    val d = ctx.resources.displayMetrics.density
    val size = (74 * d).roundToInt()
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888); bmp.density = ctx.resources.displayMetrics.densityDpi
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = Color.parseColor(color) }
    val path = Path().apply { moveTo(size / 2f, 0f); lineTo(size / 2f + 5 * d, 9 * d); lineTo(size / 2f - 5 * d, 9 * d); close() }
    Canvas(bmp).drawPath(path, paint)
    return bmp
}

private class MState(var lat: Double, var lng: Double, var key: String, var animFrom: MLatLng? = null, var animTo: MLatLng? = null, var animStart: Long = 0, var animDur: Long = 0)

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
    val markers = remember { HashMap<String, MState>() }
    val headings = remember { HashMap<String, Double>() }
    val images = remember { HashSet<String>() }
    var flying by remember { mutableStateOf(false) }
    var holdUntil by remember { mutableLongStateOf(0L) }
    var didCenter by remember { mutableStateOf(false) }
    val peopleNow by rememberUpdatedState(people); val followNow by rememberUpdatedState(follow); val orientNow by rememberUpdatedState(orientation)
    val selectedNow by rememberUpdatedState(selected)

    LaunchedEffect(Unit) {
        view.getMapAsync { m ->
            m.uiSettings.apply { isRotateGesturesEnabled = false; isTiltGesturesEnabled = false; isCompassEnabled = false; isLogoEnabled = false; isAttributionEnabled = true }
            m.setMinZoomPreference(2.0)
            m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder().target(MLatLng(47.4979, 19.0402)).zoom(12.0).build()))
            m.addOnCameraMoveStartedListener { reason ->
                if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) holdUntil = Long.MAX_VALUE
            }
            m.addOnCameraMoveListener {
                val c = m.cameraPosition; cam.lat = c.target!!.latitude; cam.lng = c.target!!.longitude; cam.zoom = c.zoom; cam.bearing = c.bearing; onCompass((-c.bearing).toFloat())
            }
            m.addOnCameraIdleListener { flying = false; if (holdUntil == Long.MAX_VALUE) holdUntil = System.currentTimeMillis() + FOLLOW_RESUME_MS }
            m.addOnMapClickListener { pt ->
                val f = m.queryRenderedFeatures(m.projection.toScreenLocation(pt), "people-icons").firstOrNull()
                val id = f?.getStringProperty("id")
                selected = if (id == null || id == selected) null else id; true
            }
            centerRef?.value = { m.cameraPosition.target }
            map = m
        }
    }
    LaunchedEffect(map, dark) {
        val m = map ?: return@LaunchedEffect
        ready = false; images.clear()
        m.setStyle(Style.Builder().fromUri(MAP_STYLE_URL)) { style ->
            applyMapContrast(style, dark)
            style.addSource(GeoJsonSource("trails"))
            style.addLayer(LineLayer("trails-glow", "trails").withProperties(lineColor(get("color")), lineWidth(13f), lineOpacity(0.28f), lineBlur(5f), lineCap("round"), lineJoin("round")))
            style.addLayer(LineLayer("trails", "trails").withProperties(lineColor(get("color")), lineWidth(4f), lineOpacity(0.96f), lineBlur(0.15f), lineCap("round"), lineJoin("round")))
            style.addSource(GeoJsonSource("self-pulse")); style.addSource(GeoJsonSource("people"))
            style.addLayer(CircleLayer("self-pulse", "self-pulse").withProperties(circleColor("#14B8A6"), circleRadius(24f), circleOpacity(0f), circlePitchAlignment("map")))
            style.addLayer(SymbolLayer("people-arrows", "people").withProperties(iconImage(get("arrow")), iconRotate(get("rot")), iconRotationAlignment("map"),
                iconAllowOverlap(true), iconIgnorePlacement(true), visibility("visible")))
            style.addLayer(SymbolLayer("people-icons", "people").withProperties(iconImage(get("img")), iconAllowOverlap(true), iconIgnorePlacement(true)))
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
            if ("p:$key" !in images) { style.addImage("p:$key", markerBitmap(ctx, p, palette, fonts)); images.add("p:$key") }
            if ("a:${p.color}" !in images) { style.addImage("a:${p.color}", arrowBitmap(ctx, p.color)); images.add("a:${p.color}") }
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
                .put("geometry", JSONObject().put("type", "LineString").put("coordinates", JSONArray(p.points.map { JSONArray(listOf(it.lng, it.lat)) }))) } else emptyList()
        (style.getSource("trails") as? GeoJsonSource)?.setGeoJson(JSONObject().put("type", "FeatureCollection").put("features", JSONArray(trailFeatures)).toString())
        if (!didCenter) people.firstOrNull { it.isSelf && it.points.isNotEmpty() }?.points?.last()?.let {
            didCenter = true; flying = true
            m.animateCamera(CameraUpdateFactory.newLatLngZoom(MLatLng(it.lat, it.lng), FOCUS_ZOOM), 1600)
        }
    }

    // Animáció- és követési ciklus (a webes step())
    LaunchedEffect(map, ready) {
        val m = map ?: return@LaunchedEffect; if (!ready) return@LaunchedEffect
        var lastStep = 0L
        while (true) withFrameMillis { nowMs ->
            val style = m.style ?: return@withFrameMillis
            var animating = false
            for (s in markers.values) if (s.animTo != null) { animating = true; break }
            val idle = !animating && followNow == null && !flying && !(orientNow == "north" && abs(m.cameraPosition.bearing) > 0.05)
            if (idle && selectedNow == null && nowMs - lastStep < 66) return@withFrameMillis
            lastStep = nowMs
            val tNow = System.nanoTime() / 1_000_000
            for (s in markers.values) {
                val to = s.animTo ?: continue; val from = s.animFrom ?: continue
                val k = ((tNow - s.animStart).toDouble() / s.animDur).coerceIn(0.0, 1.0)
                val pos = lerpPoint(LatLng(from.latitude, from.longitude), LatLng(to.latitude, to.longitude), k)
                s.lat = pos.lat; s.lng = pos.lng
                if (k >= 1.0) { s.animTo = null; s.animFrom = null }
            }
            val bearing = m.cameraPosition.bearing
            val features = JSONArray(); var selfPos: MState? = null
            for (p in peopleNow) {
                val s = markers[p.id] ?: continue
                if (p.isSelf) selfPos = s
                val h = headings[p.id]
                features.put(JSONObject().put("type", "Feature").put("geometry", JSONObject().put("type", "Point").put("coordinates", JSONArray(listOf(s.lng, s.lat))))
                    .put("properties", JSONObject().put("id", p.id).put("img", "p:${s.key}").put("arrow", "a:${p.color}").put("rot", if (orientNow == "heading" && h != null) h - bearing else -1000.0)))
            }
            (style.getSource("people") as? GeoJsonSource)?.setGeoJson(JSONObject().put("type", "FeatureCollection").put("features", features).toString())
            // Saját jelölő pulzáló gyűrűje (avatar-pulse, 2,2 mp)
            val pulse = (style.getLayer("self-pulse") as? CircleLayer)
            if (selfPos != null && pulse != null) {
                val k = ((nowMs % 2200) / 2200f)
                (style.getSource("self-pulse") as? GeoJsonSource)?.setGeoJson(JSONObject().put("type", "Feature").put("geometry", JSONObject().put("type", "Point").put("coordinates", JSONArray(listOf(selfPos.lng, selfPos.lat)))).toString())
                pulse.setProperties(circleRadius(24f + 14f * k), circleOpacity(0.5f * (1f - k)))
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
                val target = if (o == "heading") (headings[f.id] ?: bearing) else 0.0
                if (holdUntil != 0L) {
                    if (System.currentTimeMillis() < holdUntil) return@withFrameMillis
                    holdUntil = 0; flying = true
                    m.animateCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(m.cameraPosition).target(MLatLng(s.lat, s.lng)).bearing(target).build()), 900)
                    return@withFrameMillis
                }
                val nb = if (abs(target - bearing) < 0.05) target else smoothAngle(bearing, target, 0.07)
                val c = m.cameraPosition.target!!
                if (abs(c.latitude - s.lat) > 1e-8 || abs(c.longitude - s.lng) > 1e-8 || nb != bearing)
                    m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(m.cameraPosition).target(MLatLng(s.lat, s.lng)).bearing(nb).build()))
            } else if (o == "north" && abs(bearing) > 0.05)
                m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(m.cameraPosition).bearing(smoothAngle(bearing, 0.0, 0.12)).build()))
        }
    }
    // Új követési kérés: azonnal ráugrik (a hold törlődik)
    LaunchedEffect(follow?.request, follow?.id) { if (follow != null) { holdUntil = 0; flying = false } }

    Box(modifier) {
        AndroidView({ view }, Modifier.fillMaxSize())
        val bp = bubblePos; val sel = selected
        val person = people.firstOrNull { it.id == sel }
        if (bp != null && person != null) PersonBubbleHost(person, people.firstOrNull { it.isSelf }, bp, bubbleBelow, addressAllowed, onAllowAddress)
    }
}
