// A Capacitor által generált Android projekt kiegészítése: engedélyek és a háttér-értesítés szövegei.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const path = "android/app/src/main/AndroidManifest.xml";
let xml = readFileSync(path, "utf8");

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
  writeFileSync(path, xml);
}

for (const e of entries) {
  if (!xml.includes(e)) {
    console.error("Hiányzó engedély:", e);
    process.exit(1);
  }
}
console.log("AndroidManifest kiegészítve:", missing.length, "új bejegyzés");

// A háttérkövetés értesítési csatornájának neve (a telefon beállításaiban látszik).
const valuesDir = "android/app/src/main/res/values";
const stringsPath = `${valuesDir}/strings.xml`;
if (!existsSync(valuesDir)) mkdirSync(valuesDir, { recursive: true });
let strings = existsSync(stringsPath) ? readFileSync(stringsPath, "utf8") : "<?xml version='1.0' encoding='utf-8'?>\n<resources>\n</resources>\n";
const channel = '<string name="capacitor_background_geolocation_notification_channel_name">Helymegosztás</string>';
if (!strings.includes("capacitor_background_geolocation_notification_channel_name")) {
  strings = strings.replace("</resources>", `    ${channel}\n</resources>`);
  writeFileSync(stringsPath, strings);
}
console.log("Értesítési csatorna beállítva");
