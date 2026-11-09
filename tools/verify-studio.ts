// End-to-end check of the studio in headless Chrome, through real browser input:
// mouse clicks and drags (Input.dispatchMouseEvent), the file chooser (DOM.setFileInputFiles),
// the keyboard, and a tap inside the sandboxed preview frame.
//   node tools/verify-studio.ts                 the static build, opened from file:// (run pnpm build first)
//   node tools/verify-studio.ts http://localhost:5173/   the dev server
// Screenshots go to tools/out/.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fixture, launch, sleep, type Page } from "./cdp.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "tools", "out");
mkdirSync(out, { recursive: true });
const target = process.argv[2] || pathToFileURL(join(root, "apps/studio/dist/index.html")).href;

let failures = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== "" ? `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  if (!ok) failures++;
};

const chrome = await launch({ port: 9341, fileAccess: false });
const page = await chrome.newPage();
await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: "light" }] });

const center = (p: Page, selector: string) => p.eval<[number, number] | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
async function clickOn(selector: string) {
  const c = await center(page, selector);
  if (!c) throw new Error(`Nothing matches ${selector}`);
  await page.click(c[0], c[1]);
  await sleep(250);
}
const state = () => page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); return { layers: s.scene.layers.map((l) => l.id + ":" + l.type), sel: s.sel, links: s.page.links, palette: s.page.theme.palette, mode: s.page.theme.mode, view: s.view }; })()`);
const layer = (id: string) => page.eval<any>(`sceneStudio.store.getSnapshot().scene.layers.find((l) => l.id === ${JSON.stringify(id)})`);
async function keyWith(key: string, code: string, modifiers: number, vk = 0) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: vk });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: vk });
  await sleep(250);
}
const ALT = 1, CTRL = 2, SHIFT = 8;
const setFiles = (selector: string, files: string[]) => page.setFiles(selector, files);
/** Intercepts download links so their files can be read back with `downloads()`. */
const hookDownloads = () => page.eval(`(() => { window.__dl = {}; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl[this.download] = fetch(this.href).then((r) => r.text()); else orig.call(this); }; })()`);
const downloads = () => page.eval<Record<string, string>>(`(async () => { const o = {}; for (const [k, v] of Object.entries(window.__dl)) o[k] = await v; return o; })()`);
/** A point on the empty workspace, left of the page: pressing it deselects. */
const emptyWorkspace = () => page.eval<[number, number]>(`(() => { const r = document.querySelector(".workspace").getBoundingClientRect(); return [r.x + 16, r.y + 120]; })()`);

// boot clean
await page.goto(target, 1200);
await page.eval(`localStorage.clear()`);
await page.goto(target, 1500);
check("studio boots", await page.eval(`!!window.sceneStudio && !!document.querySelector("#stage .st-svg svg")`), target);

// samples
check("empty state offers upload and samples", await page.eval(`!!document.querySelector('[data-ui="empty"]')`));
await clickOn('[data-ui="samples"]');
await clickOn('[data-sample="cat"]');
await clickOn('[data-ui="samples"]');
await clickOn('[data-sample="envelope"]');
let s = await state();
check("two sample drawings added from the samples menu", s.layers.join(",") === "mat:background,grid:background,cat:decor,envelope:decor", s.layers);

// layer order: drag a row in the Layers panel, then Alt+arrow on the focused row
const catRow = await center(page, '[data-layer-row="cat"]');
const envRow = await center(page, '[data-layer-row="envelope"]');
await page.drag(catRow!, [envRow![0], envRow![1] - 14], 10);
await sleep(300);
s = await state();
check("dragging a layer row reorders the drawings", s.layers.join(",") === "mat:background,grid:background,envelope:decor,cat:decor", s.layers);
await page.eval(`document.querySelector('[data-layer-button="cat"]').focus()`);
await keyWith("ArrowDown", "ArrowDown", ALT, 40);
s = await state();
check("Alt+Down on a layer row sends it back", s.layers.join(",") === "mat:background,grid:background,cat:decor,envelope:decor", s.layers);

