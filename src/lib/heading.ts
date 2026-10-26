import { smoothAngle } from "./mapMath";

export type HeadingState = { source: "gps" | "compass"; angle: number | null };
export function hybridHeading(previous: HeadingState, speed: number | null, gps: number | null, compass: number | null): HeadingState {
  const source = speed !== null && speed > 1.4 ? "gps" : speed !== null && speed < 0.8 ? "compass" : previous.source;
  const target = source === "gps" ? gps : compass;
  if (target === null || !Number.isFinite(target)) return { source, angle: previous.angle };
  const angle = previous.angle === null ? target : smoothAngle(previous.angle, target, 0.2);
  return { source, angle: ((angle % 360) + 360) % 360 };
}