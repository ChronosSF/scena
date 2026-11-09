// Validate and lint scene (and page) files.
//   pnpm lint:scene packages/scenes/desk.scene.json [packages/scenes/pia.page.json]
// Exit code 1 when anything is invalid or over budget.

import { readFileSync } from "node:fs";
import { documentKind, lintScene, migrate, validatePage, validateScene, type SceneDocument } from "@scena/scene";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: pnpm lint:scene <scene.json> [page.json]");
  process.exit(2);
}
const MARK = { ok: "ok   ", warn: "check", error: "OVER " } as const;
let failed = false;
let scene: SceneDocument | undefined;
for (const f of files) {
  const doc: unknown = JSON.parse(readFileSync(f, "utf8"));
  const kind = documentKind(doc);
  if (!kind) { console.log(`${f}: not a scene or page document`); failed = true; continue; }
  if (kind === "scene") {
    const d = migrate(doc, "scene");
    const errors = validateScene(d);
    console.log(`\n${f} (scene "${d.id}" v${d.version})`);
    console.log(errors.length ? errors.map((e) => `  invalid  ${e}`).join("\n") : "  valid    schema checks pass");
    if (errors.length) failed = true;
    scene = d;
    const r = lintScene(d);
    for (const c of r.checks) console.log(`  ${MARK[c.level]}    ${c.label}: ${c.detail}`);
    if (!r.ok) failed = true;
  } else {
    const d = migrate(doc, "page");
    const errors = validatePage(d, scene);
    console.log(`\n${f} (page @${d.handle})`);
    console.log(errors.length ? errors.map((e) => `  invalid  ${e}`).join("\n") : "  valid    schema checks pass");
    if (errors.length) failed = true;
  }
}
process.exit(failed ? 1 : 0);
