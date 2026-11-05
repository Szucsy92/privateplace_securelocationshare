import { expect, test } from "bun:test";
import { updateTransport, type TransportState } from "../src/lib/transport";
const start: TransportState = { mode: "walk", candidate: null, candidateAt: 0 };
const hold = (s: TransportState, kmh: number) => updateTransport(updateTransport(s, kmh / 3.6, 1000), kmh / 3.6, 8000).mode;
test("14 km/h starts bicycle estimate, only after seven continuous seconds", () => {
  const pending = updateTransport(start, 14 / 3.6, 1000);
  expect(updateTransport(pending, 14 / 3.6, 7999).mode).toBe("walk");
  expect(updateTransport(pending, 14 / 3.6, 8000).mode).toBe("bike");
});
test("13 km/h stays walking", () => {
  expect(hold(start, 13)).toBe("walk");
});
test("28 km/h already belongs to car", () => {
  expect(hold(start, 28)).toBe("car");
});
test("27 km/h is still bicycle", () => {
  expect(hold(start, 27)).toBe("bike");
});
test("stopping preserves car and clears a pending candidate", () => {
  expect(updateTransport({ mode: "car", candidate: "walk", candidateAt: 1 }, 0, 10000)).toEqual({ mode: "car", candidate: null, candidateAt: 10000 });
});
test("manual selection cannot be overridden by speed", () => {
  expect(updateTransport(start, 100, 10000, "bike").mode).toBe("bike");
});
test("a break in sustained speed restarts the seven second interval", () => {
  const pending = updateTransport(start, 6, 1000);
  const interrupted = updateTransport(pending, 2, 7000);
  expect(updateTransport(interrupted, 6, 8000).mode).toBe("walk");
});
