import { useEffect, useState } from "react";

/**
 * Másodpercenként frissülő óra, amely csak látható képernyőnél ketyeg: háttérben (zárolt képernyő, másik app)
 * nem ébreszti fölöslegesen a processzort és nem rendereli újra a felületet; visszatéréskor azonnal frissít.
 */
export function useVisibleClock(intervalMs = 1000): number {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer !== undefined) return;
      setClock(Date.now());
      timer = setInterval(() => setClock(Date.now()), intervalMs);
    };
    const stop = () => {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    };
    const sync = () => (document.visibilityState === "visible" ? start() : stop());
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [intervalMs]);
  return clock;
}
