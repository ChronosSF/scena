// The web app's stylesheets lay its pages out with the theme's tokens, and hold no colour, font
// stack or radius of their own (docs/adr/0009-one-theme.md): the look, dark mode with it, is the
// theme's (@scena/studio/theme.css), in one place. How the pages look in a browser is checked by
// tools/verify-web.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const sheets = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sheets(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : []));

/** A stylesheet's declarations, "property: value", without its comments. */
const declarations = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").split(/[{};]/).map((d) => d.trim()).filter((d) => /^[a-z-]+\s*:/i.test(d));

/** The colours a value can name: the basic sixteen, and grey as well as gray. A word inside a token's name is not one. */
const NAMED = /(?<![\w-])(?:white|black|silver|gr[ae]y|red|maroon|yellow|olive|lime|green|aqua|teal|blue|navy|fuchsia|purple)(?![\w-])/i;

/** What a declaration sets that is the theme's to set, or null. */
function ownLook(declaration: string): string | null {
  const at = declaration.indexOf(":");
  const property = declaration.slice(0, at).trim().toLowerCase(), value = declaration.slice(at + 1);
  if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(value) || NAMED.test(value)) return "a colour";
  if (property === "font" || property === "font-family") return "a font stack";
  if (property.endsWith("radius") && !/^\s*var\(--ui-r[a-z-]*\)\s*$/.test(value)) return "a radius";
  return null;
}

describe("the web app's stylesheets", () => {
  const found = sheets(join(WEB, "app"));

  test("hold no colour, font stack or radius of their own: the theme's tokens only", () => {
    expect(found.length).toBeGreaterThan(2);
    const own = found.flatMap((file) => declarations(readFileSync(file, "utf8")).flatMap((d) => {
      const what = ownLook(d);
      return what ? [`${relative(WEB, file).replace(/\\/g, "/")}: "${d}" is ${what}`] : [];
    }));
    expect(own).toEqual([]);
  });

  test("the rule finds each of those, and lets the tokens through", () => {
    expect(["color: #18181b", "background: rgba(24, 24, 27, 0.05)", "box-shadow: 0 0 0 1px hsl(0 0% 0%)", "color: white", "border: 1px solid Grey", "outline-color: navy", "background: black",
      "font: 400 1rem / 1.5 system-ui", "font-family: Inter", "border-radius: 0.5rem", "border-top-left-radius: 12px"].map(ownLook))
      .toEqual(["a colour", "a colour", "a colour", "a colour", "a colour", "a colour", "a colour", "a font stack", "a font stack", "a radius", "a radius"]);
    expect(["color: var(--ui-text)", "border-radius: var(--ui-r-xl)", "font-size: var(--ui-md)", "font-weight: 600", "border-top: 1px solid var(--ui-line)",
      "white-space: nowrap", "transition: color 120ms", "background: var(--ui-red-soft)", "color: inherit"].map(ownLook))
      .toEqual([null, null, null, null, null, null, null, null, null]);
  });
});
