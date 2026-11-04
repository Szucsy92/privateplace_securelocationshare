import { afterEach, expect, test } from "bun:test";
import { startLocationWatch } from "../src/lib/locationSource";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

test("a saját friss hozzávetőleges hely megjelenhet a pontos GPS előtt", () => {
  let precise: PositionCallback | undefined;
  let quick: PositionCallback | undefined;
  let cleared = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: {
    getCurrentPosition: (cb: PositionCallback, _error: PositionErrorCallback, opts: PositionOptions) => {
      expect(opts.enableHighAccuracy).toBe(false);
      expect(opts.maximumAge).toBe(0);
      quick = cb;
    },
    watchPosition: (cb: PositionCallback) => { precise = cb; return 12; },
    clearWatch: (id: number) => { cleared = id; },
  } } });
  const fixes: number[] = [];
  const stop = startLocationWatch({ background: false, onFix: (fix) => fixes.push(fix.lat), onError: () => {} });
  const pos = (latitude: number) => ({ coords: { latitude, longitude: 19, accuracy: 200, speed: null } }) as GeolocationPosition;
  quick?.(pos(47));
  precise?.(pos(47.5));
  expect(fixes).toEqual([47, 47.5]);
  stop();
  expect(cleared).toBe(12);
  quick?.(pos(48));
  expect(fixes).toEqual([47, 47.5]);
});

test("a helyhozzáférés elutasítása nem marad végtelen keresés", () => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: {
    getCurrentPosition: (_cb: PositionCallback, error: PositionErrorCallback) => error({ code: 1 } as GeolocationPositionError),
    watchPosition: () => 1,
    clearWatch: () => {},
  } } });
  const errors: string[] = [];
  const stop = startLocationWatch({ background: false, onFix: () => {}, onError: (err) => errors.push(err) });
  expect(errors).toEqual(["denied"]);
  stop();
});
test("a hálózati fix újabb időbélyege nem dobatja el a műholdas fixet", () => {
  let precise: PositionCallback | undefined;
  let quick: PositionCallback | undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: {
    getCurrentPosition: (cb: PositionCallback) => { quick = cb; },
    watchPosition: (cb: PositionCallback) => { precise = cb; return 1; },
    clearWatch: () => {},
  } } });
  const fixes: number[] = [];
  const stop = startLocationWatch({ background: false, onFix: (fix) => fixes.push(fix.lat), onError: () => {} });
  const now = Date.now();
  const pos = (latitude: number, timestamp: number) => ({ timestamp, coords: { latitude, longitude: 19, accuracy: 10, speed: null } }) as GeolocationPosition;
  quick?.(pos(47, now + 5000));
  precise?.(pos(47.5, now));
  expect(fixes).toEqual([47, 47.5]);
  stop();
});
