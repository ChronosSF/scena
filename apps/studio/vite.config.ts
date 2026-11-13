// Studio build: React, bundled into ONE self-contained index.html (vite-plugin-singlefile)
// so the build opens from file:// with a double-click, and also hosts as static files.
// Two small plugins keep the published-page pieces honest:
//  - scena-runtime: rebuilds the page runtime (packages/renderer/runtime) when it changes
//  - scena-demo-desk: serves /demo-desk.html in dev and writes dist/demo-desk.html, rendered
//    from the desk scene and Pia's page by the same renderer the studio uses; and the same
//    for /demo-frames.html, the desk with the frame-animated steaming mug (ADR 0002)
// And one keeps the studio itself contained:
//  - scena-csp: writes a Content Security Policy into the built index.html
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { renderPage } from "@scena/renderer";
import { DESK_SCENE, PIA_PAGE, framesDemo } from "@scena/scenes";
import { buildRuntime, RUNTIME_ENTRY } from "@scena/renderer/build-runtime";
import { FIRST_FACES_HREF, MORE_FACES_HREF } from "@scena/studio/fonts";
import { isDataBlock, isExternal, scriptElements } from "@scena/studio/policy";
import { inlineHandler, policyFor, withPolicy } from "./csp.ts";

function runtime(): Plugin {
  return {
    name: "scena-runtime",
    async buildStart() {
      await buildRuntime();
    },
    configureServer(server) {
      server.watcher.add(RUNTIME_ENTRY);
      server.watcher.on("change", async (file) => {
        if (resolve(file) !== resolve(RUNTIME_ENTRY)) return;
        try {
          const r = await buildRuntime();
          server.config.logger.info(`page runtime rebuilt: ${r.bytes} B`);
        } catch (e) {
          server.config.logger.error(String(e));
        }
      });
    },
  };
}

function demoDesk(): Plugin {
  return {
    name: "scena-demo-desk",
    configureServer(server) {
      server.middlewares.use("/demo-desk.html", async (_req, res) => {
        // load through Vite so edits to the renderer or the scenes show up on reload
        const r = await server.ssrLoadModule("@scena/renderer");
        const s = await server.ssrLoadModule("@scena/scenes");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(r.renderPage(s.DESK_SCENE, s.PIA_PAGE, { demo: true }).html);
      });
      server.middlewares.use("/demo-frames.html", async (_req, res) => {
        const r = await server.ssrLoadModule("@scena/renderer");
        const s = await server.ssrLoadModule("@scena/scenes");
        const { scene, page } = s.framesDemo();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(r.renderPage(scene, page, { demo: true }).html);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "demo-desk.html", source: renderPage(DESK_SCENE, PIA_PAGE, { demo: true }).html });
      const frames = framesDemo();
      this.emitFile({ type: "asset", fileName: "demo-frames.html", source: renderPage(frames.scene, frames.page, { demo: true }).html });
    },
  };
}

/**
 * The document's typeface stylesheets, written from the addresses the studio names
 * (@scena/studio/fonts). The web app links the same two, so there is one source for both.
 * The second set is only previewed in the Typeface cards: it loads as a print stylesheet, so
 * it never holds up first paint, and main.tsx switches it to the screen (an inline onload
 * would be blocked by the build's policy).
 */
function typefaces(): Plugin {
  return {
    name: "scena-typefaces",
    transformIndexHtml: () => [
      { tag: "link", attrs: { href: FIRST_FACES_HREF, rel: "stylesheet" }, injectTo: "head" },
      { tag: "link", attrs: { id: "more-faces", href: MORE_FACES_HREF, rel: "stylesheet", media: "print" }, injectTo: "head" },
    ],
  };
}

/**
 * The studio writes markup that comes from documents into its own DOM (the stage, the
 * thumbnails), so a sanitiser that misses something would otherwise let a project file run
 * script. The policy is the layer behind the sanitisers: only the bundled app and the page
 * runtime may execute, both named by hash. Inline handlers, javascript: URLs and eval do not
 * run, and nothing loads from anywhere but the places listed.
 *
 * One visible effect: a dropped SVG that carries inline handlers logs a refusal per handler in
 * the console as the file is parsed. That parse is into an inert document, before the sanitiser
 * strips them, so nothing was going to run; the log is the policy saying so.
 *
 * Build only: the dev server needs inline scripts for hot reload. It has to run after
 * vite-plugin-singlefile, because the hash is of the inlined script: that plugin's hook is
 * ordered "post", so this one is too, and it comes later in the plugin list.
 */
function contentSecurityPolicy(): Plugin {
  const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");
  return {
    name: "scena-csp",
    apply: "build",
    enforce: "post",
    generateBundle: { order: "post", async handler(_options, bundle) {
      const file = bundle["index.html"];
      if (!file || file.type !== "asset") throw new Error("scena-csp: index.html is not in the bundle");
      // a browser reads CRLF as LF before it hashes a script, so the file is hashed and written with LF
      const html = String(file.source).replace(/\r\n/g, "\n");

      // The reading and writing of the HTML is in csp.ts, where it is tested.
      try {
        const scripts = scriptElements(html);
        if (scripts.some(isExternal)) throw new Error("a script is still external; the policy allows inlined scripts only, by hash");
        const handler = inlineHandler(html, scripts);
        if (handler) throw new Error(`index.html has an inline event handler, which the policy blocks: ${handler}`);
        // The preview is a srcdoc frame: it inherits this policy on top of the page's own, so the
        // page runtime has to be allowed here as well.
        const pageRuntime = await buildRuntime({ write: false });
        const hashes = scripts.filter((s) => !isDataBlock(s)).map((s) => sha256(s.body));
        if (!hashes.length) throw new Error("no inline script found in index.html");
        file.source = withPolicy(html, policyFor([...hashes, pageRuntime.sha256]));
      } catch (e) {
        throw new Error(`scena-csp: ${(e as Error).message}`);
      }
    } },
  };
}

export default defineConfig({
  base: "./",
  plugins: [runtime(), react(), typefaces(), viteSingleFile(), demoDesk(), contentSecurityPolicy()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: "es2022", reportCompressedSize: true },
});
