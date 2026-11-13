# 0004. One studio in two apps: a shared package, and the web app's shell

- **Status:** Proposed. It takes effect when the change that adds `apps/web` is merged.
- **Date:** 13 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer
- **Scope:** the first part of [issue 9](https://github.com/ChronosSF/scena/issues/9): where the
  studio's code lives, the Next.js app it now also runs in, and that app's Content Security
  Policy. Hosting, error reporting, sign-in and the database are not part of it.

## Context

[ADR 0001](0001-tech-stack.md) kept the studio a client-only Vite app, so that its build is one
HTML file that opens from disk, and deferred Next.js until a feature needed a server. That
point has come. The studio's side of milestone M1 is built (the links-only mode, the scene
picker). What is left of M1, and all of publishing, needs a server: sign-in, the database,
server autosave, the handle picker.

ADR 0001 named two ways to get there: move the studio's components into a `packages/studio`
that both apps import, or mount the studio as a client-only route. It also said to do it at
the start of M1, before there are two editors to keep alike.

What has to stay true:

1. The single-file build stays as it is: one `index.html` that opens with a double-click, with
   its own policy written at build time. It is what gets pitched.
2. The studio renders in a browser only. Its store opens saved work from `localStorage` as the
   module loads, and the canvas is written into the DOM.
3. Internal packages have no build step. Their `exports` point at TypeScript source, and
   relative imports carry `.ts` extensions.
4. No account exists yet for any hosted service, and none is created here.

## Decision 1: the studio is a package, `@scena/studio`

Everything under `apps/studio/src` except the entry point moved to `packages/studio/src`, and
the tests moved with it. `apps/studio` keeps what makes it the single-file build: `index.html`,
`src/main.tsx`, `vite.config.ts`, `csp.ts` and the tests of that policy. `apps/web` imports the
same package. There is one editor.

The package says what it gives and what it needs from the page that mounts it:

| Entry | What it is |
|---|---|
| `@scena/studio` | `Studio` (the component), `showMoreFaces()`, `exposeForChecks()` |
| `@scena/studio/studio.css` | the stylesheet; the app imports it, so no module of the studio imports CSS |
| `@scena/studio/fonts` | the two Google Fonts stylesheet addresses the document links |
| `@scena/studio/policy` | the sources the studio needs a Content Security Policy to allow |

`@scena/studio/fonts` and `@scena/studio/policy` are plain constants, so a server, a build
script or a test can import them without loading the studio.

The other way, mounting without a package, was one of two things. Importing `apps/studio/src`
from `apps/web` makes one app depend on the inside of another. Showing the built single file in
a frame keeps the editor behind `postMessage`, and sign-in, server autosave and the draft that
becomes the account's draft (issues 15 and 16) need the store in the same document as the
session.

Details:

- The name `@scena/studio` now belongs to the package, so the app in `apps/studio` is
  `@scena/studio-app`. Its folder and its output are unchanged.
- React is a peer dependency of the package, pinned to the same exact version in the package
  and both apps, so there is one copy.
- The test that a scene picker card runs only the page runtime moved from the picker's tests to
  the policy's tests in `apps/studio`, because it is about that app's policy.

The single-file build behaves as before: all 101 checks of `pnpm verify:studio` pass unchanged,
and the file grew by 338 bytes.

## Decision 2: `apps/web` is Next.js 16 with the App Router, and the studio loads in the browser only

- **Next.js 16.4.6**, pinned exactly, with React 19.3.1 as in the studio. `transpilePackages`
  lists the four workspace packages, and Turbopack compiles their TypeScript source, `.ts`
  extensions included.
- **`/studio`** is a server component that holds only what a server can know: the title, the
  first typefaces, the stylesheet. The studio itself is loaded by a client component through
  `next/dynamic` with `ssr: false`, so no module of the studio runs on the server and none of
  its markup is in the HTML the server sends. `tools/verify-web.ts` checks both.
- **`/`** is a placeholder with a link to the studio, until sign-in and the dashboard exist.
- **TypeScript 7 needs no exception.** ADR 0001 allowed pinning TypeScript 6 for a tool that
  needs the old compiler API. Next.js 16.4.6 runs its own type check with TypeScript 7, and the
  app is also checked by `pnpm typecheck` like every package. That script runs `next typegen`
  first, because `next-env.d.ts` and the route types are generated and git ignores them.
- **No Tailwind yet.** The issue lists it. The studio is styled by its own stylesheet and is not
  restyled, and the only page of the app's own is the placeholder, which has a small CSS module.
  Adding Tailwind is a choice for the first real screens, with sign-in.
- The dev server and `next start` use port 3100.

## Decision 3: the web app sends its own Content Security Policy, naming scripts by nonce

The studio writes markup that comes from documents into its own DOM, and the single-file build
carries a policy as the layer behind the sanitisers. The web app serves the same studio, so it
gets a policy that does the same job.

The two differ only in how they name the app's own scripts. The single-file build has one
inlined script and names it by hash at build time. Next.js sends several scripts and decides
them per build, so `apps/web/proxy.ts` makes a nonce for each request, and Next.js puts it on
the scripts it renders:

