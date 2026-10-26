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
    const timer = setInterval(() => void read(), 30000);
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