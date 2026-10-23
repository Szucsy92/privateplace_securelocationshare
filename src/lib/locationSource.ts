/**
 * Helymeghatározás forrása.
 * - Böngészőben: a szokásos navigator.geolocation (csak amíg az oldal látszik).
 * - Az Android-alkalmazásban: natív háttér-helymeghatározás. Ha a megosztás be van kapcsolva,
 *   egy állandó értesítés mellett lezárt képernyőnél is folytatódik.
 */
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

export type Fix = { lat: number; lng: number; acc: number | null; speed: number | null };
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

/** Android 13+: az állandó értesítéshez engedély kell; ha elutasítják, a követés akkor is fut. */
async function ensureNotificationPermission() {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const status = await LocalNotifications.checkPermissions();
    if (status.display !== "granted") await LocalNotifications.requestPermissions();
  } catch {
    // nem kritikus
  }
}

export function startLocationWatch(opts: {
  background: boolean;
  onFix: (fix: Fix) => void;
  onError: (err: FixError) => void;
}): () => void {
  let stopped = false;
  let cleanup: () => void = () => undefined;

  if (!isNativeApp()) {
    if (!("geolocation" in navigator)) {
      opts.onError("error");
      return () => undefined;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) =>
        opts.onFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: pos.coords.accuracy ?? null,
          speed: pos.coords.speed ?? null,
        }),
      (err) => opts.onError(err.code === 1 ? "denied" : "error"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }

  void (async () => {
    try {
      const plugin = await getBackgroundPlugin();
      if (opts.background) await ensureNotificationPermission();
      if (stopped) return;
      const id = await plugin.addWatcher(
        {
          ...(opts.background
            ? {
                backgroundTitle: "Private Place – megosztás aktív",
                backgroundMessage: "A szobatársaid élőben látják a helyzetedet. A megosztást az appban kapcsolhatod ki.",
              }
            : {}),
          requestPermissions: true,
          stale: false,
          distanceFilter: 0,
        },
        (loc, err) => {
          if (err) {
            opts.onError(err.code === "NOT_AUTHORIZED" ? "denied" : "error");
            return;
          }
          if (!loc) return;
          opts.onFix({ lat: loc.latitude, lng: loc.longitude, acc: loc.accuracy ?? null, speed: loc.speed ?? null });
        },
      );
      if (stopped) {
        void plugin.removeWatcher({ id });
        return;
      }
      cleanup = () => void plugin.removeWatcher({ id });
    } catch {
      if (!stopped) opts.onError("error");
    }
  })();

  return () => {
    stopped = true;
    cleanup();
  };
}
