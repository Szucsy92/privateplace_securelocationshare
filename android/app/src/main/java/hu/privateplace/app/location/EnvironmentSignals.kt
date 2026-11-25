package hu.privateplace.app.location

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.*
import android.content.*
import android.content.pm.PackageManager
import android.net.*
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.*
import androidx.core.content.ContextCompat
import hu.privateplace.app.domain.EnvironmentTracker
import java.security.MessageDigest

enum class NetKind { NONE, WIFI, CELLULAR, OTHER }

/**
 * Hálózat és környezet: (1) Wi-Fi/mobiladat váltás és kapcsolat-visszatérés figyelése (a P2P-kapcsolatot újra kell építeni),
 * (2) Wi-Fi-hozzáférési pontok, mobilcellák és közeli Bluetooth-eszközök ujjlenyomata → elmozdulás-bizonyíték.
 * Az azonosítók csak az eszközön, rövid életű, sózott hash-ként élnek; semmi nem kerül ki a hálózatra, és nem tárolódik.
 * Az ujjlenyomat csak az energia-ütemezést (mikor kell sűrűn mérni) segíti, a megjelenített pozíciót nem módosítja.
 */
class EnvironmentSignals(
    private val ctx: Context,
    private val onNetwork: (kind: NetKind, metered: Boolean, regained: Boolean) -> Unit,
    private val onMoved: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val tracker = EnvironmentTracker(onMoved)
    private val salt = ByteArray(8).also { java.security.SecureRandom().nextBytes(it) }
    private var running = false
    private var kind = NetKind.NONE
    private var scanning = false

    private fun granted(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED
    private fun hash(s: String): String = MessageDigest.getInstance("SHA-256").run { update(salt); digest(s.toByteArray()).take(6).joinToString("") { "%02x".format(it) } }

    /* ---------- Hálózat ---------- */
    private val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val netCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(n: Network, c: NetworkCapabilities) {
            val next = when {
                !c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) -> NetKind.NONE
                c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetKind.WIFI
                c.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetKind.CELLULAR
                else -> NetKind.OTHER
            }
            main.post { setKind(next, !c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) }
        }
        override fun onLost(n: Network) { main.post { setKind(NetKind.NONE, false) } }
    }
    private fun setKind(next: NetKind, metered: Boolean) {
        if (next == kind) return
        val regained = next != NetKind.NONE
        kind = next
        onNetwork(next, metered, regained)   // Wi-Fi ↔ mobiladat váltás vagy visszatérés: a WebRTC-kapcsolatok elavultak, újra kell csatlakozni
    }

    /* ---------- Wi-Fi ---------- */
    private val wifi by lazy { ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager }
    private val wifiReceiver = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) = readWifi() }
    @SuppressLint("MissingPermission")
    private fun readWifi() {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) || wifi?.isWifiEnabled != true) return
        val aps = runCatching { wifi!!.scanResults }.getOrNull() ?: return
        val ids = aps.filter { it.level >= -80 }.sortedByDescending { it.level }.take(12).map { hash(it.BSSID ?: "") }.toSet()
        tracker.observe(EnvironmentTracker.WIFI, ids, System.currentTimeMillis())
    }
    @Suppress("DEPRECATION")
    private fun requestWifiScan() { runCatching { wifi?.startScan() } }   // a rendszer szabályozza (előtér: 4/2 perc); hiba esetén a gyorsítótárazott lista is jó

    /* ---------- Mobilcella ---------- */
    private val tm by lazy { ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager }
    @SuppressLint("MissingPermission")
    private fun readCells() {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) return
        val cells = runCatching { tm?.allCellInfo }.getOrNull() ?: return
        val ids = HashSet<String>()
        for (c in cells) {
            if (!c.isRegistered) continue
            when (c) {
                is CellInfoLte -> ids += "lte:${c.cellIdentity.tac}:${c.cellIdentity.ci}"
                is CellInfoGsm -> ids += "gsm:${c.cellIdentity.lac}:${c.cellIdentity.cid}"
                is CellInfoWcdma -> ids += "wcdma:${c.cellIdentity.lac}:${c.cellIdentity.cid}"
                else -> if (Build.VERSION.SDK_INT >= 29 && c is CellInfoNr) ids += "nr:${(c.cellIdentity as? CellIdentityNr)?.let { "${it.tac}:${it.nci}" }}"
            }
        }
        tracker.observe(EnvironmentTracker.CELL, ids.map { hash(it) }.toSet(), System.currentTimeMillis(), minSize = 1)
    }

    /* ---------- Közeli Bluetooth-eszközök ---------- */
    private val seen = HashSet<String>()
    private val bleCb = object : ScanCallback() {
        override fun onScanResult(type: Int, r: ScanResult) { if (r.rssi >= -85) seen += hash(r.device.address) }
        override fun onBatchScanResults(l: MutableList<ScanResult>) { l.forEach { onScanResult(0, it) } }
    }
    private fun bleAllowed() = if (Build.VERSION.SDK_INT >= 31) granted(Manifest.permission.BLUETOOTH_SCAN)
        else granted(Manifest.permission.BLUETOOTH) && granted(Manifest.permission.ACCESS_FINE_LOCATION)
    @SuppressLint("MissingPermission")
    private fun bleWindow() {
        val scanner = runCatching { (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner }.getOrNull() ?: return
        if (!bleAllowed() || scanning) return
        scanning = true; seen.clear()
        runCatching { scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).build(), bleCb) }.onFailure { scanning = false; return }
        main.postDelayed({
            runCatching { scanner.stopScan(bleCb) }
            scanning = false
            tracker.observe(EnvironmentTracker.BLE, HashSet(seen), System.currentTimeMillis(), minSize = 3)
        }, 5000)
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            readCells(); requestWifiScan(); bleWindow()
            main.postDelayed(this, 30_000)
        }
    }

    @SuppressLint("MissingPermission")
    fun start() {
        if (running) return; running = true
        runCatching { cm.registerDefaultNetworkCallback(netCallback) }
        runCatching { ctx.registerReceiver(wifiReceiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)) }
        main.post(tick)
    }

    fun stop() {
        if (!running) return; running = false
        main.removeCallbacksAndMessages(null)
        runCatching { cm.unregisterNetworkCallback(netCallback) }
        runCatching { ctx.unregisterReceiver(wifiReceiver) }
        tracker.reset(); kind = NetKind.NONE
    }
}
