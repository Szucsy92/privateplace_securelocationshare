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
// Android 14+ (API 34+) requires the foreground-service type to be declared
// in AndroidManifest.xml and passed to startForeground(). The matching service
// declaration is added by patch-android.mjs before `cap sync`.
service = readFileSync(servicePath, "utf8");
if (!service.includes("FOREGROUND_SERVICE_TYPE_LOCATION")) {
  const call = /startForeground\(\s*NOTIFICATION_ID\s*,\s*notification\s*\);/;
  if (!call.test(service)) throw new Error(`Pinned native source changed: ${servicePath} (startForeground call not found)`);
  service = service.replace(call, `if (android.os.Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }`);
  writeFileSync(servicePath, service);
}

const java = "android/app/src/main/java/hu/privateplace/app";
const manifestPath = "android/app/src/main/AndroidManifest.xml";
let manifest = readFileSync(manifestPath, "utf8");
// Android 14+ rejects startForeground(..., LOCATION) unless the service itself
// declares foregroundServiceType="location" in the final app manifest.
// The dependency manifest is merged by Gradle, so patch the app manifest explicitly.
const locationServiceName = "com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService";
const serviceTagPattern = /<service\b(?=[^>]*android:name=["'][^"']*BackgroundGeolocationService["'])[^>]*\/?\s*>/;
const existingService = manifest.match(serviceTagPattern)?.[0];
if (existingService) {
  let updatedService = existingService;
  if (/android:foregroundServiceType=["'][^"']*["']/.test(updatedService)) {
    updatedService = updatedService.replace(/android:foregroundServiceType=["'][^"']*["']/, 'android:foregroundServiceType="location"');
  } else {
    updatedService = updatedService.replace(/\s*\/?\s*>$/, ' android:foregroundServiceType="location" />');
  }
  manifest = manifest.replace(existingService, updatedService);
} else {
  const applicationClose = manifest.lastIndexOf("</application>");
  if (applicationClose < 0) throw new Error("AndroidManifest.xml: missing </application>; cannot declare location foreground service");
  const declaration = `    <service android:name="${locationServiceName}" android:exported="false" android:foregroundServiceType="location" />\n`;
  manifest = manifest.slice(0, applicationClose) + declaration + manifest.slice(applicationClose);
}
if (!manifest.includes('android:foregroundServiceType="location"')) {
  throw new Error("AndroidManifest.xml: location foreground service type was not applied");
}
if (!manifest.includes('android:scheme="privateplace"')) {
  manifest = manifest.replace('</activity>', `<intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="privateplace" android:host="join" />
            </intent-filter></activity>`);
}
// Always persist the manifest: the service type may have changed even when the deep link already existed.
writeFileSync(manifestPath, manifest);
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