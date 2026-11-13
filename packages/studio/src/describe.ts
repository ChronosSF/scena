// One-line descriptions of a drawing or a background for the inspector header.

import { layerAssets, type Layer, type RasterAsset, type SceneDocument } from "@scena/scene";
import { frameCount, frameTiming, mainParts } from "./frames.ts";
import { rasterFormat } from "./ingest/raster.ts";
import { kb } from "./util.ts";

const ROLE_WORD: Record<string, string> = { line: "ink", accent1: "colour 1", accent2: "colour 2" };

/** "PNG · 525×770 · 68 KB · own colours", or "SVG · 21 shapes · 1.4 KB · recoloured (ink, colour 1)". */
export function assetSummary(scene: SceneDocument, layer: Layer): string {
  const assets = [...new Set(layerAssets(layer))].map((id) => scene.assets[id]).filter((a) => a !== undefined);
  if (!assets.length) return "";
  const bytes = assets.reduce((s, a) => s + (a.bytes || 0), 0);
  const n = frameCount(layer);
  // frames report the one box they were padded to, so the author knows they register
  const frames = n > 1 ? `${n} frames at ${frameTiming(layer).fps} fps in one ${boxOf(scene, layer)} box · ` : "";
  const raster = assets.find((a): a is RasterAsset => a.kind === "raster");
  if (raster) return `${rasterFormat(raster.url)} · ${frames || `${raster.width}×${raster.height} · `}${kb(bytes)} · own colours`;
  const roles = new Set(assets.flatMap((a) => a.colorRoles || []));
  const nodes = assets.reduce((s, a) => s + (a.nodeCount || 0), 0);
  return `SVG · ${frames}${nodes} shapes · ${kb(bytes)} · ${roles.size ? `recoloured (${[...roles].map((r) => ROLE_WORD[r] || r).join(", ")})` : "own colours"}`;
}

function boxOf(scene: SceneDocument, layer: Layer): string {
  const main = mainParts(layer);
  const a = scene.assets[main[main.length - 1]?.asset || ""];
  const b = a?.bbox || (a ? { w: a.width, h: a.height } : null);
  return b ? `${Math.round(b.w)}×${Math.round(b.h)}` : "shared";
}
