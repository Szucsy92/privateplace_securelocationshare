import { expect, test } from "bun:test";
import { isChunkLoadError } from "../src/lib/chunkReload";
test("missing program parts after a new release are recognised", () => {
  expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/LiveMap-EI652Feq.js"))).toBe(true);
  expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
});
