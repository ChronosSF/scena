# 0001. Tech stack for the scene format, the renderer and the studio

- **Status:** Accepted for the current phase. Revisit when accounts and publishing start (milestones M1 and M2 in the development plan).
- **Date:** 9 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer

## Context

The bring-your-own-drawings prototype works and is pitchable: a vanilla JavaScript studio and
renderer in one folder, built by a hand-written script into two self-contained HTML files. It
proved the idea. It was not a project: JSDoc instead of types, a home-made bundler and
minifier, and no package boundaries.

[The development plan](../development-plan.md) (section 4) recommends TypeScript end to end in a
pnpm monorepo (`packages/scene`, `packages/renderer`, `packages/scenes`, `apps/web`, `apps/edge`),
with Next.js on Vercel for the editor, Supabase for Postgres and auth, a Cloudflare Worker with
R2 for public pages, and Stripe. That recommendation was for the whole product, with accounts,
publishing, billing and custom domains.

Today the repository has to hold only what the prototype has, ported properly:

1. The scene model: types, validation, migration, the budget lint.
2. The renderer: `renderPage(scene, page) -> html`, a pure function with an inlined runtime
   whose hash goes into the page's Content-Security-Policy.
3. The built-in desk scene and Pia's page, the test fixtures, and the tests.
4. The studio as the first app. It must stay pitchable: a dev server with hot reload, and a
   static build that opens with a double-click (file://) and can also be hosted anywhere.

The next phases add to this:

- **M1, the editor with accounts:** sign-in, server autosave, the handle picker. This is server work.
- **M2, publishing:** render at publish time on a server, then serve from the edge. The renderer
  has to run in Node and in a Worker, not only in the browser.
- **Phase 2, uploads:** the SVG sanitiser moves server-side, so it needs a parser that does not depend on the DOM.

The same constraints as the plan apply: a solo designer-founder building with AI coding tools,
about 10 hours a week, with low operations load preferred over elegance.

## Options

| | A. The plan's stack now | B. TypeScript packages + Vite/React studio, Next.js later | C. TypeScript packages, studio stays vanilla JS |
|---|---|---|---|
| Shape | `apps/web` in Next.js, plus Supabase, Worker and Stripe scaffolding | `packages/*` in TypeScript; `apps/studio` as a client-only React app built with Vite | `packages/*` in TypeScript; the vanilla studio consumes them |
| Fits the port today | Poorly. Nothing needs a server yet, and a Next.js static export does not open from file:// (absolute asset paths, external module chunks) | Well. A Vite build can be inlined into one HTML file, which opens from disk | Well |
| Fits M1 and M2 | Directly | Well. Add `apps/web` (Next.js) when accounts start; it imports the same packages and the studio components | Poorly. The editor needs a rewrite before M1 anyway |
| Cost now | High: unused infrastructure to configure and keep green | Medium: a React rewrite of the studio UI | Low |
| Risk | Configuration with nothing to test it against | The rewrite has to keep every behaviour that was verified | A second rewrite later, and two styles in one repository |

Option D was SvelteKit, which the plan already compared. It was rejected for the same reason as
in the plan: the phase 2 canvas editor benefits most from the React ecosystem and from what AI
tools produce reliably.

## Decision

**Option B.** Keep the plan's language and repository shape. Defer every piece of infrastructure
until a feature needs it.

- **TypeScript end to end, pnpm workspaces.** `packages/scene`, `packages/renderer`,
  `packages/scenes` and `apps/studio`. The `@scena/` scope is a working name.
- **Internal packages without a build step.** Each package's `exports` points at its TypeScript
  source. Vite, Vitest, Node 24 (native type stripping) and later Next.js (`transpilePackages`)
  and Wrangler (esbuild) all consume TypeScript directly, so there are no `dist/` folders to keep
  in sync. Relative imports carry `.ts` extensions and the code uses only erasable syntax, so
  scripts run with plain `node` and need no loader.
- **Purity is a compiler rule.** `packages/scene` and `packages/renderer/src` compile with neither
  the DOM library nor Node types. Any DOM or Node access is a type error.
- **The page runtime** lives in `packages/renderer/runtime/runtime.ts` (typed against the DOM).
  esbuild compiles it to one minified IIFE string plus its SHA-256 in a generated module, and a
  test fails if that module is stale. The dev server rebuilds it on save.
- **The studio is React 19 on Vite 8.** `vite-plugin-singlefile` inlines the build into one
  `dist/index.html`. A small plugin renders `dist/demo-desk.html` with the same renderer.
  - The canvas is an imperative island inside React: the renderer's own SVG markup is written in a
    layout effect, and drags move the live group directly.
  - The rest of the UI is ordinary React. State is the two documents plus UI state behind
    `useSyncExternalStore`, with undo snapshots.
- **Tests:** Vitest 5. The renderer snapshot, a parity test against the prototype's output, the
  scene model, and the studio's editing operations. A headless-Chrome end-to-end check
  (`tools/verify-studio.ts`) drives the studio through real mouse, keyboard and file-chooser input.
- **Type checking:** TypeScript 7 (the native compiler), strict, `tsc --noEmit` only. Vite and
  Vitest strip types themselves.
- **Exact versions** are pinned in `package.json` (`save-exact`) and in `pnpm-lock.yaml`.

### Where this departs from the plan, and why

1. **No Next.js yet.** The studio has no server-side need, and it must open from disk for pitching.
   When M1 starts, add `apps/web` (Next.js on Vercel) for sign-in, autosave and the publish API.
   At that point move the studio's components into a `packages/studio` that both apps import (or
   mount the studio as a client-only route). The scene and renderer packages are already
   framework-agnostic, so nothing is thrown away.
2. **No Supabase, Stripe, Cloudflare Worker, R2 or Vercel configuration.** Nothing uses them yet;
   each arrives with the milestone that needs it, with its own decision record.
3. **Hand-written validators instead of zod.** They were ported one to one. They give
   path-qualified, readable messages that the studio shows as they are, and they are tested.
   Revisit when there is a server boundary, where zod schemas could also generate request types.
4. **`apps/studio` instead of `apps/web`, and no `apps/edge`.** The names follow what exists.

## Consequences

**Good**
- Zero infrastructure. `pnpm install && pnpm dev` is the whole setup, and the build is one file
  that works offline apart from the web font.
- One renderer everywhere: the studio canvas, the preview, the export, the tests, the build
  plugin, and later the publish step and the edge.
- Clear seams for what comes next: the packages are pure, the runtime is hashed, and the studio
  talks to documents through one store.

**Costs and risks**
- When `apps/web` arrives there are two React apps until the studio's components move into a
  package. Plan for that move at the start of M1.
- Internal packages only work for consumers that compile TypeScript. That is fine for this
  repository; it means they cannot be published to npm as they are, which is not needed.
- TypeScript 7 is new. It is used only for type checking. If an editor plugin or tool needs the
  old JavaScript compiler API, pin TypeScript 6 for that tool.
- The studio mutates the documents in place and bumps a revision counter. Components therefore
  depend on `rev`, not on object identity. This is simple and fast, but it is a convention to
  keep in mind.
- The SVG sanitiser still uses the browser's DOMParser. Phase 2 needs a parser that works without
  the DOM so the same allowlist can run on the server.
