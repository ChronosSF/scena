# 0002. Hand-drawn frame-flip animation

- **Status:** Accepted
- **Date:** 9 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer
- **Scope:** the scene format, the renderer and its runtime, the budget lint, the studio.
  Motion presets (float, sway, blink), path motion and Lottie- or Rive-style runtimes are out of scope.

## Context

Illustrators animate by drawing the same thing two to four times and flipping the drawings at a
low frame rate, usually "on twos": 6 new drawings a second against a 12 fps base. Procreate
exports frames as a PNG sequence or an animated PNG, and Illustrator exports one SVG per artboard.
The format already has a two-frame animation driven by state: the cat's parts `when: "idle"` and
`when: "selected"` swap its closed eyes for open ones. Frames generalise that to time and to taps.

An author drops extra drawings onto a drawing and they become its frames. The page flips them
with CSS at 2 to 12 fps.

## Decision 1: an additive change within schema version 1

`Part` gains four optional fields:

```ts
frames?: string[];   // asset ids, frame 1 first; frames[0] must equal `asset`
fps?: number;        // a whole number from 2 to 12; default 6
play?: "always" | "hover" | "selected" | "once-on-tap";   // default "always"
boil?: boolean;      // frame-animated parts skip the boil filter; true boils them anyway
```

We did not bump `schemaVersion` to 2.

- **Nothing existing changes meaning.** Every v1 document is still valid and renders exactly as
  before. The desk's rendered output is byte for byte unchanged (the parity test still passes).
- **Readers that do not know frames degrade well.** `asset` stays required and is frame 1. A
  build from before this change ignores `frames` and renders a still drawing; it does not reject
  the file, because the validators ignore fields they do not know.
- **A version bump would cost more than it buys.** With v2, every older reader refuses the file
  ("this build understands up to 1"), and the migration from v1 would be the identity. That is
  churn without a gain. Published pages are static HTML, so no published page depends on the
  reader's version anyway.
- **This is what the plan's versioning rules call a minor change** (section 3.7: "new optional
  slots or parts"). The migration tables stay empty.

Validation, in `validateScene`:

- every frame id must exist;
- at least 2 frames (12 at most structurally; the lint sets the real budget);
- `frames[0]` must be the part's `asset`;
- frames are all vector (`svg-inline`) or all raster, never procedural;
- `fps` is a whole number from 2 to 12; `play` is one of the four modes; `boil` is a boolean;
- `fps`, `play` and `boil` are only allowed on a part with frames;
- the animated parts of one drawing share frame count, fps and play mode, so they flip together.

A part whose art never changes simply has no `frames`. The steaming mug is an example: its
colour layer is printed once and its line layer is redrawn in each frame.

## Decision 2: frames of a part share one box, and the studio does the padding

Frames only work if they sit exactly on top of each other. The rule in the format is that all
frames of a part have the same box (`bbox`, `width`, `height`). The lint reports an error when
they do not.

The studio makes it true at ingestion:

- **Vector frames** register by their artboard, as Illustrator and Procreate export them. Each
  frame is sanitised as usual, then every frame of the part gets the union of their boxes. The
  markup itself is untouched.
- **Raster frames** are trimmed together. Every frame is cut to the union of the drawings on
  the frames, at one scale, from the same source canvas. Frames must therefore come from one
  canvas size; the studio says so when they do not.