```
default-src 'none';
script-src 'nonce-…' 'strict-dynamic' 'sha256-<the page runtime>';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob:;
connect-src 'self' data:;
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

- The page runtime is named by hash because the preview and the picker's cards show a published
  page in a frame made from `srcdoc`. Such a frame runs under this policy as well as the page's
  own, and its script carries no nonce.
- The style, font, image and connect sources are `'self'` plus `STUDIO_SOURCES` from
  `@scena/studio/policy`. `apps/studio/csp.ts` builds its policy from the same list, and a test
  compares the two policies, so they cannot drift apart.
- `frame-ancestors 'none'` is new. A header can say it; the `<meta>` of the single-file build
  cannot.
- The dev server adds `'unsafe-eval'`, which React needs there to rebuild server error stacks.
  The production build does not have it, and the check fails if it does.
- `'strict-dynamic'` trusts a script that a trusted script adds through the DOM. It does not
  trust markup: an inline handler does not run, and a script in a frame made from markup runs
  only if the policy names it. `tools/verify-web.ts` injects both and checks.

**The cost: every page is rendered for its request.** A nonce exists only per request, so
`app/layout.tsx` waits for the request (`connection()`), and nothing in this app is built ahead
of time. That fits what the app is for. Its pages are a signed-in person's editor and
dashboard, and the public pages are served from the edge by `apps/edge`, not by this app.
Next.js has an experimental hash-based alternative that keeps static pages; it is not used
because it is experimental.

## Checks

- `pnpm check` covers both apps: every package and both apps type-check, 146 tests pass, and
  both apps build. From a clean checkout it takes about 20 seconds on this machine.
- `pnpm verify:web` (`tools/verify-web.ts`) starts the built app's own server and drives it in
  headless Chrome, 18 checks:
  - what the server sends: the policy, a nonce of its own on every request and on every script,
    none of the studio in the HTML, a 404 under the policy too;
  - the studio in the browser: it loads with its stylesheet and typefaces, the scene picker
    opens from the empty canvas and its card runs the page runtime, choosing the desk opens it
    with its default texts, a link is filled in by typing, a real tap in the preview opens the
    panel, a reload brings the work back, the console stays clean;
  - the policy as the browser enforces it: an injected handler does not run, and a frame's
    script runs only when named;
  - the home page's link opens the studio in place, and the studio fits a 375 px screen.
- The check was run once against a policy that leaves the page runtime out. Four checks failed,
  as they should.
- CI keeps its two required jobs under the same names. "Parity and headless Chrome" builds both
  apps and also runs `pnpm verify:web`. Next.js telemetry is switched off on the runner.

## Measured (13 November 2026, this machine)

| Item | Result |
|---|---|
| `next build` | about 8 s |
| `/studio` from the built app | 7.8 KB of HTML, 8 scripts of 794 KB together, 39 KB of CSS, all before compression |
| Time until the studio is on screen, from `localhost` | 0.35 to 0.5 s |
| Single-file build | 593 KB raw, 183 KB gzipped |

## What is left of issue 9

None of these can be done without an account or a decision that is the founder's:

- A Vercel project with a preview deployment for every pull request. The issue's third "done
  when" waits on it.
- Sentry for errors.
- Environment handling for Supabase, Cloudflare and Stripe keys. Each arrives with the issue
  that first needs a key (10 and 11, then 21 and 36).

## Consequences

**Good**

- One editor. A change to the studio reaches the pitch build and the web app together, and the
  studio's own tests run once.
- The seam for the server work is in place: `apps/web` has a server, a policy and a route for
  the editor, and nothing in the studio had to change to run there.
- What the studio needs from a host page is written down in one place.

**Costs and risks**

- `pnpm build` builds two apps, and the Chrome job in CI runs one more check.
- No page of the web app is prerendered (Decision 3).
- The studio's stylesheet is global: it styles `body`. It loads with the studio route, and it
  may stay loaded when someone goes back to another page of the app without a new document.
  With one placeholder page that has its own CSS module this does not show. When the app gets
  screens of its own, scope the studio's rules under one root class.
- Saved work is per origin. The file opened from disk and the web app each keep their own
  autosave; export and import carry work between them.
- The debugging handle `window.sceneStudio` is on the web app's studio route too. It exposes
  nothing that is not already in the page, and the checks use it.
- Anyone who runs the web app locally gets Next.js's own anonymous telemetry unless they set
  `NEXT_TELEMETRY_DISABLED=1`.

## Open questions

- The store is one object per document, created as its module loads. That is right for one
  editor on a page. Server autosave and the draft that becomes the account's draft (issues 15
  and 16) will decide how the store learns about a session.
- The policy has `form-action 'none'`, because the app posts no form yet. The first one that
  does, most likely sign-in (issue 10), changes it to `'self'` on purpose.
- Self-hosting the typefaces (issue 23) removes Google from both policies and from both
  documents, in `@scena/studio/fonts` and `@scena/studio/policy`.
- The zod question from ADR 0001 is still open and belongs to the database work (issue 11).
