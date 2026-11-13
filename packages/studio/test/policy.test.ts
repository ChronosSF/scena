// Finding the script elements of a document the way a browser does (src/policy.ts). Both apps
// lean on it: the single-file build hashes what it finds, and the web app's check looks for the
// nonce on each one.
import { describe, expect, test } from "vitest";
import { STUDIO_DIRECTIVES, STUDIO_SOURCES, isDataBlock, isExternal, scriptElements } from "../src/policy.ts";

const doc = (body: string) => `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>t</title>\n</head>\n<body>\n${body}\n</body>\n</html>`;

describe("finding script elements", () => {
  test("the body is exactly the text between the tags, and the offsets cover the element", () => {
    const html = doc('<div id="root"></div>\n<script type="module" crossorigin>const a = 1;\nboot(a);</script>');
    const [s, ...rest] = scriptElements(html);
    expect(rest).toEqual([]);
    expect(s!.attrs).toBe(' type="module" crossorigin');
    expect(s!.body).toBe("const a = 1;\nboot(a);");
    expect(html.slice(s!.start, s!.end)).toBe('<script type="module" crossorigin>const a = 1;\nboot(a);</script>');
  });

  test("end tags are found however a browser accepts them", () => {
    for (const end of ["</script>", "</script >", "</SCRIPT>", "</script\n>", "</script\t\n bar>", '</script foo="bar">', "</script/>"]) {
      const html = doc(`<script>one()${end}<p>between</p><script>two()</script>`);
      expect(scriptElements(html).map((s) => s.body), end).toEqual(["one()", "two()"]);
    }
  });

  test("start tags are found however a browser accepts them, and near misses are not scripts", () => {
    for (const start of ["<script>", "<SCRIPT>", "<script >", "<script\n>", '<script type="module">', "<script/>", "<Script async>"]) {
      expect(scriptElements(doc(`${start}run()</script>`)).map((s) => s.body), start).toEqual(["run()"]);
    }
    for (const not of ["<scripted>x</scripted>", "<script-x>x</script-x>", "<noscript>x</noscript>", "&lt;script&gt;x&lt;/script&gt;"]) {
      expect(scriptElements(doc(not)), not).toEqual([]);
    }
  });

  test("an end tag escaped inside the code does not end the script", () => {
    const code = 'const page = "<script>" + runtime + "<\\/script>"; const more = "</scripted>";';
    expect(scriptElements(doc(`<script>${code}</script>`)).map((s) => s.body)).toEqual([code]);
  });

  test("a script that is never closed is an error, not a guess", () => {
    expect(() => scriptElements(doc("<script>run()"))).toThrow(/never closed/);
  });

  test("external scripts and data blocks are told apart from inline code", () => {
    const [inline, external, json, quoted, ld] = scriptElements(doc(
      '<script type="module">a()</script><script src="./assets/app.js"></script><script type="application/json" id="sd">{"a":1}</script>' +
      "<script async src=x.js></script><script type='application/ld+json'>{}</script>"));
    expect([inline, external, json, quoted, ld].map((s) => isExternal(s!))).toEqual([false, true, false, true, false]);
    expect([inline, external, json, quoted, ld].map((s) => isDataBlock(s!))).toEqual([false, false, true, false, true]);
    // an attribute that only ends in "src", or a type that only mentions json, changes nothing
    const [odd] = scriptElements(doc('<script data-src="x" type="module" data-kind="application/json">a()</script>'));
    expect(isExternal(odd!)).toBe(false);
    expect(isDataBlock(odd!)).toBe(false);
  });
});

describe("what the studio needs from a policy", () => {
  test("styles, typefaces, images and data: reads, and no script source", () => {
    expect(STUDIO_DIRECTIVES).toEqual(["style-src", "font-src", "img-src", "connect-src"]);
    expect(JSON.stringify(STUDIO_SOURCES)).not.toMatch(/script|unsafe-eval|unsafe-hashes|[*]/);
  });
});