- **Frames added later.** Each raster asset keeps an optional `crop` (where it was cut from the
  source canvas, and that canvas's size). A frame added later is cut from the same place. If it
  reaches further, the earlier frames are redrawn with a wider transparent margin, so every frame
  keeps one box. Drawings made before `crop` existed fall back to centring, and the studio says so.
- **Split drawings.** An SVG with colour fills is split into a fills part, printed off-register
  like riso, and a lines part. Frames are added to both. If a new frame has no colour fills, the
  earlier frames' fills are folded into their lines (printed in register), so every frame keeps
  the same parts. The studio reports this too.

The drawing's description line in the inspector reports the result, for example
"SVG · 3 frames at 6 fps in one 72×104 box".

## Decision 3: CSS flips the frames; the runtime only restarts taps

Each animated part renders as a stack of frames inside the drawing's group:

```html
<g class="frs frl fr-all n3 fps6"><g class="fr">frame 1</g><g class="fr">frame 2</g><g class="fr">frame 3</g></g>
```

- **Frame 1 by default.** `.fr{opacity:0}.fr:first-child{opacity:1}`. A page with no CSS
  animation support, reduced motion or Save-Data shows a still drawing.
- **Looping modes** (`always`, `hover`, `selected`) give each frame the same `steps()` keyframes:
  opacity 1 for 1/n of the cycle, then 0. Each frame is offset by a negative delay of its
  position plus half a frame, so the cycle is seamless and starts in the middle of frame 1. No
  frame boundary falls on time 0, which is when the first paint happens. The mode decides when
  the animation is attached: always, on `.obj:hover`, `.obj.hov` (the hit area) and
  `:focus-visible`, or on `.obj.selected`.
- **`once-on-tap`** gives each frame a positive delay of its position. Every frame but the last
  shows for one frame and then hides (`forwards`); the last one appears and stays. It plays when
  the drawing is selected and its stack has the `play` class. The runtime removes and re-adds
  `play` on every tap, so a second tap replays it. That is about 250 bytes of runtime: the
  runtime is now 3,085 bytes minified (1.5 KB gzipped), within the 5 KB budget.
- **Only opacity changes.** No layout, no transforms, no `display`. A test checks that the
  generated frame rules contain nothing else.
- **Holding frame 1.**
  - `prefers-reduced-motion: reduce` holds frame 1 (unless the studio's presenter override is on);
  - page motion "off" holds frame 1;
  - page motion "reduced" stops only the ambient `always` loops; frames still play on hover,
    selection and tap, because those answer the visitor;
  - Save-Data holds frame 1: the runtime sets `data-fr="off"`.
- **Pausing.** When the runtime pauses the boil (tab hidden, scene offscreen, 45 s without
  interaction), it sets `data-fr="paused"` on the root and every stack pauses with
  `animation-play-state`. An idle timer covers scenes without a boil.
- **The CSS is generated only for scenes that use frames**, and only for the frame counts, play
  modes and rates in use.
- **Frame-animated parts skip the boil filter by default.** Hand-drawn frames already wobble, and
  a filter on the flipping art would re-render on every flip. The drawing keeps its lift and its
  ring, and its still parts keep boiling: the filter wraps runs of still parts. `boil: true` on
  the animated parts puts them back under the filter, and the lint warns about it.
- **Raster and vector frames work the same.** A frame is just an asset.

## Decision 4: the budget

The lint adds a "Frame animation" check when a scene has frames. The desk's report is unchanged.

| Rule | Level |
|---|---|
| Frames per animated part: 4 or fewer | ok |
| 5 or 6 frames | warning |
| more than 6 frames | error |
| Drawings playing `always`: more than 4 | error |
| fps above 12 | error (validation also refuses it) |
| Animated parts with `boil: true` on a boiling drawing | warning |
| Frames of a part that do not share one box | error |
| A decoration with a play mode other than `always` (it can never be hovered, selected or tapped) | warning |

Why 6 frames and not 4:

- six frames on twos is a full second of drawn motion, which is the longest loop that still reads
  as a flourish rather than a film;
- illustrators routinely draw 4 to 6 for a loop;
- each frame is a whole asset in the page, so weight and shape count grow linearly with frames.
  That is why the lint warns from 5.

Every frame is in the page, so every frame counts toward the 400-shape budget. Frame bytes count
toward the existing asset weight budget, and the frames check shows their share.

Frames also count toward the 24-asset limit. A three-frame SVG with colour fills is six assets.
Pia's desk with the steaming mug sample is 24 of 24, a warning. See open questions.

## Decision 5: the studio

- **Frames section** in the inspector for the selected drawing:
  - the frames in order, as thumbnails;
  - add frames by choosing files or dropping them on the section;
  - reorder with Alt+arrows, or with the move buttons;
  - remove with Delete, or with the remove button;
  - a speed slider from 2 to 12 fps, labelled the way animators count ("6 fps, on twos");
  - when the frames play;
  - "Play on the canvas";
  - "Boil the frames too".
- **Onion skin.** Choosing a frame holds the canvas on it, and while the section is open the
  other frames show at 20% behind it, so the author can check registration. "Play on the canvas"
  resumes. All of this is studio CSS on top of the renderer's markup; the renderer knows nothing
  of it.
- **Several drawings at once** (dropped on the canvas, or chosen with Upload) ask "One drawing
  with N frames, or N separate drawings?". An animated PNG or WebP becomes frames on its own:
  the studio splits it with the browser's `ImageDecoder` and takes the frame rate from its
  timing. Where `ImageDecoder` is missing, the studio says to export a PNG sequence and uses
  the first frame.
- **Layers panel.** Animated rows show a small frames badge with the count.
- **Samples.** "Coffee mug" is three frames of rising steam over a still colour layer, in the
  desk's style. The same art is in `fixtures/steam-mug-1.svg` to `-3.svg`, painted with the three
  sentinel colours. `fixtures/blink-1.png`, `blink-2.png` and `blink-animated.png` cover raster
  frames.
- **Files and saving.** Export, import and autosave carry frames. They are plain JSON, so the
  round trip is exact; the end-to-end check compares the documents before export and after
  re-import.

## Performance

`pnpm measure --soft`: headless Chrome, software raster, 375×812 at 3×. Two pages: the desk as
rendered today, and the desk with three objects (cup, sketchbook, cat) flipping three line
frames at 6 fps. The page runtime is removed from both, so only the probe moves the boil and only
CSS moves the frames.

Measured on 9 November 2026 on this development machine:

| CPU slowdown | Boil frame, ms (no frames / frames) | p90, ms | Paint and raster per seed change, ms | Main thread with only the flips, ms per second | Frame interval, ms |
|---|---|---|---|---|---|
| 1× | 16.7 / 16.7 | 17.5 / 17.5 | 12.0 / 6.8 | 23.0 / 31.1 | 16.7 / 16.7 |
| 4× | 16.7 / 16.6 | 18.0 / 17.5 | 8.5 / 6.4 | 84.1 / 114.1 | 16.7 / 16.7 |
| 6× | 18.7 / 16.6 | 18.4 / 18.1 | 11.5 / 6.0 | 183.7 / 206.7 | 16.7 / 16.7 |

What the numbers say:

- **Frames add little.** Flipping three objects six times a second added 8 to 30 ms of
  main-thread time per second, about 1 to 5 ms per flip. No paint or raster work was traced in
  the flip-only window on either page. The frame interval stayed at 16.7 ms throughout.
- **The boil got cheaper.** The animated line layers leave the filter, so paint and raster per
  seed change fell from 8.5 to 12 ms to about 6 to 7 ms.
- **The baseline** (23 to 184 ms per second at 1× to 6×) is the probe's own `requestAnimationFrame`
  loop. The 6× runs are noisy.
- **Not measured on a real phone yet**, as for the boil. Chrome's CPU throttling slows only the
  main thread.

## Consequences

- Hidden frames are still in the page: their bytes, their shapes and their DOM nodes all count,
  and the lint says so.
- The studio's thumbnails always show a single frame. Stacks only animate on the canvas, in the
  preview and on the page.
- Studio bundle: about 30 KB more raw (537 KB, 168 KB gzipped).
- `demo-frames.html` (Pia's desk with the steaming mug as a tip link) is built next to
  `demo-desk.html`, for the demo and the runtime checks.

## Open questions

- **Should a frame set count as one asset toward the 24-asset limit?** It is one drawing to the
  author, and inline assets cost no extra requests. Today they count individually, which makes
  frame-heavy scenes hit the limit first.
- **Per-frame timing (holds).** Animators sometimes hold a key drawing for two beats. The format
  could take `frames` entries with a duration later, as an additive change.
