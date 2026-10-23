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
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];
const missing = entries.filter((e) => !xml.includes(e));
if (missing.length) {
  xml = xml.replace("<application", `${missing.join("\n    ")}\n\n    <application`);
  writeFileSync(manifestPath, xml);
}
for (const e of entries) if (!xml.includes(e)) fail(`Hiányzó engedély: ${e}`);
console.log("AndroidManifest kiegészítve:", missing.length, "új bejegyzés");

// 2) Saját ikon (rétegzett ikon Android 8+ és régi ikonok) + indítókép
const resDir = "android/app/src/main/res";
if (!existsSync("assets/android-res")) fail("Hiányzik az assets/android-res mappa (python3 scripts/make-android-icons.py)");
cpSync("assets/android-res", resDir, { recursive: true, force: true });
const adaptive = readFileSync(`${resDir}/mipmap-anydpi-v26/ic_launcher.xml`, "utf8");
if (!adaptive.includes("@mipmap/ic_launcher_foreground")) fail("Az ikon nem került be");
console.log("Ikon és indítókép bemásolva");

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
  writeFileSync(stringsPath, strings);
}

// 4) Dátumos verzió (APP_VERSION_NAME pl. 2026.10.23-2336, APP_VERSION_CODE = futás sorszáma)
const gradlePath = "android/app/build.gradle";
let gradle = readFileSync(gradlePath, "utf8");
const code = process.env.APP_VERSION_CODE;
const name = process.env.APP_VERSION_NAME;
if (code && /^\d+$/.test(code)) gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`);
if (name && /^[\w.\-]+$/.test(name)) gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${name}"`);
writeFileSync(gradlePath, gradle);
console.log("Verzió:", name ?? "(alap)", code ?? "");
