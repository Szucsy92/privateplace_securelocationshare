/**
 * Engedélyek egy helyen: helyzet, háttér-helyzet, értesítés, kamera, akkumulátor-kímélés alóli mentesség.
 * Az Android-alkalmazásban natív kérésekkel, böngészőben a böngésző saját kérdéseivel.
 */
import { registerPlugin } from "@capacitor/core";
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

/** "android" | "ios" | "web": a Capacitor saját platformneve. */
export function nativePlatform(): string {
  if (typeof window === "undefined") return "web";
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return cap?.getPlatform?.() ?? "web";
}

/**
 * Mely engedélyek értelmezhetők ezen az eszközön. A „Mindig engedélyezés” és az akkumulátor-mentesség
 * Android-specifikus (saját natív résszel), iOS-en nincs rájuk ablak, ezért ott nem kérjük őket.
 */
export function permissionKeys(native = isNativeApp(), platform = nativePlatform()): PermKey[] {
  if (!native) return ["location", "camera"];
  return platform === "ios" ? ["location", "notifications", "camera"] : ["location", "backgroundLocation", "notifications", "camera", "battery"];
}

/** A rendszerablakra várhat: a felhasználó nincs időhöz kötve, de a panel 2 perc után akkor is újra használható. */
const REQUEST_WAIT_MS = 120_000;

/** Két rendszerablak között megvárja, hogy az alkalmazás újra előtérben legyen (különben a következő kérés elveszhet). */
function waitForForeground(maxMs = 15_000): Promise<void> {
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 350));
  if (typeof document === "undefined" || document.visibilityState === "visible") return settle();
  return new Promise<void>((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onChange);
      void settle().then(resolve);
    };
    const onChange = () => {
      if (document.visibilityState === "visible") done();
    };
    const timer = setTimeout(done, maxMs);
    document.addEventListener("visibilitychange", onChange);
  });
}

