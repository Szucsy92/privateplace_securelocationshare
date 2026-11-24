package hu.privateplace.app.location

import android.content.*
import android.hardware.*
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import hu.privateplace.app.domain.WalkingDetector

/**
 * Natív eszközérzékelők:
 * - iránytű: Rotation Vector, ennek hiányában gyorsulásmérő + magnetométer;
 * - mozgás: hardveres Step Detector, ennek hiányában gyorsulásmérő;
 * - akkumulátor: rendszer BroadcastReceiver.
 *
 * A hardveres lépésérzékelő előnyben részesítése alacsonyabb fogyasztású és kevésbé
 * érzékeny a telefon kézben tartásából eredő gyorsulásra, mint a nyers RMS-alapú jel.
 */
class DeviceSensors(
    private val ctx: Context,
    private val onHeading: (Double) -> Unit,
    private val onWalking: (Boolean) -> Unit,
    private val onBattery: (Int?) -> Unit,
) {
    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private var running = false
    private val walking = WalkingDetector(onWalking)
    private val rotation = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private val stepDetector = sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
    private val accelerometer = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val magnetometer = sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
    private val useStepDetector = stepDetector != null
    private val useRotationVector = rotation != null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val expireWalking = Runnable { walking.expireSteps(System.currentTimeMillis()) }

    private val rot = FloatArray(9)
    private val ori = FloatArray(3)
    private val gravity = FloatArray(3)
    private val magnetic = FloatArray(3)
    private var hasGravity = false
    private var hasMagnetic = false
    private var lastHeadingAt = 0L

    private val listener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            val now = System.currentTimeMillis()
            when (e.sensor.type) {
                Sensor.TYPE_ROTATION_VECTOR -> {
                    if (now - lastHeadingAt < 100) return
                    SensorManager.getRotationMatrixFromVector(rot, e.values)
                    publishHeading(now)
                }
                Sensor.TYPE_STEP_DETECTOR -> {
                    walking.onStep(now)
                    mainHandler.removeCallbacks(expireWalking)
                    mainHandler.postDelayed(expireWalking, 3100L)
                }
                Sensor.TYPE_ACCELEROMETER -> {
                    if (!useStepDetector) walking.onSample(now, e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble())
                    if (!useRotationVector) {
                        e.values.copyInto(gravity, endIndex = minOf(3, e.values.size))
                        hasGravity = true
                        publishFallbackHeading(now)
                    }
                }
                Sensor.TYPE_MAGNETIC_FIELD -> if (!useRotationVector) {
                    e.values.copyInto(magnetic, endIndex = minOf(3, e.values.size))
                    hasMagnetic = true
                    publishFallbackHeading(now)
                }
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    private fun publishFallbackHeading(now: Long) {
        if (!hasGravity || !hasMagnetic || now - lastHeadingAt < 100) return
        if (SensorManager.getRotationMatrix(rot, null, gravity, magnetic)) publishHeading(now)
    }

    private fun publishHeading(now: Long) {
        lastHeadingAt = now
        SensorManager.getOrientation(rot, ori)
        val heading = (Math.toDegrees(ori[0].toDouble()) + 360.0) % 360.0
        if (heading.isFinite()) onHeading(heading)
    }

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = readBattery(i)
    }

    private fun readBattery(i: Intent?) {
        val level = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        onBattery(if (level >= 0 && scale > 0) Math.round(level * 100f / scale) else null)
    }

    fun start() {
        if (running) return
        running = true
        rotation?.let { sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_UI) }
        stepDetector?.let { sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_NORMAL) }

        // Az accelerometer csak akkor kell, ha nincs hardveres lépésérzékelő,
        // vagy a Rotation Vector hiányzik és az iránytűhöz is szükséges.
        if (accelerometersNeeded()) accelerometer?.let {
            sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_GAME)
        }
        if (!useRotationVector) magnetometer?.let {
            sm.registerListener(listener, it, SensorManager.SENSOR_DELAY_UI)
        }
        readBattery(ctx.registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED)))
    }

    private fun accelerometersNeeded() = (!useStepDetector || !useRotationVector)

    fun stop() {
        if (!running) return
        running = false
        sm.unregisterListener(listener)
        mainHandler.removeCallbacks(expireWalking)
        runCatching { ctx.unregisterReceiver(batteryReceiver) }
        hasGravity = false
        hasMagnetic = false
        walking.reset()
    }
}
