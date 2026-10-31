import { isNativeApp } from "./locationSource";
import { getPrivateRuntime } from "./privateRuntime";
/** Native stop actions persist their decision even if JavaScript is suspended. */
export function watchNativeStop(onStop: (exit: boolean) => void, onReady: () => void): () => void {
  let cancelled = false;
  let cleanup = () => {};
  if (!isNativeApp()) { onReady(); return cleanup; }
  void (async () => {
    try {
      const runtime = await getPrivateRuntime();
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