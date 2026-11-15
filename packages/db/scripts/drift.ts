// Whether the checked-in migrations say what src/schema.ts says. drizzle-kit is asked to write a
// migration from the schema into a copy of migrations/; if it writes anything, the two disagree,
// and what it wrote is the migration that is missing. Then drizzle-kit's own check reads the
// real folder for snapshots that do not follow one another. Nothing in migrations/ is changed.
//
// Used by `pnpm db:check` (scripts/check-migrations.ts), which `pnpm check` runs once. It is not
// a Vitest test: it starts drizzle-kit twice, which a plain `pnpm test` should not pay for.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const DRIZZLE_KIT = join(PACKAGE, "node_modules", "drizzle-kit", "bin.cjs");

export type Drift = { ok: true } | { ok: false; problem: string };

function drizzleKit(args: string[]): { status: number | null; output: string } {
  // No input: if drizzle-kit stops to ask whether a column was renamed, it gets no answer and
  // the timeout ends it, rather than the check waiting for ever.
  const run = spawnSync(process.execPath, [DRIZZLE_KIT, ...args], { cwd: PACKAGE, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  return { status: run.status, output: `${run.stdout ?? ""}${run.stderr ?? ""}${run.error ? String(run.error) : ""}` };
}

export function migrationDrift(): Drift {
  // Inside the package, so that the path given to drizzle-kit can be relative: it joins --out to
  // its working directory, which breaks an absolute Windows path. node_modules is ignored by git.
  const cache = join(PACKAGE, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(join(cache, "scena-db-check-"));
  try {
    const copy = join(scratch, "migrations");
    cpSync(join(PACKAGE, "migrations"), copy, { recursive: true });
    const before = new Set(readdirSync(copy));
    const generate = drizzleKit(["generate", "--dialect=postgresql", "--schema=./src/schema.ts", `--out=${relative(PACKAGE, copy).replaceAll("\\", "/")}`]);
    if (generate.status !== 0) return { ok: false, problem: `drizzle-kit could not compare the schema with the migrations (a rename it would ask about?). Run pnpm db:generate to see.\n${generate.output}` };
    const written = readdirSync(copy).filter((f) => !before.has(f) && f.endsWith(".sql"));
    if (written.length) {
      const sql = written.map((f) => `-- ${f}\n${readFileSync(join(copy, f), "utf8")}`).join("\n");
      return { ok: false, problem: `src/schema.ts and migrations/ disagree. Run pnpm db:generate and check in the migration it writes. It would write:\n${sql}` };
    }
    // Its exit status is the answer (1 for snapshots that collide or cannot be read); what it
    // prints is for a person, and its wording is drizzle-kit's to change.
    const check = drizzleKit(["check"]);
    if (check.status !== 0) return { ok: false, problem: `drizzle-kit check found a problem in migrations/:\n${check.output}` };
    return { ok: true };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
