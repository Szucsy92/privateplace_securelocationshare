import { expect, test } from "bun:test";
import { normalize, notificationStateFrom } from "../src/lib/permissions";

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
