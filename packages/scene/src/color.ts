// Colour parsing and WCAG contrast. Accepts #rgb, #rrggbb, rgb(), rgba().

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+|1\.0+)\s*)?\)$/i;

export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  let m = HEX.exec(v);
  if (m) {
    let h = m[1]!;
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = RGB.exec(v);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
    if (r > 255 || g > 255 || b > 255) return null;
    return { r, g, b, a: m[4] === undefined ? 1 : Number(m[4]) };
  }
  return null;
}

/** True for colour strings safe to drop into CSS. */
export function isColor(value: unknown): value is string {
  return parseColor(value) !== null;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** Composite a possibly translucent colour over an opaque background. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/** WCAG 2.x contrast ratio between two colour strings (fg composited over bg). */
export function contrast(fgValue: string, bgValue: string): number {
  const bg = parseColor(bgValue), fg0 = parseColor(fgValue);
  if (!bg || !fg0) return 0;
  const fg = over(fg0, bg);
  const l1 = luminance(fg), l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Channel-wise distance check, used by the sentinel colour matcher. */
export function near(a: Rgba, b: Rgba, tolerance: number): boolean {
  return Math.abs(a.r - b.r) <= tolerance && Math.abs(a.g - b.g) <= tolerance && Math.abs(a.b - b.b) <= tolerance;
}