/** Időkorláttal: ha a hívás nem válaszol, hibát dob (a hívó dönt a tartalékról). */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`időtúllépés (${ms} ms)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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

// FONTOS: a Capacitor-plugin Proxy, amelynek minden tulajdonsága (a `then` is) natív hívás.
// Ezért sosem szabad `await`-elni, Promise-ból visszaadni vagy `async` függvényből visszaadni:
// az `await plugin` ilyenkor a `plugin.then`-t hívná, és a művelet soha nem fejeződne be.
// A pluginokat ezért szinkron módon, közvetlenül hívjuk.
const runtime = registerPlugin<RuntimePermissions>("PrivateRuntime");
const backgroundGeolocation = registerPlugin<{ openSettings: () => Promise<void> }>("BackgroundGeolocation");
function runtimePlugin() {
  return runtime;
}
function backgroundPlugin() {
  return backgroundGeolocation;
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

/** Egyetlen natív hívás sem akaszthatja meg az engedély-panelt: 4 mp után „prompt”-nak vesszük. */
export async function checkPermission(key: PermKey): Promise<PermState> {
  try {
    return await within(checkPermissionNow(key), 4000);
  } catch {
    return "prompt";
  }
}

async function checkPermissionNow(key: PermKey): Promise<PermState> {
  const native = isNativeApp();
  if (!permissionKeys(native).includes(key)) return "unsupported";
  try {
    if (!native) return await browserQuery(key === "location" ? "geolocation" : "camera");
    switch (key) {
      case "location": {
        const [capacitor, runtime] = await Promise.all([
          within(capacitorLocation(false), 3000).catch(() => null),
          within(runtimePlugin().checkLocation(), 3000)
            .then((result) => normalize(result.state))
            .catch(() => null),
        ]);
        if (capacitor === "granted" || runtime === "granted") return "granted";
        if (capacitor === "limited" || runtime === "limited") return "limited";
        return capacitor ?? runtime ?? "prompt";
      }
      case "backgroundLocation":
        // „Mindig engedélyezés”; régebbi alkalmazásverzióban csak kézzel állítható.
        try {
          return normalize((await runtimePlugin().checkBackgroundLocation()).state);
        } catch {
          return "manual";
        }
      case "notifications": {
        const system = await systemNotificationState(false);
        try {
          return notificationStateFrom((await runtimePlugin().checkNotifications()).state, system);
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
  const before = await checkPermission("location");
  if (before === "granted") return before;
  const startedAt = Date.now();
  let state: PermState = before;
  try {
    // A Capacitor saját kérése megvárja a felhasználó döntését (nincs időzítéses találgatás).
    state = await capacitorLocation(true);
  } catch {
    try {
      state = normalize((await runtimePlugin().requestPreciseLocation({ openSettings: false })).state);
    } catch {
      /* nincs több tartalék */
    }
  }
  // Ha a rendszer azonnal válaszol (nem is jelent meg ablak), csak a beállítások segítenek:
  // „elutasítva” esetén, és ha a hozzávetőleges helyzet mellé a rendszer már nem kínálja a „Pontos” ablakot.
  const answeredAtOnce = Date.now() - startedAt < 700;
  if (openSettings && answeredAtOnce && (state === "denied" || (before === "limited" && state === "limited"))) await openAppSettings();
  return state;
}

/** A felugró rendszerablakra megvárja a döntést; 2 perc után a panel újra használható, és az aktuális állapotot olvassuk. */
export async function requestPermission(key: PermKey): Promise<PermState> {
  try {
    return await within(requestPermissionNow(key), REQUEST_WAIT_MS);
  } catch {
    return await checkPermission(key);
  }
}

async function requestPermissionNow(key: PermKey): Promise<PermState> {
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
          return normalize((await runtimePlugin().requestBackgroundLocation()).state);
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
  let first = true;
  for (const key of order) {
    if (!permissionKeys().includes(key)) continue;
    if ((await checkPermission(key)) === "granted") {
      onUpdate(key, "granted");
      continue;
    }
    // Az előző rendszerablak vagy beállításoldal bezárulása után várunk, mielőtt a következőt kérnénk.
    if (!first) await waitForForeground();
    first = false;
    onUpdate(key, await requestPermission(key));
  }
}

/** Az alkalmazás rendszerbeállításai (elutasított engedélyhez és a „Mindig engedélyezés”-hez). */
export async function openAppSettings(target: "app" | "notifications" | "locationServices" = "app"): Promise<void> {
  try {
    await runtimePlugin().openSettings({ target });
    return;
  } catch {
    /* régebbi alkalmazásverzió: a háttérkövető saját megnyitója */
  }
  try {
    const plugin = backgroundPlugin();
    await plugin.openSettings();
  } catch {
    /* böngészőben nincs ilyen */
  }
}

/** Elutasított engedélyhez a pontosan hozzá tartozó beállításoldal. */
export function openPermissionSettings(key: PermKey): Promise<void> {
  return openAppSettings(key === "notifications" ? "notifications" : "app");
}

/** Nyers állapotok és válaszidők: hibakereséshez, a panelen másolható szövegként. */
export async function permissionDiagnostics(): Promise<string> {
  const lines: string[] = [`natív app: ${isNativeApp()}`];
  const probe = async (name: string, call: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      lines.push(`${name}: ${JSON.stringify(await within(call(), 4000))} (${Date.now() - started} ms)`);
    } catch (error) {
      lines.push(`${name}: HIBA ${error instanceof Error ? error.message : String(error)} (${Date.now() - started} ms)`);
    }
  };
  await probe("Geolocation.check", async () => (await import("@capacitor/geolocation")).Geolocation.checkPermissions());
  await probe("Runtime.checkLocation", async () => runtimePlugin().checkLocation());
  await probe("Runtime.checkBackground", async () => runtimePlugin().checkBackgroundLocation());
  await probe("Runtime.checkNotifications", async () => runtimePlugin().checkNotifications());
  await probe("LocalNotifications.check", async () => (await import("@capacitor/local-notifications")).LocalNotifications.checkPermissions());
  await probe("Battery.enabled", async () =>
    (await import("@capawesome-team/capacitor-android-battery-optimization")).BatteryOptimization.isBatteryOptimizationEnabled(),
  );
  return lines.join("\n");
}
