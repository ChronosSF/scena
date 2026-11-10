# Development plan: an illustrated link-in-bio

**For:** Vittoria (founder, designer with UI/UX experience)
**Date:** 9 November 2026
**Status:** v1 for decision. No application code yet.
**Reference:** the attached prototype `Pia Morandi, illustrator.html` is the look-and-feel baseline throughout. Where this plan says "the prototype", it means that file.
**Tracking:** the work is tracked as [milestones](https://github.com/ChronosSF/scena/milestones) and [issues](https://github.com/ChronosSF/scena/issues) on GitHub: one milestone per row of section 9 plus the two later phases, one issue per deliverable, exit criterion and open question. The issues are the live state; this document is the reasoning behind them.

Working name used in this document: **Scena** (placeholder, see assumptions). Public pages live at `scena.example/<handle>`, the editor at `app.scena.example`.

---

## Summary

Scena replaces the vertical list of buttons with a tappable illustration: an illustrator's desk where the sketchbook is the portfolio, the envelope is commissions, and the cat is the newsletter. The prototype already proves the feel (two-colour riso look, hand-drawn line boil, link reveal panel, fallback list, dark mode, reduced motion). The plan is to turn that one hard-coded page into a product in three phases without rewriting the core: first, three hand-drawn preset scenes with a content editor (links, text, palette, commission status), a static publishing pipeline and basic analytics, launched to illustrators in about four months of ~10 hours a week; second, "bring your own drawing" on top of the same scene format; third, a marketplace where illustrators sell scenes to musicians, shops and tattoo artists. The two technical bets that make this possible for a solo founder are a **versioned JSON scene format** that every phase reads and writes, and **publishing pages as static files to a CDN** so the public side costs almost nothing, never goes down with an app deploy, and stays fast on cheap phones. The commercial bet is a free tier with a "made with Scena" badge as the growth loop and a single paid tier (custom domain, no badge, longer analytics) priced at €7/month, charged from the first week of beta so willingness to pay is measured, not assumed.

## The five decisions that matter most

1. **The scene format is the spine of the product.** A scene is a JSON document: ordered art layers, objects with parts and states, hotspots, link slots, effect settings, theme palettes. A user's page is a second, smaller JSON document bound to a scene version. One renderer turns (scene, page) into HTML. The editor preview, the publish step, phase 2 uploads and phase 3 marketplace all read and write these two documents. Nothing else is allowed to know how a page is drawn.

2. **Public pages are static files served from the edge, not an app.** Publishing renders a self-contained HTML file (inline CSS, inline SVG, ~4 KB of vanilla JS) and uploads it to object storage. A tiny edge worker maps hostname and handle to the file. The editor can be down for a day and every published page keeps working. Cost at a million views a day is tens of dollars.

3. **Stack: TypeScript end to end. Next.js on Vercel for the editor and dashboard, Supabase for Postgres and auth, Cloudflare (Worker + R2 + KV + Cloudflare for SaaS) for public pages and custom domains, Stripe for money.** This is the combination that AI coding tools produce the most reliable code for, with the lowest operations burden, and with the one hard infrastructure problem (custom domains with automatic TLS) solved by a purpose-built, cheap service.

4. **Phase 1 is a content editor on top of three hand-drawn scenes, not a design tool.** Users choose a scene, fill its link slots, pick from curated two-colour palettes, set commission status, publish. They cannot move, resize, add or upload objects. Taste stays in the product; the editor stays buildable in ~35 hours.

5. **Charge from the first week of private beta.** Free tier with badge for distribution; Pro at €7/month or €60/year for custom domain, badge removal and 90-day analytics. The phase 2 gate is "do people pay and keep the page as their live bio link for 30 days", not sign-ups.

Assumptions used throughout (full list in section 13): solo founder, building with AI coding tools, ~10 hours a week, launch target early March 2027, no technology preferences, EU-based (Italy) so VAT and GDPR apply, budget under €150/month for infrastructure before revenue.

---

## 1. Phase 1 MVP scope

### In

| Area | What ships |
|---|---|
| Account | Email magic link and Google sign-in. One page per account. Handle at `scena.example/<handle>`, reserved-word list, handle change with a 30-day redirect from the old one. |
| Scenes | Three built-in scenes drawn by Vittoria in the prototype style: **Desk** (the prototype, 5 slots), **Pinboard** (generic, 6 slots), **Shop window** (makers and small shops, 6 slots). Each slot has a default title, description and call to action. |
| Editing | Per slot: title, description, button text, URL, on/off. Profile: display name, one-line bio. Theme: pick one of 6 curated two-colour palettes (contrast-checked for light and dark), light/dark follows the system with an optional override. Motion: auto / reduced / off. Fallback list heading. |
| Commission status | Slots of kind `commissions` have a status: open / closed / waitlist, plus an optional note ("booking for spring 2027"). The status changes the object's drawn state (a small sign on the envelope) and the panel text. |
| Preview and publish | Live preview in the editor that is pixel-identical to the public page (same renderer). One-click publish, unpublish, and "revert to last published". |
| Public page | Static HTML per the prototype: header, scene, aria-live tag panel, plain text list of all links, footer badge (free tier). Light/dark, reduced motion, keyboard and screen reader support, Open Graph image generated at publish, favicon. No cookies. |
| Analytics | Page views, clicks per link, click-through rate, last 7 days (free) or 90 days (Pro), phone vs desktop split, top referrers (Pro). Collected with a cookieless beacon. |
| Billing | Stripe Checkout and Customer Portal, monthly and yearly Pro, EU VAT via Stripe Tax, 7-day grace on failed payment, graceful downgrade. |
| Custom domain | Pro only. One domain per page, `www` or subdomain, CNAME instructions, automatic TLS, status screen. |
| Sharing | Copy link, preview of the Open Graph card, "add to your Instagram/TikTok bio" instructions. |
| Legal and privacy | Terms, privacy policy, cookie-free statement, account export and deletion. |
| Landing page | One page in the product's own visual language with a live demo scene. |

### Explicitly out of phase 1

- Uploading your own art, moving or resizing objects, adding or removing objects beyond turning a slot off, custom hotspots. (Phase 2.)
- Free colour pickers, custom fonts, custom CSS, custom backgrounds.
- More than one page per account, teams, collaborators, agencies.
- Scheduled links, link expiry, UTM builders, QR codes, A/B tests.
- Email capture forms, contact forms, tipping, selling digital products, embedded players (YouTube, Spotify, Bandcamp), social feeds.
- Tracking pixels and third-party integrations (Meta pixel, Google Analytics, Zapier, webhooks).
- Password-protected pages, age gates, NSFW toggles.
- Public directory or discovery of users' pages, follower features.
- Marketplace, scene selling, scene versioning UI for users.
- Native apps. The editor is responsive and usable on a phone for link edits, but designed desktop-first.
- Editor localisation. English UI only; page content is whatever the user types.

### Why these cuts

Every excluded item exists in Linktree or Beacons and none of them is why someone would switch. The only reason to switch is the scene. Phase 1 exists to learn whether that reason is strong enough that people keep the page as their live bio link and pay for a domain. Anything that does not sharpen that answer waits.

---

## 2. Core user flows

### 2.1 Sign-up (try first, sign up to publish)

1. Landing page: a live demo scene (the desk) that the visitor can tap. Primary button: "Start with a scene".
2. Scene picker (no account yet): three scenes shown as live, tappable previews with sample content. Choosing one opens the editor with the scene's default texts.
3. The visitor edits freely. The draft lives in `localStorage` keyed by a draft id; a subtle bar says "Sign in to save and publish".
4. On "Publish" (or "Save"): email field, magic link sent; or Google. Returning users get a code they can paste on the same device.
5. After sign-in: choose a handle (pre-filled from display name, live availability check, reserved words rejected). The local draft is uploaded as the account's page draft.
6. Land back in the editor on the publish step.

Rationale: the scene is the hook, so people should touch it before giving an email. Activation (visit → publish) is the first metric that matters.

### 2.2 Choosing a scene

- Picker cards are live renderers of the scene with sample content, not screenshots, so the boil and the tap behaviour are visible before choosing.
- Each card lists its slots in plain words ("Portfolio, Shop, Commissions, Social, Newsletter") and the audience it was drawn for.
- Switching scene later keeps content: slots are matched by `kind` (portfolio → portfolio), then by order; unmatched links are kept in a "not placed" list and shown only in the fallback text list until assigned. Nothing is lost.

### 2.3 Editing links

- Layout: form on the left, live preview on the right; on narrow screens the preview is pinned on top and the form scrolls under it.
- The preview is the real renderer in a sandboxed iframe (`srcdoc`). Tapping an object in the preview posts a message to the editor and focuses that slot's form. Editing a field updates the preview on keyup.
- Slot form: title (shown in panel heading and fallback list), description (max 140 chars), button text, URL (validated, `mailto:` and `https:` only; `http:` upgraded; URL checked against Google Safe Browsing on publish), on/off toggle. Turning a slot off hides the object and its list entry.
- Commission slot adds: status (open / closed / waitlist) and a short note.
- Profile: display name (max 40), bio (max 120).
- Theme: palette swatches (6), mode (auto / light / dark), motion (auto / reduced / off).
- Autosave to the server every 2 seconds after the last change. A "Saved" indicator. Draft and published are separate; unpublished changes show a "You have unpublished changes" bar.

### 2.4 Publishing

1. "Publish" runs validation: every enabled slot has title and URL, URLs pass Safe Browsing, texts within limits, palette exists for this plan, badge forced on for Free.
2. The server writes an immutable revision (the full page document plus the scene id and version), renders HTML and the Open Graph image, uploads both to R2, updates the handle (and domain) pointers in KV, and marks the revision as published. Typical time: under 3 seconds.
3. Confirmation screen with the public URL, a "View page" button and the share step.
4. "Unpublish" removes the pointers (the URL then shows a quiet "nothing here yet" page). "Revert" republishes the previous revision.

### 2.5 Sharing

- Share panel: copy URL; Open Graph card preview as it will appear in iMessage, WhatsApp and Instagram DMs; two-step instructions for putting the link in an Instagram and TikTok bio.
- The badge on free pages links to the landing page with a `?from=<handle>` parameter so badge-driven sign-ups can be measured.

### 2.6 Viewing analytics

- Dashboard home: views and clicks for the last 7 days as a small chart, total click-through rate, and a table of links with clicks and share of clicks. Pro extends the range selector to 30 and 90 days and adds top referrers (instagram.com, tiktok.com, t.co and so on) and phone/desktop split.
- Empty state before the first view explains the beacon and that counts exclude bots.
- A plain sentence under the chart: "Counts come from the page itself, without cookies. Expect them to be 5 to 10 percent lower than Instagram's own link clicks."

### 2.7 Upgrading and adding a custom domain

1. "Upgrade" opens Stripe Checkout (monthly or yearly, VAT calculated by Stripe Tax).
2. Webhook flips the account to Pro; badge toggle appears, analytics range extends, "Custom domain" appears in settings.
3. Domain flow: enter `links.example.com` → we create a Cloudflare custom hostname → show the CNAME record to add (and a TXT record for ownership) → poll status → "Active" with TLS. Apex domains are allowed when the DNS provider supports ALIAS or CNAME flattening; otherwise the UI steers to `www` or a subdomain.
4. Downgrade: badge returns immediately, analytics window shrinks, custom domain keeps working for 14 days then is detached (the page remains live at `scena.example/<handle>`).

---

## 3. Scene format

### 3.1 Principles

- **Two documents, one renderer.** A `SceneDocument` (art, slots, effects, theme) is authored by an illustrator (Vittoria in phase 1, any user in phase 2, sellers in phase 3). A `PageDocument` (one user's content) binds to a scene at a pinned version. `render(scene, page) → HTML` is a pure function with no network access, so it runs identically in the editor preview (browser) and at publish time (server).
- **Art is data, behaviour is the platform.** Scenes contain shapes and a few declarative hints (which part is visible in which state, where the hotspot is). Line boil, lift on hover, ring draw-on, tap-to-reveal, the aria-live panel, the fallback list, dark mode and reduced motion are implemented once in the renderer and apply to any scene, including raster uploads in phase 2.
- **Colours are roles, not values.** Art references theme roles (`line`, `accent1`, `accent2`, `paper`, `mat`), never hex codes. Palettes map roles to values for light and dark. This is what makes six palettes work across every scene and what lets phase 2 recolour uploaded vector art.
- **Everything is versioned.** The format has a `schemaVersion` with migration functions. Each scene has a semver `version`. Pages pin the exact version they were published with.

### 3.2 SceneDocument

```ts
type SceneDocument = {
  schemaVersion: 1;
  id: string;                      // "desk"
  version: string;                 // semver, "1.0.0"
  name: string;                    // "Illustrator's desk"
  author: { userId: string; displayName: string };
  license: "builtin" | "private" | "marketplace";   // phase 3 adds price and terms elsewhere
  audience: string[];              // ["illustrators"], used by the picker
  canvas: { width: number; height: number };        // viewBox; 400 x 440 for the desk
  theme: {
    roles: ["paper","mat","card","grid","line","accent1","accent2","text","muted"];
    palettes: Palette[];           // curated; each has light and dark values plus blend mode and fill opacity
    defaultPalette: string;
    font: { family: string; weights: number[]; fallback: string };
  };
  effects: {
    boil: { enabled: boolean; baseFrequency: number; octaves: number; displacement: number;
            seeds: number[]; intervalMs: number; scope: "scene" | "object" };
    lift: { dx: number; dy: number; ms: number };
    ring: { strokeWidth: number; drawMs: number };
    fillOffset: { x: number; y: number };            // riso misregistration of fills vs lines
  };
  slots: Slot[];
  layers: Layer[];
  fallback: { heading: string; order: string[] };    // slot ids
  assets: Record<string, Asset>;
  editable: { palettes: "all" | string[]; allowDisableSlots: boolean };
};

type Palette = {
  id: string;
  light: Record<Role, string> & { blend: "multiply" | "normal"; fillOpacity: number };
  dark:  Record<Role, string> & { blend: "multiply" | "normal"; fillOpacity: number };
};

type Slot = {
  id: string;                      // "portfolio"
  label: string;                   // "Sketchbook" (what the editor calls it)
  objectId: string;                // the layer that represents it
  kind: "portfolio" | "shop" | "commissions" | "social" | "newsletter" | "contact" | "custom";
  defaults: { title: string; description: string; cta: string };
  a11yLabel: string;               // "Sketchbook: {title}"
  optional: boolean;               // may be turned off, which hides the object
  statusAware?: boolean;           // supports open / closed / waitlist states
};

type Layer =
  | { id: string; type: "background" | "decor" | "foreground"; asset: string;
      transform?: Transform; opacity?: number; effects?: ("boil")[] }
  | { id: string; type: "object"; slotId: string; transform: Transform;
      parts: Part[]; hotspot: Hotspot; effects?: ("boil" | "lift" | "ring")[] };

type Transform = { x: number; y: number; rotate?: number; scale?: number };

type Part = {
  asset: string;
  role: "fills" | "lines" | "text";           // fills get the blend mode and the misregistration offset
  when?: "idle" | "selected" | "status:open" | "status:closed" | "status:waitlist" | "theme:dark" | "theme:light";
};

type Hotspot =
  | { shape: "ellipse"; cx: number; cy: number; rx: number; ry: number; rotate?: number }
  | { shape: "path"; d: string }
  | { shape: "auto"; pad: number };           // bounding box of the parts, padded; default for phase 2 uploads

type Asset = {
  id: string;
  kind: "svg-inline" | "svg" | "raster";
  src?: string;                    // sanitised SVG fragment for svg-inline
  url?: string;                    // R2 URL for svg and raster
  width: number; height: number; bytes: number; sha256: string;
  colorRoles?: Role[];             // which theme roles the art uses (vector only)
  nodeCount?: number;              // for the performance lint
};
```

Vector art inside assets uses class names from a fixed vocabulary (`role-line`, `role-accent1`, `role-accent2`, `role-paper`, `role-mat`, `role-text`). At ingestion (hand-encoding in phase 1, upload in phase 2), sentinel fill colours in the source file are rewritten to these classes, so an illustrator paints with three swatches and the platform does the mapping.

Procedural backgrounds such as the prototype's cutting-mat grid are generated at render time into static SVG, not at page load in JS. Fewer bytes of script on the public page, and the same output everywhere.

### 3.3 PageDocument

```ts
type PageDocument = {
  schemaVersion: 1;
  scene: { id: string; version: string };            // pinned
  handle: string;
  profile: { displayName: string; bio: string };
  theme: { palette: string; mode: "auto" | "light" | "dark" };
  motion: "auto" | "reduced" | "off";
  links: Record<string /* slotId */, {
    enabled: boolean;
    title: string; description: string; cta: string; url: string;
    status?: "open" | "closed" | "waitlist"; statusNote?: string;
  }>;
  fallbackList: { show: boolean; heading?: string };
  seo: { title?: string; description?: string };
  badge: boolean;                                      // set by the server from the plan at publish
};
```

### 3.4 Example: the prototype desk as a scene (excerpt)

```json
{
  "schemaVersion": 1,
  "id": "desk",
  "version": "1.0.0",
  "name": "Illustrator's desk",
  "canvas": { "width": 400, "height": 440 },
  "theme": {
    "defaultPalette": "riso-pink-yellow",
    "palettes": [{
      "id": "riso-pink-yellow",
      "light": { "paper": "#F1F3F0", "mat": "#E3EAE5", "card": "#FBFCFA", "grid": "rgba(43,63,134,0.13)",
                 "line": "#2B3F86", "accent1": "#FF5DAE", "accent2": "#FFD93D",
                 "text": "#22306A", "muted": "#4E5B8E", "blend": "multiply", "fillOpacity": 1 },
      "dark":  { "paper": "#191C2E", "mat": "#20253B", "card": "#23283F", "grid": "rgba(180,195,245,0.11)",
                 "line": "#B4C3F5", "accent1": "#EE5FA6", "accent2": "#E6C23A",
                 "text": "#E6EAF8", "muted": "#A9B2D6", "blend": "normal", "fillOpacity": 0.85 }
    }],
    "font": { "family": "Shantell Sans", "weights": [400, 600, 800],
              "fallback": "\"Chalkboard SE\", \"Comic Neue\", \"Segoe Print\", sans-serif" }
  },
  "effects": {
    "boil": { "enabled": true, "baseFrequency": 0.04, "octaves": 2, "displacement": 2.8,
              "seeds": [2, 7, 13], "intervalMs": 150, "scope": "object" },
    "lift": { "dx": -1, "dy": -4, "ms": 180 },
    "ring": { "strokeWidth": 3.5, "drawMs": 550 },
    "fillOffset": { "x": 3, "y": 3 }
  },
  "slots": [
    { "id": "portfolio",   "label": "Sketchbook",       "objectId": "sketchbook", "kind": "portfolio",
      "defaults": { "title": "Sketchbook", "description": "Finished work.", "cta": "See my portfolio" },
      "a11yLabel": "Sketchbook: {title}", "optional": true },
    { "id": "shop",        "label": "Framed print",     "objectId": "print",      "kind": "shop", "...": "..." },
    { "id": "commissions", "label": "Envelope",         "objectId": "envelope",   "kind": "commissions",
      "statusAware": true, "...": "..." },
    { "id": "social",      "label": "Pencil cup",       "objectId": "cup",        "kind": "social", "...": "..." },
    { "id": "newsletter",  "label": "Biscotto the cat", "objectId": "cat",        "kind": "newsletter", "...": "..." }
  ],
  "layers": [
    { "id": "mat",     "type": "background", "asset": "mat" },
    { "id": "grid",    "type": "background", "asset": "grid-24" },
    { "id": "clutter", "type": "decor",      "asset": "clutter", "opacity": 0.28 },
    { "id": "cat", "type": "object", "slotId": "newsletter",
      "transform": { "x": 38, "y": 306 },
      "parts": [
        { "asset": "cat-fills",       "role": "fills" },
        { "asset": "cat-lines",       "role": "lines" },
        { "asset": "cat-eyes-closed", "role": "lines", "when": "idle" },
        { "asset": "cat-eyes-open",   "role": "lines", "when": "selected" },
        { "asset": "cat-zzz",         "role": "text",  "when": "idle" },
        { "asset": "cat-prrr",        "role": "text",  "when": "selected" }
      ],
      "hotspot": { "shape": "ellipse", "cx": 76, "cy": 68, "rx": 90, "ry": 62, "rotate": -3 },
      "effects": ["boil", "lift", "ring"] },
    { "id": "envelope", "type": "object", "slotId": "commissions",
      "transform": { "x": 246, "y": 322, "rotate": -7 },
      "parts": [
        { "asset": "envelope-fills",       "role": "fills" },
        { "asset": "envelope-lines",       "role": "lines" },
        { "asset": "envelope-sign-open",   "role": "lines", "when": "status:open" },
        { "asset": "envelope-sign-closed", "role": "lines", "when": "status:closed" }
      ],
      "hotspot": { "shape": "ellipse", "cx": 62, "cy": 40, "rx": 80, "ry": 56, "rotate": 5 },
      "effects": ["boil", "lift", "ring"] }
  ],
  "fallback": { "heading": "Or skip the desk",
                "order": ["portfolio", "shop", "commissions", "social", "newsletter"] },
  "assets": {
    "cat-lines": { "id": "cat-lines", "kind": "svg-inline", "colorRoles": ["line"],
                   "src": "<path class=\"role-line\" d=\"M48 30 Q90 14 132 32 ...\"/>",
                   "width": 160, "height": 120, "bytes": 1180, "sha256": "..." }
  }
}
```

Everything the prototype does maps onto this: the `.fills` group with `translate(3 3)` is `fillOffset`; `.eyes-open` / `.prr` shown only on selection are `when: "selected"`; the `<ellipse class="ring">` per object is the `hotspot`; the turbulence filter is `effects.boil`.

### 3.5 Rendering pipeline

`@scena/renderer` exports `renderPage(scene, page, opts) → { html, ogSvg }`:

1. Resolve the palette and mode into CSS custom properties on `:root`, with the dark variant under `prefers-color-scheme` and `[data-theme]`, exactly as the prototype does.
2. Emit the header, the `<svg>` with `viewBox` from `canvas`, layers in order, each object as `<g class="obj" role="button" tabindex="0" aria-pressed="false" data-slot=…>` with parts and `when` conditions as classes the runtime toggles, and the hotspot ring.
3. Emit the tag panel (`aria-live="polite"`), the fallback `<nav>` list, the badge, and a `<script type="application/json" id="links">` with the per-slot panel texts and URLs.
4. Emit the runtime (~4 KB minified, vanilla): seed cycling with visibility and reduced-motion guards, the capability gate from section 8, selection, panel update, view and click beacons. The script is inlined with a CSP hash.
5. For the Open Graph image, emit a 1200×630 SVG (name, scene without boil) that the publish step rasterises with resvg.

In the editor, the same function renders into an iframe `srcdoc` on every change. In publish, it runs in a Node function. Snapshot tests pin the HTML for each built-in scene so a renderer change that alters output is caught.

### 3.6 How phases 2 and 3 use the format unchanged

- **Phase 2 (bring your own drawings).** An upload becomes an `Asset` (`svg` or `raster`). The editor creates `object` layers with a `transform`, an `auto` hotspot and the default `effects`, and a `Slot` per object. The author's `SceneDocument` has `license: "private"` and `author` set to them. The renderer does not know or care that the art was uploaded. Raster parts get boil (displacement works on bitmaps), lift and ring; they skip recolouring because they have no `colorRoles`.
- **Phase 3 (marketplace).** Publishing a scene to the marketplace sets `license: "marketplace"` and creates a new immutable `scene_versions` row. Buyers' pages bind to that version like any other. Updates by the author create new versions; buyers are offered the update with a slot diff. No new document type is introduced.

### 3.7 Versioning rules

- **Scene semver.** Patch: art changes only. Minor: new optional slots or parts. Major: slot removed or renamed; must ship a `slotMap` (`oldId → newId | null`) so pages can migrate.
- **Pages pin a version.** The editor shows "A new version of this scene is available" and previews the change before the user accepts. Nothing moves under a published page.
- **Schema migrations** are pure functions `v1 → v2`, run lazily on read, tested against every stored document in CI.

---

## 4. Architecture and tech stack

### 4.1 What has to be true

- A designer with AI coding tools, ~10 hours a week, must be able to ship and operate it alone. Low operations load beats elegance.
- Public pages must be fast on low-end phones, cheap per view, and independent of the editor's uptime.
- Custom domains with automatic TLS must work without Vittoria touching certificates.
- The editor becomes canvas-heavy in phase 2 (drag, resize, hotspot drawing); the ecosystem for that matters.
- Phase 3 needs payouts to sellers, so the payment provider must support marketplaces.

### 4.2 Options

| | **A. Next.js + Vercel + Supabase** | **B. SvelteKit on Cloudflare, all-in** | **C. Rails monolith on a VPS** |
|---|---|---|---|
| Shape | React app on Vercel; Postgres, auth and storage on Supabase; pages served by Next.js with ISR; domains via Vercel Domains API | SvelteKit on Workers; D1 (SQLite) or Neon Postgres; R2, KV, Analytics Engine; Cloudflare for SaaS for domains | Rails + Hotwire on Hetzner; Postgres; Caddy on-demand TLS for domains; Cloudflare CDN in front |
| Speed to first version with AI tools | Best. The most training data, the most examples, the most libraries | Good. Svelte 5 is well covered now, fewer ready-made pieces | Good for CRUD, weaker for an interactive SVG editor |
| Operations burden | Very low (two managed vendors) | Low (one vendor), but Workers have runtime quirks (no Node APIs by default, CPU limits) | Medium to high: patches, backups, scaling, TLS, a server to babysit |
| Public page cost at 1M views/day | Medium: bandwidth and function invocations on Vercel add up, ISR caches help | Lowest: R2 egress free, Workers at $0.30 per million requests | Low flat cost, but you do the caching and scaling |
| Custom domains | Works (Domains API, Pro plan), less purpose-built | Cloudflare for SaaS: built for this, 100 free then $0.10 per hostname per month | Caddy on-demand TLS is fine but DIY |
| Phase 2 editor | Best ecosystem (React, dnd libraries, SVG tooling) | Fine; you write the canvas interactions yourself anyway | Weakest fit; you would end up embedding a React island |
| Phase 3 payments | Stripe Connect, straightforward | Same | Same |
| Lock-in | Moderate (Vercel, Supabase); both have exits | Moderate to high if D1 and KV hold core data | Low |
| Main risk for this founder | Public-page cost if it takes off on Vercel alone | Debugging Workers-specific issues without a backend background | Running a server alone |

### 4.3 Recommendation

**Option A for everything a signed-in user touches, plus the serving layer from option B for everything a visitor touches.**

- `app.scena.example`: Next.js (App Router, TypeScript, Tailwind) on Vercel. Editor, dashboard, billing, settings, publish API.
- Postgres and auth on Supabase (magic link and Google). Drizzle ORM for schema and migrations, so the database is plain Postgres and portable.
- `scena.example/<handle>` and custom domains: a Cloudflare Worker (~150 lines) that reads a pointer from KV and streams a file from R2, with Cloudflare for SaaS for custom hostnames and TLS. Beacons go to the same Worker and into Analytics Engine.
- Stripe (Checkout, Customer Portal, Tax, later Connect). Resend for email. Sentry for errors. GitHub Actions for CI.

Why split across two vendors when the brief is to keep it simple: the Worker is the smallest possible program, changes a few times a year, and gives three things at once. Public pages survive any app deploy or Vercel outage. Cost per view is near zero and egress is free. Custom domains are a product feature of the vendor rather than a project. The alternative of serving pages from Next.js would couple the one thing that must never break to the thing that changes every week.

Why not all-in Cloudflare: Next.js on Workers via OpenNext works but adds friction at every step for a solo founder; SvelteKit avoids that but gives up the React ecosystem for the phase 2 editor. Why not Rails: Vittoria would be learning a backend framework and server operations at the same time as building a product.

### 4.4 System diagram

```
Visitors ──► Cloudflare edge Worker ──► KV: handle/hostname → { pageId, revisionId }
                     │                   R2: p/{pageId}/{revisionId}.html, og.png, fonts/
                     └──► /_/v, /_/c beacons ──► Analytics Engine ──(nightly cron)──► Postgres rollups

Users ──► app.scena.example (Next.js on Vercel)
           ├── Supabase Auth (magic link, Google)
           ├── Postgres on Supabase: users, pages, revisions, scenes, domains, subscriptions, stats
           ├── @scena/renderer (shared package) → HTML + OG at publish → R2 + KV
           ├── Stripe: Checkout, Portal, Tax, webhooks (Connect in phase 3)
           ├── Cloudflare API: custom hostnames, KV writes, R2 writes
           └── Resend (email), Sentry (errors)
```

### 4.5 Repository layout (pnpm workspaces)

```
apps/web          Next.js app: editor, dashboard, billing, publish API, webhooks
apps/edge         Cloudflare Worker: page serving, beacons, nightly rollup cron
packages/scene    SceneDocument and PageDocument types, zod schemas, migrations, lint
packages/renderer renderPage(), runtime script, snapshot tests, OG template
packages/scenes   Built-in scenes (desk, pinboard, shop-window) as JSON + source SVGs
packages/db       Drizzle schema, migrations, typed queries
```

---

## 5. Data model

Postgres. Documents that the renderer consumes are stored as JSONB and validated with zod on write, so the schema stays small and the format stays the source of truth.

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id`, `email` (unique, citext), `display_name`, `locale`, `created_at`, `deleted_at` | Auth identities live in Supabase Auth; this mirrors the profile. |
| `pages` | `id`, `user_id`, `handle` (unique, citext), `previous_handle`, `handle_changed_at`, `draft` JSONB (PageDocument), `published_revision_id` (nullable), `status` (`draft` / `published` / `unpublished`), `created_at`, `updated_at` | One per user in phase 1 (unique on `user_id`), relaxed later. |
| `page_revisions` | `id`, `page_id`, `scene_id`, `scene_version`, `document` JSONB, `html_sha256`, `r2_key`, `og_r2_key`, `published_at`, `published_by` | Immutable. Publishing inserts a row; revert points `published_revision_id` at an older one. |
| `scenes` | `id` (slug), `author_user_id` (null for built-ins), `name`, `license`, `visibility` (`builtin` / `private` / `marketplace`), `current_version`, `status` (`draft` / `review` / `live` / `removed`), `price_cents` (phase 3), `created_at` | |
| `scene_versions` | `id`, `scene_id`, `version`, `document` JSONB (SceneDocument), `lint_report` JSONB, `changelog`, `created_at` | Immutable. Pages reference `(scene_id, version)`. |
| `assets` | `id`, `owner_user_id`, `scene_id` (nullable), `kind`, `r2_key`, `mime`, `bytes`, `width`, `height`, `sha256`, `sanitized` bool, `node_count`, `created_at` | Phase 2. Dedupe on `(owner_user_id, sha256)`. |
| `domains` | `id`, `page_id`, `hostname` (unique), `cf_custom_hostname_id`, `status` (`pending` / `verifying` / `active` / `failed` / `detached`), `ssl_status`, `verification_txt`, `detach_after` (for downgrades), `created_at` | |
| `subscriptions` | `id`, `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `plan` (`free` / `pro`), `status` (Stripe status), `current_period_end`, `cancel_at_period_end`, `grace_until` | Entitlements are derived in code from `plan` + `status` + `grace_until`. |
| `page_stats_daily` | `page_id`, `day`, `slot_id` (null for page views), `device` (`phone` / `desktop`), `referrer_host`, `count` | Nightly rollup from Analytics Engine. Primary key on the five dimensions. |
| `handles_reserved` | `handle` | Brand words, routes (`app`, `api`, `_`, `admin`, `help`), offensive terms. |
| `audit_log` | `id`, `user_id`, `action`, `target`, `meta` JSONB, `created_at` | Publishes, domain changes, plan changes. |

Phase 3 additions: `scene_licenses` (`buyer_user_id`, `scene_id`, `scene_version_at_purchase`, `price_cents`, `platform_fee_cents`, `stripe_payment_intent_id`, `refunded_at`), `connected_accounts` (`user_id`, `stripe_account_id`, `payouts_enabled`, `country`), `scene_reviews` (`scene_version_id`, `reviewer_user_id`, `decision`, `notes`), `reports` (`target_type`, `target_id`, `reporter`, `reason`, `status`).

Raw click events are not stored in Postgres. They live in Analytics Engine for 90 days; the daily rollup is the long-term record.

---

## 6. Serving public pages fast and cheaply at scale

### 6.1 Publish pipeline (runs in a Vercel function, under 3 seconds)

1. Validate the draft against the zod schema and the plan (badge, palette, domain).
2. Check every URL against Google Safe Browsing; refuse publish on a hit.
3. Insert `page_revisions`.
4. `renderPage()` → HTML (inline CSS, inline SVG, inline hashed runtime). Rasterise the OG SVG with `@resvg/resvg-js` to PNG.
5. `PUT` to R2: `p/{pageId}/{revisionId}.html` and `p/{pageId}/{revisionId}.png`, both with `Cache-Control: public, max-age=31536000, immutable` (the key includes the revision).
6. Write KV: `h:{handle} → {pageId, revisionId}` and, for each active domain, `d:{hostname} → {pageId, revisionId}`.
7. Update `pages.published_revision_id`. Done; no cache purge is needed because the revision is in the object key.

### 6.2 Request path in the Worker

```
GET https://scena.example/pia
  → KV get "h:pia" (cached in the isolate for 60 s)
  → R2 get "p/{pageId}/{revisionId}.html" via the Cache API (edge-cached, immutable)
  → respond 200, Content-Type text/html, Cache-Control: public, max-age=60, stale-while-revalidate=600
  → headers: CSP (script-src by hash, img-src self data:, connect-src self), X-Frame-Options, Referrer-Policy

GET https://links.piamorandi.it/
  → same with KV key "d:links.piamorandi.it"

GET /fonts/shantell-sans-latin.woff2  → R2, immutable, one year
POST /_/v, POST /_/c                  → beacons (section 6.4)
unknown handle                         → 404 page in the same visual language, 5-minute cache
```

Pointer propagation through KV takes a few seconds; the 60-second in-isolate cache means a republish is visible worldwide within about a minute, which is acceptable and avoids purge logic.

### 6.3 Why static files

- **Speed.** One HTML round trip delivers everything except the font. The scene paints without waiting for JS; the runtime only adds interaction.
- **Independence.** The app can be down, deploying or rate-limited; pages keep serving.
- **Cost.** Egress from R2 is free. Worker requests are the only per-view cost.
- **Security.** No server code evaluates user content on request. User text is escaped at render time; user SVG (phase 2) is sanitised at upload time; the CSP forbids any script not hashed by the renderer. The public domain never sets cookies, and the app lives on a separate origin so a public-page bug cannot touch sessions.

### 6.4 Analytics beacon

- On load, the runtime sends `navigator.sendBeacon('/_/v', {p, r, ref, w})` with page id, revision, document referrer host and viewport class. On link click (panel button or fallback list), `sendBeacon('/_/c', {p, s})` with the slot id, then lets the navigation proceed. No redirect hop: destination links stay direct, which users and destinations prefer; the trade-off is a 5 to 10 percent undercount, stated in the dashboard.
- The Worker drops known bot user agents, drops requests without the JSON body, attaches the country from Cloudflare's request data, and writes one data point to Analytics Engine: blobs `[pageId, kind, slotId, referrerHost, device, country]`, index `pageId`.
- The dashboard queries Analytics Engine's SQL API from a Next.js server action, cached for five minutes. A Worker cron at 03:00 UTC rolls up the previous day into `page_stats_daily`.
- No cookies, no IP storage, no fingerprinting. This is what makes the pages banner-free in the EU.

### 6.5 Cost at scale

Assumes 10,000 published pages, 1,000,000 page views a day, 30 percent of views producing a click, 1,000 custom domains.

| Line | Monthly estimate |
|---|---|
| Workers Paid (page views, beacons, font misses: ~70M requests) | $5 base + ~$18 overage ≈ **$23** |
| KV reads (mostly absorbed by the isolate cache) | ≈ **$5** |
| R2 storage (< 2 GB) and class B reads (mostly edge cache hits) | ≈ **$5** |
| Analytics Engine (~40M data points) | ≈ **$8** |
| Cloudflare for SaaS (1,000 hostnames, first 100 free) | **$90** |
| Vercel Pro (editor and dashboard only) | **$20** |
| Supabase Pro | **$25** |
| Resend, Sentry, domain, misc. | ≈ **$25** |
| **Total** | **≈ $200** against ~1,000 paying users (≈ €7,000 MRR) |

Before launch, the same stack runs on free and hobby tiers at roughly $45 a month (Vercel Pro is needed for a commercial site; Supabase Pro once beta starts so the database never pauses).

### 6.6 Abuse controls from day one

Link-in-bio services attract phishing. Minimum set: Safe Browsing check at publish and a nightly recheck of all published URLs; rate limit publishes per account; a "Report this page" link in the badge and footer; a one-click admin action to unpublish; handle squatting policy (inactive reserved handles released after 90 days); email verification before publish.

---

## 7. Auth, payments, custom domains, file uploads

### 7.1 Auth

- Supabase Auth with email magic link (OTP code shown as well, for people who open the email on another device) and Google. No passwords to store or reset.
- Sessions via `@supabase/ssr` cookies on `app.scena.example` only.
- Account deletion: unpublish, delete R2 objects and KV pointers, delete Stripe customer, anonymise rollups, remove the user. Export: a JSON of the page document and daily stats.
- Admin: a single `is_admin` flag on Vittoria's user, gating an `/admin` route for unpublishing reported pages and reviewing scenes in phase 3.

### 7.2 Payments

- Stripe Checkout (hosted) for upgrade, Customer Portal for card changes and cancellation. Prices in EUR; USD prices added later as Stripe multi-currency prices on the same product.
- Webhooks handled in a Next.js route with signature verification and idempotency on `event.id`: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`.
- Entitlements derived server-side on every request that needs them: `pro = status in (active, trialing) or grace_until > now`.
- Stripe Tax enabled; Vittoria registers for the EU One Stop Shop (OSS) scheme through her accountant so VAT on EU consumer sales is handled with one quarterly return. Alternative considered: a merchant of record such as Paddle for phase 1, which removes VAT work entirely. Rejected because phase 3 needs Stripe Connect for seller payouts and migrating subscriptions between providers later costs more than the OSS setup now.
- Yearly plan at roughly 30 percent off to pull cash forward and reduce churn checks.

### 7.3 Custom domains

- Pro only, one per page. Flow in section 2.7.
- Implementation: `POST /zones/{zone}/custom_hostnames` on the Cloudflare API with `ssl.method = http` and the fallback origin set to the Worker. We store the returned id and poll `GET` for `status` and `ssl.status` every 30 seconds for 10 minutes, then hourly for 48 hours, then mark `failed` with instructions.
- Ownership: Cloudflare's pre-validation TXT record, so a hostname cannot be attached by someone who does not control the DNS.
- Apex domains: supported where the provider offers ALIAS or CNAME flattening (Cloudflare DNS, DNSimple, Route 53, Namecheap); the UI recommends `www` or `links.` otherwise and explains why in one sentence.
- Cost: first 100 hostnames free, then $0.10 per hostname per month, well under 2 percent of Pro revenue.
- Detaching on downgrade removes the custom hostname via the API after the 14-day grace period.

### 7.4 File uploads (phase 2)

- Direct-to-R2 upload with a presigned `PUT` URL minted by the app (S3-compatible API), so large files never pass through Vercel functions. Accepted: SVG (≤ 1 MB), PNG and WebP with alpha (≤ 4 MB, ≤ 2048 px on the long side). Up to 24 assets and 10 MB per scene.
- After upload, a processing function (Node on Vercel, or a Worker with `wasm` sharp if simpler) fetches the object and:
  - **Sniffs the MIME type** rather than trusting the extension.
  - **Sanitises SVG** with an allowlist: `svg, g, path, rect, circle, ellipse, line, polyline, polygon, defs, clipPath, mask, linearGradient, radialGradient, stop, text, tspan`. Strips `script`, `foreignObject`, `image`, `use` with external references, `a`, every `on*` attribute, `style` blocks containing `url(` or `@import`, external `href` and `xlink:href`. Normalises to `viewBox` only (no `width`/`height`), rewrites sentinel colours to role classes, computes the bounding box and node count.
  - **Re-encodes raster** to WebP (plus PNG fallback for old Safari), strips metadata, generates 1× and 2× sizes, converts to sRGB.
  - Stores only the processed result; the original is deleted after 24 hours.
- The editor then places the asset as an object layer with an `auto` hotspot (bounding box plus padding) that the author can switch to a drawn ellipse or path.
- Automatic life: boil, lift, ring, selection states and the fallback list come from the renderer for free. A vector upload painted with the three sentinel swatches gets palette recolouring; raster uploads keep their own colours and get the multiply blend on light paper.
- The published page's CSP still forbids scripts, so a sanitiser miss cannot execute code. The sanitised markup is inlined into the page HTML at publish, exactly like built-in scenes.

---

## 8. Performance budget for animated SVG scenes on low-end phones

Target devices: a 2020-class budget Android (Moto G Power, Galaxy A14 class, 4 cores, 3 to 4 GB RAM) on throttled 4G, and iPhone SE (2nd generation). Test in Chrome Android, Safari iOS and Firefox Android. Lighthouse CI runs on the built-in sample pages on every renderer change; a real low-end Android is bought in week 1 (around €120) and used at every milestone.

### 8.1 Budget

| Metric | Budget |
|---|---|
| Total transfer, first view | ≤ 150 KB compressed |
| HTML including inline CSS, SVG and runtime | ≤ 60 KB compressed |
| Runtime JavaScript | ≤ 5 KB minified and compressed, no framework, no third-party scripts |
| Web font | ≤ 60 KB: self-hosted Latin subset of Shantell Sans as one variable woff2, `font-display: swap`, fallback with size-adjusted metrics so there is no layout shift |
| Largest Contentful Paint (Lighthouse mobile, slow 4G) | < 1.8 s |
| Interaction to Next Paint | < 200 ms; tap on an object to panel update < 100 ms |
| Cumulative Layout Shift | < 0.05 (SVG has an explicit aspect ratio, panel has `min-height`) |
| Scene complexity (lint at publish) | ≤ 400 path or shape nodes, ≤ 8 clickable objects, ≤ 24 assets |
| Line boil | ≤ 7 frames per second (150 ms interval, as the prototype), main-thread time per seed change < 16 ms on the target device, CPU busy < 25 percent while boiling |
| Battery | Boil pauses when the tab is hidden, when the scene scrolls out of view, and after 45 seconds without interaction; resumes on pointer or focus |

### 8.2 How the boil stays within budget

The prototype applies one `feTurbulence` + `feDisplacementMap` filter to the whole scene group and changes the seed every 150 ms. At 2× or 3× device pixel ratio that re-rasterises a 700×800 to 1100×1300 pixel region seven times a second on the CPU, which is the single biggest risk on cheap Androids. Mitigations, in order of application:

1. **Filter per object, not per scene** (`effects.boil.scope: "object"`). Each filter region is the object's bounding box plus 10 percent, so total filtered area is roughly a third of the scene.
2. **Cheaper noise where it is not visible.** `numOctaves` 2 on capable devices, 1 on constrained ones; `baseFrequency` 0.04 and displacement 2.8 as the prototype.
3. **A capability gate in the runtime.** If `navigator.hardwareConcurrency ≤ 4` and `deviceMemory ≤ 4`, start in "lite" mode: 2 seeds, 250 ms interval, 1 octave. Then measure: time five seed changes with `requestAnimationFrame`; if the average frame exceeds 40 ms, stop the boil and leave the scene static. Reduced motion and `Save-Data` disable it outright. The scene looks right with no boil; the boil is a flourish, never a dependency.
4. **Plan B, decided at milestone 0.** If measurement in week 2 shows the filter cannot meet the budget even in lite mode, switch the public page to **publish-time raster frames**: render each object three times with the three seeds using resvg at publish, store them as WebP sprites per theme, and animate by toggling frames. This costs zero runtime filtering and works everywhere, at the price of more bytes (about 25 KB per scene) and a publish step that takes a few seconds longer. The scene format does not change; only the renderer's output does.

### 8.3 Everything else that keeps pages fast

- Inline everything except the font; one request paints the page. Preload the font.
- No layout work in JS: the grid and all decoration are static SVG from the renderer.
- Hover lift uses `transform` only. Ring draw-on uses `stroke-dashoffset` only. No `filter` or `box-shadow` animations.
- Images: the OG image is for link previews only and is never loaded by the page.
- Fallback list is plain HTML, so screen readers and text browsers get every link with zero JS.

---

## 9. Milestones, estimates, and what to test before each next phase

Capacity: ~10 hours a week from 9 November 2026 to 7 March 2027, 17 weeks, roughly 165 hours including the two quiet weeks around Christmas. Design time (drawing scenes, landing page) is inside that budget. This is tight; the cut order is listed after the table.

### 9.1 Phase 1 milestones

| # | Weeks | Hours | Deliverable | Exit criteria |
|---|---|---|---|---|
| **Concierge test** (parallel) | W1–W6 | 6 | Five hand-made pages for five illustrators, made by editing the prototype's `LINKS` and name, hosted on a free static host under `scena.example/<name>` | ≥ 3 of 5 put it in their bio and keep it ≥ 3 weeks. Findings written down. This is the cheapest demand signal and gates nothing except confidence. |
| **M0 Foundations** | W1–W2 (9–22 Nov) | 20 | Monorepo; Next.js on Vercel; Supabase auth; Drizzle schema; `SceneDocument` and `PageDocument` zod types; the prototype re-expressed as `desk.scene.json` plus a sample page rendered by `@scena/renderer`; budget test on the low-end Android | Renderer output matches the prototype visually. Boil numbers recorded; plan A or plan B chosen for the boil. |
| **M1 Editor** | W3–W6 (23 Nov–20 Dec) | 35 | Scene picker (desk only), link/profile/palette/status editing, iframe live preview with tap-to-focus, autosave, handle picker, try-before-sign-up | Three test users go from landing to a finished draft in under 10 minutes without help. |
| **M2 Publish and serve** | W7–W9 (21 Dec–10 Jan, light) | 20 | Revisions, publish pipeline, Worker + KV + R2, fonts, OG image, 404 page, a11y pass (axe, keyboard-only, VoiceOver and TalkBack run-through), legal pages | Page is live worldwide within 60 seconds of publish. axe reports zero violations. Lighthouse mobile within budget. |
| **M3 Analytics** | W10–W11 (11–24 Jan) | 18 | Beacons, Analytics Engine, dashboard (views, clicks per link, CTR, 7/30/90 days), nightly rollup, bot filtering | Fifty manual test clicks are counted within ±5 percent. |
| **M4 Money and domains** | W12–W13 (25 Jan–7 Feb) | 22 | Stripe Checkout, Portal, webhooks, Tax, entitlements, badge logic, downgrade grace; Cloudflare for SaaS domain flow | A test domain is live with TLS within 10 minutes of adding the CNAME. Upgrade, failed payment and downgrade each behave as specified. |
| **M5 Content and landing** | W14–W15 (8–21 Feb) | 22 | Pinboard and Shop window scenes drawn and encoded; 6 palettes contrast-checked in both modes; landing page; onboarding and "you haven't published yet" emails | All three scenes pass the lint and the budget. Twenty-person hallway test understands the landing page in 10 seconds. |
| **M6 Beta and launch** | W16–W17 (22 Feb–7 Mar) | 20 | Private beta with 25 illustrators (from the concierge group and Vittoria's network), fixes, public launch to illustrator communities and Vittoria's own channels | Beta users publish without support tickets about the editor. Gate 1 metrics instrumented. |

**Cut order if time runs short:** (1) launch beta with the desk scene only and add the other two during beta; (2) drop the OG image generator and use a static per-scene image until month 5; (3) ship 4 palettes instead of 6; (4) defer referrer analytics to Pro-after-launch. Custom domains and billing are not cut because they are the price test.

### 9.2 Gate 1: before building phase 2 (evaluate ~8 weeks after public launch)

Build phase 2 only if most of these hold:

| Signal | Target |
|---|---|
| Activation | ≥ 60 percent of sign-ups publish; median time from first visit to publish under 15 minutes |
| Retention | ≥ 40 percent of pages published 30+ days ago received Instagram or TikTok referral traffic in the last 7 days (proxy for "still the live bio link") |
| Monetisation | ≥ 5 percent of pages live 30+ days are on Pro; ≥ 30 paying customers |
| Scale | ≥ 300 published pages |
| Pull for phase 2 | ≥ 50 on a "use my own drawing" waitlist; a manual pilot where Vittoria hand-encodes 8 illustrators' own drawings into scenes ends with ≥ 6 publishing and ≥ 4 paying |
| Love | "How would you feel if you could no longer use Scena?" ≥ 40 percent "very disappointed" among users live 30+ days, n ≥ 30 |
| Performance in the field | p75 LCP < 2.5 s and p75 INP < 200 ms from a tiny RUM beacon on real pages |

If retention and monetisation hit but the phase 2 pull does not, the better next step may be more preset scenes and audiences rather than uploads. If retention misses, no amount of phase 2 fixes it; go back to the scene and the onboarding.

### 9.3 Phase 2 outline (≈ 4 months at the same pace)

Upload and processing pipeline (section 7.4), a canvas editor (place, scale, rotate, order, hotspot), slot creation from objects, palette mapping for sentinel colours, the scene lint with a visible score, private scenes per account. Test before building: the manual pilot above, plus three sessions watching illustrators try to prepare files (expect Procreate PNG exports, not SVG, which is why raster support is in scope from the start of phase 2).

### 9.4 Gate 2: before building phase 3

| Signal | Target |
|---|---|
| Supply | ≥ 150 own-drawing scenes published; ≥ 30 authors with 2+ scenes |
| Demand | ≥ 20 inbound requests from non-illustrators for "a page like that one", or ≥ 10 illustrators asking to sell |
| Manual marketplace pilot | Vittoria brokers scene sales by hand (Stripe payment links, manual assignment) at €20–€40: ≥ 15 sales in 6 weeks, ≥ 70 percent of buyers publish |
| Safety | Zero security incidents from uploads over the phase; ≥ 80 percent of uploads pass the lint first time |

### 9.5 Phase 3 outline (≈ 5 months at the same pace)

Stripe Connect onboarding, listing flow with review, licence purchase, buyer-side scene picker with purchased scenes, version updates, reports and takedowns, payouts dashboard. Considerations in section 11.

---

## 10. Pricing hypothesis for launch

| | **Free** | **Pro: €7/month or €60/year** |
|---|---|---|
| Pages | 1 | 1 (more pages are a later "Studio" tier) |
| URL | `scena.example/<handle>` | Custom domain |
| Scenes | All 3 built-in | All 3 built-in, first access to new scenes |
| Palettes | 2 | All 6 |
| Dark mode, reduced motion, fallback list, accessibility | Yes | Yes (never paywalled) |
| Commission status | Yes | Yes (core to the illustrator promise, never paywalled) |
| Analytics | Last 7 days, views and clicks | 90 days, referrers, device split |
| Badge | "Made with Scena", links back | Removable |

Rationale: Linktree charges $5 to $9 for its lower tiers and Carrd charges $19 a year; Bento is free. An illustrator's alternative to Scena is not Linktree, it is a €60–€100 a year portfolio site or Linktree plus nothing. €7 sits above Linktree's entry tier because the product is design-led and because the audience earns from the link, and below the point where a monthly card charge needs justification. Yearly at €60 is the anchor and the default selection.

What is deliberately free: anything accessibility-related, the commission status, and the scenes themselves. The badge is the growth loop; removing it is the simplest reason to pay, and the custom domain is the second.

How to test it: a Van Westendorp price survey in the beta cohort (n ≥ 40) at €5, €7, €9 and €12, and the real conversion rate in the first 8 weeks. Phase 2 hypothesis: own drawings are included in Pro to maximise scene supply for phase 3; a Studio tier (€12–€15, three pages, team seats) comes later for agencies and collectives. Phase 3 hypothesis: scene licences at €15–€60 one-time, usable on Free pages (the badge stays), 70 percent to the author.

---

## 11. Phase 3 marketplace considerations

### Licensing

- Buyers receive a **non-exclusive, non-transferable licence to use the scene on their Scena pages**. The author keeps copyright. No export, no use outside Scena, no redistribution. The licence text is one page and written in plain language; a lawyer reviews it once.
- The licence covers the **version purchased and later minor and patch versions**. Major versions are offered as a free update at the author's discretion.
- If an author withdraws a scene, existing buyers keep using their purchased version; new sales stop. Legal takedowns (infringement) are the one exception, with buyers notified and offered a credit.
- Optional later: exclusive or limited-edition licences (an author sells one scene to one tattoo studio), commissions brokered through the platform. Not in the first marketplace release.
- Published pages contain the scene's SVG inline, so the art is copyable like any web image. Accept this; do not expose the `SceneDocument` through any public API, and watermark marketplace previews only in the gallery, never on live pages.

### Payouts

- **Stripe Connect Express** accounts for sellers; Stripe handles identity, bank details, tax forms and payouts. Destination charges with an `application_fee` of 30 percent in the first year (review after 12 months; 20 percent is the long-run target).
- The platform is the merchant of record for the buyer's transaction, so Stripe Tax applies VAT by buyer location. The accountant confirms OSS coverage for marketplace sales and the **DAC7** obligation to report EU sellers' earnings to the tax authority, which starts at the first sale.
- Monthly payouts, €25 minimum. Refunds within 14 days if the buyer has not published with the scene (EU right of withdrawal is waived once they do; the checkout collects that explicit consent).

### Moderation

- **Pre-publication review** of every scene by Vittoria for the first 100 listings, then automated lint plus review of first-time sellers only.
- **Human-made policy:** marketplace scenes must be made by the seller, and fully AI-generated art is not allowed. This is a brand decision as much as a legal one: the community the product serves cares about it, and the platform's value is taste.
- **Notice-and-action** under the EU Digital Services Act: a report flow on every listing and page, acknowledgement within 24 hours, decision within 7 days, repeat-infringer suspension, counter-notice. A published policy page and a yearly transparency note.
- Upload sanitisation (section 7.4) and the publish-time Safe Browsing check protect buyers from malicious files and links.

### Quality control

- **Automated lint at listing time**, shown as a score to the author before they can submit: file size and node count within budget, every object has a hotspot and a label, text contrast for every palette in both modes, reduced-motion fallback renders correctly, performance test on the renderer in a headless browser, at least 4 and at most 8 slots.
- **Curation**: a "Featured" shelf chosen by Vittoria, categories by audience (musicians, shops, tattoo artists, photographers, writers), and search by slot kinds ("has shop, has booking").
- **Pricing bands** of €10 to €80 set by the author; the platform publishes guidance by complexity.
- **Previews are live**: every listing is a working page with sample content, boil and all, so buyers try before buying.
- **Ratings** are deferred until there are enough sales per scene for them to mean anything; until then, "used by N pages" is shown.

---

## 12. Top risks and open questions for the founder

### Risks

1. **Time.** 165 hours is a thin budget for an editor, a publish pipeline, billing and domains plus three drawn scenes. Mitigation: the cut order in section 9, AI tools for boilerplate, and a ruthless "no" to anything in the out-of-scope list until Gate 1.
2. **Novelty, not need.** People may love the demo and still not switch because Linktree is good enough. Mitigation: the concierge test in weeks 1 to 6 answers this before most of the code exists; the retention proxy in Gate 1 answers it after launch.
3. **SVG filter performance on cheap Androids.** The boil is the signature and the most expensive thing on the page. Mitigation: per-object filters, the capability gate, and plan B (publish-time raster frames) decided at M0 with a real device in hand.
4. **Illustrators export PNG, not SVG.** Procreate and Photoshop are the norm. Phase 2 must handle raster from the start, and recolouring will not work for those files. Mitigation: raster is first-class in the format; palette recolouring is a vector-only bonus.
5. **Content bottleneck.** In phase 1 every scene is drawn by Vittoria, which caps the audiences served. Mitigation: pick scene 2 and 3 for the two next-largest audiences in the concierge responses; phase 2 removes the bottleneck.
6. **Abuse.** Link services get used for phishing and spam, which gets domains blocked by Instagram and flagged by Safe Browsing. Mitigation: section 6.6 from day one; publish on a clean, dedicated domain; respond to reports within a day.
7. **Security of uploaded SVG (phase 2).** Mitigation: allowlist sanitiser, CSP that blocks all non-hashed scripts, separate origins for app and pages, a bug bounty of the "thank you and a free year" kind.
8. **Tax and compliance overhead for an EU solo founder.** VAT OSS, DAC7 in phase 3, DSA process, GDPR requests. Mitigation: Stripe Tax, an accountant from day one, templates for DSA and GDPR responses written before launch.
9. **Vendor dependence.** Vercel, Supabase, Cloudflare, Stripe. Mitigation: plain Postgres via Drizzle, the renderer as a dependency-free package, static HTML in R2 that any CDN could serve.
10. **Accessibility debt.** An illustrated interface can quietly exclude people. Mitigation: the fallback list is always present, objects are real focusable controls with labels, palettes are contrast-checked, and an a11y pass is an exit criterion for M2, not a later task.

### Open questions

1. Is Vittoria the product's voice and curator long-term, or is the goal a neutral platform? This decides the marketplace's human-made policy and the "Featured" shelf, and how much of her design time goes to scenes versus the editor.
2. Which two audiences get scenes 2 and 3? The plan assumes a generic pinboard and a shop window; the concierge conversations should confirm or replace that.
3. Product name and domain. "Scena" is a placeholder; the real name needs a short domain and a free Instagram handle, and should be checked for trademark conflicts in the EU and US.
4. Pricing currency and language at launch: EUR and English only, or EUR plus USD and an Italian editor UI for the home market?
5. Should Free include the commission status, as this plan assumes, or is it the strongest illustrator-specific reason to pay?
6. How much of the editor must work on a phone at launch? The plan assumes link edits yes, canvas work no.
7. Does Vittoria want to run the private beta from her own network, or recruit cold through illustration communities? The former is faster, the latter is more honest.
8. Appetite for the manual pilots (hand-encoding eight illustrators' drawings before phase 2; brokering sales by hand before phase 3). They are the cheapest learning available and they cost her design hours.
9. Are there scenes she would never allow (political, adult, gambling) and does that policy exist before the first upload?
10. Who is the accountant, and can VAT OSS registration happen before the first paid beta invoice?

---

## 13. Assumptions made in this plan

- **Team:** Vittoria alone, designing and building with AI coding tools, no contractor budget before revenue.
- **Capacity:** about 10 hours a week, including design time, from 9 November 2026 with a public launch targeted for the week of 8 March 2027.
- **Technology preferences:** none stated; the recommendation is TypeScript, Next.js on Vercel, Supabase, Cloudflare, Stripe.
- **Infrastructure budget:** under €150 a month before revenue; the plan comes in around $45 pre-launch.
- **Location:** Vittoria operates from Italy, so EU VAT (via OSS), GDPR and the Digital Services Act apply, and prices are in EUR.
- **Audience for phase 1:** illustrators and visual artists first, because the prototype, the founder's network and the commission-status feature all point there; musicians and shops follow once presets exist for them.
- **The prototype's desk scene is scene 1** and needs only cleanup and encoding, not redrawing. Shantell Sans stays as the typeface, self-hosted as a Latin subset.
- **"Basic click analytics"** means views and clicks per link without cookies, accepting a 5 to 10 percent undercount versus redirect-based counting.
- **Commission status** is a property of a slot of kind `commissions`, with three states (open, closed, waitlist) and a free-text note.
- **One page per account in phase 1.** Multiple pages, teams and agency features are a later tier.
- **The working name "Scena"** and the domain `scena.example` are placeholders only.
- **Hour estimates** assume AI-assisted coding for boilerplate and that Vittoria reviews and tests everything herself; they include no allowance for learning a backend from scratch, which is why the stack avoids servers and passwords.
- **Launch marketing** is Vittoria's own channels and illustrator communities; no paid acquisition is assumed in phase 1.
