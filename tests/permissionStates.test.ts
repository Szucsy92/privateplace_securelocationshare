import { expect, test } from "bun:test";
import { normalize, notificationStateFrom, permissionKeys } from "../src/lib/permissions";

test("approximate-only location is reported as limited, not granted", () => {
  expect(normalize("limited")).toBe("limited");
  expect(normalize("granted")).toBe("granted");
});

test("a muted sharing notification channel counts as blocked even if notifications are allowed", () => {
  expect(notificationStateFrom("channelOff", "granted")).toBe("denied");
});

test("notifications switched off for the app need the settings page, unless the system can still ask", () => {
  expect(notificationStateFrom("off", "granted")).toBe("denied");
  expect(notificationStateFrom("off", "prompt")).toBe("prompt");
  expect(notificationStateFrom("granted", "granted")).toBe("granted");
});

test("each platform is only asked for permissions it has", () => {
  expect(permissionKeys(false, "web")).toEqual(["location", "camera"]);
  expect(permissionKeys(true, "android")).toEqual(["location", "backgroundLocation", "notifications", "camera", "battery"]);
  // iOS-en nincs „Mindig engedélyezés” ablak és akkumulátor-mentesség: különben a panel sosem lenne „kész”.
  expect(permissionKeys(true, "ios")).toEqual(["location", "notifications", "camera"]);
});
