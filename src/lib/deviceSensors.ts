import { isNativeApp } from "./locationSource";

type CompassPlugin = {
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(event: "heading", cb: (data: { heading: number }) => void): Promise<{ remove(): Promise<void> }>;
};
export async function requestCompassPermission(): Promise<boolean> {
  const orientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
  if (orientation?.requestPermission) return (await orientation.requestPermission()) === "granted";
  return true;
}
export function watchCompass(onHeading: (heading: number) => void): () => void {
  let stopped = false;
  let cleanup = () => {};
  const report = (heading: number) => { if (!stopped && Number.isFinite(heading)) onHeading(((heading % 360) + 360) % 360); };
  if (isNativeApp()) {
    void (async () => {
      try {
        const { registerPlugin } = await import("@capacitor/core");
        const plugin = registerPlugin<CompassPlugin>("PrivateCompass");
        const listener = await plugin.addListener("heading", (data) => report(data.heading));
        if (stopped) { await listener.remove(); return; }
        cleanup = () => { void listener.remove(); void plugin.stop().catch(() => {}); };
        await plugin.start();
        if (stopped) cleanup();
      } catch { /* Sensor unavailable: retain GPS heading. */ }
    })();
  } else {
    const handler = (event: DeviceOrientationEvent) => {
      const webkit = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof webkit === "number") report(webkit);
      else if (event.absolute && event.alpha !== null) report(360 - event.alpha);
    };
    window.addEventListener("deviceorientationabsolute", handler);
    window.addEventListener("deviceorientation", handler);
    cleanup = () => { window.removeEventListener("deviceorientationabsolute", handler); window.removeEventListener("deviceorientation", handler); };
  }
  return () => { stopped = true; cleanup(); };
}

export function watchBattery(onBattery: (percent: number | null) => void): () => void {
  let stopped = false;
  let cleanup = () => {};
  if (isNativeApp()) {
    const read = async () => {
      try {
        const { Device } = await import("@capacitor/device");
        const info = await Device.getBatteryInfo();
        if (!stopped) onBattery(typeof info.batteryLevel === "number" ? Math.round(info.batteryLevel * 100) : null);
      } catch { if (!stopped) onBattery(null); }
    };
    void read();
    const timer = setInterval(() => void read(), 60000);
    cleanup = () => clearInterval(timer);
  } else {
    type Battery = EventTarget & { level: number };
    const nav = navigator as Navigator & { getBattery?: () => Promise<Battery> };
    void nav.getBattery?.().then((battery) => {
      if (stopped) return;
      const read = () => { if (!stopped) onBattery(Math.round(battery.level * 100)); };
      battery.addEventListener("levelchange", read); read();
      cleanup = () => battery.removeEventListener("levelchange", read);
    }).catch(() => {});
  }
  return () => { stopped = true; cleanup(); };
}

/**
 * Járás-szerű mozgás felismerése gyorsulásmérőből (tiszta függvény, tesztelhető): elég nagy ingadozás (RMS) és
 * lépésütemnek megfelelő átmenetszám. Nem GPS, ezért a pozícióhibától független bizonyíték az induláshoz.
 */
export function looksLikeWalking(mags: number[], hz: number): boolean {
  if (mags.length < hz) return false;
  const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
  const dev = mags.map((m) => m - mean);
  const rms = Math.sqrt(dev.reduce((s, v) => s + v * v, 0) / dev.length);
  let cross = 0;
  for (let i = 1; i < dev.length; i++) if (dev[i - 1]! < 0 !== dev[i]! < 0) cross++;
  const perSec = cross / (mags.length / hz);
  return rms >= 1 && perSec >= 2.4 && perSec <= 6;
}

/** Igaz, ha az utóbbi ~3 s-ban járás-szerű mozgás volt. Előtérben működik; háttérben a natív érzékelő kell hozzá. */
export function watchWalking(onWalking: (walking: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined") return () => {};
  const samples: { t: number; m: number }[] = [];
  let walking = false, lastPositive = 0, positives = 0, lastEval = 0;
  const set = (v: boolean) => { if (v !== walking) { walking = v; onWalking(v); } };
  const handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const now = Date.now();
    samples.push({ t: now, m: Math.hypot(a.x, a.y, a.z) });
    while (samples.length && now - samples[0]!.t > 2000) samples.shift();
    if (now - lastEval < 500 || samples.length < 20) return;
    lastEval = now;
    const hz = samples.length / Math.max(0.5, (samples[samples.length - 1]!.t - samples[0]!.t) / 1000);
    if (looksLikeWalking(samples.map((s) => s.m), hz)) { positives++; lastPositive = now; } else positives = 0;
    if (positives >= 2) set(true);
    else if (now - lastPositive > 3000) set(false);
  };
  window.addEventListener("devicemotion", handler);
  return () => window.removeEventListener("devicemotion", handler);
}
