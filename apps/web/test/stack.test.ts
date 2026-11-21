// The local Supabase stack's configuration (supabase/config.toml) and its email, held to what
// the app and docs/adr/0006-sign-in.md rely on. The stack itself is driven by tools/verify-web.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { LEFT_OUT, SUPABASE_CLI } from "../../../tools/stack.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const config = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");

/** The value of `key` in the [section] of config.toml, as written (one line each, no arrays across lines). */
function setting(section: string, key: string): string | undefined {
  let current = "";
  for (const raw of config.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { current = header[1]!; continue; }
    const pair = /^([a-z_]+)\s*=\s*(.+)$/.exec(line);
    if (pair && current === section && pair[1] === key) return pair[2];
  }
  return undefined;
}

describe("the local stack", () => {
  test("is Scena's by name, and takes none of the ports other projects use", () => {
    expect(setting("", "project_id")).toBe('"scena"');
    const ports = [setting("api", "port"), setting("db", "port"), setting("db", "shadow_port"), setting("local_smtp", "port")].map(Number);
    expect(ports).toEqual([54421, 54422, 54420, 54424]);
    for (const taken of [3000, 3100, 3190, 5432, 5433, 5434, 5435, 55432, 54321, 54322, 54323, 54324]) expect(ports).not.toContain(taken);
  });

  test("starts Supabase Auth, its gateway, Postgres and the mail catcher, and nothing else", () => {
    for (const off of ["realtime", "studio", "storage", "edge_runtime", "analytics", "db.pooler"]) expect(setting(off, "enabled"), off).toBe("false");
    expect(setting("db.seed", "enabled")).toBe("false");
    expect(LEFT_OUT).toEqual(["postgrest", "postgres-meta"]);
  });

  test("is run with one exact release of the CLI", () => {
    expect(SUPABASE_CLI).toMatch(/^supabase@\d+\.\d+\.\d+$/);
  });

  test("confirms an address by its first email, as a hosted project does, and lets anyone start an account", () => {
    expect(setting("auth.email", "enable_confirmations")).toBe("true");
    expect(setting("auth", "enable_signup")).toBe("true");
    expect(setting("auth.email", "enable_signup")).toBe("true");
    expect(setting("auth", "site_url")).toBe('"http://localhost:3100"');
  });

  test("lets the checks send and verify many emails, and still refuses a second email to one address within seconds", () => {
    expect(Number(setting("auth.rate_limit", "email_sent"))).toBeGreaterThanOrEqual(1000);
    expect(Number(setting("auth.rate_limit", "token_verifications"))).toBeGreaterThanOrEqual(1000);
    expect(Number(setting("auth.rate_limit", "sign_in_sign_ups"))).toBeGreaterThanOrEqual(1000);
    expect(setting("auth.email", "max_frequency")).toBe('"5s"');
  });

  test("keeps Google off unless the environment switches it on, and reads its client from the environment", () => {
    expect(setting("auth.external.google", "enabled")).toBe("false");
    expect(setting("auth.external.google", "client_id")).toBe('"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"');
    expect(setting("auth.external.google", "secret")).toBe('"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"');
  });
});

describe("the sign-in email", () => {
  const path = (kind: string) => setting(`auth.email.template.${kind}`, "content_path");

  test("is one template for a new address and a known one", () => {
    expect(path("confirmation")).toBe('"./supabase/templates/sign-in.html"');
    expect(path("magic_link")).toBe(path("confirmation"));
    expect(setting("auth.email.template.magic_link", "subject")).toBe(setting("auth.email.template.confirmation", "subject"));
  });

  test("carries the link to the confirm page, with the token's hash after the #, and the code", () => {
    const html = readFileSync(join(ROOT, "supabase", "templates", "sign-in.html"), "utf8");
    const links = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    // the address the app asked for, which is its confirm page with the way back
    expect(links).toEqual(["{{ .RedirectTo }}#token_hash={{ .TokenHash }}"]);
    expect(html).toContain("{{ .Token }}");
    // nothing that signs in when opened: Supabase's own link does, on GET
    expect(html).not.toMatch(/ConfirmationURL|\{\{ \.SiteURL \}\}\/auth\/v1/);
  });
});
