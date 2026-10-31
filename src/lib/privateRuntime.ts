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

export async function checkNotificationState(): Promise<NotificationState> {
  try {
    return normalize((await (await getPrivateRuntime()).checkNotifications()).display);
  } catch {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    return normalize((await LocalNotifications.checkPermissions()).display);
  }
}

/** Ha már megadott, nem kérdez újra. Ha a rendszer nem engedi a felugró ablakot, „denied”-et ad (ekkor a Beállítások nyitható). */
export async function requestNotificationState(): Promise<NotificationState> {
  try {
    return normalize((await (await getPrivateRuntime()).requestNotifications()).display);
  } catch {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    return normalize((await LocalNotifications.requestPermissions()).display);
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
