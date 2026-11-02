/**
 * Helymeghatározás forrása.
 * - Böngészőben: a szokásos navigator.geolocation (csak amíg az oldal látszik).
 * - Az Android-alkalmazásban: natív háttér-helymeghatározás. Ha a megosztás be van kapcsolva,
 *   egy állandó értesítés mellett lezárt képernyőnél is folytatódik.
 */
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

export type Fix = { lat: number; lng: number; acc: number | null; speed: number | null; bearing?: number | null; at?: number };
export type FixError = "denied" | "error";

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

let bgPlugin: BackgroundGeolocationPlugin | null = null;

async function getBackgroundPlugin() {
  if (!bgPlugin) {
    const { registerPlugin } = await import("@capacitor/core");
    bgPlugin = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
  }
  return bgPlugin;
}

/**
 * Android 13+: az állandó értesítéshez engedély kell; ha elutasítják (vagy a megosztás
 * értesítési csatornája némítva van), a követés akkor is fut, de a felső sávban nem látszik.
 */
async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const { checkPermission } = await import("./permissions");
    const state = await checkPermission("notifications");
    if (state === "granted") return true;
    if (state === "denied") return false;
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.requestPermissions();
    return (await checkPermission("notifications")) === "granted";
  } catch {
    return true;
  }
}

let preciseAskedThisRun = false;

export function startLocationWatch(opts: {
  background: boolean;
  onFix: (fix: Fix) => void;
  onError: (err: FixError) => void;
  /** A háttérben futó megosztás értesítése le van tiltva a telefonon. */
  onNotificationsBlocked?: () => void;
  /** Csak hozzávetőleges helyzet engedélyezett (a „Pontos hely” kapcsoló ki van kapcsolva). */
  onPreciseMissing?: () => void;
}): () => void {
  let stopped = false;
  let cleanup: () => void = () => undefined;

  let acquisitionTimer: ReturnType<typeof setTimeout> | undefined;
  let gotFix = false;
  let latestAt = 0;
  let retryTimer: ReturnType<typeof setInterval> | undefined;
  const reportFix = (fix: Fix) => {
    if (stopped || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) return;
    const at = fix.at ?? Date.now();
    if (at < latestAt || Date.now() - at > 30000 || at > Date.now() + 60000) return;
    latestAt = at;
    gotFix = true;
    clearTimeout(acquisitionTimer);
    opts.onFix({ ...fix, at });
  };
  const reportError = (err: FixError) => {
    if (!stopped && (err === "denied" || !gotFix || Date.now() - latestAt > 15000)) opts.onError(err);
  };
  acquisitionTimer = setTimeout(() => reportError("error"), 25000);

  if (!isNativeApp()) {
    if (!("geolocation" in navigator)) {
      clearTimeout(acquisitionTimer);
      opts.onError("error");
      return () => undefined;
    }
    const fromPosition = (pos: GeolocationPosition) => reportFix({
      lat: pos.coords.latitude, lng: pos.coords.longitude,
      acc: pos.coords.accuracy ?? null, speed: pos.coords.speed ?? null,
      bearing: pos.coords.heading ?? null, at: pos.timestamp,
    });
    const quickFix = () => navigator.geolocation.getCurrentPosition(fromPosition,
      (err) => reportError(err.code === 1 ? "denied" : "error"),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 10000 });
    quickFix();
    const id = navigator.geolocation.watchPosition(fromPosition, (err) => {
      reportError(err.code === 1 ? "denied" : "error");
      if (err.code !== 1 && !stopped) quickFix();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    return () => {
      stopped = true;
      clearTimeout(acquisitionTimer);
      navigator.geolocation.clearWatch(id);
    };
  }

  void (async () => {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const { checkPermission, requestPreciseLocation } = await import("./permissions");
      let location = await checkPermission("location");
      if (stopped) return;
      // Pontos helyzetet kér (hozzávetőlegesnél a rendszer „Pontos” frissítő ablakát), alkalmanként
      // legfeljebb egyszer, és itt soha nem nyit beállításoldalt, hogy ne zavarjon minden visszatéréskor.
      if ((location === "prompt" || location === "limited") && !preciseAskedThisRun) {
        preciseAskedThisRun = true;
        location = await requestPreciseLocation(false);
      }
      if (stopped) return;
      if (location !== "granted" && location !== "limited") {
        reportError("denied");
        return;
      }
      if (location === "limited") opts.onPreciseMissing?.();
      // A hálózati hely elsőként megjelenhet; a műholdas követő pontosítja.
      let quickPending = false;
      const quickFix = () => {
        if (stopped || quickPending) return;
        quickPending = true;
        void Geolocation.getCurrentPosition({ enableHighAccuracy: false, maximumAge: 0, timeout: 10000 })
          .then((pos) => reportFix({ lat: pos.coords.latitude, lng: pos.coords.longitude,
            acc: pos.coords.accuracy ?? null, speed: pos.coords.speed ?? null, bearing: pos.coords.heading ?? null, at: pos.timestamp }))
          .catch(() => undefined).finally(() => { quickPending = false; });
      };
      quickFix();
      retryTimer = setInterval(() => {
        if (!stopped && document.visibilityState === "visible" && Date.now() - latestAt > 10000) quickFix();
      }, 12000);
      const plugin = await getBackgroundPlugin();
      if (opts.background && !(await ensureNotificationPermission()) && !stopped) opts.onNotificationsBlocked?.();
      if (stopped) return;
      const id = await plugin.addWatcher({
        ...(opts.background ? {
          backgroundTitle: "Private Place – megosztás aktív",
          backgroundMessage: "Élő helymegosztás aktív",
        } : {}),
        requestPermissions: true, stale: false, distanceFilter: 0,
      }, (loc, err) => {
        if (err) { reportError(err.code === "NOT_AUTHORIZED" ? "denied" : "error"); return; }
        if (loc) reportFix({ lat: loc.latitude, lng: loc.longitude, acc: loc.accuracy ?? null, speed: loc.speed ?? null, bearing: loc.bearing ?? null, at: loc.time ?? Date.now() });
      });
      if (stopped) { void plugin.removeWatcher({ id }).catch(() => undefined); return; }
      cleanup = () => void plugin.removeWatcher({ id }).catch(() => undefined);
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
      reportError(code === "OS-PLUG-GLOC-0003" || code === "NOT_AUTHORIZED" ? "denied" : "error");
    }
  })();
  return () => {
    stopped = true;
    clearTimeout(acquisitionTimer);
    clearInterval(retryTimer);
    cleanup();
  };
}
