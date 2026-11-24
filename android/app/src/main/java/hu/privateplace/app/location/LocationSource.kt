package hu.privateplace.app.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.os.Looper
import com.google.android.gms.location.*
import com.google.android.gms.tasks.CancellationTokenSource
import hu.privateplace.app.domain.RawFix
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Helymeghatározás: FusedLocationProviderClient. Pontos (GPS) folyam a megadott közzel, plusz egy gyors hálózati
 * kezdőfix (src = "network"), hogy a saját jelölő azonnal megjelenjen; a drift-szűrő a durva fixre nem horgonyoz.
 */
class LocationSource(context: Context) {
    private val client = LocationServices.getFusedLocationProviderClient(context.applicationContext)

    private fun Location.toFix(src: String) = RawFix(
        lat = latitude, lng = longitude, acc = if (hasAccuracy()) accuracy.toDouble() else null,
        speed = if (hasSpeed()) speed.toDouble() else null,
        speedAcc = if (hasSpeedAccuracy()) speedAccuracyMetersPerSecond.toDouble() else null,
        bearing = if (hasBearing()) bearing.toDouble() else null, at = time, src = src,
    )

    @SuppressLint("MissingPermission")
    fun fixes(intervalMs: Long): Flow<RawFix> = callbackFlow {
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs / 2).setWaitForAccurateLocation(false).build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(r: LocationResult) { for (l in r.locations) trySend(l.toFix("gps")) }
        }
        val cts = CancellationTokenSource()
        client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.token).addOnSuccessListener { l -> if (l != null) trySend(l.toFix("network")) }
        client.requestLocationUpdates(req, cb, Looper.getMainLooper())
        awaitClose { cts.cancel(); client.removeLocationUpdates(cb) }
    }
}
