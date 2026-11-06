import { isNativeApp } from "./locationSource";
type Runtime = {
  consumeStop(): Promise<{ stopped: boolean }>;
  addListener(event: "sharingStopped", callback: (data: { exit: boolean }) => void): Promise<{ remove(): Promise<void> }>;
};
/** Native stop actions persist their decision even if JavaScript is suspended. */
export function watchNativeStop(onStop: (exit: boolean) => void, onReady: () => void): () => void {
  let cancelled = false;
  let cleanup = () => {};
  if (!isNativeApp()) { onReady(); return cleanup; }
  void (async () => {
    try {
      const { registerPlugin } = await import("@capacitor/core");
      const runtime = registerPlugin<Runtime>("PrivateRuntime");
      const listener = await runtime.addListener("sharingStopped", ({ exit }) => { if (!cancelled) { onStop(exit); void runtime.consumeStop(); } });
      if (cancelled) { await listener.remove(); return; }
      cleanup = () => { void listener.remove(); };
      const stopped = await runtime.consumeStop();
      if (!cancelled && stopped.stopped) onStop(false);
      if (!cancelled) onReady();
    } catch { if (!cancelled) { onStop(false); onReady(); } }
  })();
  return () => { cancelled = true; cleanup(); };
}
let wantedGpsMs = 1000;
let appliedGpsMs = 1000;
function runtimePlugin() {
  return import("@capacitor/core").then(({ registerPlugin }) => registerPlugin<{ setLocationInterval(o: { ms: number }): Promise<void> }>("PrivateRuntime"));
}
/**
 * A natív háttérkövető GPS-mérési közét állítja futás közben (a szolgáltatás és az értesítés érintetlen marad).
 * Újraindított követőnél a natív oldal az 1 mp-es alapra áll vissza: ilyenkor `force` újra elküldi a kívánt értéket.
 */
export function setNativeLocationInterval(ms: number, force = false): void {
  if (!isNativeApp()) return;
  wantedGpsMs = ms;
  if (!force && appliedGpsMs === ms) return;
  appliedGpsMs = ms;
  void runtimePlugin().then((p) => p.setLocationInterval({ ms })).catch(() => { appliedGpsMs = -1; });
}
/** Új natív követő indulása után hívjuk: a kívánt mérési köz visszaállítása (alapérték: 1 mp, nincs teendő). */
export function reapplyNativeLocationInterval(): void {
  appliedGpsMs = 1000;
  if (wantedGpsMs !== 1000) setNativeLocationInterval(wantedGpsMs, true);
}

type UpdateRuntime = {
  downloadAndInstall(options: { url: string }): Promise<{ state: UpdateState }>;
  addListener(event: "updateProgress", callback: (data: { percent: number }) => void): Promise<{ remove(): Promise<void> }>;
};
export type UpdateState = "installing" | "needsPermission" | "failed";
/**
 * Az új APK letöltése az appon belül, majd a rendszer telepítőjének indítása.
 * installing = a telepítő megnyílt; needsPermission = az „ismeretlen forrás” engedély oldala nyílt meg; failed = nem sikerült.
 */
export async function downloadAndInstallUpdate(url: string, onProgress: (percent: number) => void): Promise<UpdateState> {
  if (!isNativeApp()) return "failed";
  let listener: { remove(): Promise<void> } | null = null;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const runtime = registerPlugin<UpdateRuntime>("PrivateRuntime");
    listener = await runtime.addListener("updateProgress", ({ percent }) => onProgress(percent));
    const result = await runtime.downloadAndInstall({ url });
    return result.state;
  } catch {
    return "failed";
  } finally {
    await listener?.remove().catch(() => {});
  }
}

/** A telepített APK tényleges versionCode-ja (a natív csomaginfóból); a build-időben beírt érték csak tartalék. */
export async function installedVersionCode(): Promise<number> {
  const built = Number(import.meta.env["VITE_APP_VERSION_CODE"] ?? 0);
  if (!isNativeApp()) return built;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const runtime = registerPlugin<{ versionCode(): Promise<{ versionCode: number }> }>("PrivateRuntime");
    const { versionCode } = await runtime.versionCode();
    return Number.isInteger(versionCode) && versionCode > 0 ? versionCode : built;
  } catch {
    return built;
  }
}
