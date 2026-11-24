package hu.privateplace.app.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class NetworkKind { NONE, WIFI, CELLULAR, ETHERNET, VPN, OTHER }

data class NetworkState(
    val connected: Boolean = false,
    val validated: Boolean = false,
    val captivePortal: Boolean = false,
    val metered: Boolean = true,
    val kind: NetworkKind = NetworkKind.NONE,
    val downstreamKbps: Int = 0,
    val upstreamKbps: Int = 0,
    val wifiSignalDbm: Int? = null,
) {
    val usableInternet: Boolean get() = connected && validated
    val isWifi: Boolean get() = kind == NetworkKind.WIFI
    val isCellular: Boolean get() = kind == NetworkKind.CELLULAR
}

/**
 * Az aktív alapértelmezett hálózat állapotát figyeli.
 *
 * Nem kér Wi-Fi SSID-t, jelszót vagy READ_PHONE_STATE engedélyt: ezek a helymegosztáshoz
 * nem szükségesek. A Wi-Fi/mobiladat típus és az internet validáltsága elegendő a
 * megbízható újracsatlakozási döntésekhez.
 */
class NetworkMonitor(context: Context) {
    private val appContext = context.applicationContext
    private val connectivity = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val _state = MutableStateFlow(readCurrent())
    val state: StateFlow<NetworkState> = _state.asStateFlow()
    private var registered = false

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            publish(connectivity.getNetworkCapabilities(network))
        }

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            publish(capabilities)
        }

        override fun onLost(network: Network) {
            // onLost nem feltétlenül jelenti az alapértelmezett hálózat elvesztését:
            // a rendszer rögtön másik hálózatra válthat. Olvassuk vissza az aktuálisat.
            publish(readCurrent())
        }
    }

    @Synchronized
    fun start() {
        if (registered) return
        registered = true
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                connectivity.registerDefaultNetworkCallback(callback)
            } else {
                connectivity.registerNetworkCallback(
                    NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
                    callback
                )
            }
            publish(readCurrent())
        } catch (_: Exception) {
            registered = false
            publish(readCurrent())
        }
    }

    @Synchronized
    fun stop() {
        if (!registered) return
        registered = false
        runCatching { connectivity.unregisterNetworkCallback(callback) }
    }

    private fun readCurrent(): NetworkState {
        val network = connectivity.activeNetwork ?: return NetworkState()
        return fromCapabilities(connectivity.getNetworkCapabilities(network))
    }

    private fun publish(capabilities: NetworkCapabilities?) {
        publish(fromCapabilities(capabilities))
    }

    private fun publish(next: NetworkState) {
        if (_state.value != next) _state.value = next
    }

    private fun fromCapabilities(c: NetworkCapabilities?): NetworkState {
        if (c == null || !c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            return NetworkState()
        }
        val kind = when {
            c.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> NetworkKind.VPN
            c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkKind.WIFI
            c.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkKind.CELLULAR
            c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkKind.ETHERNET
            else -> NetworkKind.OTHER
        }
        val signal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && kind == NetworkKind.WIFI) {
            c.signalStrength.takeIf { it != Int.MIN_VALUE && it in -127..0 }
        } else null
        return NetworkState(
            connected = true,
            validated = c.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
            captivePortal = c.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL),
            metered = !c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
            kind = kind,
            downstreamKbps = c.linkDownstreamBandwidthKbps.coerceAtLeast(0),
            upstreamKbps = c.linkUpstreamBandwidthKbps.coerceAtLeast(0),
            wifiSignalDbm = signal,
        )
    }
}
