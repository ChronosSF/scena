// A drawn desk top and a lettered "Pia", in the desk's style. One source for two outputs:
// the scene sample (art classes, scripts/encode-samples.ts) and the fixture files an
// illustrator would upload (sentinel colours, tools/make-fixtures.ts). See ADR 0003.

export type ArtMode = "classes" | "sentinel";

const ink = (m: ArtMode, w = 2.4) => (m === "classes" ? `class="ink"${w !== 2.4 ? ` stroke-width="${w}"` : ""}` : `fill="none" stroke="#FF00FF" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`);
const fill = (m: ArtMode, role: "accent1" | "accent2") => (m === "classes" ? `class="role-${role}"` : `fill="${role === "accent1" ? "#00FFFF" : "#FFFF00"}"`);
const strokeIn = (m: ArtMode, role: "accent1" | "accent2", w: number) =>
  m === "classes" ? `class="stroke-${role}" fill="none" stroke-width="${w}" stroke-linecap="round"` : `fill="none" stroke="${role === "accent1" ? "#00FFFF" : "#FFFF00"}" stroke-width="${w}" stroke-linecap="round"`;

/** The desk top's board, in art units: the same as the desk's canvas. */
export const DESK_TOP_BOX = { x: 0, y: 0, w: 400, h: 440 };

/** The colour layer: a light wash of colour 2 over the whole board. */
export function deskTopFills(m: ArtMode): string {
  return `<rect ${fill(m, "accent2")} opacity="0.16" x="0" y="0" width="400" height="440" rx="18"/>`;
}

/** The line layer: plank seams with a little wobble, grain strokes and a few knots. */
export function deskTopLines(m: ArtMode): string {
  const seams = [72, 146, 222, 296, 370].map((y, i) => {
    const w = i % 2 ? 3 : -3;
    return `<path ${ink(m, 2)} d="M-4 ${y} C 90 ${y + w}, 170 ${y - w}, 250 ${y + w / 2} S 360 ${y - w}, 404 ${y}"/>`;
  });
  const grain = [[40, 30, 70], [210, 40, 60], [120, 104, 80], [300, 112, 58], [60, 182, 64], [250, 190, 90], [150, 258, 70], [320, 262, 50], [30, 336, 80], [200, 330, 70], [110, 404, 60], [290, 400, 80]]
    .map(([x, y, len]) => `<path ${ink(m, 1.4)} d="M${x} ${y} q${len! / 2} -5 ${len} 0"/>`);
  const knots = [[96, 40], [330, 186], [70, 262], [240, 404]].map(([cx, cy]) => `<ellipse ${ink(m, 1.6)} cx="${cx}" cy="${cy}" rx="9" ry="5"/>`);
  return seams.join("") + grain.join("") + knots.join("");
}

/** A desk top as one SVG file, painted with the sentinel colours. */
export function deskTopFile(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="880" viewBox="0 0 400 440">
  <title>Drawn desk top</title>
  <g>${deskTopFills("sentinel")}</g>
  <g>${deskTopLines("sentinel")}</g>
</svg>
`;
}

/** "Pia" with a brush pen: the letters in ink, a dot of colour 1 on the i, a swash of colour 2 under it. */
export const PIA_STROKES = [
  // P: stem and bowl
  "M24 96 C 25 72, 22 42, 25 14",
  "M25 17 C 66 6, 80 42, 28 54",
  // i: stem
  "M98 56 C 99 70, 97 82, 100 96",
  // a: bowl and stem
  "M156 62 C 130 50, 118 92, 144 95 C 158 97, 164 80, 166 62",
  "M166 58 C 165 76, 167 88, 176 97",
];
export const PIA_DOT = { cx: 99, cy: 34, r: 6.5 };
export const PIA_SWASH = "M14 106 C 70 99, 140 112, 206 101";
export const PIA_VIEWBOX = { w: 220, h: 118 };

export function letteringFile(): string {
  const { w, h } = PIA_VIEWBOX;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w * 3}" height="${h * 3}" viewBox="0 0 ${w} ${h}">
  <title>Pia, lettered</title>
  <path ${strokeIn("sentinel", "accent2", 7)} d="${PIA_SWASH}"/>
  ${PIA_STROKES.map((d) => `<path ${ink("sentinel", 9)} d="${d}"/>`).join("\n  ")}
  <circle ${fill("sentinel", "accent1")} cx="${PIA_DOT.cx}" cy="${PIA_DOT.cy}" r="${PIA_DOT.r}"/>
</svg>
`;
}
