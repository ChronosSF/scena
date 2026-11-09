// Scene format, schema version 1. Mirrors docs/development-plan.md sections 3.2 and 3.3.
// Extensions beyond the plan are marked EXT; all of them are optional, so documents
// shaped exactly like the plan stay valid.

export type Role = "paper" | "mat" | "card" | "grid" | "line" | "accent1" | "accent2" | "text" | "muted";
export type BlendMode = "multiply" | "normal";

export type PaletteMode = Record<Role, string> & { blend: BlendMode; fillOpacity: number };

export interface Palette {
  id: string;
  /** EXT: label shown in the studio. */
  name?: string;
  light: PaletteMode;
  dark: PaletteMode;
}

export type SlotKind = "portfolio" | "shop" | "commissions" | "social" | "newsletter" | "contact" | "custom";
export type CommissionStatus = "open" | "closed" | "waitlist";

export interface Slot {
  id: string;
  /** What the editor calls it ("Sketchbook"). */
  label: string;
  /** The object layer that represents it. */
  objectId: string;
  kind: SlotKind;
  defaults: { title: string; description: string; cta: string };
  /** Template. Placeholders: {title} {list} {label} {cta}. */
  a11yLabel: string;
  optional: boolean;
  statusAware?: boolean;
}

export interface Transform {
  x: number;
  y: number;
  rotate?: number;
  scale?: number;
}

export type PartRole = "fills" | "lines" | "text";
export type When = "idle" | "selected" | "status:open" | "status:closed" | "status:waitlist" | "theme:dark" | "theme:light";

/** When a frame-animated part flips its frames. */
export type FramePlay = "always" | "hover" | "selected" | "once-on-tap";

export interface Part {
  /** The art. For a frame-animated part this is frame 1, so readers without frame support show a still drawing. */
  asset: string;
  /** fills get the blend mode and the misregistration offset */
  role: PartRole;
  when?: When;
  /**
   * EXT, frame-flip animation: asset ids, frame 1 first (equal to `asset`). Two or more,
   * all vector or all raster, sharing one box so they register on top of each other.
   */
  frames?: string[];
  /** EXT: frames per second, a whole number from 2 to 12. Default 6 ("on twos" at 12 fps). */
  fps?: number;
  /** EXT: when the frames play. Default "always". Decorations only play "always". */
  play?: FramePlay;
  /** EXT: frame-animated parts skip the boil filter (the frames already wobble); true boils them anyway. */
  boil?: boolean;
}

/**
 * Hotspot geometry is in the art's own (unscaled) units; "auto" pads the parts'
 * bounding box in canvas units.
 */
export type Hotspot =
  | { shape: "ellipse"; cx: number; cy: number; rx: number; ry: number; rotate?: number }
  | { shape: "path"; d: string }
  | { shape: "auto"; pad: number };

export type Effect = "boil" | "lift" | "ring";
export type LayerType = "background" | "decor" | "foreground" | "object";
/** How an uploaded background meets the board: "cover" fills it (cropping), "contain" shows all of it. */
export type BackgroundFit = "cover" | "contain";

interface LayerBase {
  id: string;
  /** EXT: human name shown in the studio. */
  name?: string;
  transform?: Transform;
  opacity?: number;
  effects?: Effect[];
  /** Single-asset art (background, decor, foreground). */
  asset?: string;
  /** Multi-part art. Required on objects; EXT: also allowed on decor. */
  parts?: Part[];
  /**
   * EXT, background layers only: fit the art to the board, centred (the mat's box when
   * `clip` is set, else the canvas). Without `fit`, `transform` places it like a drawing.
   */
  fit?: BackgroundFit;
  /** EXT, background layers only: clip to the mat's rounded shape. */
  clip?: boolean;
  /**
   * EXT, background layers only: a dark-mode variant of `asset` (the same kind). Without one,
   * a raster background is multiplied onto the dark mat at the palette's fill opacity.
   */
  assetDark?: string;
}

export interface ArtLayer extends LayerBase {
  type: "background" | "decor" | "foreground";
}

export interface ObjectLayer extends LayerBase {
  type: "object";
  slotId: string;
  transform: Transform;
  parts: Part[];
  hotspot: Hotspot;
}

export type Layer = ArtLayer | ObjectLayer;

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AssetBase {
  id: string;
  width: number;
  height: number;
  /** EXT: art bounds in asset coordinates (auto hotspots, status tags, sticker backing). */
  bbox?: BBox;
  bytes: number;
  sha256: string;
  /** Which theme roles the art uses (vector only). */
  colorRoles?: Role[];
  /** For the performance lint. */
  nodeCount?: number;
  /** EXT: original file name. */
  source?: string;
}

