# 0003. Uploaded backgrounds, a curated typeface list and hand-lettered names

- **Status:** Accepted
- **Date:** 9 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer
- **Scope:** the scene format, the renderer, the lint and the studio, in this priority order:
  uploaded backgrounds, the typeface list, lettered names.

## Context

In the plan, the board (the mat or the desk) and the typeface of the name belong to the scene.
Preset users never change them. In bring-your-own-drawings, the user is the scene's author, so
they should own them too: a paper texture or a drawn desk under their drawings, a face that suits
their hand, and their name as they letter it.

All three are additive changes within schema version 1, for the reasons in ADR 0002: every field
is optional, older readers ignore what they do not know, and none of it changes how the built-in
desk renders. The parity test still passes.

## Decision 1: uploaded backgrounds

### Format

Background layers with uploaded assets were already allowed. Three optional fields are new, and
only background layers may have them:

```ts
fit?: "cover" | "contain";  // fit the art to the board, centred; without it, `transform` places it
clip?: boolean;             // clip to the mat's rounded shape
assetDark?: string;         // a dark-mode variant of `asset`, the same kind of art
```

- **Fitting.** The board is the mat's box (inset 6, radius 18) when `clip` is set, and the canvas
  otherwise. "cover" fills it and crops; "contain" shows all of it. The renderer works this out
  from the art's box and the canvas, so a background still fits after the canvas size changes.
- **Never part of the drawing.** Validation refuses `effects` (no boil, lift or ring) and
  `hotspot` on background layers.
- **Kept apart in the page.** Uploaded backgrounds render in their own group, marked
  `aria-hidden`, and take no pointer events.

### Placement, in the studio

The studio builds two placements out of these pieces:

- **Replace the mat.**
  - the generated mat and grid go: the surface becomes bare paper;
  - the background moves first and fits "cover";
  - it is clipped to the mat's rounded shape.
- **Over the mat.**
  - the surface stays, or comes back;
  - the background sits on it, behind the drawings, fitted "contain" and clipped.

Placement belongs to the board, not to one background. Choosing "Over the mat" for one brings
the mat back under all of them.

The surface a background replaced is remembered, so "Over the mat" and "Use as drawing" restore
it. "Use as drawing" puts the background back where it showed: its fit becomes its transform.

A drawing that becomes a background flattens to frame 1 (a board does not animate). A clickable
drawing gives up its link, which is kept in the stash as with the clickable toggle.

### Dark mode: both a variant and a rule

- **`assetDark`** is shown instead of `asset` in dark mode. It uses the existing `w-light` and
  `w-dark` classes, so it costs one more group and no new CSS mechanism.
- **A raster without a variant** is multiplied onto the palette's dark mat colour, at the
  palette's dark fill opacity (0.85 in every built-in palette). A light paper texture becomes
  dark paper with its grain intact, instead of glowing. The renderer puts a mat-coloured
  rectangle under the image, shown only in dark mode, and gives the image
  `mix-blend-mode: multiply` there. A CSS filter (invert, or brightness) would have been more
  exact, but filters re-run whenever the boil repaints the tiles under them. Blending is cheap
  and stays still.
- **Vector backgrounds** painted with the sentinel colours recolour with the palette like any
  drawing. They need neither.

### Ingestion and budget

- **Raster backgrounds are not trimmed**, because a texture is all "drawing".
- **They are scaled down to 3× the board.** For the 400-unit desk that is 1200 px wide; for a
  400 × 440 canvas, up to 1200 × 1320.
- **They are re-encoded as WebP** (quality 0.82) where the browser's canvas can encode it (Chrome,
  Edge, Firefox), and as PNG elsewhere (Safari).
- **"Use as background" re-reads the original file** for a raster drawing added in the same
  session, so it gets the background treatment rather than the drawing's trimmed 1024 px image.
- **The lint, per background** (its art plus its dark variant):
  - over 150 KB warns, over 300 KB is an error;
  - a raster more than 1.5 times bigger than the board needs also warns.

## Decision 2: a curated typeface list

`theme.font` already drove the Google Fonts link and the font stack. The studio now exposes it as
"Typeface" in the page settings: a list of six faces, each showing the page's own name in that
face. The list lives in `@scena/scene` as `TYPEFACES`:

| Face | Why | Weights | Name size |
|---|---|---|---|
| Shantell Sans | the default: a marker hand that matches the riso look | 400, 600, 800 | 1 |
| Caveat | a quick pen; the most "handwritten" | 400, 600, 700 | 1.25 |
| Patrick Hand | felt-tip capitals, very legible | 400 | 1.25 |
| Kalam | pencil, a little more formal | 400, 700 | 1.1 |
| Fredoka | rounded and friendly, for character work | 400, 600, 700 | 1.1 |
| Instrument Serif | an editorial serif, for contrast with drawn work | 400 | 1.25 |

- **Each entry carries its weights**, which go into the font URL, plus the weights the page uses
  for the name, headings and buttons, and for emphasis. A face without an 800 (Patrick Hand,
  Instrument Serif) is never asked for one, so the browser does not fake a bold.
