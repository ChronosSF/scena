// Page CSS, generated from the scene's theme and effects. Derived line by line from
// the prototype's stylesheet. The same function styles the published page (root
// ":root") and the studio canvas (root ".stage"), which is why every class rule
// carries the scope prefix S.

import { DEFAULT_TYPEFACE, FRAMES, TEXT_X_HEIGHT, parseColor, typeface, type FontSpec, type FramePlay, type Palette, type PaletteMode, type Role, type SceneDocument } from "@scena/scene";
import { num } from "./escape.ts";

export interface CssOptions {
  /** Root selector that carries the custom properties: ":root" for a page, ".stage" in the studio. */
  root?: string;
  /** Selector that gets the page background and font: "body" for a page. */
  body?: string;
  /** Prefix for every class rule, with a trailing space (".stage "), or "" for a page. */
  scope?: string;
  /** Studio canvas: decoration stays selectable. */
  editor?: boolean;
  demo?: boolean;
  /** Studio canvas and preview only: keep transitions even under prefers-reduced-motion. */
  forceMotion?: boolean;
}

const ROLE_VARS: [Role, string][] = [["paper", "paper"], ["mat", "mat"], ["card", "card"], ["grid", "grid"], ["line", "line"],
  ["accent1", "accent1"], ["accent2", "accent2"], ["text", "text"], ["muted", "muted"]];

/** A colour that is safe to print into CSS, or a neutral fallback. */
function col(v: string, fallback = "#808080"): string {
  const c = parseColor(v);
  if (!c) return fallback;
  return c.a === 1 ? String(v).trim() : `rgba(${c.r},${c.g},${c.b},${c.a})`;
}

function vars(m: PaletteMode): string {
  return ROLE_VARS.map(([role, name]) => `--${name}:${col(m[role])}`).join(";") +
    `;--blend:${m.blend === "multiply" ? "multiply" : "normal"};--fill-op:${num(Math.min(1, Math.max(0, m.fillOpacity ?? 1)))}`;
}

