// What the browser gets of the web app. Every client component ("use client"), and everything it
// imports, ends up in the browser's bundle. None of it may reach the database package, a
// Supabase client, Next.js's request-only modules or the environment: the session is kept on
// the server, and a key a client module read would be written into a public file. A server
// action module ("use server") is where the walk stops: a client gets a reference to its
// functions, not their code.
//
// The walk follows the imports as they are written, into the workspace's packages as well, so
// that a package the studio pulls in later is held to the same rule.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const ROOT = resolve(WEB, "..", "..");
const rel = (file: string) => relative(ROOT, file).replace(/\\/g, "/");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (["node_modules", ".next", "test"].includes(e.name) ? [] : sources(join(dir, e.name)))
      : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []);

/** The directive a module starts with, after its comments. */
function directive(text: string): "use client" | "use server" | null {
  const code = text.replace(/^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, "");
  const m = /^["'](use client|use server)["']/.exec(code);
  return m ? (m[1] as "use client" | "use server") : null;
}

/** What a module imports, as written: import … from, export … from, import "…", import("…"). */
function importsOf(text: string): { spec: string; typeOnly: boolean }[] {
  const found: { spec: string; typeOnly: boolean }[] = [];
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) found.push({ spec: m[3]!, typeOnly: !!m[2] });
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push({ spec: m[1]!, typeOnly: false });
  return found;
}

/** A workspace package's file for an import such as "@scena/studio/fonts", or null for anything else. */
function workspaceFile(spec: string): string | null {
  const m = /^@scena\/([a-z-]+)(\/.*)?$/.exec(spec);
  if (!m) return null;
  const dir = join(ROOT, "packages", m[1]!);
  if (!existsSync(join(dir, "package.json"))) return null;
  const exports = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).exports as Record<string, string>;
  const target = exports[`.${m[2] ?? ""}`];
  return target && /\.(ts|tsx)$/.test(target) ? join(dir, target) : null;
}

