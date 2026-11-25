package hu.privateplace.app.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Perms {
    private fun has(c: Context, p: String) = ContextCompat.checkSelfPermission(c, p) == PackageManager.PERMISSION_GRANTED
    fun fine(c: Context) = has(c, Manifest.permission.ACCESS_FINE_LOCATION)
    fun anyLocation(c: Context) = fine(c) || has(c, Manifest.permission.ACCESS_COARSE_LOCATION)
    fun background(c: Context) = Build.VERSION.SDK_INT < 29 || has(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    fun notifications(c: Context) = (Build.VERSION.SDK_INT < 33 || has(c, Manifest.permission.POST_NOTIFICATIONS)) && NotificationManagerCompat.from(c).areNotificationsEnabled()
    fun camera(c: Context) = has(c, Manifest.permission.CAMERA)
    /** Lépésérzékelő: Android 10+ futásidejű engedély; régebbin nincs rá szükség. */
    fun motion(c: Context) = Build.VERSION.SDK_INT < 29 || has(c, Manifest.permission.ACTIVITY_RECOGNITION)
    /** Közeli eszközök (Bluetooth LE): Android 12+: BLUETOOTH_SCAN; régebbin a helyengedély elég. */
    fun nearby(c: Context) = if (Build.VERSION.SDK_INT >= 31) has(c, Manifest.permission.BLUETOOTH_SCAN) else anyLocation(c)
    fun openSettings(c: Context) = c.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${c.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    fun openBatterySettings(c: Context) = c.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** Az Activity által adott engedélykérő műveletek. */
class PermissionActions(val requestLocation: () -> Unit, val requestBackground: () -> Unit, val requestNotifications: () -> Unit, val requestCamera: (() -> Unit) -> Unit,
    val requestMotion: () -> Unit = {}, val requestNearby: () -> Unit = {})
