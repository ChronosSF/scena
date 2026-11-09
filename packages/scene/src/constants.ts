import type { AssetKind, BackgroundFit, CommissionStatus, Effect, FramePlay, LayerType, PartRole, Role, SlotKind, When } from "./types.ts";

export const SCHEMA_VERSION = 1 as const;
export const ROLES: readonly Role[] = ["paper", "mat", "card", "grid", "line", "accent1", "accent2", "text", "muted"];
export const KINDS: readonly SlotKind[] = ["portfolio", "shop", "commissions", "social", "newsletter", "contact", "custom"];
export const PART_ROLES: readonly PartRole[] = ["fills", "lines", "text"];
export const WHENS: readonly When[] = ["idle", "selected", "status:open", "status:closed", "status:waitlist", "theme:dark", "theme:light"];
export const STATUSES: readonly CommissionStatus[] = ["open", "closed", "waitlist"];
export const LAYER_TYPES: readonly LayerType[] = ["background", "decor", "foreground", "object"];
export const ASSET_KINDS: readonly AssetKind[] = ["svg-inline", "svg", "raster", "procedural"];
export const EFFECTS: readonly Effect[] = ["boil", "lift", "ring"];
export const FRAME_PLAYS: readonly FramePlay[] = ["always", "hover", "selected", "once-on-tap"];
export const BACKGROUND_FITS: readonly BackgroundFit[] = ["cover", "contain"];

/** The mat's shape: backgrounds clip to it ("Replace the mat"), and fit into it when clipped. */
export const MAT_SHAPE = { inset: 6, rx: 18 } as const;

/** A hand-lettered name's width, as a percentage of the header. */
export const LETTERING = { minWidth: 20, maxWidth: 100, width: 85 } as const;

/**
 * The curated typefaces (ADR 0003). The renderer builds a Google Fonts URL from the family,
 * so a scene may only name one of these. `display` and `strong` are the weights the page
 * uses for the name, headings and buttons, and for emphasis; `size` scales the name so it
 * fills the header the same way whatever the face's proportions (measured against Shantell
 * Sans at 800: about halfway between matching its width and matching its cap height).
 */
export interface Typeface {
  family: string;
  /** what it is like, for the studio */
  note: string;
  weights: readonly number[];
  display: number;
  strong: number;
  size: number;
  fallback: string;
}
export const TYPEFACES: readonly Typeface[] = [
  { family: "Shantell Sans", note: "Marker, the default", weights: [400, 600, 800], display: 800, strong: 600, size: 1, fallback: `"Chalkboard SE", "Comic Neue", "Segoe Print", "Trebuchet MS", sans-serif` },
  { family: "Caveat", note: "Quick pen", weights: [400, 600, 700], display: 700, strong: 600, size: 1.25, fallback: `"Segoe Print", "Bradley Hand", cursive` },
  { family: "Patrick Hand", note: "Felt-tip capitals", weights: [400], display: 400, strong: 400, size: 1.25, fallback: `"Segoe Print", "Comic Neue", sans-serif` },
  { family: "Kalam", note: "Pencil", weights: [400, 700], display: 700, strong: 700, size: 1.1, fallback: `"Segoe Print", "Bradley Hand", cursive` },
  { family: "Fredoka", note: "Rounded, friendly", weights: [400, 600, 700], display: 700, strong: 600, size: 1.1, fallback: `"Trebuchet MS", "Arial Rounded MT Bold", sans-serif` },
  { family: "Instrument Serif", note: "Editorial serif, for contrast", weights: [400], display: 400, strong: 400, size: 1.25, fallback: `Georgia, "Times New Roman", serif` },
];
export const DEFAULT_TYPEFACE = TYPEFACES[0]!;
/** Shantell Sans's x-height; other faces set their running text to it (font-size-adjust). */
export const TEXT_X_HEIGHT = 0.51;
export const typeface = (family: string | undefined): Typeface | undefined => TYPEFACES.find((t) => t.family === family);
/** Frame-flip animation defaults and hard limits (the budget is in LIMITS). */
export const FRAMES = { fps: 6, minFps: 2, maxFps: 12, min: 2, max: 12, play: "always" } as const;

export const STATUS_TEXT: Record<CommissionStatus, string> = { open: "Open for commissions", closed: "Commissions closed", waitlist: "Waitlist only" };
export const STATUS_WORD: Record<CommissionStatus, string> = { open: "open", closed: "closed", waitlist: "waitlist" };

/** Art class vocabulary. role-* set fill, stroke-* set stroke, ink is the scene pen, art-text is lettering. */
export const ART_CLASSES: readonly string[] = ["ink", "art-text", "sm", "on-accent",
  "role-line", "role-accent1", "role-accent2", "role-paper", "role-mat", "role-text",
  "stroke-line", "stroke-accent1", "stroke-accent2", "stroke-paper", "stroke-mat", "stroke-text"];

export const LIMITS = {
  nodes: 400,
  clickable: 8,
  assets: 24,
  sceneBytes: 10 * 1024 * 1024,
  svgBytes: 1024 * 1024,
  rasterBytes: 4 * 1024 * 1024,
  contrast: 4.5,
  displayName: 40,
  bio: 120,
  description: 140,
  /** frames per animated part: warn above framesSoft, error above frames */
  framesSoft: 4,
  frames: 6,
  /** drawings looping all the time ("always") */
  alwaysPlaying: 4,
  /** an uploaded background (asset and dark variant): warn above, error above */
  backgroundBytesSoft: 150 * 1024,
  backgroundBytes: 300 * 1024,
  /** raster backgrounds are stored at this many pixels per canvas unit (a 400-unit board at 3x) */
  pxPerUnit: 3,
  /** a hand-lettered name: warn above, error above */
  letteringBytesSoft: 60 * 1024,
  letteringBytes: 150 * 1024,
} as const;
