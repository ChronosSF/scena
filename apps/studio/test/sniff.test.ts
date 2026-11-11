// Type sniffing for dropped files (apps/studio/src/ingest/raster.ts): the pattern for the
// start of an SVG accepts what real exports begin with, and stays fast on a file built to
// make it backtrack.
import { describe, expect, test } from "vitest";
import { sniff } from "../src/ingest/raster.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("sniffing an SVG", () => {
  test("accepts a declaration, comments and a DOCTYPE before <svg", () => {
    for (const head of [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      "\n  <svg>",
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg ',
      '<?xml version="1.0"?><!-- Generator: Adobe Illustrator 28.0 -->\n<!-- a -- b --->\n' +
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg>',
      "<!---->\n<SVG>",
    ]) expect(sniff(bytes(head)), head).toBe("svg");
  });

  test("rejects text that only mentions svg", () => {
    for (const head of ["<html><svg>", "<!-- <svg> ", "<?xml version='1.0'?><root><svg>", "svg", "<svgx>", ""]) {
      expect(sniff(bytes(head)), head).toBeNull();
    }
  });

  test("stays fast on a file built to make the pattern backtrack", () => {
    // With the earlier pattern 30 repetitions took 15 seconds, and each one more doubled it.
    const hostile = bytes("<!--" + "--><!--".repeat(280) + "x");
    const start = Date.now();
    expect(sniff(hostile)).toBeNull();
    expect(Date.now() - start).toBeLessThan(500);
  });
});
