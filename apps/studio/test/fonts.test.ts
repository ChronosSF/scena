// The single-file build's document links the typefaces by hand (index.html), and the web app
// takes the same addresses from the studio package (@scena/studio/fonts). This keeps the two
// from drifting apart.
import { expect, test } from "vitest";
import { FIRST_FACES_HREF, MORE_FACES_HREF } from "@scena/studio/fonts";
import html from "../index.html?raw";

const inAttribute = (href: string) => href.replace(/&/g, "&amp;");

test("index.html links the typefaces the studio names, the second set without holding up first paint", () => {
  expect(html).toContain(`<link href="${inAttribute(FIRST_FACES_HREF)}" rel="stylesheet">`);
  expect(html).toContain(`<link id="more-faces" href="${inAttribute(MORE_FACES_HREF)}" rel="stylesheet" media="print">`);
});
