import type { AssetKind, CommissionStatus, Effect, FramePlay, LayerType, PartRole, Role, SlotKind, When } from "./types.ts";

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
} as const;