// visibility: hiding a decoration keeps it in the scene but not on the page
await clickOn('[data-layer-row="cat"] [data-ui="visibility"]');
const hiddenOp = (await layer("cat")).opacity;
await clickOn('[data-layer-row="cat"] [data-ui="visibility"]');
const shownOp = (await layer("cat")).opacity;
check("visibility toggle hides and shows a drawing", hiddenOp === 0 && shownOp !== 0, { hiddenOp, shownOp });
await clickOn('[data-layer-button="envelope"]');

// clickable + commission status, by real clicks
await clickOn("#clickable");
s = await state();
check("envelope made clickable as a commissions link", s.layers.includes("envelope:object") && s.links.commissions?.status === "open", s.links.commissions);
await clickOn('input[name][value="waitlist"] + span');
s = await state();
const flag = await page.eval<string>(`[...document.querySelectorAll("#stage .st-svg text")].map((t) => t.textContent).join("|")`);
check("commission status switched to waitlist, flag redrawn", s.links.commissions?.status === "waitlist" && flag.includes("waitlist"), flag);

// uploads through the real file chooser
await setFiles("#file", [fixture("teapot-sentinel.svg"), fixture("plant-procreate.png")]);
await sleep(2500);
s = await state();
const ann = await page.eval<string>(`document.getElementById("announce").textContent`);
check("SVG and PNG uploaded through the file input", s.layers.includes("teapot-sentinel:decor") && s.layers.includes("plant-procreate:decor"), ann);
const teapot = await page.eval<any>(`Object.values(sceneStudio.store.getSnapshot().scene.assets).filter((a) => a.id.startsWith("teapot")).map((a) => ({ id: a.id, roles: a.colorRoles }))`);
check("sentinel colours recoloured, fills split for riso", teapot.length === 2 && teapot.every((a: any) => a.roles.includes("line")), teapot);
const plant = await page.eval<any>(`(() => { const a = sceneStudio.store.getSnapshot().scene.assets["plant-procreate"]; return { w: a.width, h: a.height, kind: a.kind }; })()`);
check("PNG trimmed to the drawing", plant.kind === "raster" && plant.w === 525 && plant.h === 770, plant);

// direct manipulation with the mouse on the plant
await clickOn('[data-layer-button="plant-procreate"]');
const t0 = (await layer("plant-procreate")).transform;
const p = await center(page, '#stage [data-layer="plant-procreate"]');
await page.drag(p!, [p![0] + 60, p![1] - 40]);
await sleep(300);
const t1 = (await layer("plant-procreate")).transform;
check("drag moves the drawing", Math.abs(t1.x - t0.x) > 20 && Math.abs(t1.y - t0.y) > 10, { t0, t1 });
const scaleKnob = await center(page, '#stage .ov .ov-h.se .ov-knob');
await page.drag(scaleKnob!, [scaleKnob![0] + 30, scaleKnob![1] + 30]);
await sleep(300);
const t2 = (await layer("plant-procreate")).transform;
check("corner handle resizes", (t2.scale ?? 1) > (t1.scale ?? 1), { before: t1.scale, after: t2.scale });
const rotKnob = await center(page, '#stage .ov [data-h="rotate"] .ov-knob');
await page.drag(rotKnob!, [rotKnob![0] + 60, rotKnob![1] + 10]);
await sleep(300);
const t3 = (await layer("plant-procreate")).transform;
check("rotate handle rotates", Math.abs(t3.rotate || 0) > 5, { rotate: t3.rotate });

// undo and redo with the keyboard (focus on the canvas, not a text field)
await page.eval(`document.querySelector('#stage [data-layer="plant-procreate"]').focus()`);
await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
await sleep(300);
const tu = (await layer("plant-procreate")).transform;
check("Ctrl+Z undoes the rotation", (tu.rotate || 0) === (t2.rotate || 0), { rotate: tu.rotate });
await clickOn('[data-ui="redo"]');
const tr = (await layer("plant-procreate")).transform;
check("Redo restores it", tr.rotate === t3.rotate, { rotate: tr.rotate });

