// Raster assets are shown through blob: URLs inside the studio (canvas and thumbnails),
// so re-rendering never re-parses megabytes of data URL. The cache lives for the
// session; an entry is replaced when its asset changes. Exports always use data URLs.

import type { Asset } from "@scena/scene";
import { dataUrlToBlob } from "./util.ts";

const blobs = new Map<string, { key: string; url: string }>();

export function assetHref(asset: Asset): string {
  if (asset.kind !== "raster" || !asset.url) return "";
  const key = asset.sha256 || String(asset.url.length);
  let e = blobs.get(asset.id);
  if (!e || e.key !== key) {
    if (e) URL.revokeObjectURL(e.url);
    e = { key, url: URL.createObjectURL(dataUrlToBlob(asset.url)) };
    blobs.set(asset.id, e);
  }
  return e.url;
}
