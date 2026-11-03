package hu.privateplace.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
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
import androidx.core.app.NotificationManagerCompat;
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
        android.content.SharedPreferences prefs = prefs();
        JSObject data = new JSObject();
        data.put("stopped", prefs.getBoolean("stopped", false));
        prefs.edit().remove("stopped").apply();
        call.resolve(data);
    }

    // Engedélyek: pontos helyzet, háttérbeli helyzet ("Mindig engedélyezés"), értesítések
    // és a hozzájuk tartozó rendszerbeállítás-oldalak.
    private static final String FINE = android.Manifest.permission.ACCESS_FINE_LOCATION;
    private static final String COARSE = android.Manifest.permission.ACCESS_COARSE_LOCATION;
    private static final String BACKGROUND = "android.permission.ACCESS_BACKGROUND_LOCATION";
    // A háttérkövető értesítési csatornája (a háttérkövető csomagnevével azonos azonosító).
    private static final String CHANNEL = "com.equimaps.capacitor_background_geolocation";
    private PluginCall pendingCall;
    private String pendingKind;
    private boolean paused;
    private boolean dialogSeen;

    private android.content.SharedPreferences prefs() {
        return getContext().getSharedPreferences("privateplace.runtime", Context.MODE_PRIVATE);
    }
    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }
    private boolean foregroundLocation() {
        return granted(FINE) || granted(COARSE);
    }
    /** granted = pontos; limited = csak hozzávetőleges; denied = a rendszer már nem kérdez. */
    private String locationState() {
        if (granted(FINE)) return "granted";
        if (granted(COARSE)) return "limited";
        if (!prefs().getBoolean("locationAsked", false) || getActivity() == null) return "prompt";
        return ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), FINE) ? "prompt" : "denied";
    }
    private String backgroundState() {
        if (!foregroundLocation()) return "prompt";
        if (Build.VERSION.SDK_INT < 29) return "granted";
        if (granted(BACKGROUND)) return "granted";
        return prefs().getBoolean("backgroundAsked", false) ? "denied" : "prompt";
    }
    /** off = az alkalmazás értesítései tiltva; channelOff = csak a helymegosztás csatornája némítva. */
    private String notificationState() {
        if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) return "off";
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = manager != null ? manager.getNotificationChannel(CHANNEL) : null;
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return "channelOff";
        }
        return "granted";
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
    private void resolveState(PluginCall call, String kind) {
        JSObject data = new JSObject();
        data.put("state", "location".equals(kind) ? locationState() : backgroundState());
        call.resolve(data);
    }
    /**
     * Rendszerablakot kér, és megvárja a felhasználó döntését. Beállításoldalt csak akkor nyit (ha a hívó engedi),
     * ha 3 mp után sem jelent meg ablak (a rendszer már nem kérdez). Amíg rendszerablak takarja az alkalmazást,
     * türelmesen vár (legfeljebb 5 percig); a döntés után a handleOnResume válaszol.
     */
    private void ask(PluginCall call, String kind, String[] permissions, int code, boolean settingsFallback) {
        if (pendingCall != null) resolveState(pendingCall, pendingKind);
        pendingCall = call;
        pendingKind = kind;
        paused = false;
        dialogSeen = false;
        prefs().edit().putBoolean(kind + "Asked", true).apply();
        ActivityCompat.requestPermissions(getActivity(), permissions, code);
        watchPending(call, kind, settingsFallback, 0);
    }

    /** 250 ms-onként figyeli, hogy takarja-e rendszerablak az alkalmazást (szünet vagy elvesztett ablak-fókusz). */
    private void watchPending(PluginCall call, String kind, boolean settingsFallback, int tick) {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (pendingCall != call) return; // már megválaszolva, vagy újabb kérés váltotta le
            android.app.Activity activity = getActivity();
            boolean covered = paused || (activity != null && !activity.hasWindowFocus());
            if (covered) dialogSeen = true;
            if (dialogSeen) {
                if (!covered) {
                    // Az ablak eltűnt, de életciklus-esemény nem érkezett: a jelenlegi állapottal válaszolunk.
                    pendingCall = null;
                    resolveState(call, kind);
                } else if (tick < 1200) {
                    watchPending(call, kind, settingsFallback, tick + 1);
                } else {
                    pendingCall = null;
                    resolveState(call, kind);
                }
                return;
            }
            if (tick < 12) {
                // Lassú készüléken a rendszerablak nyitása 1,5 mp-nél is tovább tarthat: türelmi idő.
                watchPending(call, kind, settingsFallback, tick + 1);
                return;
            }
            // 3 mp után sem jelent meg ablak: a rendszer már nem kérdez.
            if (!settingsFallback || !openAppDetails()) {
                pendingCall = null;
                resolveState(call, kind);
            }
        }, 250);
    }

    @PluginMethod public void checkLocation(PluginCall call) {
        resolveState(call, "location");
    }
    /** Pontos helyzet: Android 12+ a „Pontos” kapcsolóval kérdez, hozzávetőlegesnél a frissítő ablakot mutatja. */
    @PluginMethod public void requestPreciseLocation(PluginCall call) {
        if (granted(FINE) || getActivity() == null) {
            resolveState(call, "location");
            return;
        }
        ask(call, "location", new String[]{FINE, COARSE}, 28361, call.getBoolean("openSettings", true));
    }
    @PluginMethod public void checkBackgroundLocation(PluginCall call) {
        resolveState(call, "background");
    }
    @PluginMethod public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 || granted(BACKGROUND) || !foregroundLocation() || getActivity() == null) {
            resolveState(call, "background");
            return;
        }
        // Android 10: rendszerablak; Android 11+: közvetlenül a hely-engedély oldala nyílik meg.
        ask(call, "background", new String[]{BACKGROUND}, 28360, true);
    }
    @PluginMethod public void checkNotifications(PluginCall call) {
        JSObject data = new JSObject();
        data.put("state", notificationState());
        call.resolve(data);
    }
    @PluginMethod public void openSettings(PluginCall call) {
        String target = call.getString("target", "app");
        String pkg = getContext().getPackageName();
        boolean opened = false;
        if ("notifications".equals(target) && Build.VERSION.SDK_INT >= 26) {
            // Ha csak a helymegosztás csatornája némított, egyenesen annak az oldalát nyitjuk meg.
            if ("channelOff".equals(notificationState())) {
                opened = open(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, pkg).putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL));
            }
            if (!opened) opened = open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg));
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
        if (pendingCall != null && paused) {
            PluginCall call = pendingCall;
            String kind = pendingKind;
            pendingCall = null;
            resolveState(call, kind);
        }
    }
    @Override protected void handleOnDestroy() {
        LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(receiver);
        super.handleOnDestroy();
    }
}
