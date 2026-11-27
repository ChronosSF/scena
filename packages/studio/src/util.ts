// Small browser helpers for the studio.

/** Save text or a Blob as a file. Works from file:// as well. */
export function download(name: string, content: string | Blob, type = "text/plain"): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  try {
    const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const d = await crypto.subtle.digest("SHA-256", buf as Uint8Array<ArrayBuffer>);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

/** Gzipped size, for the budget panel and the export dialog. 0 when the browser cannot compress. */
export async function gzipSize(text: string): Promise<number> {
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    return (await new Response(stream).blob()).size;
  } catch {
    return 0;
  }
}

export const kb = (b: number): string => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/**
 * JSON with every object's keys in order, so that two copies of a document compare equal
 * whatever order their keys were written in (a database may keep them in another order).
 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

/** "teapot_final-v2" -> "Teapot final v2" */
export function prettyName(base: string): string {
  const s = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 40) || "Drawing";
}

export function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(",");
  const type = /^data:([^;,]+)/.exec(url)?.[1] || "application/octet-stream";
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
