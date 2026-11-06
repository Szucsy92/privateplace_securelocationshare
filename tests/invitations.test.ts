import { expect, test } from "bun:test";
import { buildFromTag, needsUpdate, pickRelease, validApkUrl } from "../src/lib/invitations";
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
const apkUrl = "https://github.com/example/app/releases/download/build-2026-10-22_0846-13/private-place-2026-10-22_0846.apk";
test("the build number is read from the release tag", () => {
  expect(buildFromTag("build-2026-10-22_0846-13")).toBe(13);
  expect(buildFromTag("v1.0")).toBeNull();
});
test("a release is offered only with an APK and a readable build number", () => {
  expect(pickRelease({ tag_name: "build-2026-10-22_0846-13", assets: [{ name: "private-place-2026-10-22_0846.apk", browser_download_url: apkUrl }] })?.versionCode).toBe(13);
  expect(pickRelease({ tag_name: "build-2026-10-22_0846-13", assets: [{ name: "private-place-x.ipa", browser_download_url: apkUrl }] })).toBeNull();
  expect(pickRelease({ tag_name: "latest", assets: [{ name: "a.apk", browser_download_url: apkUrl }] })).toBeNull();
});
