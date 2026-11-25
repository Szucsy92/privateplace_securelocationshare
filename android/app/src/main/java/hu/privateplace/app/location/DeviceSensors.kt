package hu.privateplace.app.location

import android.content.*
import android.hardware.*
import android.os.BatteryManager
import android.view.Surface
import android.view.WindowManager
import hu.privateplace.app.domain.StepWindow
import hu.privateplace.app.domain.StillnessDetector
import hu.privateplace.app.domain.WalkingDetector

/** Az eszközérzékelők kimenetei (mind a főszálon érkeznek). */
interface SensorListenerOut {
    fun onHeading(trueHeading: Double) {}
    fun onWalking(walking: Boolean) {}
    fun onStep(at: Long) {}
    fun onPhysicallyStill(still: Boolean) {}
    fun onSignificantMotion() {}
    fun onBattery(percent: Int?) {}
}

/**
 * Iránytű (forgatásvektor, kijelző-forgatás szerint átfordítva, mágneses elhajlással igazítva; tartalék: gyorsulásmérő + mágnesesmező),
 * járás-jelzés (gyorsulásmérő + lépésérzékelő), fizikai mozdulatlanság, jelentős mozgás és akkumulátorszint.
 */
class DeviceSensors(private val ctx: Context, private val out: SensorListenerOut) {
    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private var running = false
    private val walking = WalkingDetector { out.onWalking(it) }
    private val still = StillnessDetector { out.onPhysicallyStill(it) }
    val steps = StepWindow()
    private var lastHeadingAt = 0L
    private val rot = FloatArray(9); private val adj = FloatArray(9); private val ori = FloatArray(3)
    private var gravity: FloatArray? = null; private var magnet: FloatArray? = null
    /** Mágneses → valódi észak (fok); a helyzet ismeretében a motor frissíti. */
    @Volatile var declination = 0.0
    var hasRotationVector = false; private set
    var hasStepDetector = false; private set

    private val significant = object : TriggerEventListener() {
        override fun onTrigger(e: TriggerEvent?) { out.onSignificantMotion(); armSignificant() }
    }
    private fun armSignificant() { sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)?.let { sm.requestTriggerSensor(significant, it) } }

    @Suppress("DEPRECATION")
    private fun displayRotation(): Int = runCatching { (ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.rotation }.getOrDefault(Surface.ROTATION_0)

    private fun emitHeading(matrix: FloatArray) {
        var x = SensorManager.AXIS_X; var y = SensorManager.AXIS_Y
        when (displayRotation()) {
            Surface.ROTATION_90 -> { x = SensorManager.AXIS_Y; y = SensorManager.AXIS_MINUS_X }
            Surface.ROTATION_180 -> { x = SensorManager.AXIS_MINUS_X; y = SensorManager.AXIS_MINUS_Y }
            Surface.ROTATION_270 -> { x = SensorManager.AXIS_MINUS_Y; y = SensorManager.AXIS_X }
        }
        SensorManager.remapCoordinateSystem(matrix, x, y, adj)
        SensorManager.getOrientation(adj, ori)
        out.onHeading(((Math.toDegrees(ori[0].toDouble()) + declination) % 360 + 360) % 360)
    }

    private val listener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            val now = System.currentTimeMillis()
            when (e.sensor.type) {
                Sensor.TYPE_ROTATION_VECTOR -> {
                    if (e.accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE || now - lastHeadingAt < 100) return
                    lastHeadingAt = now
                    SensorManager.getRotationMatrixFromVector(rot, e.values); emitHeading(rot)
                }
                Sensor.TYPE_ACCELEROMETER -> {
                    val v = e.values
                    walking.onSample(now, v[0].toDouble(), v[1].toDouble(), v[2].toDouble())
                    still.onSample(now, v[0].toDouble(), v[1].toDouble(), v[2].toDouble())
                    if (!hasRotationVector) { gravity = lowPass(gravity, v); fallbackHeading(now) }
                }
                Sensor.TYPE_MAGNETIC_FIELD -> if (!hasRotationVector) { magnet = lowPass(magnet, e.values); fallbackHeading(now) }
                Sensor.TYPE_STEP_DETECTOR -> { steps.hit(now); out.onStep(now) }
            }
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }
    private fun lowPass(prev: FloatArray?, v: FloatArray): FloatArray =
        if (prev == null) v.clone() else FloatArray(3) { prev[it] + 0.15f * (v[it] - prev[it]) }
    private fun fallbackHeading(now: Long) {
        val g = gravity ?: return; val m = magnet ?: return
        if (now - lastHeadingAt < 100) return
        if (SensorManager.getRotationMatrix(rot, null, g, m)) { lastHeadingAt = now; emitHeading(rot) }
    }

    private val batteryReceiver = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) = readBattery(i) }
    private fun readBattery(i: Intent?) {
        val lvl = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1; val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        out.onBattery(if (lvl >= 0 && scale > 0) Math.round(lvl * 100f / scale) else null)
    }

    /** @param stepsAllowed az ACTIVITY_RECOGNITION engedély megvan-e (lépésérzékelőhöz Android 10+-on kell). */
    fun start(stepsAllowed: Boolean) {
        if (running) return; running = true
        val rv = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        hasRotationVector = rv != null
        if (rv != null) sm.registerListener(listener, rv, SensorManager.SENSOR_DELAY_UI)
        else {
            sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)?.let { sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_UI) }
        }
        sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_GAME) }
        val sd = if (stepsAllowed) sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR) else null
        hasStepDetector = sd != null
        if (sd != null) sm.registerListener(listener, sd, SensorManager.SENSOR_DELAY_NORMAL)
        armSignificant()
        readBattery(ctx.registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED)))
    }

    fun stop() {
        if (!running) return; running = false
        sm.unregisterListener(listener)
        sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)?.let { sm.cancelTriggerSensor(significant, it) }
        runCatching { ctx.unregisterReceiver(batteryReceiver) }
        gravity = null; magnet = null
    }
}
