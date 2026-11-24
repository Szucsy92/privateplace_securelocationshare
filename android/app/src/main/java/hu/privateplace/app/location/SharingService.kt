package hu.privateplace.app.location

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import hu.privateplace.app.PrivatePlaceApp
import hu.privateplace.app.R
import hu.privateplace.app.ui.MainActivity

/**
 * Előtér-szolgáltatás („location” típus): amíg a megosztás be van kapcsolva, a folyamat lezárt képernyőnél is él.
 * A tényleges munkát a SharingEngine végzi; a szolgáltatás a folyamatot tartja életben + az állandó értesítést adja.
 */
class SharingService : Service() {
    private var wake: PowerManager.WakeLock? = null
    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val graph = (application as PrivatePlaceApp).graph
        if (intent?.action == ACTION_STOP) {
            graph.engine.setSharing(false)
            if (intent.getBooleanExtra(EXTRA_EXIT, false)) graph.exitRequests.tryEmit(Unit)
            stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Helymegosztás", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        fun action(label: String, exit: Boolean) = NotificationCompat.Action.Builder(0, label, PendingIntent.getService(this, if (exit) 2 else 1,
            Intent(this, SharingService::class.java).setAction(ACTION_STOP).putExtra(EXTRA_EXIT, exit), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build()
        val n = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat).setContentTitle("Private Place")
            .setContentText("A helyzeted meg van osztva a szobáiddal").setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE).setContentIntent(open)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(action("Leállítás", false)).addAction(action("Kilépés", true)).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(NOTIF_ID, n)
        if (wake == null) wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PrivatePlace:sharing").apply { acquire() }
        graph.engine.setPermissionGranted(true)
        return START_STICKY
    }

    override fun onDestroy() { wake?.takeIf { it.isHeld }?.release(); wake = null; super.onDestroy() }

    companion object { const val CHANNEL = "sharing"; const val NOTIF_ID = 7; const val ACTION_STOP = "hu.privateplace.STOP"; const val EXTRA_EXIT = "exit" }
}
