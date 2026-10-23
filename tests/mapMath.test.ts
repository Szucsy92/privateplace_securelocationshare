import { describe, expect, it } from "bun:test";
import { animationDurationMs, bearingDegrees, lerpPoint } from "@/lib/mapMath";

const BP = { lat: 47.4979, lng: 19.0402 };

describe("bearingDegrees", () => {
  it("északi haladás 0 fok", () => {
    expect(bearingDegrees(BP, { lat: BP.lat + 0.01, lng: BP.lng })).toBeCloseTo(0, 1);
  });
  it("keleti haladás 90 fok", () => {
    expect(bearingDegrees(BP, { lat: BP.lat, lng: BP.lng + 0.01 })).toBeCloseTo(90, 1);
  });
  it("déli haladás 180 fok", () => {
    expect(bearingDegrees(BP, { lat: BP.lat - 0.01, lng: BP.lng })).toBeCloseTo(180, 1);
  });
  it("nyugati haladás 270 fok", () => {
    expect(bearingDegrees(BP, { lat: BP.lat, lng: BP.lng - 0.01 })).toBeCloseTo(270, 1);
  });
});

describe("lerpPoint", () => {
  const a = { lat: 47.0, lng: 19.0 };
  const b = { lat: 47.01, lng: 19.02 };
  it("k=0 a kiindulópontot adja", () => {
    expect(lerpPoint(a, b, 0)).toEqual(a);
  });
  it("k=1 a végpontot adja", () => {
    expect(lerpPoint(a, b, 1)).toEqual(b);
  });
  it("k=0.5 a felezőpontot adja", () => {
    const mid = lerpPoint(a, b, 0.5);
    expect(mid.lat).toBeCloseTo(47.005, 6);
    expect(mid.lng).toBeCloseTo(19.01, 6);
  });
  it("a tartományon kívüli k-t korlátozza", () => {
    expect(lerpPoint(a, b, 2)).toEqual(b);
    expect(lerpPoint(a, b, -1)).toEqual(a);
  });
});

describe("animationDurationMs", () => {
  it("első pontnál 800 ms", () => {
    expect(animationDurationMs(null, 1000)).toBe(800);
  });
  it("a pontok időközét követi", () => {
    expect(animationDurationMs(1000, 2000)).toBe(1000);
  });
  it("400 ms alatt 400 ms", () => {
    expect(animationDurationMs(1000, 1100)).toBe(400);
  });
  it("2000 ms felett 2000 ms", () => {
    expect(animationDurationMs(1000, 9000)).toBe(2000);
  });
});

import { angleDelta, headingFromTrack } from "../src/lib/mapMath";

describe("haladási irány", () => {
  test("a forgás mindig a rövidebb irányba történik", () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
  });
  test("helyben állva nincs irány, haladva van", () => {
    expect(headingFromTrack([{ lat: 47.5, lng: 19 }, { lat: 47.5, lng: 19 }])).toBeNull();
    const h = headingFromTrack([{ lat: 47.5, lng: 19 }, { lat: 47.501, lng: 19 }]);
    expect(Math.round(h ?? -1)).toBe(0);
  });
});
