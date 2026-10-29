import { isNativeApp } from "./locationSource";
type Runtime = {
  consumeStop(): Promise<{ stopped: boolean }>;
  addListener(event: "sharingStopped", callback: (data: { exit: boolean }) => void): Promise<{ remove(): Promise<void> }>;
};
/** Native stop actions persist their decision even if JavaScript is suspended. */
export function watchNativeStop(onStop: (exit: boolean) => void): () => void {
  let cancelled = false;
  let cleanup = () => {};
  if (!isNativeApp()) return cleanup;
  void (async () => {
    try {
      const { registerPlugin } = await import("@capacitor/core");
      const runtime = registerPlugin<Runtime>("PrivateRuntime");
      const listener = await runtime.addListener("sharingStopped", ({ exit }) => { if (!cancelled) onStop(exit); });
      if (cancelled) { await listener.remove(); return; }
      cleanup = () => { void listener.remove(); };
      const stopped = await runtime.consumeStop();
      if (!cancelled && stopped.stopped) onStop(false);
    } catch { /* iOS has no Android foreground notification actions. */ }
  })();
  return () => { cancelled = true; cleanup(); };
}