export function fontStack(font: FontSpec | undefined): string {
  const fam = String(font?.family || "Shantell Sans").replace(/[^\w \-]/g, "");
  const fb = String(font?.fallback || "sans-serif").replace(/[^\w \-",']/g, "");
  return `"${fam}", ${fb}`;
}

export function fontsHref(font: FontSpec | undefined): string {
  const fam = String(font?.family || "Shantell Sans").replace(/[^\w \-]/g, "").trim().replace(/ +/g, "+");
  const weights = (font?.weights || [400, 600, 800]).filter((w) => Number.isInteger(w) && w >= 100 && w <= 900).sort((a, b) => a - b);
  return `https://fonts.googleapis.com/css2?family=${fam}:wght@${weights.join(";")}&display=swap`;
}

export function pageCss(scene: SceneDocument, palette: Palette, o: CssOptions = {}): string {
  const R = o.root || ":root";
  const B = o.body || "body";
  const S = o.scope || "";
  const page = R === ":root";
  const lift = scene.effects?.lift || { dx: -1, dy: -4, ms: 180 };
  const ring = scene.effects?.ring || { strokeWidth: 3.5, drawMs: 550 };
  const L = palette.light, D = palette.dark;
  const dark = (sel: string) => `@media (prefers-color-scheme:dark){${R}:not([data-theme="light"]) ${sel}}${R}[data-theme="dark"] ${sel}`;

  return [
    `${R}{color-scheme:light;${vars(L)};--sticker:${col(L.card, "#fff")};--font:${fontStack(scene.theme?.font)};box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}`,
    `@media (prefers-color-scheme:dark){${R}:not([data-theme="light"]){color-scheme:dark;${vars(D)}}}`,
    `${R}[data-theme="dark"]{color-scheme:dark;${vars(D)}}`,
    `${S}*,${S}*::before,${S}*::after{box-sizing:inherit}`,
    page ? `html{scroll-padding-top:env(safe-area-inset-top,0px)}` : "",
    `${B}{margin:0;background:var(--paper);color:var(--text);font-family:var(--font);font-size:1rem;line-height:1.5}`,
    `${S}.page{max-width:30rem;margin:0 auto;padding:2rem 1.25rem 3rem}`,
    // header
    `${S}.name{margin:0;font-size:clamp(2.6rem,12vw,3.5rem);font-weight:800;line-height:1;letter-spacing:-.01em;color:var(--line);text-shadow:3px 3px 0 var(--accent1);transform:rotate(-2deg);transform-origin:left center;overflow-wrap:break-word}`,
    `${S}.bio{margin:.9rem 0 0;max-width:32ch;color:var(--muted);font-size:1.05rem}`,
    // scene
    `${S}.desk{margin:1.5rem -.5rem 0}`,
    `${S}.desk svg{display:block;width:100%;height:auto;overflow:visible}`,
    `${S}.mat{fill:var(--mat)}`,
    `${S}.grid line{stroke:var(--grid);stroke-width:1}`,
    `${S}.dot{fill:var(--grid)}`,
    `${S}.ink{fill:none;stroke:var(--line);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}`,
    ["line", "accent1", "accent2", "paper", "mat", "text"].map((r) => `${S}.role-${r}{fill:var(--${r})}${S}.stroke-${r}{stroke:var(--${r})}`).join(""),
    `${S}.fills{mix-blend-mode:var(--blend);opacity:var(--fill-op)}`,
    `${S}.art-text{font-family:var(--font);font-weight:600;fill:var(--line);font-size:15px}${S}.art-text.sm{font-size:12.5px}`,
    `${S}.raster>.lift,${S}.raster>.art{mix-blend-mode:var(--blend)}`,
    `${S}.sticker{display:none;fill:var(--sticker)}`,
    dark(`.sticker{display:inline}`), dark(`.art-text.on-accent{fill:var(--paper)}`),
    o.editor ? "" : `${S}.decor,${S}.bg{pointer-events:none}`,
    `${S}.hit{fill:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent}`,
    `${S}.ed-hit{fill:transparent}`,
    // objects
    `${S}.obj{cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent}`,
    `${S}.obj .lift{transition:transform ${num(lift.ms)}ms ease;transform-box:fill-box;transform-origin:center}`,
    `${S}.obj:hover .lift,${S}.obj.hov .lift,${S}.obj.selected .lift{transform:translate(${num(lift.dx)}px,${num(lift.dy)}px)}`,
    `${S}.ring{fill:none;stroke:var(--accent1);stroke-width:${num(ring.strokeWidth)};stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset ${num(ring.drawMs)}ms ease}`,
    `${S}.obj.selected .ring{stroke-dashoffset:0}${S}.obj.noring.selected .ring{stroke-dashoffset:1}`,
    `${S}.obj:focus-visible .ring{stroke-dashoffset:0;stroke:var(--line);stroke-dasharray:.02 .014}`,
    // part conditions
    `${S}.w-sel{display:none}${S}.obj.selected .w-sel{display:inline}${S}.obj.selected .w-idle{display:none}`,
    `${S}.w-dark{display:none}`,
    dark(`.w-dark{display:inline}`), dark(`.w-light{display:none}`),
    // tag panel
    `${S}.tag{margin-top:1rem;min-height:10rem;padding:1.1rem 1.2rem 1.2rem;background:var(--card);border:2px solid var(--line);border-radius:255px 18px 225px 18px/18px 225px 18px 255px}`,
    `${S}.hint{margin:0;color:var(--muted);font-size:1.1rem}`,
    `${S}.tag h2{margin:0;font-size:1.45rem;font-weight:800;line-height:1.2;color:var(--line)}`,
    `${S}.stat{margin:.35rem 0 0;font-weight:600;font-size:.95rem}`,
    `${S}.stat::before{content:"";display:inline-block;width:.8em;height:.8em;margin-right:.45em;border:2px solid var(--line);border-radius:50%;vertical-align:-.08em}`,
    `${S}.stat.s-open::before{background:var(--accent2)}${S}.stat.s-waitlist::before{background:var(--accent1)}`,
    `${S}.tag p.desc{margin:.35rem 0 1rem;max-width:36ch}`,
    `${S}.btn{display:inline-block;padding:.6rem 1.1rem;background:var(--line);color:var(--paper);font-family:var(--font);font-weight:800;font-size:1rem;text-decoration:none;border:0;border-radius:12px 4px 14px 5px;box-shadow:4px 4px 0 var(--accent1);cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}`,
    `${S}.btn:hover{transform:translate(-1px,-1px);box-shadow:5px 5px 0 var(--accent1)}`,
    `${S}.btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--accent1)}`,
    `${S}.btn:focus-visible,${S}.links a:focus-visible,${S}.foot a:focus-visible{outline:3px dashed var(--accent1);outline-offset:4px}`,
    // plain list
    `${S}.links-h{margin:2.25rem 0 .25rem;font-size:1.1rem;font-weight:600;color:var(--muted)}`,
    `${S}.links ul{list-style:none;margin:0;padding:0}`,
    `${S}.links a{display:block;padding:.75rem .1rem;border-bottom:2px dashed var(--grid);color:var(--text);font-weight:600;font-size:1.1rem;text-decoration:none}`,
    `${S}.links a:hover{color:var(--line);text-decoration:underline;text-decoration-color:var(--accent1);text-decoration-thickness:3px;text-underline-offset:4px}`,
    `${S}.links .ls{font-weight:400;color:var(--muted);font-size:.95rem}`,
    `${S}.foot{margin:2rem 0 0;color:var(--muted);font-size:.9rem}${S}.foot a{color:inherit}`,
    page ? `.toast{position:fixed;left:50%;bottom:calc(1rem + env(safe-area-inset-bottom,0px));transform:translate(-50%,1rem);width:min(26rem,calc(100% - 2rem));padding:.75rem 1rem;background:var(--line);color:var(--paper);border-radius:14px 6px 16px 6px;box-shadow:4px 4px 0 var(--accent1);font-weight:600;opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.toast.show{opacity:1;transform:translate(-50%,0)}` : "",
    o.forceMotion ? "" : `@media (prefers-reduced-motion:reduce){${S}.obj .lift,${S}.ring,${S}.btn${page ? ",.toast" : ""}{transition:none}}`,
    `${R}[data-motion="off"] .lift,${R}[data-motion="off"] .ring,${R}[data-motion="off"] .btn{transition:none}`,
    frameCss(scene, R, S, !!o.forceMotion),
    typefaceCss(scene, B, S),
    boardCss(scene, S, dark),
    letteringCss(scene, S),
  ].filter(Boolean).join("\n");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The curated face's weights and the name's size (ADR 0003). Shantell Sans needs nothing:
 * the rules above are written for it, so the desk's CSS does not change.
 */
function typefaceCss(scene: SceneDocument, B: string, S: string): string {
  const face = typeface(scene.theme?.font?.family);
  if (!face || face.family === DEFAULT_TYPEFACE.family) return "";
  const f = face.size;
  // running text keeps Shantell's x-height, so a small-eyed face like Caveat stays readable;
  // the name has its own size factor, and lettering inside drawings keeps the size it was drawn at
  return `${B}{font-size-adjust:${TEXT_X_HEIGHT}}${S}.name,${S}.art-text{font-size-adjust:none}` +
    `${S}.name{font-size:clamp(${r2(2.6 * f)}rem,${r2(12 * f)}vw,${r2(3.5 * f)}rem);font-weight:${face.display}}` +
    `${S}.tag h2,${S}.btn{font-weight:${face.display}}${S}.art-text,${S}.stat,${S}.links-h,${S}.links a{font-weight:${face.strong}}`;
}

/** Uploaded backgrounds: a raster without a dark variant is multiplied onto the dark mat. */
function boardCss(scene: SceneDocument, S: string, dark: (sel: string) => string): string {
  const uploaded = (scene.layers || []).some((l) => l.type === "background" && (Array.isArray(l.parts) || (l.asset && scene.assets?.[l.asset]?.kind !== "procedural")));
  if (!uploaded) return "";
  return `${S}.bg-base{display:none;fill:var(--mat)}` + dark(`.bg-base{display:inline}`) + dark(`.bgr{mix-blend-mode:multiply;opacity:var(--fill-op)}`);
}

/** The hand-lettered name: sized by its width, capped in height, and its riso shadow. */
function letteringCss(scene: SceneDocument, S: string): string {
  const lt = scene.header?.lettering;
  const a = lt ? scene.assets?.[lt.asset] : undefined;
  if (!lt || !a) return "";
  const b = a.bbox || { w: a.width, h: a.height };
  const ratio = (b.w || 1) / (b.h || 1);
  const off = scene.effects?.fillOffset || { x: 3, y: 3 };
  const width = Math.min(100, Math.max(20, lt.maxWidth ?? 85));
  return `${S}.name.lettered{text-shadow:none}${S}.name.flat{transform:none}` +
    `${S}.vh{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}` +
    // as wide as asked, but never taller than 7.5rem
    `${S}.lettering{display:grid;width:min(${num(width)}%,${r2(7.5 * ratio)}rem)}` +
    // the ink copy is positioned so it paints over the transformed shadow
    `${S}.lt{grid-area:1/1;display:block;width:100%;height:auto;overflow:visible;position:relative}` +
    `${S}.lt-sh{transform:translate(${num(off.x)}px,${num(off.y)}px);--line:var(--accent1);--accent2:var(--accent1);--text:var(--accent1);--paper:var(--accent1);--mat:var(--accent1)}`;
}

/** The frame stacks a scene uses: frame counts per play mode, and frame rates. */
function frameUse(scene: SceneDocument): { loops: Map<number, Set<FramePlay>>; once: Set<number>; fps: Set<number> } {
  const loops = new Map<number, Set<FramePlay>>(), once = new Set<number>(), fps = new Set<number>();
  for (const l of scene.layers || []) {
    for (const p of Array.isArray(l.parts) ? l.parts : []) {
      if (!Array.isArray(p.frames) || p.frames.length < 2) continue;
      const n = p.frames.length, play = p.play || FRAMES.play;
      fps.add(Math.min(FRAMES.maxFps, Math.max(FRAMES.minFps, Math.round(p.fps ?? FRAMES.fps))));
      if (play === "once-on-tap") once.add(n);
      else (loops.get(n) || loops.set(n, new Set()).get(n)!).add(play);
    }
  }
  return { loops, once, fps };
}

/**
 * Frame-flip animation (ADR 0002), only for scenes that use it. Frame 1 shows by default;
 * playing stacks flip opacity with steps(), timed by --fd (ms per frame). Loops offset each
 * frame with a negative delay so the cycle is seamless and starts on frame 1; "once-on-tap" delays each frame by
 * its position and holds the last. Reduced motion, page motion "off", Save-Data and the
 * studio's hold all show frame 1; the runtime pauses stacks with the boil.
 */
function frameCss(scene: SceneDocument, R: string, S: string, forceMotion: boolean): string {
  const { loops, once, fps } = frameUse(scene);
  if (!loops.size && !once.size) return "";
  const pct = (n: number) => `${+(100 / n).toFixed(3)}%`;
  const active: Record<Exclude<FramePlay, "once-on-tap">, (n: number) => string[]> = {
    always: (n) => [`${S}.fr-all.n${n}>.fr`],
    hover: (n) => [`${S}.obj:hover .fr-hov.n${n}>.fr`, `${S}.obj.hov .fr-hov.n${n}>.fr`, `${S}.obj:focus-visible .fr-hov.n${n}>.fr`],
    selected: (n) => [`${S}.obj.selected .fr-sel.n${n}>.fr`],
  };
  const out: string[] = [`${S}.fr{opacity:0}${S}.fr:first-child{opacity:1}`];
  out.push([...fps].sort((a, b) => a - b).map((f) => `${S}.fps${f}{--fd:${Math.round(1000 / f)}ms}`).join(""));
  const maxLoop = Math.max(0, ...loops.keys()), maxOnce = Math.max(0, ...once);
  for (const [n, plays] of [...loops].sort((a, b) => a[0] - b[0])) {
    const sel = [...plays].flatMap((p) => active[p as keyof typeof active](n));
    out.push(`@keyframes fr${n}{0%{opacity:1}${pct(n)},to{opacity:0}}` +
      `${sel.join(",")}{animation-name:fr${n};animation-duration:calc(var(--fd)*${n});animation-timing-function:step-end;animation-iteration-count:infinite}`);
  }
  if (maxLoop) {
    // Each frame's window is offset by half a frame, so the cycle starts in the middle of
    // frame 1 and no frame boundary falls on time 0, the moment of the first paint.
    let d = "";
    for (let k = 1; k <= maxLoop; k++) d += `${S}.frl>.fr:nth-last-child(${k}){animation-delay:calc(var(--fd)*-${k}.5)}`;
    out.push(d);
  }
  if (maxOnce) {
    let d = "@keyframes frw{0%{opacity:1}to{opacity:0}}@keyframes frh{0%,to{opacity:1}}" +
      `${S}.obj.selected .fro.play>.fr{animation-name:frw;animation-duration:var(--fd);animation-timing-function:step-end;animation-fill-mode:forwards}` +
      `${S}.obj.selected .fro.play>.fr:last-child{animation-name:frh}`;
    for (let k = 2; k <= maxOnce; k++) d += `${S}.fro>.fr:nth-child(${k}){animation-delay:calc(var(--fd)*${k - 1})}`;
    out.push(d);
  }
  if (!forceMotion) out.push(`@media (prefers-reduced-motion:reduce){${S}.fr{animation:none!important}}`);
  out.push(`${R}[data-motion="off"] .fr,${R}[data-fr="off"] .fr{animation:none!important}` +
    `${R}[data-motion="reduced"] .fr-all>.fr{animation:none!important}` +
    `${R}[data-fr="paused"] .fr{animation-play-state:paused!important}`);
  return out.join("\n");
}
