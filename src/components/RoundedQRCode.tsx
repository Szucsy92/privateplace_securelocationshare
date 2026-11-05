import { useMemo, type CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";

interface RoundedQRCodeProps {
  value: string;
  size?: number;
  fgColor: string;
  bgColor: string;
  className?: string;
  style?: CSSProperties;
}

interface QRMatrix {
  count: number;
  cells: boolean[][];
}

/**
 * A QR-mátrixot a már telepített qrcode.react-ből nyerjük ki (nincs új függőség,
 * a bun.lock érintetlen marad): a statikusan renderelt SVG útvonalából
 * visszaolvassuk a sötét modulokat. Hibajavítás: "M".
 */
function buildMatrix(value: string): QRMatrix | null {
  try {
    const markup = renderToStaticMarkup(
      <QRCodeSVG value={value} size={100} level="M" marginSize={0} />,
    );
    const viewBox = /viewBox="0 0 (\d+) \1"/.exec(markup);
    if (!viewBox) return null;
    const count = Number(viewBox[1]);
    const cells = Array.from({ length: count }, () => new Array<boolean>(count).fill(false));

    // qrcode.react 4.x: "M{x} {y}h{w}v1H{x}z" (a sor végén "M{x},{y} h…")
    const run = /M\s*(\d+)[\s,]+(\d+)\s*h\s*(\d+)\s*v1\s*[hH]\s*-?\d+\s*z/g;
    let match: RegExpExecArray | null;
    let found = 0;
    while ((match = run.exec(markup))) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      const w = Number(match[3]);
      for (let i = 0; i < w; i++) {
        if (cells[y] && x + i < count) cells[y][x + i] = true;
      }
      found++;
    }
    return found > 0 ? { count, cells } : null;
  } catch {
    return null;
  }
}

const inFinder = (x: number, y: number, count: number) =>
  (x < 7 && y < 7) || (x >= count - 7 && y < 7) || (x < 7 && y >= count - 7);

/** Lekerekített négyzet útvonala (egység: modul). */
const roundRect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}` +
  `h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

export function RoundedQRCode({
  value,
  size = 210,
  fgColor,
  bgColor,
  className,
  style,
}: RoundedQRCodeProps) {
  const paths = useMemo(() => {
    const matrix = buildMatrix(value);
    if (!matrix) return null;
    const { count, cells } = matrix;

    // Adatmodulok: lekerekített pöttyök (mérsékelt sugár a megbízható olvashatóságért)
    const dots: string[] = [];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (cells[y][x] && !inFinder(x, y, count)) dots.push(roundRect(x + 0.04, y + 0.04, 0.92, 0.92, 0.32));
      }
    }

    // Sarokszemek: lekerekített gyűrű (even-odd) + lekerekített közép
    const finders = [
      [0, 0],
      [count - 7, 0],
      [0, count - 7],
    ]
      .map(([fx, fy]) => `${roundRect(fx, fy, 7, 7, 2)}${roundRect(fx + 1, fy + 1, 5, 5, 1.2)}${roundRect(fx + 2, fy + 2, 3, 3, 0.9)}`)
      .join("");

    return { count, dots: dots.join(""), finders };
  }, [value]);

  if (!paths) {
    // Tartalék: ha a mátrix nem olvasható ki, a QR-kód akkor is látszik (sima stílusban)
    return (
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        bgColor={bgColor}
        fgColor={fgColor}
        marginSize={0}
        className={className}
        style={style}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${paths.count} ${paths.count}`}
      className={className}
      style={style}
      role="img"
      aria-label="QR-kód"
      shapeRendering="geometricPrecision"
    >
      <rect width={paths.count} height={paths.count} fill={bgColor} />
      <path d={paths.dots} fill={fgColor} />
      <path d={paths.finders} fill={fgColor} fillRule="evenodd" />
    </svg>
  );
}

export default RoundedQRCode;
