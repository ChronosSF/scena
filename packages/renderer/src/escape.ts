// Escaping helpers. Every piece of user text goes through esc() before it reaches HTML.

const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text for HTML element content and double-quoted attributes. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENT[c]!);
}

/** JSON that is safe inside <script type="application/json">. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Compact number for SVG attributes: at most two decimals, no trailing zeros. */
export function num(x: unknown): string {
  const r = Math.round((Number(x) || 0) * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}
