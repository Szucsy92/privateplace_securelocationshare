import { useEffect, useState, type RefObject } from "react";

/** Fekvő telefon: a CSS ugyanezt a feltételt használja (styles.css, "map-live" blokk). */
export const LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 600px)";

export function useLandscape(): boolean {
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(LANDSCAPE_QUERY);
    const update = () => setLandscape(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return landscape;
}

/** A függőleges kapszulasáv szélein csak akkor halványít, ha arra van még görgethető tartalom. */
export function useScrollFade(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      delete el.dataset.fadeTop;
      delete el.dataset.fadeBottom;
      return;
    }
    const update = () => {
      el.dataset.fadeTop = String(el.scrollTop > 2);
      el.dataset.fadeBottom = String(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref, enabled]);
}
