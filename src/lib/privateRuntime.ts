/**
 * A saját natív modul (PrivateRuntime, scripts/native/PrivateRuntime.java) közös, egyszer regisztrált hídja.
 * Csak az Android-alkalmazásban hívható; a hívók előtte isNativeApp()-pal ellenőriznek.
 */
export type NotificationState = "granted" | "denied" | "prompt";

export type PrivateRuntimePlugin = {
  consumeStop(): Promise<{ stopped: boolean }>;
  addListener(event: "sharingStopped", callback: (data: { exit: boolean }) => void): Promise<{ remove(): Promise<void> }>;
  openAppSettings(): Promise<void>;
  checkNotifications(): Promise<{ display: NotificationState }>;
  requestNotifications(): Promise<{ display: NotificationState }>;
};

let runtime: PrivateRuntimePlugin | null = null;

export async function getPrivateRuntime(): Promise<PrivateRuntimePlugin> {
  if (!runtime) {
    const { registerPlugin } = await import("@capacitor/core");
    runtime = registerPlugin<PrivateRuntimePlugin>("PrivateRuntime");
  }
  return runtime;
}

function normalize(state: string | undefined): NotificationState {
  return state === "granted" || state === "denied" ? state : "prompt";
}

/** Egy natív híváshoz sem szabad örökre várni: ha nem válaszol, a többi engedély és a GPS-indítás nem akadhat el rajta. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function legacyNotificationState(request: boolean): Promise<NotificationState> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const result = request ? await LocalNotifications.requestPermissions() : await LocalNotifications.checkPermissions();
    return normalize(result.display);
  } catch {
    return "prompt";
  }
}

export async function checkNotificationState(): Promise<NotificationState> {
  try {
    const runtime = await getPrivateRuntime();
    return normalize((await withTimeout(runtime.checkNotifications(), 3000)).display);
  } catch {
    return await legacyNotificationState(false);
  }
}

/** Ha már megadott, nem kérdez újra. Ha a rendszer nem engedi a felugró ablakot, „denied”-et ad (ekkor a Beállítások nyitható). */
export async function requestNotificationState(): Promise<NotificationState> {
  try {
    const runtime = await getPrivateRuntime();
    return normalize((await withTimeout(runtime.requestNotifications(), 30000)).display);
  } catch (err) {
    // Időtúllépésnél a felugró ablak még látszhat: nem kérünk újra, csak az állapotot nézzük meg.
    if (err instanceof Error && err.message === "timeout") return await checkNotificationState();
    return await legacyNotificationState(true);
  }
}

/** Az alkalmazás konkrét rendszerbeállítás-oldala (Settings.ACTION_APPLICATION_DETAILS_SETTINGS). */
export async function openNativeAppSettings(): Promise<void> {
  try {
    await (await getPrivateRuntime()).openAppSettings();
  } catch {
    // Tartalék: a háttér-helymeghatározó bővítmény saját megoldása.
    const { registerPlugin } = await import("@capacitor/core");
    await registerPlugin<{ openSettings: () => Promise<void> }>("BackgroundGeolocation").openSettings();
  }
}
