import { expect, test } from "bun:test";
import { hybridHeading } from "../src/lib/heading";
test("above 1.4 m/s GPS is exclusive", () => {
  expect(hybridHeading({ source: "compass", angle: null }, 1.41, 90, 180)).toEqual({ source: "gps", angle: 90 });
});
test("below 0.8 m/s compass takes over", () => {
  expect(hybridHeading({ source: "gps", angle: null }, 0.79, 90, 180)).toEqual({ source: "compass", angle: 180 });
});
test("0.8 through 1.4 m/s retains the previous source", () => {
  for (const speed of [0.8, 1, 1.4]) expect(hybridHeading({ source: "gps", angle: null }, speed, 90, 180).source).toBe("gps");
});
test("EMA 0.2 crosses north by the short path", () => {
  expect(hybridHeading({ source: "gps", angle: 359 }, 2, 1, 180).angle).toBeCloseTo(359.4);
});