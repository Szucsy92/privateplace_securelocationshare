// Deterministic CI patch for the pinned background-geolocation 1.3.1 Android source.
// No generated Android folders or modified installed dependencies are committed.
import { readFileSync, writeFileSync, cpSync, mkdirSync } from "node:fs";
const root = "node_modules/@capacitor-community/background-geolocation/android/src/main/java/com/equimaps/capacitor_background_geolocation/";
function patch(file, needle, replacement) {
  const source = readFileSync(file, "utf8");
  if (source.includes("// Private Place runtime patch")) return;
  if (!source.includes(needle)) throw new Error(`Pinned native source changed: ${file}`);
  writeFileSync(file, source.replace(needle, replacement));
}
patch(root + "BackgroundGeolocation.java", "backgroundNotification = builder.build();", `// Private Place runtime patch
            for (String action : new String[]{"hu.privateplace.STOP", "hu.privateplace.EXIT"}) {
                Intent control = new Intent(getContext(), BackgroundGeolocationService.class).setAction(action);
                PendingIntent pending = PendingIntent.getService(getContext(), action.endsWith("EXIT") ? 28353 : 28352,
                    control, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                builder.addAction(android.R.drawable.ic_media_pause, action.endsWith("EXIT") ? "Kilépés" : "Megosztás leállítása", pending);
            }
            backgroundNotification = builder.build();`);
// The plugin binds its service asynchronously in load(). On a fast first share tap,
// addWatcher() could run before onServiceConnected() and reject with "Service not running",
// which meant no foreground notification was ever created. Retry briefly instead.
const pluginPath = root + "BackgroundGeolocation.java";
let pluginSource = readFileSync(pluginPath, "utf8");
if (!pluginSource.includes("Private Place service-bind retry")) {
  const needle = `        if (service == null) {
            call.reject("Service not running.");
            return;
        }`;
  const replacement = `        if (service == null) {
            // Private Place service-bind retry
            final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
            handler.postDelayed(new Runnable() {
                int attempts = 0;
                @Override public void run() {
                    if (service != null) {
                        addWatcher(call);
                    } else if (++attempts < 50) {
                        handler.postDelayed(this, 100);
                    } else {
                        call.reject("Background location service did not connect.");
                    }
                }
            }, 100);
            return;
        }`;
  if (!pluginSource.includes(needle)) throw new Error(`Pinned native source changed: ${pluginPath} (service binding guard not found)`);
  pluginSource = pluginSource.replace(needle, replacement);
  writeFileSync(pluginPath, pluginSource);
}

patch(root + "BackgroundGeolocationService.java", "private final IBinder binder = new LocalBinder();", `// Private Place runtime patch
    private android.os.PowerManager.WakeLock sharingLock;
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ("hu.privateplace.STOP".equals(intent.getAction()) || "hu.privateplace.EXIT".equals(intent.getAction()))) {
            getSharedPreferences("privateplace.runtime", MODE_PRIVATE).edit().putBoolean("stopped", true).commit();
            for (Watcher watcher : watchers) watcher.client.removeLocationUpdates(watcher.locationCallback);
            watchers.clear();
            if (sharingLock != null && sharingLock.isHeld()) sharingLock.release();
            stopForeground(true);
            LocalBroadcastManager.getInstance(this).sendBroadcast(new Intent("hu.privateplace.STOPPED").putExtra("exit", "hu.privateplace.EXIT".equals(intent.getAction())));
            stopSelf();
        }
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        for (Watcher watcher : watchers) watcher.client.removeLocationUpdates(watcher.locationCallback);
        watchers.clear();
        if (sharingLock != null && sharingLock.isHeld()) sharingLock.release();
        super.onDestroy();
    }
    private final IBinder binder = new LocalBinder();`);
