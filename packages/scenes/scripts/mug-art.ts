// The steaming mug: three hand-drawn frames of rising steam, in the desk's style.
// One source for two outputs: the scene sample (art classes, scripts/encode-samples.ts)
// and the fixture files an illustrator would upload (sentinel colours, tools/make-fixtures.ts).
// The mug is redrawn in every frame, with the small wobble of a hand redraw; the colour
// layer is printed once (a still fills part under animated lines).

export type MugMode = "classes" | "sentinel";
export const MUG_FRAMES = 3;
/** Shared artboard of the frame files, in art units. */
export const MUG_VIEWBOX = { w: 84, h: 108 };

const inkAttr = (m: MugMode) => (m === "classes" ? 'class="ink"' : 'fill="none" stroke="#FF00FF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"');
const fillAttr = (m: MugMode, role: "accent1" | "accent2") => (m === "classes" ? `class="role-${role}"` : `fill="${role === "accent1" ? "#00FFFF" : "#FFFF00"}"`);

/** The colour layer: the mug body and a heart. Still in every frame. */
export function mugFills(m: MugMode): string {
  return `<path ${fillAttr(m, "accent1")} d="M8 50 Q9 92 16 98 Q34 106 52 98 Q59 92 60 50 Q34 58 8 50 Z"/>` +
    `<path ${fillAttr(m, "accent2")} d="M34 86 C23 77 25 68 31 70 Q34 71 34 74 Q34 71 37 70 C43 68 45 77 34 86 Z"/>`;
}

// per-frame wobble of the redrawn mug, and where each steam strand starts, which way it curls and how many waves it has
const WOBBLE: [number, number][] = [[0, 0], [0.7, -0.5], [-0.6, 0.5]];
const STEAM: [number, number, 1 | -1, number][][] = [
  [[22, 42, 1, 2], [34, 38, -1, 3], [46, 42, 1, 2]],
  [[22, 40, -1, 2], [34, 41, 1, 2], [46, 38, -1, 3]],
  [[22, 38, 1, 3], [34, 42, -1, 2], [46, 40, 1, 2]],
];

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The line layer of frame k (0-based): the mug outline and the steam. */
export function mugLines(m: MugMode, k: number): string {
  const [a, b] = WOBBLE[k]!;
  const ink = inkAttr(m);
  const mug = [
    `<ellipse ${ink} cx="${r1(34 + a / 2)}" cy="50" rx="${r1(26 + b / 2)}" ry="6"/>`,
    `<path ${ink} d="M8 50 Q${r1(9 + a)} 92 16 98 Q34 ${r1(106 + b)} 52 98 Q${r1(59 - a)} 92 60 50"/>`,
    `<path ${ink} d="M59 60 Q${r1(78 + b)} ${r1(57 + a)} 76 74 Q${r1(74 - a)} 90 57 88"/>`,
    `<path ${ink} d="M34 86 C23 77 25 68 31 70 Q34 71 34 74 Q34 71 37 70 C43 68 45 77 34 86 Z"/>`,
  ];
  const steam = STEAM[k]!.map(([x, y, dir, waves]) => `<path ${ink} d="M${x} ${y} q${r1(3.5 * dir)} -6 0 -12${" t0 -12".repeat(waves - 1)}"/>`);
  return mug.join("") + steam.join("");
}

/** A frame as a standalone SVG file, painted with the sentinel colours. */
export function mugFile(k: number): string {
  const { w, h } = MUG_VIEWBOX;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w * 4}" height="${h * 4}" viewBox="0 0 ${w} ${h}">
  <title>Steaming mug, frame ${k + 1} of ${MUG_FRAMES}</title>
  <g>${mugFills("sentinel")}</g>
  <g>${mugLines("sentinel", k)}</g>
</svg>
`;
}
