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
