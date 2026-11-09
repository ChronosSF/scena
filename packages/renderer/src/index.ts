// @scena/renderer: renderPage(scene, page, opts) -> self-contained HTML.
// Pure TypeScript: no DOM, no network, no clock (enforced by this package's tsconfig).

export { renderPage, renderParts, resolvePalette, slotStatus, isAnimated, framesFps, isUploadedBackground, fitTransform, type RenderOptions, type RenderedParts, type RuntimeData, type RuntimeLink } from "./render.ts";
export { pageCss, fontStack, fontsHref, type CssOptions } from "./css.ts";
export { esc, jsonForScript, num } from "./escape.ts";
export {
  bboxOf, layerBBox, scaleOf, transformAttr, jitter, hotspotGeometry, layerToCanvas, layerCenter, translateForCenter,
  type Point, type HotspotGeometry,
} from "./geometry.ts";
export { RUNTIME_JS, RUNTIME_SHA256 } from "./runtime.generated.ts";
