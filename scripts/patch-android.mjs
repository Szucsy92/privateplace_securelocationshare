// A Capacitor által generált Android projekt kiegészítése:
// engedélyek, háttér-értesítés, saját ikon és indítókép, dátumos verziószám.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// 1) Engedélyek
const manifestPath = "android/app/src/main/AndroidManifest.xml";
let xml = readFileSync(manifestPath, "utf8");
const entries = [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.WAKE_LOCK" />',
  '<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />',
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];
const missing = entries.filter((e) => !xml.includes(e));
if (missing.length) {
  xml = xml.replace("<application", `${missing.join("\n    ")}\n\n    <application`);
}

// Biztonsági mentés tiltása: a szobakódok és a tulajdonosi kulcsok a helyi tárolóban vannak,
// ezeket nem szabad felhőbe vagy adb backup útján kimenteni.
const appTag = /<application\b[^>]*>/.exec(xml)?.[0];
if (!appTag) fail("Nem található az <application> elem az AndroidManifestben");
if (/android:allowBackup="[^"]*"/.test(appTag)) {
  xml = xml.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
} else {
  xml = xml.replace("<application", '<application android:allowBackup="false"');
}
if (!/<application\b[^>]*android:allowBackup="false"/.test(xml)) fail("Az allowBackup=false nem került be");

// Android 14+ (API 34+) requires the location foreground-service type in BOTH
// the manifest and startForeground(). The app manifest entry merges with the
// plugin's service declaration during `npx cap sync android`.
const locationService = "com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService";
const escapedServiceName = locationService.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const serviceOpeningTag = new RegExp(`<service\\b(?=[^>]*android:name=["']${escapedServiceName}["'])[^>]*>`);
if (serviceOpeningTag.test(xml)) {
  xml = xml.replace(serviceOpeningTag, (tag) => {
    if (/android:foregroundServiceType=["'][^"']*["']/.test(tag)) {
      return tag.replace(/android:foregroundServiceType=["'][^"']*["']/, 'android:foregroundServiceType="location"');
    }
    const close = tag.endsWith("/>") ? "/>" : ">";
    return tag.replace(/\s*\/?>$/, ` android:foregroundServiceType="location"${close}`);
  });
} else {
  xml = xml.replace("</application>", `    <service
        android:name="${locationService}"
        android:foregroundServiceType="location" />\n</application>`);
}

writeFileSync(manifestPath, xml);
for (const e of entries) if (!xml.includes(e)) fail(`Hiányzó engedély: ${e}`);
if (!xml.includes(`android:name="${locationService}"`) || !xml.includes('android:foregroundServiceType="location"')) {
  fail("A háttér-helymeghatározó szolgáltatás location típusa hiányzik az AndroidManifestből");
}
console.log("AndroidManifest kiegészítve:", missing.length, "új engedély; location foreground service; allowBackup=false");

// 2) Saját ikon (rétegzett ikon Android 8+ és régi ikonok) + indítókép
const resDir = "android/app/src/main/res";
if (!existsSync("assets/android-res")) fail("Hiányzik az assets/android-res mappa (python3 scripts/make-android-icons.py)");
cpSync("assets/android-res", resDir, { recursive: true, force: true });
const adaptive = readFileSync(`${resDir}/mipmap-anydpi-v26/ic_launcher.xml`, "utf8");
if (!adaptive.includes("@mipmap/ic_launcher_foreground")) fail("Az ikon nem került be");
console.log("Ikon és indítókép bemásolva");

// 2b) Indítóképernyő Android 12+: az ikon háttérszínén, a kerek ikon „kocka” nélkül
const stylesPath = `${resDir}/values/styles.xml`;
let styles = readFileSync(stylesPath, "utf8");
if (!styles.includes("windowSplashScreenBackground")) {
  styles = styles.replace(
    /(<style name="AppTheme.NoActionBarLaunch"[^>]*>)/,
    `$1
        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="android:windowBackground">@drawable/splash</item>`,
  );
  writeFileSync(stylesPath, styles);
}
if (!styles.includes("windowSplashScreenBackground")) fail("Az indítóképernyő témája nem frissült");
console.log("Indítóképernyő témája beállítva");

// 3) Háttérkövetés értesítési csatornájának neve
const valuesDir = `${resDir}/values`;
const stringsPath = `${valuesDir}/strings.xml`;
if (!existsSync(valuesDir)) mkdirSync(valuesDir, { recursive: true });
let strings = existsSync(stringsPath)
  ? readFileSync(stringsPath, "utf8")
  : "<?xml version='1.0' encoding='utf-8'?>\n<resources>\n</resources>\n";
if (!strings.includes("capacitor_background_geolocation_notification_channel_name")) {
  strings = strings.replace(
    "</resources>",
    '    <string name="capacitor_background_geolocation_notification_channel_name">Helymegosztás</string>\n</resources>',
  );
}
if (!strings.includes("capacitor_background_geolocation_notification_icon")) {
  strings = strings.replace(
    "</resources>",
    '    <string name="capacitor_background_geolocation_notification_icon">drawable/ic_tracking</string>\n</resources>',
  );
}
writeFileSync(stringsPath, strings);

// Android status-bar notifications require a dedicated, monochrome small icon.
// The adaptive launcher icon is not a valid substitute on many Android skins.
const drawableDir = `${resDir}/drawable`;
mkdirSync(drawableDir, { recursive: true });
writeFileSync(`${drawableDir}/ic_tracking.xml`, `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,2C8.13,2 5,5.13 5,9c0,5.25 7,13 7,13s7,-7.75 7,-13c0,-3.87 -3.13,-7 -7,-7zM12,11.5A2.5,2.5 0,1 1,12 6.5a2.5,2.5 0,0 1,0 5z" />
</vector>
`);

// 4) Dátumos verzió (APP_VERSION_NAME pl. 2026.10.23-2336, APP_VERSION_CODE = futás sorszáma)
const gradlePath = "android/app/build.gradle";
let gradle = readFileSync(gradlePath, "utf8");
const code = process.env.APP_VERSION_CODE;
const name = process.env.APP_VERSION_NAME;
if (code && /^\d+$/.test(code)) gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`);
if (name && /^[\w.\-]+$/.test(name)) gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${name}"`);

// A natív PrivateRuntime.java a LocalBroadcastManagert használja, amit a Capacitor app modulja nem hoz magával.
const LBM = 'implementation "androidx.localbroadcastmanager:localbroadcastmanager:1.1.0"';
if (!gradle.includes("androidx.localbroadcastmanager:localbroadcastmanager")) {
  const next = gradle.replace(/^dependencies\s*\{/m, (m) => `${m}\n    ${LBM}`);
  if (next === gradle) fail("Nem található a dependencies blokk az app/build.gradle fájlban");
  gradle = next;
}
writeFileSync(gradlePath, gradle);
console.log("Verzió:", name ?? "(alap)", code ?? "");
