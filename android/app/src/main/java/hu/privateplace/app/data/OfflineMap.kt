package hu.privateplace.app.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import hu.privateplace.app.ui.MAP_STYLE_URL
import org.maplibre.android.MapLibre
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition
import kotlin.math.cos
import kotlin.math.hypot

/**
 * Offline térkép: a legutóbbi helyzet körüli körzet (RADIUS_M) előre letöltődik a MapLibre offline tárolójába, így induláskor
 * azonnal, net nélkül is megvan a térkép. Ha a körzet elavult (STALE_MS) vagy a felhasználó messzire költözött (MOVE_M),
 * az app a háttérben újratölti – csak nem mért (Wi-Fi) hálózaton, a UI blokkolása nélkül. Az új régió sikeres letöltése után törli a régit.
 */
class OfflineMap(private val ctx: Context) {
    private val sp = ctx.getSharedPreferences("offline_map", Context.MODE_PRIVATE)
    private var busy = false

    /** Tárolt (utoljára sikeresen letöltött) közép alapján frissít, ha elavult; még nincs tárolt közép → vár az első fixre. */
    fun ensureLast() {
        if (!sp.contains("lat")) return
        ensure(java.lang.Double.longBitsToDouble(sp.getLong("lat", 0)), java.lang.Double.longBitsToDouble(sp.getLong("lng", 0)))
    }

    fun ensure(lat: Double, lng: Double) {
        if (busy || !unmetered()) return
        val doneAt = sp.getLong("doneAt", 0)
        if (doneAt > 0 && System.currentTimeMillis() - doneAt < STALE_MS) {
            val oLat = java.lang.Double.longBitsToDouble(sp.getLong("lat", 0)); val oLng = java.lang.Double.longBitsToDouble(sp.getLong("lng", 0))
            if (distanceM(oLat, oLng, lat, lng) < MOVE_M) return
        }
        busy = true
        runCatching { download(lat, lng) }.onFailure { busy = false }
    }

    private fun download(lat: Double, lng: Double) {
        MapLibre.getInstance(ctx)
        val om = OfflineManager.getInstance(ctx)
        val dLat = RADIUS_M / 110540.0
        val dLng = RADIUS_M / (111320.0 * cos(Math.toRadians(lat)).coerceAtLeast(0.2))
        val bounds = LatLngBounds.from(lat + dLat, lng + dLng, lat - dLat, lng - dLng)
        val def = OfflineTilePyramidRegionDefinition(MAP_STYLE_URL, bounds, 0.0, MAX_ZOOM, ctx.resources.displayMetrics.density)
        om.createOfflineRegion(def, "{}".toByteArray(), object : OfflineManager.CreateOfflineRegionCallback {
            override fun onCreate(offlineRegion: OfflineRegion) {
                var finished = false
                offlineRegion.setObserver(object : OfflineRegion.OfflineRegionObserver {
                    override fun onStatusChanged(status: OfflineRegionStatus) {
                        if (finished || !status.isComplete) return
                        finished = true
                        offlineRegion.setDownloadState(OfflineRegion.STATE_INACTIVE)
                        sp.edit().putLong("lat", java.lang.Double.doubleToRawLongBits(lat)).putLong("lng", java.lang.Double.doubleToRawLongBits(lng))
                            .putLong("doneAt", System.currentTimeMillis()).apply()
                        deleteOthers(om, offlineRegion.id)
                    }
                    override fun onError(error: OfflineRegionError) { if (!finished) { finished = true; offlineRegion.setDownloadState(OfflineRegion.STATE_INACTIVE); busy = false } }
                    override fun mapboxTileCountLimitExceeded(limit: Long) { if (!finished) { finished = true; offlineRegion.setDownloadState(OfflineRegion.STATE_INACTIVE); busy = false } }
                })
                offlineRegion.setDownloadState(OfflineRegion.STATE_ACTIVE)
            }
            override fun onError(error: String) { busy = false }
        })
    }

    /** A régi (és a félbemaradt) régiók törlése, hogy a tároló ne nőjön. */
    private fun deleteOthers(om: OfflineManager, keepId: Long) {
        om.listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
            override fun onList(offlineRegions: Array<OfflineRegion>?) {
                offlineRegions?.filter { it.id != keepId }?.forEach {
                    it.delete(object : OfflineRegion.OfflineRegionDeleteCallback { override fun onDelete() {}; override fun onError(error: String) {} })
                }
                busy = false
            }
            override fun onError(error: String) { busy = false }
        })
    }

    private fun unmetered(): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    private fun distanceM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double =
        hypot((lat2 - lat1) * 110540.0, (lng2 - lng1) * 111320.0 * cos(Math.toRadians((lat1 + lat2) / 2)))

    private companion object {
        const val RADIUS_M = 15000.0                 // 30×30 km-es körzet a közép körül
        const val MAX_ZOOM = 14.0                    // az OpenFreeMap vektorcsempéi z14-ig vannak
        const val STALE_MS = 14L * 24 * 3600 * 1000  // ennyi után frissítjük
        const val MOVE_M = 10000.0                   // ennyire elmozdulva új körzetet töltünk
    }
}
