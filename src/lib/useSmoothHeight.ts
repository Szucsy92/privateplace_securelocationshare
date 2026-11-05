import { useEffect, type RefObject } from "react";

/** Nagy tartalomváltásnál (pl. Szobák → QR-kód) az ablak magassága 240 ms alatt lágyan követi az új méretet. */
export function useSmoothHeight(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active || typeof ResizeObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let last = el.getBoundingClientRect().height;
    let animating = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      animating = false;
      el.style.height = "";
      el.style.transition = "";
      last = el.getBoundingClientRect().height;
    };
    const ro = new ResizeObserver(() => {
      if (animating) return;
      const next = el.getBoundingClientRect().height;
      // Apró, folyamatos változásokat (belső harmonika) nem animálunk újra.
      if (Math.abs(next - last) < 24) { last = next; return; }
      animating = true;
      el.style.transition = "none";
      el.style.height = `${last}px`;
      void el.offsetHeight;
      el.style.transition = "height 240ms ease";
      el.style.height = `${next}px`;
      timer = setTimeout(finish, 260);
    });
    ro.observe(el);
    return () => { ro.disconnect(); if (timer) clearTimeout(timer); el.style.height = ""; el.style.transition = ""; };
  }, [ref, active]);
}
