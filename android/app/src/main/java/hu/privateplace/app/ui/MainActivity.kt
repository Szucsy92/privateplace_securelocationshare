package hu.privateplace.app.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import hu.privateplace.app.PrivatePlaceApp
import hu.privateplace.app.domain.Invitation
import hu.privateplace.app.domain.parseRoomInput
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val graph get() = (application as PrivatePlaceApp).graph
    private val invite = mutableStateOf<Invitation?>(null)
    private val permTick = mutableIntStateOf(0)
    private var afterCamera: (() -> Unit)? = null

    private val locLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refreshPerms() }
    private val bgLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshPerms() }
    private val notifLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshPerms() }
    private val camLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) afterCamera?.invoke(); afterCamera = null }

    private val appVisible = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) { graph.engine.setVisible(true); graph.peers.wake() }
        override fun onStop(owner: LifecycleOwner) { graph.engine.setVisible(false) }
    }

    private fun refreshPerms() { graph.engine.setPermissionGranted(Perms.anyLocation(this)); permTick.intValue++ }

    private val actions by lazy {
        PermissionActions(
            requestLocation = { locLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) },
            // Android 11+: a háttérhelyzetet külön, a helyengedély után kell kérni (a rendszer a beállításokra irányíthat)
            requestBackground = { if (Build.VERSION.SDK_INT >= 29) { if (!Perms.fine(this)) locLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) else bgLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) } },
            requestNotifications = { if (Build.VERSION.SDK_INT >= 33) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) else Perms.openSettings(this) },
            requestCamera = { then -> if (Perms.camera(this)) then() else { afterCamera = then; camLauncher.launch(Manifest.permission.CAMERA) } },
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleIntent(intent)
        ProcessLifecycleOwner.get().lifecycle.addObserver(appVisible)
        lifecycleScope.launch { graph.exitRequests.collect { finishAndRemoveTask() } }
        refreshPerms()
        setContent { PrivatePlaceTheme { AppRoot(actions, invite.value, { invite.value = null }, permTick.intValue) { graph.engine.setSharing(false); finishAndRemoveTask() } } }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent) }
    override fun onResume() { super.onResume(); refreshPerms(); graph.peers.wake() }
    override fun onDestroy() { ProcessLifecycleOwner.get().lifecycle.removeObserver(appVisible); super.onDestroy() }

    /** Meghívó link (…#szoba=…) vagy ACTION_SEND-ből érkező kód. */
    private fun handleIntent(i: Intent?) {
        val data = i?.dataString ?: i?.getStringExtra(Intent.EXTRA_TEXT) ?: return
        parseRoomInput(data)?.let { invite.value = it }
    }
}
