import { expect, test } from "bun:test";
import { updateTransport, type TransportState } from "../src/lib/transport";
const start: TransportState = { mode: "walk", candidate: null, candidateAt: 0 };
test("20 km/h starts bicycle estimate, only after seven continuous seconds", () => {
  const pending = updateTransport(start, 20 / 3.6, 1000);
  expect(updateTransport(pending, 20 / 3.6, 7999).mode).toBe("walk");
  expect(updateTransport(pending, 20 / 3.6, 8000).mode).toBe("bike");
});
test("50 km/h belongs to car, not bicycle", () => {
  const pending = updateTransport(start, 50 / 3.6, 1000);
  expect(updateTransport(pending, 50 / 3.6, 8000).mode).toBe("car");
});
test("below 20 km/h belongs to walking", () => {
  const car: TransportState = { mode: "car", candidate: null, candidateAt: 0 };
  expect(updateTransport(updateTransport(car, 19 / 3.6, 1000), 19 / 3.6, 8000).mode).toBe("walk");
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