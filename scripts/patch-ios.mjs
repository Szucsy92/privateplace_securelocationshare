// A Capacitor által generált iOS projekt kiegészítése:
// helymeghatározási/kamera engedélyszövegek, háttér-helymeghatározás, dátumos verzió.
import { readFileSync, writeFileSync } from "node:fs";

const plistPath = "ios/App/App/Info.plist";
let plist = readFileSync(plistPath, "utf8");

const entries = {
  NSLocationWhenInUseUsageDescription: "A saját helyzeted a térképen, és megosztva a szobatársaidnak.",
  NSLocationAlwaysAndWhenInUseUsageDescription: "Hogy bekapcsolt megosztásnál a helyzeted zsebben, lezárt képernyőnél is továbbmenjen.",
  NSLocationAlwaysUsageDescription: "Hogy bekapcsolt megosztásnál a helyzeted lezárt képernyőnél is továbbmenjen.",
  NSCameraUsageDescription: "A szobák QR-kódjának beolvasásához.",
  NSPhotoLibraryUsageDescription: "Profilkép választásához.",
};

const esc = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");
let added = "";
for (const [key, value] of Object.entries(entries)) {
  if (!plist.includes(`<key>${key}</key>`)) added += `\t<key>${key}</key>\n\t<string>${esc(value)}</string>\n`;
}
if (!plist.includes("<key>UIBackgroundModes</key>")) {
  added += "\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>\n\t</array>\n";
}
const last = plist.lastIndexOf("</dict>");
plist = plist.slice(0, last) + added + plist.slice(last);

const name = process.env.APP_VERSION_NAME;
const code = process.env.APP_VERSION_CODE;
const setString = (key, value) => {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  plist = re.test(plist) ? plist.replace(re, `$1${value}$2`) : plist;
};
// iOS-en a verzió csak számokból és pontokból állhat (pl. 2026.10.24).
if (name) setString("CFBundleShortVersionString", name.split("-")[0].replace(/[^\d.]/g, "") || "1.0");
if (code && /^\d+$/.test(code)) setString("CFBundleVersion", code);

writeFileSync(plistPath, plist);
for (const key of Object.keys(entries)) if (!plist.includes(`<key>${key}</key>`)) {
  console.error(`Hiányzó Info.plist kulcs: ${key}`);
  process.exit(1);
}
console.log("Info.plist kiegészítve");
