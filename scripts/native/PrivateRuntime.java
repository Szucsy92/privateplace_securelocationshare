package hu.privateplace.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "PrivateRuntime",
    permissions = { @Permission(strings = { "android.permission.POST_NOTIFICATIONS" }, alias = "notifications") }
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

    /** "granted", "denied" vagy "prompt". A rendszerbeállításban letiltott értesítést is látja (areNotificationsEnabled). */
    private String notificationDisplay() {
        android.app.NotificationManager manager = getContext().getSystemService(android.app.NotificationManager.class);
        if (manager != null && manager.areNotificationsEnabled()) return "granted";
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            PermissionState permission = getPermissionState("notifications");
            if (permission == PermissionState.PROMPT || permission == PermissionState.PROMPT_WITH_RATIONALE) return "prompt";
        }
        return "denied";
    }

    private JSObject notificationState() {
        JSObject data = new JSObject();
        data.put("display", notificationDisplay());
        return data;
    }

    @PluginMethod public void checkNotifications(PluginCall call) {
        call.resolve(notificationState());
    }

    @PluginMethod public void requestNotifications(PluginCall call) {
        if ("prompt".equals(notificationDisplay()) && android.os.Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAlias("notifications", call, "notificationsCallback");
        } else {
            call.resolve(notificationState());
        }
    }

    @PermissionCallback private void notificationsCallback(PluginCall call) {
        call.resolve(notificationState());
    }

    /** Az alkalmazás saját rendszerbeállítás-oldala (engedélyek, értesítések). */
    @PluginMethod public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(
            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            android.net.Uri.fromParts("package", getContext().getPackageName(), null)
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @Override protected void handleOnDestroy() {
        LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(receiver);
        super.handleOnDestroy();
    }
}