// Port check: renders desk + Pia with @scena/renderer and compares it with the
// prototype's build output (fixtures/reference/demo-desk.prototype.html). The only
// expected difference is the inlined runtime (now compiled by esbuild) and its CSP hash.
//   pnpm parity
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderPage } from "@scena/renderer";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const normalise = (html: string) => html
  .replace(/script-src 'sha256-[^']+'/, "script-src 'sha256-RUNTIME'")
  .replace(/<script>[\s\S]*?<\/script>/, "<script>RUNTIME</script>");

const prototype = readFileSync(join(root, "fixtures/reference/demo-desk.prototype.html"), "utf8");
const ported = renderPage(DESK_SCENE, PIA_PAGE, { demo: true }).html;
const a = normalise(prototype), b = normalise(ported);
if (a === b) {
  console.log(`parity: identical apart from the runtime (${prototype.length} B prototype, ${ported.length} B ported)`);
} else {
  const i = [...a].findIndex((c, j) => c !== b[j]);
  console.error(`parity: differs at ${i}:\n prototype: ${JSON.stringify(a.slice(i - 60, i + 80))}\n ported:    ${JSON.stringify(b.slice(i - 60, i + 80))}`);
  process.exit(1);
}
