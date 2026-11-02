import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("native stop actions, compass and deep link are applied once in generated Android output", () => {
  const dir = mkdtempSync(join(tmpdir(), "privateplace-native-"));
  try {
    const dependency = "node_modules/@capacitor-community/background-geolocation/android/src/main/java/com/equimaps/capacitor_background_geolocation";
    mkdirSync(join(dir, dependency), { recursive: true });
    for (const name of ["BackgroundGeolocation.java", "BackgroundGeolocationService.java"]) cpSync(join(dependency, name), join(dir, dependency, name));
    mkdirSync(join(dir, "scripts")); cpSync("scripts/native", join(dir, "scripts/native"), { recursive: true });
    cpSync("scripts/patch-background.mjs", join(dir, "scripts/patch-background.mjs"));
    const java = "android/app/src/main/java/hu/privateplace/app";
    mkdirSync(join(dir, java), { recursive: true });
    writeFileSync(join(dir, java, "MainActivity.java"), "package hu.privateplace.app;\nimport com.getcapacitor.BridgeActivity;\npublic class MainActivity extends BridgeActivity {}\n");
    writeFileSync(join(dir, "android/app/src/main/AndroidManifest.xml"), '<manifest><application><activity></activity></application></manifest>');
    for (let n = 0; n < 2; n++) {
      const result = Bun.spawnSync(["node", "scripts/patch-background.mjs"], { cwd: dir });
      expect(result.exitCode).toBe(0);
    }
    const service = readFileSync(join(dir, dependency, "BackgroundGeolocationService.java"), "utf8");
    expect(service.match(/onStartCommand/g)?.length).toBe(1);
    expect(service).toContain('putBoolean("stopped", true).commit()');
    expect(service).toContain("stopForeground(true)");
    expect(service).toContain("sharingLock.release()");
    expect(service.match(/FOREGROUND_SERVICE_TYPE_LOCATION/g)?.length).toBe(1);
    expect(service.match(/sharingLock\.acquire/g)?.length).toBe(1);
    expect(service).toContain("if (pendingNotification != null) promote(pendingNotification);");
    const plugin = readFileSync(join(dir, dependency, "BackgroundGeolocation.java"), "utf8");
    // A felső sávban azonnal látszó szolgáltatás-értesítés, egyszer beépítve.
    expect(plugin.match(/FOREGROUND_SERVICE_IMMEDIATE/g)?.length).toBe(1);
    expect(plugin.match(/"Megosztás leállítása"/g)?.length).toBe(1);
    // Hozzávetőleges hellyel is fut, nem kérdez újra minden indításnál.
    expect(plugin).not.toContain('getPermissionState("location")');
    expect(plugin.match(/private boolean privateLocationAllowed\(\)/g)?.length).toBe(1);
    expect(readFileSync(join(dir, java, "MainActivity.java"), "utf8")).toContain("registerPlugin(PrivateCompass.class)");
    expect(readFileSync(join(dir, java, "PrivateRuntime.java"), "utf8")).toContain("requestPreciseLocation");
    expect(readFileSync(join(dir, "android/app/src/main/AndroidManifest.xml"), "utf8")).toContain('android:scheme="privateplace"');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});