/**
 * Engedélyek egy helyen: helyzet, háttér-helyzet, értesítés, kamera, akkumulátor-kímélés alóli mentesség.
 * Az Android-alkalmazásban natív kérésekkel, böngészőben a böngésző saját kérdéseivel.
 */
import { isNativeApp } from "@/lib/locationSource";

export type PermKey = "location" | "backgroundLocation" | "notifications" | "camera" | "battery";
/** limited = csak hozzávetőleges helyzet (a „Pontos” kapcsoló ki van kapcsolva). */
export type PermState = "granted" | "limited" | "denied" | "prompt" | "manual" | "unsupported";
export type PermMap = Record<PermKey, PermState>;

const ASKED_KEY = "elohely.permissions.v1";

/** Az első indításkor egyszer kérjük el az összeset; utána a Beállításokból bármikor újra. */
export function permissionsAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return true;
  }
}

export function markPermissionsAsked() {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* nem kritikus */
  }
}

/** Mely engedélyek értelmezhetők ezen az eszközön (a webes változatban kevesebb). */
export function permissionKeys(native = isNativeApp()): PermKey[] {
  return native ? ["location", "backgroundLocation", "notifications", "camera", "battery"] : ["location", "camera"];
}

export function normalize(state: string | undefined): PermState {
  if (state === "granted") return "granted";
  if (state === "limited") return "limited";
  if (state === "denied") return "denied";
  return "prompt";
}

/** A natív értesítés-állapot: off = alkalmazásszinten tiltva, channelOff = csak a megosztás csatornája némítva. */
export function notificationStateFrom(native: string, systemPrompt: PermState): PermState {
  if (native === "granted") return "granted";
  if (native === "channelOff") return "denied";
  return systemPrompt === "granted" ? "denied" : systemPrompt;
}

async function browserQuery(name: string): Promise<PermState> {
  try {
    const res = await navigator.permissions.query({ name } as PermissionDescriptor);
    return normalize(res.state);
  } catch {
    return "prompt";
  }
}

type RuntimePermissions = {
  checkLocation(): Promise<{ state: string }>;
  requestPreciseLocation(options: { openSettings: boolean }): Promise<{ state: string }>;
  checkBackgroundLocation(): Promise<{ state: string }>;
  requestBackgroundLocation(): Promise<{ state: string }>;
  checkNotifications(): Promise<{ state: string }>;
  openSettings(options: { target: "app" | "notifications" | "locationServices" }): Promise<void>;
};

async function runtimePlugin() {
  const { registerPlugin } = await import("@capacitor/core");
  return registerPlugin<RuntimePermissions>("PrivateRuntime");
}

async function backgroundPlugin() {
  const { registerPlugin } = await import("@capacitor/core");
  return registerPlugin<{ openSettings: () => Promise<void> }>("BackgroundGeolocation");
}

/** Régebbi alkalmazásverzió (saját natív rész nélkül): a Capacitor saját állapota. */
async function capacitorLocation(request: boolean): Promise<PermState> {
  const { Geolocation } = await import("@capacitor/geolocation");
  const state = request
    ? await Geolocation.requestPermissions({ permissions: ["location", "coarseLocation"] })
    : await Geolocation.checkPermissions();
  if (state.location === "granted") return "granted";
  if (state.coarseLocation === "granted") return "limited";
  return normalize(state.location);
}

async function systemNotificationState(request: boolean): Promise<PermState> {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const status = request ? await LocalNotifications.requestPermissions() : await LocalNotifications.checkPermissions();
  return normalize(status.display);
}

export async function checkPermission(key: PermKey): Promise<PermState> {
  const native = isNativeApp();
  if (!permissionKeys(native).includes(key)) return "unsupported";
  try {
    if (!native) return await browserQuery(key === "location" ? "geolocation" : "camera");
    switch (key) {
      case "location":
        try {
          return normalize((await (await runtimePlugin()).checkLocation()).state);
        } catch {
          return await capacitorLocation(false);
        }
      case "backgroundLocation":
        // „Mindig engedélyezés”; régebbi alkalmazásverzióban csak kézzel állítható.
        try {
          return normalize((await (await runtimePlugin()).checkBackgroundLocation()).state);
        } catch {
          return "manual";
        }
      case "notifications": {
        const system = await systemNotificationState(false);
        try {
          return notificationStateFrom((await (await runtimePlugin()).checkNotifications()).state, system);
        } catch {
          return system;
        }
      }
      case "camera": {
        const { Camera } = await import("@capacitor/camera");
        return normalize((await Camera.checkPermissions()).camera);
      }
      case "battery": {
        const { BatteryOptimization } = await import("@capawesome-team/capacitor-android-battery-optimization");
        const { enabled } = await BatteryOptimization.isBatteryOptimizationEnabled();
        return enabled ? "prompt" : "granted";
      }
    }
  } catch {
    return "prompt";
  }
}

