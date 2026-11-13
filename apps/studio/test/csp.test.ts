// The build's Content Security Policy (csp.ts): spotting what the policy would block, and
// writing the policy into the document. Finding the script elements is the studio package's
// (packages/studio/test/policy.test.ts). The built file itself is checked in a real browser by
// tools/verify-studio.ts.
import { describe, expect, test } from "vitest";
import { renderPage, RUNTIME_SHA256 } from "@scena/renderer";
import { BUILT_IN_SCENES } from "@scena/scenes";
import { smallDesk } from "@scena/scenes/testing";
import { STUDIO_SOURCES, isDataBlock, isExternal, scriptElements } from "@scena/studio/policy";
import { inlineHandler, policyFor, withPolicy } from "../csp.ts";

const doc = (body: string) => `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>t</title>\n</head>\n<body>\n${body}\n</body>\n</html>`;

describe("inline event handlers", () => {
  test("one in the markup is found after a space, a slash or a quote", () => {
    for (const tag of ['<link rel="stylesheet" media="print" onload="this.media=\'all\'">', "<img/onerror=x()>", '<body class="a"onload="x()">', "<DIV ONCLICK = 'x()'>"]) {
      const html = doc(`${tag}<script>boot()</script>`);
      expect(inlineHandler(html, scriptElements(html)), tag).toMatch(/on[a-z]+\s*=/i);
    }
  });

  test("code and prose that merely look like one are not", () => {
    const html = doc('<p>Come on = in</p><a href="?on=1" class="on-accent" data-on="x">x</a>' +
      '<script>img.onload = () => {}; const s = "<img onerror=x()>";</script><style>.on{color:red}</style>');
    expect(inlineHandler(html, scriptElements(html))).toBe("");
  });
});

describe("the policy", () => {
  const policy = policyFor(["AAAA", "BBBB"]);

  test("names scripts by hash and allows nothing inline or evaluated", () => {
    const directives = Object.fromEntries(policy.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
    expect(directives["default-src"]).toEqual(["'none'"]);
    expect(directives["script-src"]).toEqual(["'sha256-AAAA'", "'sha256-BBBB'"]);
    expect(directives["base-uri"]).toEqual(["'none'"]);
    expect(directives["form-action"]).toEqual(["'none'"]);
    expect(directives["img-src"]).toEqual(["data:", "blob:"]);
    expect(directives["connect-src"]).toEqual(["data:"]);
    // What loads is exactly what the studio says it needs. The web app's policy is held to the
    // same list (apps/web/test/csp.test.ts), so the two allow the same things.
    for (const [name, sources] of Object.entries(STUDIO_SOURCES)) expect(directives[name], name).toEqual([...sources]);
    expect(Object.keys(directives)).toEqual(["default-src", "script-src", ...Object.keys(STUDIO_SOURCES), "base-uri", "form-action"]);
    // 'unsafe-inline' is for styles only; nowhere is anything evaluated or loaded from an arbitrary host
    expect(policy.match(/'unsafe-inline'/g)).toHaveLength(1);
    expect(directives["style-src"]).toContain("'unsafe-inline'");
    expect(policy).not.toMatch(/unsafe-eval|unsafe-hashes|\*|https?:(?!\/\/fonts\.g(oogleapis|static)\.com)/);
    expect(() => policyFor([])).toThrow();
  });

  test("goes right after the charset, ahead of every script", () => {
    const html = doc("<script>boot()</script>");
    const out = withPolicy(html, policy);
    expect(out).toContain(`<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${policy}">\n<title>`);
    expect(out.replace(`\n<meta http-equiv="Content-Security-Policy" content="${policy}">`, "")).toBe(html);
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<script"));
  });

  test("refuses a document it cannot protect", () => {
    expect(() => withPolicy("<html><head><title>t</title></head></html>", policy)).toThrow(/charset/);
    expect(() => withPolicy('<html><head><script>early()</script><meta charset="utf-8"></head></html>', policy)).toThrow(/before the charset/);
    expect(() => withPolicy(doc(""), 'default-src "none"')).toThrow(/double quote/);
  });
});

// The scene picker shows each ready-made scene as its published page, in a frame made from
// srcdoc. Such a frame runs under the studio's own policy as well as the page's, and the build
// names its scripts by hash. So a card works in the built studio only if the one script its
// page runs is the page runtime, whatever the scene: the ones that ship, and a second that is
// a test fixture.
describe("a scene picker card under the policy", () => {
  /** Base64 SHA-256, as a policy writes it. */
  const sha256 = async (s: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))));
  const each = [...BUILT_IN_SCENES, smallDesk()].map((e) => [e.scene.name, e] as const);

  test.each(each)("%s: the only script its page runs is the page runtime, which the policy names", async (_name, { scene, sample }) => {
    const studioPolicy = policyFor(["the-studio-bundle", RUNTIME_SHA256]);
    for (const forceMotion of [false, true]) {
      const { html } = renderPage(scene, sample, { demo: true, forceMotion });
      const scripts = scriptElements(html);
      expect(scripts.some(isExternal)).toBe(false);
      const run = scripts.filter((s) => !isDataBlock(s));
      expect(await Promise.all(run.map((s) => sha256(s.body)))).toEqual([RUNTIME_SHA256]);
      expect(studioPolicy).toContain(`'sha256-${await sha256(run[0]!.body)}'`);
      expect(html).toContain(`script-src 'sha256-${RUNTIME_SHA256}'`); // and the page's own policy names it too
    }
  });
});