export interface SvgInlineAsset extends AssetBase {
  kind: "svg-inline";
  /** Sanitised SVG fragment. */
  src: string;
}

export interface SvgAsset extends AssetBase {
  kind: "svg";
  url: string;
}

/** Where a raster was cut from its source canvas, in source pixels. */
export interface RasterCrop {
  x: number;
  y: number;
  w: number;
  h: number;
  /** size of the exported canvas the image came from */
  sw: number;
  sh: number;
}

export interface RasterAsset extends AssetBase {
  kind: "raster";
  /** data:image/png or data:image/webp in this build; an object-storage URL once publishing exists. */
  url: string;
  /** EXT, studio: the crop from the source canvas, so frames exported later from the same canvas register. */
  crop?: RasterCrop;
}

export type ProceduralGenerator = "mat" | "grid" | "dots";

/** EXT: generated at render time (cutting mat, grid, dot paper). */
export interface ProceduralAsset extends AssetBase {
  kind: "procedural";
  generator: ProceduralGenerator;
  params?: { inset?: number; step?: number; start?: number; rx?: number; r?: number };
}

export type Asset = SvgInlineAsset | SvgAsset | RasterAsset | ProceduralAsset;
export type AssetKind = Asset["kind"];

export interface BoilEffect {
  enabled: boolean;
  baseFrequency: number;
  octaves: number;
  displacement: number;
  seeds: number[];
  intervalMs: number;
  scope: "scene" | "object";
}

export interface SceneEffects {
  boil: BoilEffect;
  lift: { dx: number; dy: number; ms: number };
  ring: { strokeWidth: number; drawMs: number };
  /** Riso misregistration of fills against lines. */
  fillOffset: { x: number; y: number };
}

export interface FontSpec {
  family: string;
  weights: number[];
  fallback: string;
}

/** EXT: a hand-lettered name, drawn in place of the typed name. */
export interface Lettering {
  /** an svg-inline or raster asset */
  asset: string;
  /** largest width as a percentage of the header, 20 to 100; default 85 */
  maxWidth?: number;
  /** the header's slight tilt, as on the typed name; default true */
  tilt?: boolean;
}

export interface Copy {
  /** Prompt under the drawing ("Tap anything on my desk."). */
  hint?: string;
  /** Accessible label of the drawing. */
  sceneLabel?: string;
}

export interface SceneDocument {
  schemaVersion: 1;
  id: string;
  /** semver */
  version: string;
  name: string;
  author: { userId: string; displayName: string };
  license: "builtin" | "private" | "marketplace";
  audience: string[];
  /** viewBox; 400 x 440 for the desk */
  canvas: { width: number; height: number };
  theme: {
    roles: Role[];
    palettes: Palette[];
    defaultPalette: string;
    font: FontSpec;
  };
  effects: SceneEffects;
  slots: Slot[];
  layers: Layer[];
  /** slot ids */
  fallback: { heading: string; order: string[] };
  assets: Record<string, Asset>;
  /**
   * `font` (EXT): page owners may pick another face from the curated list (presets, later).
   * The scene's author always sets theme.font directly.
   */
  editable: { palettes: "all" | string[]; allowDisableSlots: boolean; font?: boolean };
  /** EXT: default prompt and drawing label */
  copy?: Copy;
  /** EXT: the page header as the author designed it: a hand-lettered name. */
  header?: { lettering?: Lettering };
}

export interface LinkContent {
  enabled: boolean;
  title: string;
  description: string;
  cta: string;
  url: string;
  status?: CommissionStatus;
  statusNote?: string;
  /** EXT: plain-list wording when it should differ from the panel title. */
  listLabel?: string;
}

export type ThemeMode = "auto" | "light" | "dark";
export type Motion = "auto" | "reduced" | "off";

export interface PageDocument {
  schemaVersion: 1;
  /** pinned */
  scene: { id: string; version: string };
  handle: string;
  profile: { displayName: string; bio: string };
  theme: { palette: string; mode: ThemeMode };
  motion: Motion;
  /** keyed by slot id */
  links: Record<string, LinkContent>;
  fallbackList: { show: boolean; heading?: string };
  seo: { title?: string; description?: string };
  /** Set by the server from the plan at publish. */
  badge: boolean;
  /** EXT: the page owner's prompt and drawing label */
  copy?: Copy;
}

export type DocumentKind = "scene" | "page";

export type LintLevel = "ok" | "warn" | "error";
export interface LintCheck {
  id: string;
  level: LintLevel;
  label: string;
  detail: string;
}
export interface LintReport {
  ok: boolean;
  errors: number;
  warnings: number;
  checks: LintCheck[];
}
