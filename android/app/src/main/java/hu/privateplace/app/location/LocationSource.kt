package hu.privateplace.app.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.*
import com.google.android.gms.tasks.CancellationTokenSource
import hu.privateplace.app.domain.RawFix
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Helymeghatározás (a webes locationSource.ts megfelelője).
 * - Elsődleges: FusedLocationProviderClient (GPS + Wi-Fi + mobilcella). Google Play szolgáltatások nélkül (pl. Google-mentes telefon)
 *   a platform LocationManager GPS- és hálózati szolgáltatójára vált.
 * - Gyors hálózati kezdőfix (src = "network"), hogy a saját jelölő azonnal megjelenjen; ha 10 mp-ig nincs fix, újra kér egyet.
 * - Szimulált (mock) fixeket eldob; a Doppler nélküli (hálózati) 0 sebesség nem "áll" bizonyíték → null.
 * - Forrásonként külön időbélyeg: a hálózati fix nem teszi elavulttá a műholdas csomagokat, és nem írja felül azokat.
 */
class LocationSource(context: Context) {
    private val app = context.applicationContext
    private val fused by lazy { LocationServices.getFusedLocationProviderClient(app) }
    private val hasPlayServices get() = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(app) == ConnectionResult.SUCCESS

    private fun Location.isSimulated() = if (Build.VERSION.SDK_INT >= 31) isMock else @Suppress("DEPRECATION") isFromMockProvider

    private fun Location.toFix(src: String): RawFix {
        // A hálózati/Wi-Fi alapú fixnél az Android 0-t ad sebességnek (nincs Doppler): ez nem "áll" bizonyíték.
        val noDoppler = !hasSpeed() || (speed == 0f && (!hasAccuracy() || accuracy > 20f))
        return RawFix(
            lat = latitude, lng = longitude, acc = if (hasAccuracy()) accuracy.toDouble() else null,
            speed = if (noDoppler) null else speed.toDouble(),
            speedAcc = if (!noDoppler && Build.VERSION.SDK_INT >= 26 && hasSpeedAccuracy()) speedAccuracyMetersPerSecond.toDouble() else null,
            bearing = if (hasBearing()) bearing.toDouble() else null, at = time, src = src,
        )
    }

    @SuppressLint("MissingPermission")
    fun fixes(intervalMs: Long, isVisible: () -> Boolean = { true }): Flow<RawFix> = callbackFlow {
        var latestGpsAt = 0L; var latestNetAt = 0L; var latestAt = 0L
        fun report(l: Location, src: String) {
            if (l.isSimulated() || !l.latitude.isFinite() || !l.longitude.isFinite() || Math.abs(l.latitude) > 90 || Math.abs(l.longitude) > 180) return
            val now = System.currentTimeMillis(); val at = l.time
            if (now - at > 30_000 || at > now + 60_000) return
            if (src == "network") { if (at < latestNetAt || at < latestGpsAt) return; latestNetAt = at }
            else { if (at < latestGpsAt) return; latestGpsAt = at }
            latestAt = maxOf(latestAt, at)
            trySend(l.toFix(src))
        }

        var cleanup: () -> Unit = {}
        if (hasPlayServices) {
            val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                .setMinUpdateIntervalMillis(intervalMs / 2).setMinUpdateDistanceMeters(0f)
                .setGranularity(Granularity.GRANULARITY_FINE).setWaitForAccurateLocation(false).build()
            val cb = object : LocationCallback() {
                override fun onLocationResult(r: LocationResult) { for (l in r.locations) report(l, "gps") }
            }
            var cts: CancellationTokenSource? = null
            fun quick() {
                cts?.cancel(); val t = CancellationTokenSource(); cts = t
                fused.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, t.token).addOnSuccessListener { l -> if (l != null) report(l, "network") }
            }
            quick()
            fused.requestLocationUpdates(req, cb, Looper.getMainLooper())
            val ticker = launch { while (isActive) { kotlinx.coroutines.delay(12_000); if (isVisible() && System.currentTimeMillis() - latestAt > 10_000) quick() } }
            cleanup = { ticker.cancel(); cts?.cancel(); fused.removeLocationUpdates(cb) }
        } else {
            val lm = app.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val gps = object : LocationListener {
                override fun onLocationChanged(l: Location) = report(l, "gps")
                @Deprecated("API < 29") override fun onStatusChanged(p: String?, s: Int, e: Bundle?) {}
            }
            val net = object : LocationListener {
                override fun onLocationChanged(l: Location) = report(l, "network")
                @Deprecated("API < 29") override fun onStatusChanged(p: String?, s: Int, e: Bundle?) {}
            }
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, 0f, gps, Looper.getMainLooper())
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, maxOf(intervalMs, 5000L), 0f, net, Looper.getMainLooper())
                lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)?.let { report(it, "network") }
            }
            cleanup = { lm.removeUpdates(gps); lm.removeUpdates(net) }
        }
        awaitClose { cleanup() }
    }
}