// keyboard nudges on the focused drawing
await clickOn('[data-layer-button="plant-procreate"]');
await page.eval(`document.querySelector('#stage [data-layer="plant-procreate"]').focus()`);
const before = (await layer("plant-procreate")).transform;
await page.key("ArrowRight", "ArrowRight");
await page.key("ArrowRight", "ArrowRight");
await sleep(200);
const after = (await layer("plant-procreate")).transform;
check("arrow keys nudge the focused drawing", Math.round((after.x - before.x) * 10) / 10 === 4, { before: before.x, after: after.x });

// hostile SVG, dropped onto the canvas with a real drag and drop: it lands where it was dropped
const dropAt = await page.eval<[number, number]>(`(() => { const r = document.querySelector("#stage .desk").getBoundingClientRect(); return [r.x + r.width * 0.3, r.y + r.height * 0.3]; })()`);
const dragData = { items: [], files: [fixture("malicious.svg")], dragOperationsMask: 1 };
for (const type of ["dragEnter", "dragOver", "drop"]) await page.send("Input.dispatchDragEvent", { type, x: dropAt[0], y: dropAt[1], data: dragData });
await sleep(1200);
const landed = await page.eval<[number, number] | null>(`(() => { const el = document.querySelector('#stage [data-layer="malicious"]'); if (!el) return null; const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
check("a file dropped on the canvas lands where it was dropped", !!landed && Math.hypot(landed[0] - dropAt[0], landed[1] - dropAt[1]) < 40, { dropAt, landed });
const evil = await page.eval<string>(`Object.values(sceneStudio.store.getSnapshot().scene.assets).filter((a) => a.id.startsWith("malicious")).map((a) => a.src).join(" ")`);
check("hostile SVG sanitised", evil.length > 0 && !/script|onclick|onload|evil\.example|javascript:|foreignObject|<image/i.test(evil), evil.slice(0, 80) + "…");

// the floating toolbar under the selection
await clickOn('[data-layer-button="plant-procreate"]');
const orderBefore = (await state()).layers.indexOf("plant-procreate:decor");
await clickOn('#stage .ov-tools [data-act="back"]');
const orderAfter = (await state()).layers.indexOf("plant-procreate:decor");
check("selection toolbar sends the drawing back", orderAfter === orderBefore - 1, { orderBefore, orderAfter });

// zoom: 100%, then Shift+1 back to fit
await clickOn('[data-ui="zoom-100"]');
const z100 = await page.eval<any>(`sceneStudio.store.getSnapshot().zoom`);
await page.eval(`document.querySelector('#stage [data-layer="plant-procreate"]').focus()`);
await keyWith("!", "Digit1", SHIFT, 49);
const zFit = await page.eval<any>(`sceneStudio.store.getSnapshot().zoom`);
check("100% and Shift+1 (fit) zoom the canvas", z100 === 1 && zFit === "fit", { z100, zFit });

// make the plant clickable and give it a link by typing
await clickOn('[data-layer-button="plant-procreate"]');
await clickOn("#clickable");
await clickOn('#inspector input[type="url"]');
await page.send("Input.insertText", { text: "http://shop.example.com/plants" });
await sleep(300);
s = await state();
const plantLink = Object.values(s.links).find((l: any) => l.url?.includes("shop.example.com")) as any;
check("link typed into the URL field", !!plantLink, plantLink);
const hint = await page.eval<string>(`[...document.querySelectorAll(".field-msg")].map((m) => m.textContent).join(" ")`);
check("http is shown as upgraded to https", hint.includes("Will open https://shop.example.com/plants"), hint);

// ---------------------------------------------------------------- frames (ADR 0002)
// three SVG frames through the real file input: the studio asks, and they become one drawing
await setFiles("#file", [1, 2, 3].map((k) => fixture(`steam-mug-${k}.svg`)));
await sleep(800);
check("several drawings at once ask: frames of one drawing, or separate", await page.eval<boolean>(`!!document.querySelector('dialog[open] [data-ui="choice-frames"]')`));
await clickOn('dialog[open] [data-ui="choice-frames"]');
await sleep(2000);
const FRAMES_STATE = `(() => { const s = sceneStudio.store.getSnapshot(); const l = s.scene.layers.find((x) => x.id === s.sel); const parts = (l.parts || []).filter((p) => p.frames);
  return { id: l.id, type: l.type, counts: parts.map((p) => p.frames.length), lines: (parts.find((p) => p.role === "lines") || parts[0] || {}).frames, fps: parts[0] && parts[0].fps, play: parts[0] && parts[0].play,
    oneBox: parts.every((p) => new Set(p.frames.map((id) => { const a = s.scene.assets[id]; return JSON.stringify([a.bbox, a.width, a.height, a.crop]); })).size === 1),
    meta: (document.querySelector(".insp-meta") || {}).textContent, errs: sceneStudio.validateScene(s.scene) }; })()`;
const mug = await page.eval<any>(FRAMES_STATE);
check("three SVG frames become one drawing whose frames share one box", mug.counts.length === 2 && mug.counts.every((n: number) => n === 3) && mug.oneBox && !mug.errs.length && /3 frames at 6 fps in one \d+×\d+ box/.test(mug.meta), mug);

// hold frame 2: the others show faintly behind it (onion skin)
await clickOn('[data-ui="frames"] [data-frame="1"]');
const onion = await page.eval<string[]>(`[...document.querySelectorAll('#stage [data-layer="${mug.id}"] .frs')].map((st) => [...st.children].map((f) => getComputedStyle(f).opacity).join(" "))`);
check("choosing a frame holds it on the canvas with an onion skin of the others", onion.length === 2 && onion.every((x) => x === "0.2 1 0.2"), onion);
// Alt+Left moves it to the front; the speed slider and the play mode by keyboard
await keyWith("ArrowLeft", "ArrowLeft", ALT, 37);
const moved = await page.eval<any>(FRAMES_STATE);
check("Alt+Left reorders frames", moved.lines[0] === mug.lines[1] && moved.lines[1] === mug.lines[0], { before: mug.lines, after: moved.lines });
await clickOn("#clickable");
await page.eval(`document.querySelector('[data-ui="frames"] input[type="range"]').focus()`);
await keyWith("ArrowLeft", "ArrowLeft", 0, 37);
await keyWith("ArrowLeft", "ArrowLeft", 0, 37);
await page.eval(`document.querySelector('[data-ui="frames"] select').focus()`);
for (let i = 0; i < 3; i++) await keyWith("ArrowDown", "ArrowDown", 0, 40);
await clickOn("#play-frames");
const timed = await page.eval<any>(FRAMES_STATE);
check("speed and play mode set from the Frames section", timed.fps === 4 && timed.play === "once-on-tap" && timed.type === "object" && /4 fps, on threes/.test(await page.eval<string>(`document.querySelector('[data-ui="frames"] output').textContent`)), { fps: timed.fps, play: timed.play, type: timed.type });

// PNG frames: one PNG, then a second frame from the same canvas through the Frames section's
// file input, then an animated PNG dropped on the section; all trimmed to one shared box
await setFiles("#file", [fixture("blink-1.png")]);
await sleep(1500);
await setFiles("#frame-file", [fixture("blink-2.png")]);
await sleep(1500);
const blink = await page.eval<any>(FRAMES_STATE);
check("a PNG frame added later registers with the first (same crop, same size)", blink.counts[0] === 2 && blink.oneBox && !blink.errs.length, blink);
const section = await center(page, '[data-ui="frames"] [data-ui="add-frames"]');
const dropData = { items: [], files: [fixture("blink-animated.png")], dragOperationsMask: 1 };
for (const type of ["dragEnter", "dragOver", "drop"]) await page.send("Input.dispatchDragEvent", { type, x: section![0], y: section![1], data: dropData });
await sleep(2000);
const apng = await page.eval<any>(FRAMES_STATE);
check("an animated PNG dropped on the Frames section is split and appended", apng.id === blink.id && apng.counts[0] === 4 && apng.oneBox, { counts: apng.counts, oneBox: apng.oneBox, layers: (await state()).layers.length });
await clickOn('[data-ui="frame-remove"]');
const removed = (await page.eval<any>(FRAMES_STATE)).counts[0];
await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: CTRL, windowsVirtualKeyCode: 90 });
await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: CTRL, windowsVirtualKeyCode: 90 });
await sleep(300);
check("removing a frame, and undo brings it back", removed === 3 && (await page.eval<any>(FRAMES_STATE)).counts[0] === 4, { removed });

// ---------------------------------------------------------------- backgrounds (ADR 0003)
const BOARD = `(() => { const s = sceneStudio.store.getSnapshot(); const proc = (l) => l.type === "background" && l.asset && s.scene.assets[l.asset] && s.scene.assets[l.asset].kind === "procedural";
  const bgs = s.scene.layers.filter((l) => l.type === "background" && !proc(l)); const a = s.scene.assets["paper-texture"];
  return { sel: s.sel, bgs: bgs.map((l) => ({ id: l.id, fit: l.fit, clip: l.clip, first: s.scene.layers[0].id === l.id })), surface: s.scene.layers.filter(proc).map((l) => l.id),
    paper: a && { w: a.width, h: a.height, type: a.url.slice(5, 15), bytes: a.bytes }, inspector: document.getElementById("inspector").getAttribute("aria-label"), errs: sceneStudio.validateScene(s.scene) }; })()`;
await setFiles("#background-file", [fixture("paper-texture.png")]);
await sleep(1500);
let board = await page.eval<any>(BOARD);
check("a paper texture added as the background replaces the mat: untrimmed, WebP, fitted and clipped", board.bgs[0]?.id === "paper-texture" && board.bgs[0].first && board.bgs[0].fit === "cover" && board.bgs[0].clip === true &&
  !board.surface.length && board.paper.type === "image/webp" && board.paper.w === 600 && board.paper.h === 660 && board.inspector === "Background settings" && !board.errs.length, board);
await clickOn('[aria-label="Placement"] input[value="over"] + span');
board = await page.eval<any>(BOARD);
check("Over the mat brings the cutting mat back under it, contained", board.surface.length === 2 && board.bgs[0].fit === "contain" && !board.bgs[0].first, board);
await clickOn('[data-layer-row="teapot-sentinel"] button[aria-haspopup="menu"]');
await clickOn('[data-ui="menu-use-background"]');
await sleep(400);
board = await page.eval<any>(BOARD);
const teapotBg = board.bgs.some((b: any) => b.id === "teapot-sentinel") && !(await state()).layers.includes("teapot-sentinel:decor");
await clickOn('[data-ui="use-drawing"]');
check("Use as background from a drawing's menu, and Use as drawing puts it back", teapotBg && (await state()).layers.includes("teapot-sentinel:decor"), board.bgs);
await clickOn('[data-ui="samples"]');
await clickOn('[data-sample-bg="desk-top"]');
board = await page.eval<any>(BOARD);
const boardHtml = await page.eval<string>(`document.querySelector("#stage .st-svg svg").innerHTML`);
check("the drawn desk top sample goes over the mat; both backgrounds draw clipped, without boil", board.bgs.map((b: any) => b.id).join() === "paper-texture,desk-top" &&
  (boardHtml.match(/<g class="bg" aria-hidden="true" clip-path=/g) || []).length === 2 && !/filter="url\(#ed-b-(paper-texture|desk-top)\)"/.test(boardHtml), board.bgs);

// nothing selected: a press on the empty workspace shows the page settings
const ws = await emptyWorkspace();
await page.click(ws[0], ws[1]);
await sleep(250);
const inspLabel = await page.eval<string>(`document.getElementById("inspector").getAttribute("aria-label")`);
check("pressing the empty workspace deselects", (await state()).sel === null && inspLabel === "Page settings", inspLabel);

// palette and dark mode by clicking
await clickOn('input[name="palette"][value="violet-lime"] + .pal-chip');
await clickOn('input[name][value="dark"] + span');
s = await state();
const stageTheme = await page.eval<string>(`document.getElementById("stage").getAttribute("data-theme")`);
check("palette and dark mode applied to the canvas", s.palette === "violet-lime" && s.mode === "dark" && stageTheme === "dark", { palette: s.palette, mode: s.mode, stageTheme });
await clickOn('[aria-label="Motion"] input[value="off"] + span');
const motion = await page.eval<any>(`({ doc: sceneStudio.store.getSnapshot().page.motion, stage: document.getElementById("stage").getAttribute("data-motion") })`);
check("motion set to Off from the page settings", motion.doc === "off" && motion.stage === "off", motion);
await clickOn('[aria-label="Motion"] input[value="auto"] + span');

// typeface and lettering (ADR 0003)
await clickOn('input[name="typeface"][value="Patrick Hand"] + .face-card');
const face = await page.eval<any>(`({ font: sceneStudio.store.getSnapshot().scene.theme.font, css: getComputedStyle(document.querySelector("#stage .bio")).fontFamily })`);
check("a curated typeface from the page settings reaches the canvas", face.font.family === "Patrick Hand" && face.font.weights.join() === "400" && face.css.startsWith('"Patrick Hand"'), face);
const LETTERING = `(() => { const s = sceneStudio.store.getSnapshot(); const lt = s.scene.header && s.scene.header.lettering; const a = lt && s.scene.assets[lt.asset];
  return { kind: a && a.kind, svgs: document.querySelectorAll("#stage .name.lettered .lt").length, shadow: !!document.querySelector("#stage .lt-sh"), sticker: !!document.querySelector("#stage .lettering .sticker"),
    typed: (document.querySelector("#stage .name .vh") || {}).textContent, layers: s.scene.layers.length, errs: sceneStudio.validateScene(s.scene) }; })()`;
await setFiles("#lettering-file", [fixture("pia-lettering.svg")]);
await sleep(1200);
let lt = await page.eval<any>(LETTERING);
check("vector lettering replaces the visible name, with its riso shadow; the typed name stays for screen readers", lt.kind === "svg-inline" && lt.svgs === 2 && lt.shadow && lt.typed === "Your Name" && !lt.errs.length, lt);
await clickOn('[data-ui="remove-lettering"]');
await setFiles("#lettering-file", [fixture("pia-lettering.png")]);
await sleep(1200);
lt = await page.eval<any>(LETTERING);
check("raster lettering: one copy, on a paper sticker in dark mode, no shadow", lt.kind === "raster" && lt.svgs === 1 && !lt.shadow && lt.sticker, lt);
await setFiles("#file", [fixture("pia-lettering.svg")]);
await sleep(1200);
const layersBefore = (await page.eval<any>(LETTERING)).layers;
await clickOn('[data-ui="use-lettering"]');
await sleep(800);
lt = await page.eval<any>(LETTERING);
check("Use as name lettering moves a drawing into the header", lt.kind === "svg-inline" && lt.svgs === 2 && lt.layers === layersBefore - 1, { ...lt, layersBefore });
writeFileSync(join(out, "studio-edit.png"), await page.screenshot());

// preview, and a real tap inside the sandboxed frame
await clickOn('[data-ui="view-preview"]');
await sleep(1500);
const objRect = await page.frameEval<[number, number] | null>(`(() => { const o = document.querySelector('.obj[data-k="link"] .lift image'); if (!o) return null; const r = o.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height * 0.8]; })()`);
const frameRect = await page.eval<[number, number]>(`(() => { const r = document.getElementById("preview").getBoundingClientRect(); return [r.x, r.y]; })()`);
if (objRect) await page.click(frameRect[0] + objRect[0], frameRect[1] + objRect[1]);
await sleep(600);
const tapped = await page.frameEval<any>(`({ title: document.getElementById("tt").textContent, pressed: document.querySelector('.obj[data-k="link"]').getAttribute("aria-pressed"), boil: document.documentElement.dataset.boil, csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') })`);
check("tapping a drawing in the preview opens its panel", tapped.pressed === "true" && tapped.title.length > 0, tapped);

// the mug plays its frames once per tap in the preview, holds the last, and replays on the next tap.
// Media emulation does not reach the out-of-process preview frame, so it follows this machine's
// own setting first: with reduced motion, frame 1 holds.
const mugAt = await page.frameEval<[number, number]>(`(() => { const r = document.querySelector(".fro").closest(".obj").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height * 0.75]; })()`);
const shown = `[...document.querySelector(".fro").children].map((f) => getComputedStyle(f).opacity).join(" ")`;
const tapMug = async () => { await page.click(frameRect[0] + mugAt[0], frameRect[1] + mugAt[1]); return page.frameEval<string>(shown); };
for (const reduce of [true, false]) {
  await page.frameSend("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }] });
  await sleep(200);
  const first = await tapMug();
  await sleep(1100);
  const held = await page.frameEval<string>(shown);
  const again = await tapMug();
  const fr = await page.frameEval<string>(`document.documentElement.dataset.fr`);
  if (reduce) check("with reduced motion the preview holds frame 1", first === "1 0 0" && held === "1 0 0" && again === "1 0 0", { first, held, again });
  else check("once-on-tap plays from frame 1, holds the last frame, and replays on the next tap", first === "1 0 0" && held === "0 0 1" && again === "1 0 0" && fr === "on", { first, held, again, fr });
}
writeFileSync(join(out, "studio-preview.png"), await page.screenshot());

// export, then import into a fresh canvas
await hookDownloads();
await clickOn('[data-ui="export"]');
await sleep(400);
const exportText = await page.eval<string>(`document.querySelector("dialog[open]")?.textContent || ""`);
for (const b of ["dl-page", "dl-scene", "dl-data"]) await clickOn(`dialog[open] [data-ui="${b}"]`);
await sleep(300);
const files = await downloads();
const names = Object.keys(files);
const html = files[names.find((n) => n.endsWith(".html"))!] || "";
check("export dialog offers the three files", names.length === 3 && /no external scripts/i.test(exportText), names);
check("exported page has no external script and a CSP", !/<script[^>]+src=/i.test(html) && html.includes("Content-Security-Policy") && html.includes("data:image/png;base64"), `${html.length} B`);
for (const n of names) writeFileSync(join(out, n), files[n]!);
const beforeImport = await page.eval<string>(`JSON.stringify({ s: sceneStudio.store.getSnapshot().scene, p: sceneStudio.store.getSnapshot().page })`);
await page.eval(`document.querySelector("dialog[open]")?.close()`);
await clickOn('[data-ui="more"]');
await clickOn('[data-ui="menu-reset"]');
await clickOn('dialog[open] [data-ui="reset-blank"]');
await sleep(300);
check("start over empties the canvas", (await state()).layers.length === 2);
await setFiles("#import-file", names.filter((n) => n.endsWith(".json")).map((n) => join(out, n)));
await sleep(1200);
const afterImport = await page.eval<string>(`JSON.stringify({ s: sceneStudio.store.getSnapshot().scene, p: sceneStudio.store.getSnapshot().page })`);
check("re-import restores scene and page exactly", afterImport === beforeImport, `${afterImport.length} B`);
check("the round trip carries backgrounds, lettering and the typeface", /"type":"background","name":"Paper texture"/.test(afterImport) && /"lettering":\{"asset"/.test(afterImport) && /"family":"Patrick Hand"/.test(afterImport));

// a realistic export: Pia's desk with the paper texture under it and her lettered name, against the plan's budget
await clickOn('[data-ui="view-edit"]');
await clickOn('[data-ui="more"]');
await clickOn('[data-ui="menu-desk"]');
await sleep(300);
await setFiles("#background-file", [fixture("paper-texture.png")]);
await sleep(1500);
const wsAt = await emptyWorkspace();
await page.click(wsAt[0], wsAt[1]);
await sleep(300);
await setFiles("#lettering-file", [fixture("pia-lettering.svg")]);
await sleep(1200);
await hookDownloads();
await clickOn('[data-ui="export"]');
await sleep(400);
await clickOn('dialog[open] [data-ui="dl-page"]');
await sleep(300);
const piaHtml = Object.values(await downloads())[0] || "";
await page.eval(`document.querySelector("dialog[open]")?.close()`);
writeFileSync(join(out, "pia-board-lettering.html"), piaHtml);
const piaGz = gzipSync(Buffer.from(piaHtml), { level: 9 }).length;
check("Pia's desk with a paper background and lettering exports within the 60 KB compressed budget", piaGz <= 60 * 1024 && piaHtml.includes("data:image/webp") && piaHtml.includes('class="name lettered"'),
  { raw: `${(piaHtml.length / 1024).toFixed(1)} KB`, gzip: `${(piaGz / 1024).toFixed(1)} KB` });

// keyboard: Tab reaches the skip link first, and focus is drawn
await clickOn('[data-ui="view-edit"]');
const savedLayers = (await state()).layers.join(",");
await page.goto(target, 1200); // work is autosaved; a fresh load puts the focus start at the top
check("autosave brings the work back after a reload", (await state()).layers.join(",") === savedLayers, savedLayers);
await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
await sleep(200);
const focusRing = await page.eval<any>(`(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { el: a.className, text: a.textContent, outline: cs.outlineStyle, top: a.getBoundingClientRect().top }; })()`);
check("Tab lands on a visible skip link with a focus ring", focusRing.el === "skip" && focusRing.outline !== "none" && focusRing.top >= 0, focusRing);

// the chrome follows the OS; the page keeps its own appearance
const pageTheme = await page.eval<string | null>(`document.getElementById("stage").getAttribute("data-theme")`);
await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: "dark" }] });
await sleep(300);
const dark = await page.eval<any>(`({ chrome: getComputedStyle(document.querySelector(".panel")).backgroundColor, page: document.getElementById("stage").getAttribute("data-theme") })`);
check("dark chrome, page appearance unchanged", dark.chrome === "rgb(24, 24, 27)" && dark.page === pageTheme, { ...dark, before: pageTheme });
writeFileSync(join(out, "studio-dark.png"), await page.screenshot());
await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: "light" }] });

// phone width: canvas on top, Layers and the inspector as tabs
await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await sleep(500);
const sw = await page.eval<number>(`document.documentElement.scrollWidth`);
check("no horizontal scrolling at 375 px", sw <= 375, { scrollWidth: sw });
await clickOn("#tab-inspect");
const tabbed = await page.eval<any>(`({ layers: document.getElementById("panel-layers").hidden, inspector: document.getElementById("inspector").hidden, selected: document.getElementById("tab-inspect").getAttribute("aria-selected") })`);
check("phone tabs switch between Layers and the inspector", tabbed.layers === true && tabbed.inspector === false && tabbed.selected === "true", tabbed);
await clickOn("#tab-layers");
writeFileSync(join(out, "studio-375.png"), await page.screenshot());

const errors = page.logs.filter((l) => /^(error|exception|console\.error)/i.test(l) && !/fonts\.g/.test(l));
check("console is clean", errors.length === 0, errors.join(" | "));

await chrome.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
