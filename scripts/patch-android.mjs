// A Capacitor által generált Android projekt kiegészítése: hely- és kameraengedélyek.
import { readFileSync, writeFileSync } from "node:fs";

const path = "android/app/src/main/AndroidManifest.xml";
let xml = readFileSync(path, "utf8");

const entries = [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
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
