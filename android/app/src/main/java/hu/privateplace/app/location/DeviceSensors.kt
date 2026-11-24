package hu.privateplace.app.location

import android.content.*
import android.hardware.*
import android.os.BatteryManager
import hu.privateplace.app.domain.WalkingDetector

/** Iránytű (rotation vector), járás-jelzés (gyorsulásmérő) és akkumulátorszint. */
class DeviceSensors(private val ctx: Context, private val onHeading: (Double) -> Unit, private val onWalking: (Boolean) -> Unit, private val onBattery: (Int?) -> Unit) {
    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private var running = false
    private val walking = WalkingDetector(onWalking)
    private val rot = FloatArray(9); private val ori = FloatArray(3)
    private var lastHeadingAt = 0L

    private val listener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            when (e.sensor.type) {
                Sensor.TYPE_ROTATION_VECTOR -> {
                    val now = System.currentTimeMillis(); if (now - lastHeadingAt < 100) return; lastHeadingAt = now
                    SensorManager.getRotationMatrixFromVector(rot, e.values); SensorManager.getOrientation(rot, ori)
                    onHeading((Math.toDegrees(ori[0].toDouble()) + 360) % 360)
                }
                Sensor.TYPE_ACCELEROMETER -> walking.onSample(System.currentTimeMillis(), e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble())
            }
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }
    private val batteryReceiver = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) = readBattery(i) }
    private fun readBattery(i: Intent?) {
        val lvl = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1; val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        onBattery(if (lvl >= 0 && scale > 0) Math.round(lvl * 100f / scale) else null)
    }

    fun start() {
        if (running) return; running = true
        sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let { sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_UI) }
        sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_GAME) }
        readBattery(ctx.registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED)))
    }
    fun stop() {
        if (!running) return; running = false
        sm.unregisterListener(listener); runCatching { ctx.unregisterReceiver(batteryReceiver) }
    }
}
