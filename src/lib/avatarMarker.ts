const cache = new Map<string, string>();

/**
 * Kör alakú profilkép ikon (data URL) a térképi jelölőhöz.
 * Ha nincs kép, a kezdőbetűt rajzoljuk ki.
 */
export async function circularAvatarIcon(
  url: string | null,
  fallbackLabel: string,
  ringColor = "#3ddc97",
  size = 56,
): Promise<string> {
  const key = `${url ?? "none"}|${fallbackLabel}|${ringColor}|${size}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const r = size / 2;
  const inner = r - 4;

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, inner, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = "#2a3244";
  ctx.fillRect(0, 0, size, size);

  let drew = false;
  if (url) {
    try {
      const img = await loadImage(url);
      ctx.drawImage(img, r - inner, r - inner, inner * 2, inner * 2);
      drew = true;
    } catch {
      drew = false;
    }
  }
  if (!drew) {
    ctx.fillStyle = "#e7ecf5";
    ctx.font = `600 ${Math.round(size * 0.4)}px "DM Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((fallbackLabel || "?").charAt(0).toUpperCase(), r, r + 1);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(r, r, inner, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = ringColor;
  ctx.stroke();

  const dataUrl = canvas.toDataURL("image/png");
  cache.set(key, dataUrl);
  return dataUrl;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
