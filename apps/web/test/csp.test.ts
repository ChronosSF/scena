// The web app's Content Security Policy (csp.ts): what it lets run and load, and how it differs
// from the single-file build's policy (apps/studio/csp.ts). The policy as a browser enforces it
// is checked by tools/verify-web.ts.
import { describe, expect, test } from "vitest";
import { RUNTIME_SHA256 } from "@scena/renderer";
import { STUDIO_SOURCES } from "@scena/studio/policy";
import { policyFor as buildPolicyFor } from "../../studio/csp.ts";
import { newNonce, policyFor } from "../csp.ts";

const NONCE = "MDEyMzQ1Njc4OWFiY2RlZg==";
const directives = (policy: string) => Object.fromEntries(policy.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]));

describe("the policy", () => {
  const policy = policyFor({ nonce: NONCE, pageRuntimeSha256: RUNTIME_SHA256 });
  const d = directives(policy);

  test("names the scripts of a request by its nonce, the page runtime by hash, and allows nothing inline or evaluated", () => {
    expect(d["default-src"]).toEqual(["'none'"]);
    expect(d["script-src"]).toEqual([`'nonce-${NONCE}'`, "'strict-dynamic'", `'sha256-${RUNTIME_SHA256}'`]);
    expect(d["base-uri"]).toEqual(["'none'"]);
    expect(d["form-action"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    // 'unsafe-inline' is for styles only; nothing is evaluated, and no host is named but the typefaces'
    expect(policy.match(/'unsafe-inline'/g)).toHaveLength(1);
    expect(d["style-src"]).toContain("'unsafe-inline'");
    expect(policy).not.toMatch(/unsafe-eval|unsafe-hashes|\*|https?:(?!\/\/fonts\.g(oogleapis|static)\.com)/);
  });

  test("only the dev server may evaluate, and nothing else changes there", () => {
    const dev = policyFor({ nonce: NONCE, pageRuntimeSha256: RUNTIME_SHA256, dev: true });
    expect(directives(dev)["script-src"]).toEqual([...d["script-src"]!, "'unsafe-eval'"]);
    expect(dev.replace(" 'unsafe-eval'", "")).toBe(policy);
  });

  test("loads what the studio needs, and this origin's own files, and no more", () => {
    for (const [name, sources] of Object.entries(STUDIO_SOURCES)) expect(d[name], name).toEqual(["'self'", ...sources]);
  });

  test("allows what the single-file build's policy allows, apart from how each names its own scripts", () => {
    const build = directives(buildPolicyFor(["the-studio-bundle", RUNTIME_SHA256]));
    for (const name of Object.keys(build)) {
      if (name === "script-src") continue;
      expect(d[name]!.filter((s) => s !== "'self'"), name).toEqual(build[name]);
    }
    // the preview and the picker's cards run the page runtime in a frame, under either policy
    expect(build["script-src"]).toContain(`'sha256-${RUNTIME_SHA256}'`);
    expect(d["script-src"]).toContain(`'sha256-${RUNTIME_SHA256}'`);
    expect(Object.keys(d).filter((name) => !(name in build))).toEqual(["frame-ancestors"]); // a header can say it; a <meta> cannot
  });

  test("refuses a nonce or a hash that could end the quotes it is written in", () => {
    for (const nonce of ["", "short", "abc' 'unsafe-inline", `${NONCE}; script-src *`, "has space in it at all ok"]) {
      expect(() => policyFor({ nonce, pageRuntimeSha256: RUNTIME_SHA256 }), nonce).toThrow(/nonce/);
    }
    expect(() => policyFor({ nonce: NONCE, pageRuntimeSha256: "x' *" })).toThrow(/hash/);
  });
});

describe("the nonce", () => {
  test("is 128 random bits in base64, new each time, and the policy accepts it", () => {
    const made = Array.from({ length: 200 }, newNonce);
    for (const n of made) {
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(atob(n)).toHaveLength(16);
    }
    expect(new Set(made).size).toBe(made.length);
    expect(() => policyFor({ nonce: made[0]!, pageRuntimeSha256: RUNTIME_SHA256 })).not.toThrow();
  });
});
