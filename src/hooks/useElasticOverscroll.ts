import { useEffect, useRef } from "react";

/**
 * Puha, rugalmas túlhúzás: a lista szélén az ujj húzására a tartalom
 * ellenállással enged, majd elengedéskor lágyan visszarugózik.
 * A görgethető elem első gyermekét mozgatja.
 */
export function useElasticOverscroll<T extends HTMLElement>(axis: "x" | "y") {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startPos = 0;
    let edgePos: number | null = null;
    let offset = 0;

    const target = () => el.firstElementChild as HTMLElement | null;
    const pos = (e: TouchEvent) => {
      const t = e.touches[0];
      return t ? (axis === "x" ? t.clientX : t.clientY) : 0;
    };
    const apply = (value: number, animate: boolean) => {
      const node = target();
      if (!node) return;
      node.style.transition = animate ? "transform 520ms cubic-bezier(0.22, 1.25, 0.36, 1)" : "none";
      node.style.transform = value
        ? axis === "x"
          ? `translate3d(${value}px,0,0)`
          : `translate3d(0,${value}px,0)`
        : "";
    };

    const onStart = (e: TouchEvent) => {
      startPos = pos(e);
      edgePos = null;
      offset = 0;
    };
    const onMove = (e: TouchEvent) => {
      const p = pos(e);
      const scroll = axis === "x" ? el.scrollLeft : el.scrollTop;
      const max = axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      const pullingStart = scroll <= 0 && p > startPos;
      const pullingEnd = scroll >= max - 1 && p < startPos;
      if (!pullingStart && !pullingEnd) {
        if (offset) apply((offset = 0), false);
        edgePos = null;
        return;
      }
      if (edgePos == null) edgePos = p;
      const d = p - edgePos;
      const sign = Math.sign(d);
      offset = sign * Math.min(72, Math.pow(Math.abs(d), 0.82) * 0.55);
      apply(offset, false);
    };
    const onEnd = () => {
      if (offset) apply(0, true);
      offset = 0;
      edgePos = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [axis]);

  return ref;
}
