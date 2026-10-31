package hu.privateplace.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "PrivateRuntime",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
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

    /** Opens this app's own system settings page (Permissions → Location → "Allow all the time", Notifications). */
    @PluginMethod public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Nem nyitható meg az alkalmazás beállítása", e);
        }
    }

    private boolean notificationsAllowed() {
        NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        return manager != null && manager.areNotificationsEnabled();
    }
    private void resolveNotifications(PluginCall call) {
        JSObject data = new JSObject();
        data.put("display", notificationsAllowed() ? "granted" : "denied");
        call.resolve(data);
    }

    /** "granted" | "denied" | "prompt" (the system dialog can still be shown). */
    @PluginMethod public void checkNotifications(PluginCall call) {
        if (notificationsAllowed()) { resolveNotifications(call); return; }
        JSObject data = new JSObject();
        boolean askable = Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT;
        data.put("display", askable ? "prompt" : "denied");
        call.resolve(data);
    }

    /** Android 13+: asks for POST_NOTIFICATIONS so the system cannot mute the foreground-service notification. */
    @PluginMethod public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || notificationsAllowed()) { resolveNotifications(call); return; }
        requestPermissionForAlias("notifications", call, "notificationsPermissionCallback");
    }
    @PermissionCallback private void notificationsPermissionCallback(PluginCall call) {
        resolveNotifications(call);
    }

    @Override protected void handleOnDestroy() {
        LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(receiver);
        super.handleOnDestroy();
    }
}
