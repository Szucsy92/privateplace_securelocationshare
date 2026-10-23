import { describe, expect, test } from "bun:test";
import { parseTurnConfig } from "../src/lib/turn";

describe("parseTurnConfig", () => {
  test("no relay configured means none is used", () => {
    expect(parseTurnConfig(undefined, undefined, undefined)).toBeUndefined();
    expect(parseTurnConfig("  ", "u", "p")).toBeUndefined();
  });

  test("accepts comma separated turn/turns urls with credentials", () => {
    expect(parseTurnConfig("turn:a.example:3478, turns:a.example:5349", "user", "secret")).toEqual([
      { urls: ["turn:a.example:3478", "turns:a.example:5349"], username: "user", credential: "secret" },
    ]);
  });

  test("ignores urls that are not relay addresses", () => {
    expect(parseTurnConfig("https://evil.example,turn:ok.example", "", "")).toEqual([{ urls: ["turn:ok.example"] }]);
  });
});