export async function checkAllPermissions(): Promise<PermMap> {
  const keys: PermKey[] = ["location", "backgroundLocation", "notifications", "camera", "battery"];
  const states = await Promise.all(keys.map((k) => checkPermission(k)));
  return Object.fromEntries(keys.map((k, i) => [k, states[i]])) as PermMap;
}

/**
 * Pontos helyzet kérése. Ha a rendszer már nem kérdez, és `openSettings` igaz,
 * az alkalmazás beállításoldala nyílik meg (Engedélyek → Hely → Pontos hely).
 */
export async function requestPreciseLocation(openSettings: boolean): Promise<PermState> {
  try {
    return normalize((await (await runtimePlugin()).requestPreciseLocation({ openSettings })).state);
  } catch {
    return await capacitorLocation(true);
  }
}

export async function requestPermission(key: PermKey): Promise<PermState> {
  const native = isNativeApp();
  if (!permissionKeys(native).includes(key)) return "unsupported";
  try {
    if (!native) {
      if (key === "location") {
        await new Promise<void>((resolve) =>
          navigator.geolocation.getCurrentPosition(
            () => resolve(),
            () => resolve(),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
          ),
        );
      } else if (key === "camera" && navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          /* elutasítva */
        }
      }
      return await checkPermission(key);
    }
    switch (key) {
      case "location":
        return await requestPreciseLocation(true);
      case "backgroundLocation":
        try {
          return normalize((await (await runtimePlugin()).requestBackgroundLocation()).state);
        } catch {
          await openAppSettings();
          return "manual";
        }
      case "notifications": {
        const before = await checkPermission("notifications");
        // Tiltott értesítéshez (vagy némított megosztás-csatornához) a rendszer már nem kérdez: beállításoldal.
        if (before === "denied") {
          await openAppSettings("notifications");
          return before;
        }
        await systemNotificationState(true);
        return await checkPermission("notifications");
      }
      case "camera": {
        const { Camera } = await import("@capacitor/camera");
        return normalize((await Camera.requestPermissions({ permissions: ["camera"] })).camera);
      }
      case "battery": {
        const { BatteryOptimization } = await import("@capawesome-team/capacitor-android-battery-optimization");
        await BatteryOptimization.requestIgnoreBatteryOptimization();
        return await checkPermission("battery");
      }
    }
  } catch {
    return await checkPermission(key);
  }
}

/**
 * Sorban mindegyik engedély legmagasabb szintjét kéri: pontos helyzet, értesítés, kamera,
 * majd a „Mindig engedélyezés” (Android 11+ ehhez a beállításoldalt nyitja) és az akkumulátor-mentesség.
 */
export async function requestAllPermissions(onUpdate: (key: PermKey, state: PermState) => void): Promise<void> {
  const order: PermKey[] = ["location", "notifications", "camera", "backgroundLocation", "battery"];
  for (const key of order) {
    if (!permissionKeys().includes(key)) continue;
    if ((await checkPermission(key)) === "granted") {
      onUpdate(key, "granted");
      continue;
    }
    onUpdate(key, await requestPermission(key));
  }
}

/** Az alkalmazás rendszerbeállításai (elutasított engedélyhez és a „Mindig engedélyezés”-hez). */
export async function openAppSettings(target: "app" | "notifications" | "locationServices" = "app"): Promise<void> {
  try {
    await (await runtimePlugin()).openSettings({ target });
    return;
  } catch {
    /* régebbi alkalmazásverzió: a háttérkövető saját megnyitója */
  }
  try {
    const plugin = await backgroundPlugin();
    await plugin.openSettings();
  } catch {
    /* böngészőben nincs ilyen */
  }
}

/** Elutasított engedélyhez a pontosan hozzá tartozó beállításoldal. */
export function openPermissionSettings(key: PermKey): Promise<void> {
  return openAppSettings(key === "notifications" ? "notifications" : "app");
}
