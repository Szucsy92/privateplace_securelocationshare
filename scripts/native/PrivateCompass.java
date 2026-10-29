package hu.privateplace.app;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.view.Surface;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PrivateCompass")
public class PrivateCompass extends Plugin implements SensorEventListener {
    private SensorManager manager;
    private long lastSent = 0;
    @PluginMethod public void start(PluginCall call) {
        manager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        Sensor sensor = manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        if (sensor == null) { call.reject("Rotation vector unavailable"); return; }
        manager.unregisterListener(this);
        if (!manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)) { call.reject("Sensor unavailable"); return; }
        call.resolve();
    }
    @PluginMethod public void stop(PluginCall call) { if (manager != null) manager.unregisterListener(this); call.resolve(); }
    @Override protected void handleOnDestroy() { if (manager != null) manager.unregisterListener(this); super.handleOnDestroy(); }
    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    @Override public void onSensorChanged(SensorEvent event) {
        if (event.accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE) return;
        if (event.timestamp - lastSent < 100000000L) return;
        lastSent = event.timestamp;
        float[] matrix = new float[9], adjusted = new float[9], angles = new float[3];
        SensorManager.getRotationMatrixFromVector(matrix, event.values);
        int rotation = getActivity().getWindowManager().getDefaultDisplay().getRotation();
        int x = SensorManager.AXIS_X, y = SensorManager.AXIS_Y;
        if (rotation == Surface.ROTATION_90) { x = SensorManager.AXIS_Y; y = SensorManager.AXIS_MINUS_X; }
        else if (rotation == Surface.ROTATION_180) { x = SensorManager.AXIS_MINUS_X; y = SensorManager.AXIS_MINUS_Y; }
        else if (rotation == Surface.ROTATION_270) { x = SensorManager.AXIS_MINUS_Y; y = SensorManager.AXIS_X; }
        SensorManager.remapCoordinateSystem(matrix, x, y, adjusted);
        SensorManager.getOrientation(adjusted, angles);
        JSObject data = new JSObject();
        data.put("heading", (Math.toDegrees(angles[0]) + 360) % 360);
        notifyListeners("heading", data);
    }
}