// What no module in the browser may import.
const REFUSED_PACKAGES = [/^@scena\/db$/, /^@supabase\//, /^next\/headers$/, /^server-only$/, /^postgres$/, /^drizzle-orm/];
// The server modules of sign-in: they hold the keys and the session.
const REFUSED_FILES = ["apps/web/auth/env.ts", "apps/web/auth/db.ts", "apps/web/auth/supabase.ts", "apps/web/auth/server.ts", "apps/web/auth/session.ts", "apps/web/auth/config.ts"];

const onDisk = (file: string) => readFileSync(file, "utf8");

/** Every module a client component brings into the browser, and why each refused one was reached. */
function browserGraph(entries: string[], read = onDisk, exists: (file: string) => boolean = existsSync) {
  const seen = new Set<string>(), problems: string[] = [];
  const walk = (file: string, via: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = read(file);
    const here = rel(file);
    // reaching one is the mistake; what it imports in turn says nothing more
    if (REFUSED_FILES.includes(here)) { problems.push(`${[...via, here].join(" -> ")}`); return; }
    // the environment: NODE_ENV is the one value a bundler writes in, and it is not a secret
    for (const m of text.matchAll(/process\.env\.?([A-Z_]*)/g)) if (m[1] !== "NODE_ENV") problems.push(`${[...via, here].join(" -> ")} reads process.env${m[1] ? `.${m[1]}` : ""}`);
    if (/NEXT_PUBLIC_/.test(text)) problems.push(`${here} names a NEXT_PUBLIC_ variable, which Next.js writes into the browser's files`);
    for (const { spec, typeOnly } of importsOf(text)) {
      if (typeOnly) continue; // erased: nothing of it reaches the bundle
      if (REFUSED_PACKAGES.some((r) => r.test(spec))) { problems.push(`${[...via, here].join(" -> ")} imports ${spec}`); continue; }
      const next = spec.startsWith(".") ? resolve(dirname(file), spec) : workspaceFile(spec);
      if (!next || !/\.(ts|tsx)$/.test(next) || !exists(next)) continue;
      // a server action module: the browser gets references to its functions, not its imports
      if (directive(read(next)) === "use server") continue;
      walk(next, [...via, here]);
    }
  };
  for (const entry of entries) walk(entry, []);
  return { modules: [...seen].map(rel), problems };
}

const all = [...sources(join(WEB, "app")), ...sources(join(WEB, "auth")), ...sources(join(WEB, "drafts"))];
const clientEntries = all.filter((f) => directive(readFileSync(f, "utf8")) === "use client");

describe("what the browser gets of the web app", () => {
  test("no client component reaches the database, a Supabase client, the session's modules or the environment", () => {
    const { modules, problems } = browserGraph(clientEntries);
    // the walk did see the app's client components and the studio behind them
    expect(clientEntries.map(rel).sort()).toEqual(expect.arrayContaining(["apps/web/app/sign-in/SignInForm.tsx", "apps/web/app/studio/AccountSlot.tsx", "apps/web/app/studio/MountedStudio.tsx"]));
    expect(modules).toEqual(expect.arrayContaining(["packages/studio/src/index.ts", "packages/studio/src/store.ts", "apps/web/auth/sign-in-state.ts", "apps/web/drafts/autosave.ts", "apps/web/drafts/messages.ts"]));
    // the server actions that keep the draft are a reference in the browser: the walk stops there
    expect(modules).not.toContain("apps/web/drafts/save.ts");
    expect(problems).toEqual([]);
  });

  test("the walk finds each kind of mistake, through a module in between and past a type import", () => {
    // client components that are not on disk: the walk reads them from here, and the real files for the rest
    const fake: Record<string, string> = {
      [join(WEB, "app", "probe", "Direct.tsx")]: `"use client";\nimport { currentAccount } from "../../auth/server.ts";\n`,
      [join(WEB, "app", "probe", "Between.tsx")]: `"use client";\nimport { helper } from "./helper.ts";\nimport type { User } from "@scena/db";\n`,
      [join(WEB, "app", "probe", "helper.ts")]: `import "@supabase/ssr";\nexport const key = process.env.SUPABASE_PUBLISHABLE_KEY;\n`,
      [join(WEB, "app", "probe", "Action.tsx")]: `"use client";\nimport { signIn } from "../../auth/actions.ts";\n`,
    };
    const read = (f: string) => fake[f] ?? onDisk(f);
    const exists = (f: string) => f in fake || existsSync(f);
    const entries = Object.keys(fake).filter((f) => directive(read(f)) === "use client");
    expect(entries).toHaveLength(3);
    expect(browserGraph(entries, read, exists).problems.sort()).toEqual([
      "apps/web/app/probe/Between.tsx -> apps/web/app/probe/helper.ts imports @supabase/ssr",
      "apps/web/app/probe/Between.tsx -> apps/web/app/probe/helper.ts reads process.env.SUPABASE_PUBLISHABLE_KEY",
      "apps/web/app/probe/Direct.tsx -> apps/web/auth/server.ts",
    ]);
    // a server action is a reference in the browser: Action.tsx brought nothing of actions.ts's imports
    expect(browserGraph([entries[2]!], read, exists).modules).toEqual(["apps/web/app/probe/Action.tsx"]);
    expect(directive(`// a comment\n/* and another */\n"use server";\nexport async function x() {}`)).toBe("use server");
  });

  test("the server action modules are marked as such, and the session's modules cannot be bundled for a browser", () => {
    expect(directive(readFileSync(join(WEB, "auth", "actions.ts"), "utf8"))).toBe("use server");
    expect(directive(readFileSync(join(WEB, "drafts", "actions.ts"), "utf8"))).toBe("use server");
    // Next.js fails a build in which a client module imports one of these
    for (const f of ["server.ts", "db.ts"]) expect(readFileSync(join(WEB, "auth", f), "utf8"), f).toMatch(/^import "server-only";$/m);
  });

  test("the publishable key is the only Supabase key the app reads, and only on the server", () => {
    const named = all.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => `${rel(f)}: ${m[1]}`));
    expect(named.filter((n) => !/: NODE_ENV$/.test(n))).toEqual(["apps/web/auth/db.ts: DATABASE_URL"]);
    // config.ts is given process.env (env.ts) and reads these names from it
    const config = readFileSync(join(WEB, "auth", "config.ts"), "utf8");
    expect([...config.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]).sort()).toEqual(["DATABASE_URL", "SCENA_GOOGLE_SIGN_IN", "SCENA_SITE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_URL"]);
    expect(all.filter((f) => /SERVICE_ROLE|SUPABASE_SECRET|sb_secret_[A-Za-z0-9]/.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });
});
