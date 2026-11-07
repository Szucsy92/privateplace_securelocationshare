import { expect, test } from "bun:test";
import { looksLikeWalking } from "../src/lib/deviceSensors";

const HZ = 50;
const sig = (n: number, f: (t: number) => number) => Array.from({ length: n }, (_, i) => 9.81 + f(i / HZ));
test("1,8 Hz-es, 2 m/s² amplitúdójú járás-jel felismerhető", () => {
  expect(looksLikeWalking(sig(100, (t) => 2 * Math.sin(2 * Math.PI * 1.8 * t)), HZ)).toBe(true);
});
test("az asztalon fekvő telefon (kis zaj) nem járás", () => {
  expect(looksLikeWalking(sig(100, (t) => 0.05 * Math.sin(40 * t)), HZ)).toBe(false);
});
test("lassú, nagy lengés (autó fékezés) nem járás", () => {
  expect(looksLikeWalking(sig(100, (t) => 2 * Math.sin(2 * Math.PI * 0.3 * t)), HZ)).toBe(false);
});
test("rövid minta nem elég", () => {
  expect(looksLikeWalking(sig(20, (t) => 2 * Math.sin(2 * Math.PI * 1.8 * t)), HZ)).toBe(false);
});

test("lassú járás kisebb gyorsulás-ingadozással is felismerhető", () => {
  expect(looksLikeWalking(sig(150, (t) => 1.0 * Math.sin(2 * Math.PI * 1.45 * t)), HZ)).toBe(true);
});
test("kis amplitúdójú asztali rezgés nem lesz járás", () => {
  expect(looksLikeWalking(sig(150, (t) => 0.2 * Math.sin(2 * Math.PI * 1.6 * t)), HZ)).toBe(false);
});
