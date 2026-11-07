import { expect, test } from "bun:test";
import { isPersonColor, PERSON_COLOR_OPTIONS, setPersonColor, SELF_COLOR_KEY } from "../src/lib/personColors";

test("a felajánlott színek érvényesek, a szabad szöveg nem", () => {
  for (const c of PERSON_COLOR_OPTIONS) expect(isPersonColor(c.value)).toBe(true);
  expect(isPersonColor(PERSON_COLOR_OPTIONS[0]?.value.toLowerCase())).toBe(true);
  expect(isPersonColor("red; background:url(x)")).toBe(false);
  expect(isPersonColor("#123456")).toBe(false);
});

test("a saját és mások színe is beállítható, az alapszín visszaállítható", () => {
  const green = PERSON_COLOR_OPTIONS[0]?.value ?? "";
  const pink = PERSON_COLOR_OPTIONS.find((c) => c.name === "Rózsaszín")?.value ?? "";
  let colors = setPersonColor({}, SELF_COLOR_KEY, green);
  colors = setPersonColor(colors, "peer-device-1", pink);
  expect(colors).toEqual({ self: green, "peer-device-1": pink });
  colors = setPersonColor(colors, "peer-device-1", null);
  expect(colors).toEqual({ self: green });
});

test("érvénytelen szín vagy azonosító nem változtat, az ismételt beállítás ugyanazt az objektumot adja", () => {
  const green = PERSON_COLOR_OPTIONS[0]?.value ?? "";
  const colors = setPersonColor({}, "peer-device-1", green);
  expect(setPersonColor(colors, "peer-device-1", green)).toBe(colors);
  expect(setPersonColor(colors, "peer-device-1", "#123456")).toBe(colors);
  expect(setPersonColor(colors, "rovid", green)).toBe(colors);
  expect(setPersonColor(colors, "peer-device-2", null)).toBe(colors);
});
