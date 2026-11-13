// The Content Security Policy of the built studio: the parts that read and write the HTML,
// kept free of Node and Vite so they can be tested (test/csp.test.ts). vite.config.ts runs
// them on dist/index.html once the app's script has been inlined. The web app serves the same
// studio under a policy of its own (apps/web/csp.ts). What both need is in @scena/studio/policy:
// the sources the studio needs, and how to find the scripts of a document.
import { STUDIO_DIRECTIVES, STUDIO_SOURCES, scriptElements, type ScriptElement } from "@scena/studio/policy";

/**
 * The first inline event handler in the markup outside the scripts, or "" when there is none.
 * The policy blocks every one of them, so finding one at build time beats finding it broken.
 */
export function inlineHandler(html: string, scripts: ScriptElement[]): string {
  let outside = "", from = 0;
  for (const s of scripts) { outside += html.slice(from, s.start); from = s.end; }
  outside += html.slice(from);
  // tag by tag, so each pattern reads its input once: a handler is an attribute, and an
  // attribute name starts after whitespace, a slash or the quote that closed the one before
  for (const tag of outside.matchAll(/<[^<>]*>/g)) {
    if (/[\s/"']on[a-z]+\s*=/i.test(tag[0])) return tag[0].slice(0, 100);
  }
  return "";
}

/**
 * The policy, given the base64 SHA-256 of every script that may run. Only those run: no inline
 * handlers, no javascript: URLs, no eval. Nothing loads from anywhere but the places listed.
 */
export function policyFor(scriptHashes: string[]): string {
  if (!scriptHashes.length) throw new Error("no script to allow");
  return [
    "default-src 'none'",
    `script-src ${scriptHashes.map((h) => `'sha256-${h}'`).join(" ")}`,
    // styles, typefaces, images and data: reads, as the studio needs them and no wider
    ...STUDIO_DIRECTIVES.map((d) => `${d} ${STUDIO_SOURCES[d].join(" ")}`),
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** The document with the policy right after its charset, which has to be ahead of every script. */
export function withPolicy(html: string, policy: string): string {
  const anchor = '<meta charset="utf-8">';
  const at = html.indexOf(anchor);
  if (at < 0) throw new Error(`no ${anchor} to put the policy after`);
  const first = scriptElements(html)[0];
  if (first && first.start < at) throw new Error("a script comes before the charset, so the policy would not cover it");
  if (policy.includes('"')) throw new Error("the policy must not contain a double quote");
  const end = at + anchor.length;
  return `${html.slice(0, end)}\n<meta http-equiv="Content-Security-Policy" content="${policy}">${html.slice(end)}`;
}
