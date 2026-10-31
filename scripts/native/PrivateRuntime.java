package hu.privateplace.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
importcom.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PrivateRuntime")
public class PrivateRuntime extends Plugin {

    private static final String CHANNEL_ID = "secure_location_channel_id";

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            JSObject data = new JSObject();
            boolean exit = intent.getBooleanExtra("exit", false);
            data.put("exit", exit);
            notifyListeners("sharingStopped", data, true);
            if (exit && getActivity() != null) {
                getActivity().finishAndRemoveTask();
            }
        }
    };

    @Override
    public void load() {
        super.load();
        LocalBroadcastManager.getInstance(getContext())
            .registerReceiver(receiver, new IntentFilter("hu.privateplace.STOPPED"));
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Biztonságos Helymegosztás",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("A helymegosztás háttérszolgáltatásának értesítése");
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @PluginMethod
    public void startBackgroundService(PluginCall call) {
        Context context = getContext();
        createNotificationChannel();
        
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Helymegosztás aktív")
            .setContentText("A háttérben zajlik a biztonságos pozíciókövetés.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(1001, notification);
        }

        call.resolve();
    }

    @PluginMethod
    public void stopBackgroundService(PluginCall call) {
        Context context = getContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(1001);
        }
        call.resolve();
    }

    @PluginMethod
    public void consumeStop(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("privateplace.runtime", Context.MODE_PRIVATE);
        JSObject data = new JSObject();
        data.put("stopped", prefs.getBoolean("stopped", false));
        prefs.edit().remove("stopped").apply();
        call.resolve(data);
    }

    @Override
    protected void handleOnDestroy() {
        try {
            LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(receiver);
        } catch (Exception e) {
            // Ignored
        }
        super.handleOnDestroy();
    }
}
