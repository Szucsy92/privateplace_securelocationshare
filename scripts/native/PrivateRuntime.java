package hu.privateplace.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PrivateRuntime")
public class PrivateRuntime extends Plugin {
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            JSObject data = new JSObject();
            data.put("exit", intent.getBooleanExtra("exit", false));
            notifyListeners("sharingStopped", data, true);
            if (intent.getBooleanExtra("exit", false)) getActivity().finishAndRemoveTask();
        }
    };
    @Override public void load() {
        LocalBroadcastManager.getInstance(getContext()).registerReceiver(receiver, new IntentFilter("hu.privateplace.STOPPED"));
    }
    @PluginMethod public void consumeStop(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("privateplace.runtime", Context.MODE_PRIVATE);
        JSObject data = new JSObject();
        data.put("stopped", prefs.getBoolean("stopped", false));
        prefs.edit().remove("stopped").apply();
        call.resolve(data);
    }
    // Engedélyek: háttérbeli helyzet ("Mindig engedélyezés") és a megfelelő rendszerbeállítás-oldalak.
    private static final String BACKGROUND = "android.permission.ACCESS_BACKGROUND_LOCATION";
    private PluginCall pendingBackground;
    private boolean paused;
    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }
    private boolean foregroundLocation() {
        return granted(android.Manifest.permission.ACCESS_FINE_LOCATION) || granted(android.Manifest.permission.ACCESS_COARSE_LOCATION);
    }
    private String backgroundState() {
        if (!foregroundLocation()) return "prompt";
        if (Build.VERSION.SDK_INT < 29) return "granted";
        if (granted(BACKGROUND)) return "granted";
        return getContext().getSharedPreferences("privateplace.runtime", Context.MODE_PRIVATE).getBoolean("backgroundAsked", false) ? "denied" : "prompt";
    }
    private boolean open(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (getActivity() != null) getActivity().startActivity(intent); else getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
    private boolean openAppDetails() {
        return open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null)));
    }
    @PluginMethod public void checkBackgroundLocation(PluginCall call) {
        JSObject data = new JSObject();
        data.put("state", backgroundState());
        call.resolve(data);
    }
    @PluginMethod public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 || granted(BACKGROUND) || !foregroundLocation() || getActivity() == null) {
            checkBackgroundLocation(call);
            return;
        }
        if (pendingBackground != null) checkBackgroundLocation(pendingBackground);
        pendingBackground = call;
        paused = false;
        getContext().getSharedPreferences("privateplace.runtime", Context.MODE_PRIVATE).edit().putBoolean("backgroundAsked", true).apply();
        // Android 10: rendszerablak; Android 11+: közvetlenül a hely-engedély oldala nyílik meg.
        ActivityCompat.requestPermissions(getActivity(), new String[]{BACKGROUND}, 28360);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (pendingBackground == null || paused) return;
            // A rendszer már nem kérdez újra: az alkalmazás beállításait nyitjuk meg.
            if (!openAppDetails()) { checkBackgroundLocation(pendingBackground); pendingBackground = null; }
        }, 1500);
    }
    @PluginMethod public void openSettings(PluginCall call) {
        String target = call.getString("target", "app");
        String pkg = getContext().getPackageName();
        boolean opened = false;
        if ("notifications".equals(target) && Build.VERSION.SDK_INT >= 26) {
            opened = open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg));
        } else if ("locationServices".equals(target)) {
            opened = open(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
        }
        if (!opened) opened = openAppDetails();
        if (opened) call.resolve(); else call.reject("Settings unavailable");
    }
    @Override protected void handleOnPause() {
        paused = true;
        super.handleOnPause();
    }
    @Override protected void handleOnResume() {
        super.handleOnResume();
        if (pendingBackground != null && paused) {
            PluginCall call = pendingBackground;
            pendingBackground = null;
            checkBackgroundLocation(call);
        }
    }
    @Override protected void handleOnDestroy() {
        LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(receiver);
        super.handleOnDestroy();
    }
}