# 0009. One theme: the app's pages on the studio's tokens and controls, and no Tailwind

- **Status:** Proposed. It takes effect when the change that makes it is merged.
- **Date:** 27 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer
- **Scope:** where the theme lives, and the web app's own pages (sign-in, the confirm page,
  `/admin`, the home placeholder, the 404), as the founder approved on 27 November 2026
  ([app-pages.md](../design/app-pages.md)). Not part of it: the address picker and the
  inspector's address row, new pages, self-hosted typefaces (issue 23), the landing page (issue 48).

## Context

The studio has a design system ([studio-ui.md](../design/studio-ui.md)) whose tokens were at the
top of `studio.css`. The app's pages had a second one in two CSS modules: their own colours, the
system font, blue primary buttons, and their own button and field rules. The account slot
repeated each token's value as a fallback. Because `studio.css` is global and stays loaded after
a visit to `/studio`, `global.css` and each page repeated what it set on the body, so that a page
looked the same before and after ([ADR 0004](0004-one-studio-two-apps.md), costs). The plan
(§4.3) and issue 9 name Tailwind for the app; ADR 0004 left that choice for the first real screens.

## Decision 1: the theme has one home, in the studio's package

`packages/studio/src/theme.css`, exported as `@scena/studio/theme.css` beside `./studio.css`:
the tokens, light and dark; the base (box sizing, the body's type and colours, the focus ring,
`.sr-only`, reduced motion); the controls the studio and the pages share (`.btn` and its kinds,
the field rules, `.field-msg`); and the page scale (Decision 2). The rules moved; none was copied.

- **`studio.css` begins with `@import "./theme.css"`** and keeps what only the chrome needs. An
  app that mounts the studio still imports one stylesheet.
- **The web app's root layout imports the theme and links Inter** (`@scena/studio/fonts`) for
  every page; `/studio` imports `studio.css` as before. Turbopack puts the imported theme in one
  chunk that the layout and `/studio` share, so a page of the studio loads it once.
- **Vite inlines the import** into the single file. Its rules are the same, in a new order; every
  element of the studio has the same box and computed style in light, dark, at 375 px and with the
  scene picker open, and the file grew by 562 bytes (the new tokens and the page scale).
- **In the studio's package**, its first user, whose tests and pictures guard it; a package of
  its own would hold one stylesheet.

The question ADR 0004 left, what a visit to the studio does to the app's other pages, goes
away rather than being answered again: those pages use the theme's classes and their own
modules' alone, and what `studio.css` adds names the studio's own elements. `global.css`, the
pages' copies of the body's values and the account slot's fallbacks are gone.

## Decision 2: one button, one field, one message, at a page scale

The pages use the studio's `btn`, `btn-primary`, `input`, `field-label` and `field-msg`. A scope,
`.page-scale`, on the page's `<main>` (`Shell`) sets `--ui-h-control` to the new `--ui-h-page`
(40 px) and the base type to `--ui-lg`, steps field labels and messages up to `--ui-md`, and
gives a field 12 px inside: five rules beside the controls they scale, and two for a phone or a
touch screen (44 px controls, a field's type at 16 px). New tokens: `--ui-xl`, `--ui-xl-lh` (24 /
30, page titles), `--ui-h-page`, and `--ui-r-xl`, the dialogs' 12 px radius, for the pages' card.
`.btn` gained `text-decoration: none`, for a link drawn as a button. Icons are `lucide-react`'s.

Considered: a token per measure the scale changes, which puts variables in every control for one
scope; and page classes of their own, the second definition this removes.

## Decision 3: the app does not take Tailwind

The studio's system is hand-written: custom properties and two stylesheets. Tailwind beside it
would be a second styling system, the thing this change removes. Its utilities would need the
tokens restated in its configuration, its preflight would compete with the theme's base, and it
would bring a build step and a dependency to keep current. This record replaces the plan's
"Tailwind" in §4.3 and closes that part of issue 9.

What it costs:

- **No ready-made utilities.** A new page's layout is a few lines of a CSS module on the tokens;
  its controls are the theme's. Someone who knows Tailwind learns roughly sixty tokens and a
  handful of control classes instead.
- **A test, not a framework, keeps a module to tokens.** `apps/web/test/styles.test.ts` refuses
  a colour (hex, a colour function, or one of the basic named colours), a font stack or a radius
  in the app's stylesheets; a rarer colour name gets past it to review. `pnpm verify:web` checks
  the pages' colours, type and scale in light and dark.
- **The global classes are few but global**, one namespace for the studio and the app: a page
  must not give `.btn`, `.input` or the field classes another meaning.

## Costs and risks

- The single file carries the page scale's rules, unused there (part of the 562 bytes).
- **Every page now asks Google Fonts for its stylesheet ahead of first paint** (before, only
  `/studio`; home and sign-in asked no other host), until the faces are self-hosted (issue 23).
- The account slot's two controls are now the theme's ghost buttons, so their hover fades in
  120 ms as the studio's own buttons do; every box and computed value in the bar is otherwise
  unchanged at 1024, 1180, 1280 and 1440 px, signed in and out, light and dark. `apps/web` now
  declares `lucide-react` at the studio's version; the person is Lucide's, a little rounder.
- 44 px controls on phones depart from the approved 40 (app-pages.md, the decisions least sure of).

## Checks

`pnpm verify:web` gained three checks: the home page is on the theme at the page scale, light and
dark; a wrong code is shown under its field, in the danger colour with the field's border, and
said once; and at 375 px a field's type is 16 px. Two changed: the keyboard reaches the sign-in
page in the order it is seen (the way back is now under the card), and "the home page looks the
same after a visit to the studio" finds the studio's stylesheet by its own rule, since every
page now has more than one. Taking out the theme's import in the root layout, the page scale's
scope, the dark tokens or the 16 px rule each makes one of them fail. Two were extended: a page
that does not exist is the app's own page in the shell (`app/not-found.tsx`), and stepping back
from the code step carries no problem with it. `pnpm test` has two more: the app's stylesheets
hold no colour, font stack or radius of their own, and the rule that says so finds each.
