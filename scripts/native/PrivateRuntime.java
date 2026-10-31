package hu.privateplace.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.provider.Settings;
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
    /** Opens this app's Android details page so the user can set Location to "Allow all the time". */
    @PluginMethod public void openLocationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the app's Android permission settings", error);
        }
    }
    @PluginMethod public void consumeStop(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("privateplace.runtime", Context.MODE_PRIVATE);
        JSObject data = new JSObject();
        data.put("stopped", prefs.getBoolean("stopped", false));
        prefs.edit().remove("stopped").apply();
        call.resolve(data);
    }
    @Override protected void handleOnDestroy() {
        LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(receiver);
        super.handleOnDestroy();
    }
}