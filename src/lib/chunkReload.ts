/**
 * Ha új verzió került ki, a régi lapon a korábbi programrészek már nem tölthetők le.
 * Ilyenkor egyszer újratöltjük az oldalt (ismétlődő újratöltés nélkül), üres képernyő helyett.
 */
const KEY = "privateplace.chunkReloadAt";

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk/i.test(message);
}

export function reloadOnceForNewVersion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function lazyImportWithReload<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((error: unknown) => {
      if (isChunkLoadError(error) && reloadOnceForNewVersion()) return new Promise<T>(() => undefined);
      throw error;
    });
}

let installed = false;
export function installChunkReload() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForNewVersion()) event.preventDefault();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) reloadOnceForNewVersion();
  });
}
