// The studio as a package: one editor, mounted by the single-file build (apps/studio) and by
// the web app (apps/web). See docs/adr/0004-one-studio-two-apps.md.
//
// The styles are a separate entry, "@scena/studio/studio.css", which the app that mounts the
// studio imports. Nothing here imports a stylesheet, so a test or a server can load a module of
// the studio without a bundler that understands CSS.
//
// The studio reads localStorage and the document, so it renders in a browser only. An app that
// renders on a server has to load this module on the client (apps/web/app/studio).
export { App as Studio } from "./components/App.tsx";
export { showMoreFaces } from "./more-faces.ts";
export { exposeForChecks } from "./handle.ts";