// Independent transformations are verified, applied once, and owned by this script.
const servicePath = root + "BackgroundGeolocationService.java";
let service = readFileSync(servicePath, "utf8");
if (!service.includes("sharingLock.acquire")) {
  service = service.replace("startForeground(NOTIFICATION_ID, notification);", `startForeground(NOTIFICATION_ID, notification);
            if (sharingLock == null) {
                android.os.PowerManager power = (android.os.PowerManager) getSystemService(POWER_SERVICE);
                sharingLock = power.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "PrivatePlace:sharing");
                sharingLock.setReferenceCounted(false);
            }
            if (!sharingLock.isHeld()) sharingLock.acquire();`);
  service = service.replace("stopForeground(true);\n                    }", "stopForeground(true);\n                        if (sharingLock != null && sharingLock.isHeld()) sharingLock.release();\n                    }");
  writeFileSync(servicePath, service);
}
// Android 14+ (API 34+): startForeground() gets the explicit "location" service type.
// Defensive: any failure is logged and falls back to the plain call, so it can never break location updates.
// DIAGNOSTICS records what the service really does and shows it as a Toast when the app comes back to the foreground
// (set to false once the notification works).
const DIAGNOSTICS = true;
service = readFileSync(servicePath, "utf8");
if (!service.includes("FOREGROUND_SERVICE_TYPE_LOCATION")) {
  const call = /([ \t]*)startForeground\(\s*NOTIFICATION_ID\s*,\s*notification\s*\);/;
  if (!call.test(service)) throw new Error(`Pinned native source changed: ${servicePath} (startForeground call not found)`);
  const diag = (i, expr) => (DIAGNOSTICS ? `${i}ppDiag(${expr});\n` : "");
  const enabled = '((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).areNotificationsEnabled()';
  service = service.replace(call, (_m, i) => `${i}try {
${i}    if (android.os.Build.VERSION.SDK_INT >= 34) {
${i}        startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
${i}    } else {
${i}        startForeground(NOTIFICATION_ID, notification);
${i}    }
${diag(i + "    ", `"startForeground OK, ertesites engedelyezve=" + ${enabled}`)}${i}} catch (Exception typedStart) {
${i}    android.util.Log.e("PrivatePlace", "startForeground(location) failed, retrying without type", typedStart);
${diag(i + "    ", `"startForeground HIBA: " + typedStart`)}${i}    try {
${i}        startForeground(NOTIFICATION_ID, notification);
${i}    } catch (Exception plainStart) {
${i}        android.util.Log.e("PrivatePlace", "plain startForeground failed", plainStart);
${diag(i + "        ", `"tipus nelkuli hiba is: " + plainStart`)}${i}    }
${i}}`);
  if (DIAGNOSTICS) {
    const helpers = `private void ppDiag(String message) {
        try {
            android.content.SharedPreferences prefs = getSharedPreferences("privateplace.diag", MODE_PRIVATE);
            String old = prefs.getString("log", "");
            prefs.edit().putString("log", old.isEmpty() ? message : old + " | " + message).apply();
        } catch (Exception ignored) {}
    }
    private void ppShowDiag() {
        try {
            final android.content.SharedPreferences prefs = getSharedPreferences("privateplace.diag", MODE_PRIVATE);
            final String log = prefs.getString("log", "");
            if (log.isEmpty()) return;
            prefs.edit().remove("log").apply();
            new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> android.widget.Toast.makeText(getApplicationContext(), "PP: " + log, android.widget.Toast.LENGTH_LONG).show());
        } catch (Exception ignored) {}
    }
    `;
    const binderNeedle = "private final IBinder binder = new LocalBinder();";
    if (!service.includes(binderNeedle)) throw new Error(`Pinned native source changed: ${servicePath} (binder field not found)`);
    service = service.replace(binderNeedle, helpers + binderNeedle);
    // Optional instrumentation: skipped silently when the pinned source looks different.
    service = service.replace(/(void\s+onActivityStarted\s*\(\s*\)\s*\{)/, "$1\n            ppShowDiag();\n            ppDiag(\"onActivityStarted\");");
    service = service.replace(/(void\s+onActivityStopped\s*\(\s*\)\s*\{)/, "$1\n            ppDiag(\"onActivityStopped notification=\" + (notification != null));");
    service = service.replace(/(void\s+addWatcher\s*\(([^)]*Notification\s+(\w+)[^)]*)\)\s*\{)/, (m, _all, _params, name) => `${m}\n            ppDiag("addWatcher notification=" + (${name} != null));`);
  }
  writeFileSync(servicePath, service);
}
const java = "android/app/src/main/java/hu/privateplace/app";
const manifestPath = "android/app/src/main/AndroidManifest.xml";
let manifest = readFileSync(manifestPath, "utf8");
if (!manifest.includes('android:scheme="privateplace"')) {
  manifest = manifest.replace('</activity>', `<intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="privateplace" android:host="join" />
            </intent-filter></activity>`);
  writeFileSync(manifestPath, manifest);
}
mkdirSync(java, { recursive: true });
for (const name of ["PrivateCompass", "PrivateRuntime"]) cpSync(`scripts/native/${name}.java`, `${java}/${name}.java`);
patch(`${java}/MainActivity.java`, "public class MainActivity extends BridgeActivity {}", `public class MainActivity extends BridgeActivity {
    // Private Place runtime patch
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(PrivateCompass.class);
        registerPlugin(PrivateRuntime.class);
        super.onCreate(savedInstanceState);
    }
}`);