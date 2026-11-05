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
            // Szolgáltatás-értesítés: azonnal látszik (Android 12+ különben akár 10 mp-et késleltet), nem csörög újra.
            builder.setCategory(Notification.CATEGORY_SERVICE).setOnlyAlertOnce(true).setShowWhen(false);
            if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
            backgroundNotification = builder.build();`);
// Csak „Hozzávetőleges” helynél is induljon a követés, és ne kérdezzen újra minden indításnál:
// a pontosítást az alkalmazás saját engedélykérője intézi (PrivateRuntime.requestPreciseLocation).
const pluginPath = root + "BackgroundGeolocation.java";
let plugin = readFileSync(pluginPath, "utf8");
if (!plugin.includes("privateLocationAllowed")) {
  const denied = 'getPermissionState("location") != PermissionState.GRANTED';
  const allowed = 'getPermissionState("location") == PermissionState.GRANTED';
  const anchor = "public class BackgroundGeolocation extends Plugin {";
  if (plugin.split(denied).length !== 4 || plugin.split(allowed).length !== 2 || !plugin.includes(anchor)) {
    throw new Error(`Pinned native source changed: ${pluginPath}`);
  }
  plugin = plugin.replaceAll(denied, "!privateLocationAllowed()").replaceAll(allowed, "privateLocationAllowed()");
  plugin = plugin.replace(anchor, `${anchor}
    private boolean privateLocationAllowed() {
        return getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || getContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }`);
  writeFileSync(pluginPath, plugin);
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
// Android 10+: a helyzetkövető szolgáltatás kifejezetten "location" típussal lép előtérbe
// (Android 14+ enélkül nem mutatja az értesítést), és engedély megadása után újra előtérbe lép.
service = readFileSync(servicePath, "utf8");
if (!service.includes("FOREGROUND_SERVICE_TYPE_LOCATION")) {
  const token = "startForeground(NOTIFICATION_ID, notification);";
  const grant = "void onPermissionsGranted() {";
  if (!service.includes(token) || !service.includes(grant)) throw new Error(`Pinned native source changed: ${servicePath}`);
  service = service.replace(token, `try { startService(new Intent(this, BackgroundGeolocationService.class)); } catch (Exception ignored) {}
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }`);
  service = service.replace(grant, `${grant}
            Notification pendingNotification = getNotification();
            if (pendingNotification != null) promote(pendingNotification);`);
  writeFileSync(servicePath, service);
}
// Energiatakarékos GPS-ütem: a mérési köz futás közben állítható (a szolgáltatás, az értesítés és a watcher érintetlen marad,
// így Android 12+ alatt sincs újraindított előtér-szolgáltatás). Ritkított (>= 5 mp) mérésnél a CPU-t ébren tartó
// wake lock felszabadul; néző mellett (<= 3 mp) marad, hogy a közvetlen kapcsolat ne szakadjon meg.
service = readFileSync(servicePath, "utf8");
if (!service.includes("// Private Place power patch")) {
  const binderToken = "public class LocalBinder extends Binder {";
  const bindToken = "public IBinder onBind(Intent intent) {";
  if (!service.includes(binderToken) || !service.includes(bindToken) || !service.includes("private android.os.PowerManager.WakeLock sharingLock;")) {
    throw new Error(`Pinned native source changed: ${servicePath}`);
  }
  service = service.replace(bindToken, `${bindToken}
        instance = this;`);
  if (!service.includes("super.onDestroy();")) throw new Error(`Pinned native source changed: ${servicePath}`);
  service = service.replace("super.onDestroy();", `if (instance == this) instance = null;
        super.onDestroy();`);
  service = service.replace(binderToken, `// Private Place power patch
    private static volatile BackgroundGeolocationService instance;
    // Ennél ritkább mérésnél nincs szükség a CPU-t ébren tartó wake lockra.
    private static final long LOCK_MAX_INTERVAL_MS = 3000;
    /** A PrivateRuntime hívja (JS: setLocationInterval). Igaz, ha volt futó szolgáltatás, amin alkalmazni lehetett. */
    public static boolean privateSetInterval(long ms) {
        BackgroundGeolocationService service = instance;
        if (service == null) return false;
        service.applyInterval(Math.max(1000L, Math.min(ms, 15000L)));
        return true;
    }
    private void applyInterval(long ms) {
        try {
            for (Watcher watcher : new java.util.ArrayList<Watcher>(watchers)) {
                LocationRequest request = new LocationRequest();
                request.setMaxWaitTime(ms);
                request.setInterval(ms);
                if (ms > 1000L) request.setFastestInterval(ms);
                request.setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY);
                request.setSmallestDisplacement(watcher.locationRequest.getSmallestDisplacement());
                watcher.locationRequest = request;
                try {
                    watcher.client.removeLocationUpdates(watcher.locationCallback);
                    watcher.client.requestLocationUpdates(request, watcher.locationCallback, null);
                } catch (SecurityException ignore) {}
            }
            // Wake lockot csak futó előtér-szolgáltatásnál (van értesítés) szabad felvenni; így nem maradhat gazdátlanul.
            if (sharingLock != null) {
                if (ms <= LOCK_MAX_INTERVAL_MS) { if (getNotification() != null && !sharingLock.isHeld()) sharingLock.acquire(); }
                else if (sharingLock.isHeld()) sharingLock.release();
            }
        } catch (Exception exception) {
            Logger.error("Failed to change location interval", exception);
        }
    }
    ${binderToken}`);
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