- **Name size.** The size factor scales the name's `clamp(2.6rem, 12vw, 3.5rem)`. It was measured
  against Shantell Sans at 800 over three sample names, about halfway between matching its width
  and matching its cap height, so the name fills the header without getting taller than it.
- **Running text** in a non-default face uses `font-size-adjust: 0.51`, Shantell's x-height, so
  Caveat's small x-height stays readable. The name and lettering inside drawings keep their own
  sizes.
- **Shantell Sans needs no extra CSS**, which keeps the desk's output unchanged.
- **Validation:** the family must be in the list, because the renderer builds a URL from it. An
  unknown family is an error, and so is a weight the face does not come in.
- **Fonts stay on Google Fonts for now.** The plan's self-hosted subsets come with publishing.
  The studio loads all six faces in one request for its previews.

**`editable.font?: boolean`** (default false) is in the format, but the studio does not set it.
In bring-your-own-drawings the author edits `theme.font` directly. The flag is for presets, where
it will let page owners pick from the same list. That also needs a page-side override, which
comes with the preset phase.

## Decision 3: hand-lettered names live in the scene

```ts
header?: { lettering?: { asset: string; maxWidth?: number; tilt?: boolean } }
```

The lettering is scene-level, not page-level:

- assets are scene-level;
- the header is part of the design, as the board is;
- in bring-your-own-drawings the scene is the author's own.

The page's `profile.displayName` stays the accessible text.

### Rendering

- **The h1 keeps the typed name**, visually hidden but read by screen readers, and the drawn name
  shows in its place (`aria-hidden`). `<title>`, the panel and the plain list are unchanged.
- **Vector lettering** painted with the sentinel colours recolours with the palette. It gets the
  riso shadow: a second copy behind the ink copy, offset by the scene's fill offset in CSS pixels
  (like the typed name's `text-shadow`). In that copy the role colours (ink, colour 2, text,
  paper) point at colour 1 through custom properties, so strokes stay strokes. Lettering in its
  own colours gets no shadow.
- **Raster lettering** gets no shadow, as asked. It gets the dark-mode paper sticker raster
  drawings already have, so dark ink still reads on a dark page.
- **Size.** Width is `min(maxWidth%, 7.5rem × aspect ratio)`, so a tall lettering never gets
  taller than 7.5rem. `maxWidth` goes from 20 to 100 and defaults to 85.
- **Tilt.** The header's slight tilt is on by default, as on the typed name; `tilt: false` turns
  it off.

### Lint

- Lettering over 60 KB warns; over 150 KB is an error.
- A recoloured vector lettering counts twice toward the 400-shape budget (the ink and the shadow).
- The typed name must not be empty while lettering is set. `validatePage` already requires a
  name; `lintPage` also says why ("screen readers and the page title still need it").

### Studio

- In the page settings: a "Name lettering" drop target with a preview, a Remove button, a width
  slider and the tilt switch.
- On a drawing's menu and in its inspector: "Use as name lettering". It takes frame 1, folds the
  fills into the lines, and removes the drawing from the canvas.
- The lettering is never a layer; it shows in the page header on the canvas.

## Measured

Two exports of Pia's desk, compared:

| Export | Raw | Gzipped | Budget |
|---|---|---|---|
| Pia's desk (`demo-desk.html`) | 23.6 KB | 7.3 KB | 60 KB gzipped |
| Pia's desk with the paper texture background and her lettered name, exported by the studio in `verify:studio` | 31.0 KB | 12.8 KB | 60 KB gzipped |

- **The fixture texture is small on purpose:** 600 × 660, 5 KB as WebP.
- **A real scanned texture at full board size** is more like 60 to 150 KB as WebP, which is why
  the background budget warns at 150 KB. Base64 inside the page does not gzip much further, so
  that bytes count almost one for one toward the page's 60 KB compressed budget, and a scan near
  the warning level would use most of it.
- **Reduced motion is unaffected.** Backgrounds and lettering do not move, and frames and the boil
  behave as before.

## Fixtures and samples

`tools/make-fixtures.ts` writes:
- `paper-texture.png`: 600 × 660, warm off-white with mottling and fibres;
- `drawn-desk.svg`: plank seams and a wash, in the sentinel colours;
- `pia-lettering.svg`: brush "Pia", sentinel colours;
- `pia-lettering.png`: the same "Pia" in dark ink with a red swash, like a scan.

The drawn desk is also the "Drawn desk top" background under Samples, from `samples.json`. The
desk scene itself is untouched.

## Open questions

- **Lettering for presets.** A page owner on a preset may want their own lettered name. That is
  page-level and would need page-level assets, which the format does not have yet.
- **A background per palette.** Today a background has one dark variant, not one per palette. A
  drawn background in the sentinel colours already recolours, which covers most cases.
- **Self-hosted fonts.** With publishing, the six faces should become self-hosted Latin subsets,
  per the plan's font budget.
