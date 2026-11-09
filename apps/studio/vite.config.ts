// Studio build: React, bundled into ONE self-contained index.html (vite-plugin-singlefile)
// so the build opens from file:// with a double-click, and also hosts as static files.
// Two small plugins keep the published-page pieces honest:
//  - scena-runtime: rebuilds the page runtime (packages/renderer/runtime) when it changes
//  - scena-demo-desk: serves /demo-desk.html in dev and writes dist/demo-desk.html, rendered
//    from the desk scene and Pia's page by the same renderer the studio uses; and the same
//    for /demo-frames.html, the desk with the frame-animated steaming mug (ADR 0002)
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";
import { renderPage } from "@scena/renderer";
import { DESK_SCENE, PIA_PAGE, framesDemo } from "@scena/scenes";
import { buildRuntime, RUNTIME_ENTRY } from "@scena/renderer/build-runtime";

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

export default defineConfig({
  base: "./",
  plugins: [runtime(), react(), viteSingleFile(), demoDesk()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: "es2022", reportCompressedSize: true },
});
