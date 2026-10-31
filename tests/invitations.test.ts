import { expect, test } from "bun:test";
import { needsUpdate, validApkUrl } from "../src/lib/invitations";
test("only a newer installed-version code offers an update", () => {
  expect(needsUpdate(12, 13)).toBe(true);
  expect(needsUpdate(13, 13)).toBe(false);
  expect(needsUpdate(14, 13)).toBe(false);
});
test("downloads must be HTTPS GitHub release APKs", () => {
  expect(validApkUrl("https://github.com/example/app/releases/download/build-13/private-place-latest.apk")).toBe(true);
  expect(validApkUrl("https://example.com/app.apk")).toBe(false);
  expect(validApkUrl("javascript:alert(1)")).toBe(false);
});