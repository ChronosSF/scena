// The local Supabase stack for sign-in (supabase/config.toml, docs/adr/0006-sign-in.md), run
// with the Supabase CLI at one pinned version, fetched by pnpm when it is first used and not
// installed with the workspace: it is a 150 MB binary that only this and CI's Chrome job need.
//
//   pnpm stack:start    start it (Docker), apply the app's migrations to its database, and say where it is
//   pnpm stack:stop     stop it; its data stays in its Docker volumes
//   pnpm stack:remove   stop it and remove its volumes, for a clean start
//   pnpm stack:env      the variables the web app reads, for this stack (KEY=value lines;
//                       --powershell writes them as $env:KEY = "value", and --write puts
//                       them in apps/web/.env.local, which Next.js reads and git ignores,
//                       leaving the file's other lines as they were)
//
// The keys it prints are the CLI's local ones, made for this machine's stack. None is written
// into a file of the repository. The secret key is never printed by this script and never given
// to the app.

import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./cdp.ts";

/** The CLI, at the release that was tried. A new release has to have been public for a week (a month for a new major). */
export const SUPABASE_CLI = "supabase@2.122.1";

/**
 * Started from config.toml, which switches off everything sign-in does not need (Realtime,
 * Storage, the Studio, Edge Functions, analytics, the pooler). These two are on whenever the
 * gateway is, and are left out here: the app reads its tables through its own connection.
 */
export const LEFT_OUT = ["postgrest", "postgres-meta"];

/** Where the stack is, as the web app and the checks need it. */
export interface Stack {
  /** Supabase's API, through the gateway (SUPABASE_URL). */
  apiUrl: string;
  publishableKey: string;
  /** The stack's Postgres (DATABASE_URL), where the app's tables live beside Supabase Auth's. */
  dbUrl: string;
  /** The mail catcher's page and API. */
  mailUrl: string;
}

// The CLI reports usage to its maker unless told not to, like Next.js (README).
const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" };

/**
 * pnpm itself, by name. Windows finds pnpm.cmd through a shell alone, so there the command is
 * one line, made of this file's constants and nothing from outside.
 */
function pnpm(args: string[]): [string, string[], { shell: boolean }] {
  return process.platform === "win32" ? [["pnpm", ...args].join(" "), [], { shell: true }] : ["pnpm", args, { shell: false }];
}

function cli(args: string[], capture: boolean): SpawnSyncReturns<string> {
  const [cmd, all, opts] = pnpm(["dlx", SUPABASE_CLI, ...args]);
  // a first start writes a line for every layer of every image it pulls
  return spawnSync(cmd, all, { cwd: repoRoot, env, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", ...opts, timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 });
}

/** The running stack, or why there is none. Asks the CLI, which reads Docker; it starts nothing. */
export function stackStatus(): { stack: Stack } | { why: string } {
  const r = cli(["status", "-o", "json"], true);
  if (r.error) return { why: `the Supabase CLI could not be run (${r.error.message})` };
  let s: Record<string, string> = {};
  try { s = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))); } catch { /* not JSON: the stack is not running */ }
  if (r.status !== 0 || !s.API_URL || !s.DB_URL) {
    const said = `${r.stderr}\n${r.stdout}`.split("\n").map((l) => l.trim()).filter((l) => l && !/new version|recommend/i.test(l)).slice(-2).join(" ");
    return { why: `the local stack is not running (pnpm stack:start)${said ? `: ${said.slice(0, 200)}` : ""}` };
  }
  const key = s.PUBLISHABLE_KEY || s.ANON_KEY;
  if (!key) return { why: "the stack reported no publishable key" };
  return { stack: { apiUrl: s.API_URL, publishableKey: key, dbUrl: s.DB_URL, mailUrl: s.MAILPIT_URL || s.INBUCKET_URL || "" } };
}

/** The web app's variables for this stack, and the port it runs on in `pnpm dev:web`. */
export const appEnv = (stack: Stack, site = "http://localhost:3100"): Record<string, string> => ({
  SUPABASE_URL: stack.apiUrl,
  SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
  DATABASE_URL: stack.dbUrl,
  SCENA_SITE_URL: site,
});

const ENV_FILE_NOTE = [
  "# The local Supabase stack, for pnpm dev:web: written by `pnpm stack:env --write`, ignored by git.",
  "# These are the CLI's local values for this machine's stack, and no hosted project's.",
];

/**
 * apps/web/.env.local with the stack's variables in it. Whatever else the file had stays, after
 * them: only the lines that set one of these variables, and this script's own note, are replaced.
 */
export function envFileWith(existing: string, vars: Record<string, string>): string {
  const kept = existing.split(/\r?\n/).filter((line) => !ENV_FILE_NOTE.includes(line) && !Object.hasOwn(vars, line.split("=")[0]!.trim()));
  while (kept.length && !kept[0]!.trim()) kept.shift();
  while (kept.length && !kept.at(-1)!.trim()) kept.pop();
  return [...ENV_FILE_NOTE, ...Object.entries(vars).map(([name, value]) => `${name}=${value}`), ...(kept.length ? ["", ...kept] : []), ""].join("\n");
}

function fail(message: string): never {
  console.error(`stack: ${message}`);
  process.exit(1);
}

async function main(command: string | undefined, flags: string[]): Promise<void> {
  if (command === "start") {
    // The CLI ends by printing the stack's keys; they are left out of the output (and so out of
    // CI's log). What it says on the way is passed on when it is done.
    console.log(`stack: starting it with ${SUPABASE_CLI} (the first start pulls its Docker images, which takes a few minutes)…`);
    const started = cli(["start", "-x", LEFT_OUT.join(",")], true);
    const said = `${started.stdout}\n${started.stderr}`.split("\n").filter((l) => l.trim() && !l.trim().startsWith("{") && !/KEY|SECRET|JWT/.test(l));
    if (said.length) console.log(said.join("\n"));
    if (started.status !== 0) fail("the stack did not start (is Docker running?)");
    const found = stackStatus();
    if ("why" in found) fail(found.why);
    // The app's own tables, in the stack's database, by the same migrations as everywhere else.
    const [cmd, all, opts] = pnpm(["db:migrate"]);
    const migrated = await new Promise<number>((done) => spawn(cmd, all, { cwd: repoRoot, env: { ...env, DATABASE_URL: found.stack.dbUrl }, stdio: "inherit", ...opts }).on("close", (code) => done(code ?? 1)));
    if (migrated !== 0) fail("the app's migrations did not apply to the stack's database");
    console.log([
      "",
      "The local stack is running:",
      `  Supabase Auth (gateway)  ${found.stack.apiUrl}`,
      `  its Postgres             ${new URL(found.stack.dbUrl).host} (the app's tables are migrated)`,
      `  the mail catcher         ${found.stack.mailUrl}`,
      "The web app's variables for it: pnpm stack:env",
    ].join("\n"));
    return;
  }
  if (command === "stop" || command === "remove") {
    if (cli(command === "remove" ? ["stop", "--no-backup"] : ["stop"], false).status !== 0) fail("the stack did not stop");
    return;
  }
  if (command === "env") {
    const found = stackStatus();
    if ("why" in found) fail(found.why);
    const vars = appEnv(found.stack);
    if (flags.includes("--write")) {
      // the file Next.js reads for the web app (pnpm dev:web); git ignores it
      const file = join(repoRoot, "apps", "web", ".env.local");
      writeFileSync(file, envFileWith(existsSync(file) ? readFileSync(file, "utf8") : "", vars));
      console.log(`stack: wrote ${Object.keys(vars).join(", ")} to apps/web/.env.local, and left its other lines as they were`);
      return;
    }
    const powershell = flags.includes("--powershell");
    for (const [name, value] of Object.entries(vars)) console.log(powershell ? `$env:${name} = "${value}"` : `${name}=${value}`);
    return;
  }
  fail("say start, stop, remove or env");
}

// run as a script; tools/verify-web.ts imports stackStatus from here as well
if (import.meta.main) await main(process.argv[2], process.argv.slice(3));
