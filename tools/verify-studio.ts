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
import { BUILT_IN_SCENES } from "@scena/scenes";
import { smallDesk } from "@scena/scenes/testing";
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
/** Opening another scene asks first when there is work on the canvas: agree. */
async function confirmReplace() {
  if (await page.eval<boolean>(`!!document.querySelector('dialog[open] [data-ui="replace-ok"]')`)) await clickOn('dialog[open] [data-ui="replace-ok"]');
}
const state = () => page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); return { layers: s.scene.layers.map((l) => l.id + ":" + l.type), sel: s.sel, links: s.page.links, palette: s.page.theme.palette, mode: s.page.theme.mode, view: s.view }; })()`);
const layer = (id: string) => page.eval<any>(`sceneStudio.store.getSnapshot().scene.layers.find((l) => l.id === ${JSON.stringify(id)})`);
async function keyWith(key: string, code: string, modifiers: number, vk = 0) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: vk });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: vk });
  await sleep(250);
}
const ALT = 1, CTRL = 2, SHIFT = 8;
/** Enter as a keyboard sends it: with its character, which is what presses a focused button. */
async function pressEnter() {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(250);
}
const pressTab = (modifiers = 0) => keyWith("Tab", "Tab", modifiers, 9);
const setFiles = (selector: string, files: string[]) => page.setFiles(selector, files);

// The scene picker (issue 12). The build offers the scenes that ship. To show that the picker
// depends on none of them, it is also given a second scene that is only a test fixture.
const shipped = BUILT_IN_SCENES.map((e) => e.scene);
const second = smallDesk();
// The page is handed this list as a value (page.call): data from here is never written into code that runs there.
const twoScenes = [...BUILT_IN_SCENES, second];
/** The open picker: where the focus is, and what each card says. null when it is closed. */
const PICKER = `(() => { const d = document.querySelector("dialog.picker[open]"); if (!d) return null; const a = document.activeElement;
  const named = (el) => (el.getAttribute("aria-labelledby") || "").split(" ").map((id) => (document.getElementById(id) || {}).textContent).join(" ");
  return { focus: (a.dataset && a.dataset.ui) || a.id || a.tagName, focusScene: ((a.closest && a.closest("[data-scene]")) || { dataset: {} }).dataset.scene || "",
    cards: [...d.querySelectorAll("[data-scene]")].map((c) => { const f = c.querySelector("iframe"); return { id: c.dataset.scene, name: c.querySelector("h3").textContent,
      audience: (c.querySelector('[data-ui="scene-audience"]') || {}).textContent || "", slots: c.querySelector('[data-ui="scene-slots"]').textContent,
      count: (c.querySelector('[data-ui="scene-count"]') || {}).textContent || "",
      use: named(c.querySelector('[data-ui="scene-use"]')), sandbox: f.getAttribute("sandbox"), current: !!c.querySelector('[data-ui="scene-current"]') }; }) }; })()`;
interface PickerState { focus: string; focusScene: string; cards: { id: string; name: string; audience: string; slots: string; count: string; use: string; sandbox: string | null; current: boolean }[] }
const picker = () => page.eval<PickerState | null>(PICKER);
/** What is open in the studio now, as the links-only mode shows it. */
const OPENED = `(() => { const s = sceneStudio.store.getSnapshot(); return { picker: !!document.querySelector("dialog.picker[open]"), asked: (document.querySelector("dialog[open] #replace-h") || {}).textContent || "",
  id: s.scene.id, license: s.scene.license, view: s.view, panel: document.getElementById("panel-layers").getAttribute("aria-label"), name: (document.querySelector('[data-ui="scene-name"]') || {}).textContent,
  rows: [...document.querySelectorAll("[data-link-row]")].map((r) => r.getAttribute("data-link-row")).join(","), titles: Object.values(s.page.links).map((l) => l.title).join("|"),
  urls: Object.values(s.page.links).map((l) => l.url).join(""), palette: s.page.theme.palette, heading: s.page.fallbackList.heading, palettes: document.querySelectorAll('#inspector input[name="palette"]').length,
  toast: (document.getElementById("toast") || {}).textContent || "", errs: [...sceneStudio.validateScene(s.scene), ...sceneStudio.validatePage(s.page, s.scene)] }; })()`;
const defaultTitles = (scene: (typeof shipped)[number]) => scene.slots.map((s) => s.defaults.title || s.label).join("|");
/**
 * Intercepts download links so their files can be read back with `downloads()`. It keeps the Blob
 * behind each blob: URL and reads that, because the build's Content Security Policy does not let
 * the page fetch a blob: URL (the studio never does).
 */
const hookDownloads = () => page.eval(`(() => {
  window.__dl = {};
  const blobs = new Map(), make = URL.createObjectURL;
  URL.createObjectURL = function (b) { const u = make.call(URL, b); if (b instanceof Blob) blobs.set(u, b); return u; };
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.download) return orig.call(this);
    const blob = blobs.get(this.href);
    window.__dl[this.download] = blob ? blob.text() : Promise.reject(new Error("the download is not a Blob the page made: " + this.href.slice(0, 40)));
  };
})()`);
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

// the other way to a page: the empty state opens the scene picker, and with nothing on the
// canvas the chosen scene opens at once, as a new page with the scene's own wording
await clickOn('[data-ui="empty-scenes"]');
await sleep(400);
const fromEmpty = await picker();
await clickOn(`dialog.picker [data-scene="${shipped[0]!.id}"] [data-ui="scene-use"]`);
await sleep(400);
const atOnce = await page.eval<any>(OPENED);
check("the empty state opens the scene picker, and on an untouched canvas the chosen scene opens at once with its defaults",
  fromEmpty?.cards.map((c) => c.id).join() === shipped.map((sc) => sc.id).join() && atOnce.asked === "" && atOnce.picker === false && atOnce.id === shipped[0]!.id && atOnce.license === "builtin"
  && atOnce.view === "edit" && atOnce.panel === "Links" && atOnce.titles === defaultTitles(shipped[0]!) && atOnce.urls === "" && atOnce.errs.length === 0,
  { listed: fromEmpty?.cards.map((c) => c.id), opened: atOnce.id, titles: atOnce.titles });
await clickOn('[data-ui="more"]');
await clickOn('[data-ui="menu-reset"]');
await clickOn('dialog[open] [data-ui="reset-blank"]');
await sleep(300);
const afterMenuDialog = await page.eval<string>(`document.activeElement.getAttribute("data-ui") || document.activeElement.tagName`);
check("a dialog opened from a menu returns the focus to the menu's button when it closes", afterMenuDialog === "more", afterMenuDialog);
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
// The file is parsed into an inert document before the sanitiser reads it. Its inline handlers
// can never run there, but the build's Content Security Policy refuses them as they are parsed
// and logs each refusal: expected in this step, and only in this step.
const hostileFrom = page.logs.length;
for (const type of ["dragEnter", "dragOver", "drop"]) await page.send("Input.dispatchDragEvent", { type, x: dropAt[0], y: dropAt[1], data: dragData });
await sleep(1200);
const hostileTo = page.logs.length;
const HANDLER_REFUSED = /inline event handler.*Content Security Policy/i;
const hostileRefusals = page.logs.slice(hostileFrom, hostileTo).filter((l) => HANDLER_REFUSED.test(l)).length;
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
await confirmReplace();
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

const errors = page.logs.filter((l, i) => /^(error|exception|console\.error)/i.test(l) && !/fonts\.g/.test(l)
  && !(i >= hostileFrom && i < hostileTo && HANDLER_REFUSED.test(l)));
check("console is clean", errors.length === 0, errors.join(" | ").slice(0, 600));

// The build's Content Security Policy (apps/studio/vite.config.ts) is the layer behind the
// sanitisers: markup that reaches the studio's DOM must not be able to run script. A refusal
// during the run above would have shown in the console check; this injects a handler on
// purpose. The dev server has no policy, so there is nothing to check against it.
const policy = await page.eval<string>(`(document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || ""`);
if (process.argv[2] && !policy) console.log("SKIP  Content Security Policy checks: this target has no policy (the dev server)");
else {
  check("the build names its scripts by hash in a Content Security Policy",
    /default-src 'none'/.test(policy) && /script-src 'sha256-[^;]+/.test(policy) && !/script-src[^;]*'unsafe-(inline|eval)'/.test(policy), policy.slice(0, 90));
  check("the policy refused the hostile drawing's handlers as the file was parsed", hostileRefusals > 0, { refusals: hostileRefusals });
  const probe = await page.eval<{ ran: boolean; blocked: string }>(`new Promise((done) => {
    let blocked = "";
    document.addEventListener("securitypolicyviolation", (e) => { blocked = e.violatedDirective; }, { once: true });
    const d = document.createElement("div");
    d.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" onload="window.__cspProbe=1" onerror="window.__cspProbe=1">';
    document.body.append(d);
    setTimeout(() => { d.remove(); done({ ran: !!window.__cspProbe, blocked }); }, 500);
  })`);
  check("markup injected into the studio cannot run script", probe.ran === false && probe.blocked.startsWith("script-src"), probe);
}

// The scene picker (issue 12), with work on the canvas: Pia's desk with a background and lettering.
await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(300);
const sceneJson = () => page.eval<string>(`JSON.stringify(sceneStudio.store.getSnapshot().scene)`);
const mine = await sceneJson();
const pickerFrom = page.logs.length;

// by keyboard: the More menu, down to the picker's entry, Enter
await page.eval(`document.querySelector('[data-ui="more"]').focus()`);
await pressEnter();
for (let i = 0; i < 6 && (await page.eval<string>(`document.activeElement.getAttribute("data-ui") || ""`)) !== "menu-scenes"; i++) await keyWith("ArrowDown", "ArrowDown", 0, 40);
await pressEnter();
await sleep(500);
const byKeyboard = await picker();
check("the keyboard opens the scene picker from the More menu, with the focus on its heading; it lists the scenes that ship",
  byKeyboard?.focus === "picker-h" && byKeyboard.cards.map((c) => c.id).join() === shipped.map((sc) => sc.id).join() && byKeyboard.cards.every((c, i) => c.name === shipped[i]!.name && c.sandbox === "allow-scripts"),
  { focus: byKeyboard?.focus, listed: byKeyboard?.cards.map((c) => c.name) });
if (!process.argv[2]) {
  const built = readFileSync(join(root, "apps/studio/dist/index.html"), "utf8");
  check("the second scene is a test fixture: the build does not contain it", !built.includes(`"${second.scene.id}"`) && !built.includes(second.scene.name) && !built.includes(second.sample.profile.displayName), second.scene.name);
}
await pressTab();
const onClose = (await picker())?.focus;
await pressTab();
const onUse = await picker();
await pressTab();
await pressTab();
// whichever scenes ship: the studio's focus is on the first card's frame, and in exactly one frame it is on a drawing
const inCard = await picker();
const focusedIn = await Promise.all(Array.from({ length: page.frameCount() }, (_, i) => page.frameEval<string>(`document.activeElement.getAttribute("role") || document.activeElement.tagName`, i)));
const inFrame = { studio: inCard?.focus, card: inCard?.focusScene, frame: focusedIn.filter((role) => role === "button").join() };
check("Tab goes to Close, to the first card's button, named for its scene, and on into the card's live page",
  onClose === "picker-close" && onUse?.focus === "scene-use" && onUse.focusScene === shipped[0]!.id && onUse.cards[0]!.use === `Use this scene ${shipped[0]!.name}`
  && inFrame.studio === "scene-frame" && inFrame.card === shipped[0]!.id && inFrame.frame === "button",
  { onClose, onUse: onUse?.focus, named: onUse?.cards[0]!.use, inFrame });
for (let i = 0; i < 4 && (await picker())?.focus !== "scene-use"; i++) await pressTab(SHIFT);
await keyWith("Escape", "Escape", 0, 27);
const escaped = await page.eval<any>(`({ open: !!document.querySelector("dialog.picker[open]"), focus: document.activeElement.getAttribute("data-ui") })`);
check("Escape closes the picker, its frames go with it, and the focus returns to the More button", escaped.open === false && escaped.focus === "more" && page.frameCount() === 0 && (await sceneJson()) === mine, { ...escaped, frames: page.frameCount() });

// the question before work is replaced: No keeps the work, and the picker stays to choose again
await clickOn('[data-ui="more"]');
await clickOn('[data-ui="menu-scenes"]');
await clickOn(`dialog.picker [data-scene="${shipped[0]!.id}"] [data-ui="scene-use"]`);
const asked = await page.eval<string>(`(document.querySelector("dialog[open] #replace-h") || {}).textContent || ""`);
await clickOn('dialog[open] [data-ui="replace-cancel"]');
const afterNo = await picker();
check("choosing a scene over work asks first, and Cancel leaves the work alone and the picker open", asked === `Open ${shipped[0]!.name}?` && (await sceneJson()) === mine && !!afterNo, { asked, picker: !!afterNo });
await clickOn('[data-ui="picker-close"]');
await sleep(300);
const closedByMouse = await page.eval<any>(`({ focus: document.activeElement.getAttribute("data-ui"), tooltips: document.querySelectorAll(".tooltip").length })`);
check("closed with the mouse, the picker returns the focus to the More button, and no tooltip opens for it", closedByMouse.focus === "more" && closedByMouse.tooltips === 0, closedByMouse);

// two scenes: the ones that ship and the fixture. Motion is forced, so the frames boil whatever this machine's setting.
await page.call(`(scenes) => { sceneStudio.store.set({ forceMotion: true }); sceneStudio.openPicker(scenes); }`, twoScenes);
await sleep(1500);
const two = await picker();
const card = (id: string) => two?.cards.find((c) => c.id === id);
check("given a second scene, the picker shows a card for each: its name, who it was drawn for and its links in plain words",
  two?.cards.map((c) => c.id).join() === [...shipped.map((sc) => sc.id), second.scene.id].join() && two.cards.every((c) => c.sandbox === "allow-scripts")
  && card("desk")?.name === "Illustrator's desk" && card("desk")?.audience === "Drawn for illustrators" && card("desk")?.slots === "Portfolio, Shop, Commissions, Social, Newsletter"
  && card("small-desk")?.name === "Small desk" && card("small-desk")?.audience === "Drawn for writers and poets" && card("small-desk")?.slots === "Newsletter, Notebook, Commissions"
  && card("small-desk")?.use === "Use this scene Small desk"
  && twoScenes.every((e) => card(e.scene.id)?.count === `${e.scene.slots.length} ${e.scene.slots.length === 1 ? "link" : "links"}`), // the links a page on it gets
  two?.cards.map((c) => `${c.name} · ${c.audience} · ${c.count}: ${c.slots}`));

// Each card's frame is the published page, running: its script ran under the studio's policy, and
// its lines boil. The page times its own boil and holds still on a machine too slow for it
// (tools/verify-runtime.ts checks that rule); a frame that did so is running all the same.
const LIVE = `new Promise((done) => { const t = document.querySelector("filter.boil feTurbulence"), seen = new Set(); const iv = setInterval(() => seen.add(t && t.getAttribute("seed")), 40);
  setTimeout(() => { clearInterval(iv); const fcp = performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint");
    done({ name: (document.querySelector(".name") || {}).textContent || "", boil: document.documentElement.dataset.boil, ms: Number(document.documentElement.dataset.boilMs) || 0, seeds: seen.size, objects: document.querySelectorAll(".obj").length, width: innerWidth,
      policy: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'), painted: fcp ? Math.round(fcp.startTime) : -1 }); }, 900); })`;
interface Live { name: string; boil?: string; ms: number; seeds: number; objects: number; width: number; policy: boolean; painted: number }
/** Which frame is which scene's card, by scene id: a frame is known by the name on its sample page. */
const frameOf: Record<string, number> = {};
let live: Live[] = [];
const boils = (f: Live) => f.boil === "on" && f.seeds > 1, tooSlow = (f: Live) => f.boil === "static" && f.ms > 40 && f.seeds === 1;
for (let attempt = 0; attempt < 4; attempt++) { // the frames attach a moment after the cards appear; the boil measures itself before it settles, and may try twice
  live = await Promise.all(Array.from({ length: page.frameCount() }, (_, i) => page.frameEval<Live>(LIVE, i)));
  if (live.length === twoScenes.length && live.every((f) => boils(f) || tooSlow(f))) break;
  await sleep(1200);
}
for (const e of twoScenes) frameOf[e.scene.id] = live.findIndex((f) => f.name.includes(e.sample.profile.displayName));
check(`each card is the published page in a sandboxed frame, running under the studio's policy: ${live.every(boils) ? "the lines boil" : "its boil timed itself, and holds still on this machine"}`,
  live.length === twoScenes.length && twoScenes.every((e) => live[frameOf[e.scene.id]!]?.objects === e.scene.slots.length) // a drawing for every link of the sample
  && live.every((f) => (boils(f) || tooSlow(f)) && f.policy && f.painted >= 0 && f.width === 375), live);
console.log(`NOTE  the cards painted ${live.map((f) => `${f.painted} ms`).join(" and ")} after their frames were made, on this machine. The plan's target is under a second on a mid-range phone, which this does not measure.`);

// a real tap on a drawing in the second card opens its panel, there and only there
const tapInCard = async (sceneId: string, slot: string) => {
  const frame = await page.call<[number, number, number]>(`(id) => { const f = [...document.querySelectorAll("[data-scene]")].find((c) => c.dataset.scene === id).querySelector("iframe"); f.scrollIntoView({ block: "center" }); const r = f.getBoundingClientRect(); return [r.x, r.y, r.width / f.offsetWidth]; }`, sceneId);
  const at = await page.frameCall<[number, number]>(frameOf[sceneId], `(k) => { scrollTo(0, 0); const r = [...document.querySelectorAll(".obj")].find((o) => o.getAttribute("data-k") === k).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }`, slot);
  await page.click(frame[0] + at[0] * frame[2], frame[1] + at[1] * frame[2]);
  await sleep(600);
};
const PANEL = `({ pressed: [...document.querySelectorAll('.obj[aria-pressed="true"]')].map((o) => o.getAttribute("data-k")).join(), title: document.getElementById("tt").textContent })`;
await tapInCard(second.scene.id, "newsletter");
const panels = await Promise.all(twoScenes.map((e) => page.frameEval<any>(PANEL, frameOf[e.scene.id])));
const tappedCard = { tapped: panels[panels.length - 1], others: panels.slice(0, -1).map((p) => p.pressed).join("") }; // the fixture's card is the last
check("a tap on a drawing in a card opens its panel, in that card alone", tappedCard.tapped.pressed === "newsletter" && tappedCard.tapped.title === second.sample.links.newsletter!.title && tappedCard.others === "", tappedCard);
writeFileSync(join(out, "studio-picker.png"), await page.screenshot());
await page.eval(`sceneStudio.store.set({ forceMotion: false })`);
await sleep(300);

// by keyboard to the second card, through the first card's page, and Enter; then the question, answered by keyboard
await page.eval(`document.getElementById("picker-h").focus()`);
let tabs = 0;
for (; tabs < 60; tabs++) {
  await pressTab();
  const at = await picker();
  if (at?.focus === "scene-use" && at.focusScene === second.scene.id) break;
}
await pressEnter();
const askedSecond = await page.eval<any>(`({ title: (document.querySelector("dialog[open] #replace-h") || {}).textContent || "", focus: document.activeElement.getAttribute("data-ui") })`);
for (let i = 0; i < 3 && (await page.eval<string>(`document.activeElement.getAttribute("data-ui") || ""`)) !== "replace-ok"; i++) await pressTab();
await pressEnter();
await sleep(400);
const chosen = await page.eval<any>(OPENED);
check("chosen with the keyboard, the second scene opens in the links-only mode with its own defaults",
  tabs < 60 && askedSecond.title === `Open ${second.scene.name}?` && chosen.picker === false && chosen.id === second.scene.id && chosen.license === "builtin" && chosen.view === "edit"
  && chosen.panel === "Links" && chosen.name === second.scene.name && chosen.rows === second.scene.fallback.order.join() && chosen.titles === defaultTitles(second.scene) && chosen.urls === ""
  && chosen.palette === second.scene.theme.defaultPalette && chosen.palettes === 2 && chosen.heading === second.scene.fallback.heading && chosen.errs.length === 0
  && chosen.toast.startsWith(`Opened ${second.scene.name}.`),
  { tabs: tabs + 1, asked: askedSecond.title, id: chosen.id, rows: chosen.rows, titles: chosen.titles, palette: chosen.palette, palettes: chosen.palettes, errs: chosen.errs });
check("undo brings back the work the scene replaced", await page.call<boolean>(`(before) => { sceneStudio.store.undo(); const was = JSON.stringify(sceneStudio.store.getSnapshot().scene) === before; sceneStudio.store.redo(); return was; }`, mine)
  && (await page.eval<string>(`sceneStudio.store.getSnapshot().scene.id`)) === second.scene.id);

// nothing typed on a ready-made scene's page: going to another scene asks nothing
await clickOn('[data-ui="more"]');
await clickOn('[data-ui="menu-scenes"]');
await clickOn('dialog.picker [data-scene="desk"] [data-ui="scene-use"]');
await sleep(400);
const switched = await page.eval<any>(OPENED);
check("from a ready-made scene with nothing typed, another opens without a question", switched.asked === "" && switched.picker === false && switched.id === "desk", { asked: switched.asked, id: switched.id });
const pickerErrors = page.logs.slice(pickerFrom).filter((l) => /^(error|exception|console\.error)/i.test(l) && !/fonts\.g/.test(l));
check("the console stayed clean through the picker: no script of a card was refused", pickerErrors.length === 0, pickerErrors.join(" | ").slice(0, 600));

// Links-only mode (issue 13): a built-in scene is filled in, not designed. The canvas only
// selects; the drawings cannot be changed by mouse, keyboard, a dropped file or code; and
// what is typed in a link's form reaches the page.
const builtIn0 = await sceneJson();
const mode = await page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); return {
  license: s.scene.license, panel: document.getElementById("panel-layers").getAttribute("aria-label"),
  rows: [...document.querySelectorAll("[data-link-row]")].map((r) => r.getAttribute("data-link-row")).join(","),
  upload: !!document.querySelector('[data-ui="upload"], [data-ui="drop"], #file'), nameField: !!document.querySelector(".name-input"),
  editorMarkup: document.querySelectorAll("#stage [data-layer]").length, objects: document.querySelectorAll("#stage g[data-k]").length,
  urls: Object.values(s.page.links).map((l) => l.url).join(""), errs: [...sceneStudio.validateScene(s.scene), ...sceneStudio.validatePage(s.page, s.scene)],
}; })()`);
check("a ready-made scene opens in the links-only mode, with a new page to fill in",
  mode.license === "builtin" && mode.panel === "Links" && mode.rows === "portfolio,shop,commissions,social,newsletter" && !mode.upload && !mode.nameField
  && mode.editorMarkup === 0 && mode.objects === 5 && mode.urls === "" && mode.errs.length === 0, mode);

const catAt = await center(page, '#stage g[data-k="newsletter"]');
await page.drag(catAt!, [catAt![0] + 70, catAt![1] - 50]);
await sleep(300);
const dragged = await page.eval<any>(`({ sel: sceneStudio.store.getSnapshot().sel, handles: document.querySelectorAll("#stage .ov *, #stage .ov-tools").length })`);
check("a drag on the canvas moves nothing and picks nothing", (await sceneJson()) === builtIn0 && dragged.sel === null && dragged.handles === 0, dragged);
await page.click(catAt![0], catAt![1]);
await sleep(300);
const pressed = await page.eval<any>(`({ sel: sceneStudio.store.getSnapshot().sel, inspector: document.getElementById("inspector").getAttribute("aria-label"),
  title: (document.querySelector('[data-ui="slot-title"]') || {}).textContent, handles: document.querySelectorAll("#stage .ov *, #stage .ov-tools").length })`);
check("a click on a drawing selects it, with its link's form and no handles", (await sceneJson()) === builtIn0 && pressed.sel === "cat" && pressed.inspector === "Link settings" && pressed.title === "Cat" && pressed.handles === 0, pressed);

await page.eval(`document.querySelector('#stage g[data-k="newsletter"]').focus()`);
for (const [key, code] of [["ArrowRight", "ArrowRight"], ["]", "BracketRight"], ["+", "Equal"], ["Delete", "Delete"], ["PageUp", "PageUp"]]) await page.key(key!, code!);
await sleep(200);
check("the keys that move, turn, resize, delete and reorder do nothing", (await sceneJson()) === builtIn0, { layers: (await state()).layers.length });

const toastFrom = await page.eval<string>(`(document.getElementById("toast") || {}).textContent || ""`);
const lockedDrop = { items: [], files: [fixture("plant-procreate.png")], dragOperationsMask: 1 };
for (const type of ["dragEnter", "dragOver", "drop"]) await page.send("Input.dispatchDragEvent", { type, x: dropAt[0], y: dropAt[1], data: lockedDrop });
await sleep(600);
const refusal = await page.eval<any>(`({ toast: (document.getElementById("toast") || {}).textContent || "", veil: document.querySelector(".app").classList.contains("dropping") })`);
check("a dropped file is refused, with the reason", (await sceneJson()) === builtIn0 && refusal.toast !== toastFrom && /ready-made scene/.test(refusal.toast) && refusal.veil === false, refusal);

const forced = await page.eval<any>(`(() => {
  const ok = sceneStudio.store.change((s) => { s.scene.layers.pop(); s.scene.name = "Mine"; s.page.profile.displayName = "Changed with it"; });
  const s = sceneStudio.store.getSnapshot();
  return { ok, name: s.page.profile.displayName };
})()`);
check("a change to the scene made in code is undone as a whole", forced.ok === false && forced.name !== "Changed with it" && (await sceneJson()) === builtIn0, forced);

// the link's form: what is typed reaches the canvas and the preview, within the limits
const typeInto = async (selector: string, text: string) => {
  await clickOn(selector);
  await keyWith("a", "KeyA", CTRL, 65);
  if (text) await page.send("Input.insertText", { text }); else await keyWith("Backspace", "Backspace", 0, 8); // the key code is what deletes
  await sleep(250);
};
await typeInto('#inspector [name="link-title"]', "Letters from my desk");
await typeInto('#inspector [name="url"]', "example.com/letter");
const typed = await page.eval<any>(`(() => { const l = sceneStudio.store.getSnapshot().page.links.newsletter; const f = (n) => document.querySelector('#inspector [name="' + n + '"]'); return {
  title: l.title, url: l.url, panel: (document.querySelector("#stage #ed-tt") || {}).textContent, list: (document.querySelector('#stage .st-list a[data-k="newsletter"]') || {}).textContent,
  note: [...document.querySelectorAll("#inspector .field-msg")].map((m) => m.textContent).filter(Boolean).join(" | "),
  count: f("link-title").closest(".field").querySelector(".count").textContent,
  limits: [f("link-title").maxLength, f("link-description").maxLength, f("link-cta").maxLength].join(","), row: document.querySelector('[data-link-row="newsletter"] .layer-note'),
}; })()`);
check("typing in a link's form updates the page, with counts, limits and the address it will open",
  typed.title === "Letters from my desk" && typed.url === "example.com/letter" && typed.panel === "Letters from my desk" && /Letters from my desk/.test(typed.list || "")
  && /Will open https:\/\/example\.com\/letter/.test(typed.note) && typed.count === "20/60" && typed.limits === "60,140,40" && typed.row === null, typed);

await typeInto('#inspector [name="link-title"]', "");
const emptied = await page.eval<any>(`({ title: sceneStudio.store.getSnapshot().page.links.newsletter.title, field: document.querySelector('#inspector [name="link-title"]').value,
  msg: document.querySelector('#inspector [name="link-title"]').closest(".field").querySelector(".field-msg").textContent,
  errs: sceneStudio.validatePage(sceneStudio.store.getSnapshot().page, sceneStudio.store.getSnapshot().scene) })`);
check("an emptied title is not stored: the page keeps the last one and the field says why", emptied.title === "Letters from my desk" && emptied.field === "" && /needs a title/.test(emptied.msg) && emptied.errs.length === 0, emptied);
await typeInto('#inspector [name="link-title"]', "Letters from my desk");

await typeInto('#inspector [name="url"]', "my shop");
const notAddress = await page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); const f = document.querySelector('#inspector [name="url"]'); return {
  url: s.page.links.newsletter.url, field: f.value, msg: f.closest(".field").querySelector(".field-msg").textContent,
  row: (document.querySelector('[data-link-row="newsletter"] .layer-note') || {}).textContent, errs: sceneStudio.validatePage(s.page, s.scene) }; })()`);
check("text that is not an address stays in the field and out of the page", notAddress.url === "" && notAddress.field === "my shop" && notAddress.msg.includes("has no address")
  && notAddress.row === "No address" && notAddress.errs.length === 0, notAddress);
await typeInto('#inspector [name="url"]', "example.com/letter");

await clickOn('[data-ui="view-preview"]');
await sleep(500);
const inPreview = await page.eval<boolean>(`document.getElementById("preview").srcdoc.includes("Letters from my desk") && document.getElementById("preview").srcdoc.includes("https://example.com/letter")`);
await clickOn('[data-ui="view-edit"]');
await sleep(300);
check("the preview shows what was typed", inPreview === true);

await clickOn("#slot-on");
const off = await page.eval<any>(`({ enabled: sceneStudio.store.getSnapshot().page.links.newsletter.enabled, drawn: !!document.querySelector('#stage g[data-k="newsletter"]'),
  listed: !!document.querySelector('#stage .st-list a[data-k="newsletter"]'), row: (document.querySelector('[data-link-row="newsletter"] .layer-note') || {}).textContent })`);
await clickOn("#slot-on");
const on = await page.eval<any>(`({ enabled: sceneStudio.store.getSnapshot().page.links.newsletter.enabled, drawn: !!document.querySelector('#stage g[data-k="newsletter"]') })`);
check("turning a link off takes its drawing and its list entry off the page, and on brings them back",
  off.enabled === false && off.drawn === false && off.listed === false && off.row === "Off" && on.enabled === true && on.drawn === true, { off, on });

// a link that was turned off with no title (older work could hold one) gets its slot's title back when it comes on
await clickOn("#slot-on");
await page.eval(`sceneStudio.store.change((s) => { s.page.links.newsletter.title = ""; })`);
await clickOn("#slot-on");
const backOn = await page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); return { enabled: s.page.links.newsletter.enabled, title: s.page.links.newsletter.title, errs: sceneStudio.validatePage(s.page, s.scene) }; })()`);
check("a link that comes back on always has a title", backOn.enabled === true && backOn.title === "The cat" && backOn.errs.length === 0, backOn);

await clickOn('[data-link-row="commissions"] .layer-main');
await clickOn('#inspector input[type="radio"][value="waitlist"]');
await typeInto('#inspector [name="status-note"]', "Booking for spring.");
const commission = await page.eval<any>(`(() => { const l = sceneStudio.store.getSnapshot().page.links.commissions; return { status: l.status, note: l.statusNote, shown: (document.querySelector("#stage #ed-ts") || {}).textContent }; })()`);
check("a commission slot takes a status and a note", commission.status === "waitlist" && commission.note === "Booking for spring." && /Booking for spring\./.test(commission.shown || ""), commission);
writeFileSync(join(out, "studio-links.png"), await page.screenshot());

await page.eval(`sceneStudio.store.select(null)`);
await sleep(200);
await clickOn('#inspector input[name="palette"][value="violet-lime"]');
const pageForm = await page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); const f = (n) => document.querySelector('#inspector [name="' + n + '"]'); return {
  sections: [...document.querySelectorAll("#inspector .section-title")].map((t) => t.textContent).join(","), palettes: document.querySelectorAll('#inspector input[name="palette"]').length,
  palette: s.page.theme.palette, limits: [f("display-name").maxLength, f("bio").maxLength, f("list-heading").maxLength].join(","),
  errs: [...sceneStudio.validateScene(s.scene), ...sceneStudio.validatePage(s.page, s.scene)],
}; })()`);
check("the page keeps its words, palette and motion, and nothing that belongs to the scene",
  pageForm.sections === "Profile,Palette,Appearance,Words,Scene" && pageForm.palettes === 5 && pageForm.palette === "violet-lime" && pageForm.limits === "40,120,60" && pageForm.errs.length === 0, pageForm);
check("after all of it the scene is byte for byte what it was", (await sceneJson()) === builtIn0);

// what the form leaves behind always opens again: a half-typed address, then a reload
await clickOn('[data-link-row="social"] .layer-main');
await typeInto('#inspector [name="url"]', "instagram");
await sleep(600);
await page.goto(target, 1200);
const reopened = await page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); return { dialog: !!document.querySelector("dialog[open]"), license: s.scene.license,
  social: s.page.links.social.url, commission: s.page.links.commissions.status, save: (document.querySelector("[data-save]") || {}).getAttribute("data-save"),
  aside: localStorage.getItem("scene-studio/v1/set-aside") }; })()`);
check("work left with a half-typed address opens again after a reload", reopened.dialog === false && reopened.license === "builtin" && reopened.social === "" && reopened.commission === "waitlist"
  && reopened.save === "saved" && reopened.aside === null, reopened);

await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await sleep(500);
await clickOn("#tab-layers");
await clickOn('[data-link-row="shop"] .layer-main');
const phone = await page.eval<any>(`({ scroll: document.documentElement.scrollWidth, tabs: [...document.querySelectorAll(".tabs .tab")].map((t) => t.textContent).join(","),
  form: document.getElementById("inspector").hidden === false && !!document.querySelector('#inspector [name="link-title"]'), title: (document.querySelector('[data-ui="slot-title"]') || {}).textContent })`);
check("on a phone a link's row opens its form, with no sideways scrolling", phone.scroll <= 375 && phone.tabs === "Links,Link" && phone.form === true && phone.title === "Framed print", phone);
writeFileSync(join(out, "studio-links-375.png"), await page.screenshot());

// Nothing is dragged in this mode, so a finger that starts on a drawing scrolls the page and
// picks nothing; a tap picks. Real touch events, as a phone sends them.
await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
await clickOn("#tab-layers");
await page.eval(`sceneStudio.store.select(null); document.querySelector(".workspace-scroll").scrollTop = 0`);
await sleep(300);
const fingerAt = await page.eval<[number, number]>(`(() => { const r = document.querySelector('#stage g[data-k="portfolio"]').getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
const touch = (type: string, y: number) => page.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: fingerAt[0], y }] });
await touch("touchStart", fingerAt[1]);
for (let i = 1; i <= 8; i++) { await touch("touchMove", fingerAt[1] - i * 15); await sleep(16); }
await touch("touchEnd", 0);
await sleep(400);
const swipe = await page.eval<any>(`({ scrolled: document.querySelector(".workspace-scroll").scrollTop, sel: sceneStudio.store.getSnapshot().sel, tab: sceneStudio.store.getSnapshot().tab })`);
check("a swipe that starts on a drawing scrolls the page and picks nothing", swipe.scrolled > 40 && swipe.sel === null && swipe.tab === "layers", swipe);
await page.eval(`document.querySelector(".workspace-scroll").scrollTop = 0`);
await sleep(200);
await touch("touchStart", fingerAt[1]);
await touch("touchEnd", 0);
await sleep(400);
const tap = await page.eval<any>(`({ sel: sceneStudio.store.getSnapshot().sel, title: (document.querySelector('[data-ui="slot-title"]') || {}).textContent })`);
await page.send("Emulation.setTouchEmulationEnabled", { enabled: false });
check("a tap on a drawing picks it", tap.sel === "sketchbook" && tap.title === "Sketchbook", tap);

// The scene picker on a phone: it takes the whole screen, one card to a row, and nothing goes
// sideways. The desk is open, with links typed, so its card says so and another scene asks first.
await page.call(`(scenes) => { sceneStudio.openPicker(scenes); }`, twoScenes);
await sleep(1200);
const narrow = await page.eval<any>(`(() => { const d = document.querySelector("dialog.picker[open]"), r = d.getBoundingClientRect(), ul = d.querySelector(".scene-cards");
  return { page: document.documentElement.scrollWidth, dialog: [r.x, r.y, r.width, r.height].map(Math.round), sideways: ul.scrollWidth - ul.clientWidth,
    cards: [...d.querySelectorAll("[data-scene]")].map((c) => { const b = c.getBoundingClientRect(), u = c.querySelector('[data-ui="scene-use"]').getBoundingClientRect(), f = c.querySelector("iframe"), v = f.getBoundingClientRect();
      return { id: c.dataset.scene, left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), use: [Math.round(u.left), Math.round(u.right), Math.round(u.height)],
        frame: [Math.round(v.left), Math.round(v.right)], phone: f.offsetWidth, current: !!c.querySelector('[data-ui="scene-current"]') }; }) }; })()`);
check("at 375 px the picker fills the screen, one card to a row, with nothing sideways",
  narrow.page <= 375 && narrow.dialog.join() === "0,0,375,812" && narrow.sideways <= 0 && narrow.cards.length === twoScenes.length
  && narrow.cards.every((c: any, i: number) => i === 0 || c.top >= narrow.cards[i - 1].bottom)
  && narrow.cards.every((c: any) => c.left >= 0 && c.right <= 375 && c.right - c.left >= 300 && c.use[0] >= c.left && c.use[1] <= c.right && c.use[2] >= 24 && c.frame[0] >= c.left && c.frame[1] <= c.right && c.phone === 375)
  && narrow.cards.every((c: any) => c.current === (c.id === "desk")), narrow);
writeFileSync(join(out, "studio-picker-375.png"), await page.screenshot());
// a finger that starts on a card's page moves the list of cards: the page inside the card stays put
await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
const onCard = await page.eval<[number, number]>(`(() => { const r = document.querySelector('dialog.picker [data-ui="scene-frame"]').getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(Math.min(r.bottom, innerHeight) - 60)]; })()`);
const cardTouch = (type: string, y: number) => page.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: onCard[0], y }] });
await cardTouch("touchStart", onCard[1]);
for (let i = 1; i <= 8; i++) { await cardTouch("touchMove", onCard[1] - i * 20); await sleep(16); }
await cardTouch("touchEnd", 0);
await sleep(400);
const cardSwipe = { list: await page.eval<number>(`document.querySelector(".scene-cards").scrollTop`),
  inside: Math.max(...(await Promise.all(Array.from({ length: page.frameCount() }, (_, i) => page.frameEval<number>(`scrollY`, i))))) };
await page.send("Emulation.setTouchEmulationEnabled", { enabled: false });
check("on a phone a swipe that starts on a card's page scrolls the list of cards, not the page in the card", cardSwipe.list > 40 && cardSwipe.inside === 0, cardSwipe);
await clickOn(`dialog.picker [data-scene="${second.scene.id}"] [data-ui="scene-use"]`);
const askedPhone = await page.eval<string>(`(document.querySelector("dialog[open] #replace-h") || {}).textContent || ""`);
await clickOn('dialog[open] [data-ui="replace-ok"]');
await sleep(400);
const onPhone = await page.eval<any>(`({ ...${OPENED}, scroll: document.documentElement.scrollWidth, tabs: [...document.querySelectorAll(".tabs .tab")].map((t) => t.textContent).join(","), tab: sceneStudio.store.getSnapshot().tab })`);
check("on a phone a chosen scene replaces typed links only after asking, and opens on its list of links",
  askedPhone === `Open ${second.scene.name}?` && onPhone.picker === false && onPhone.id === second.scene.id && onPhone.rows === second.scene.fallback.order.join() && onPhone.urls === ""
  && onPhone.tabs === "Links,Page" && onPhone.tab === "layers" && onPhone.scroll <= 375 && onPhone.errs.length === 0, { asked: askedPhone, id: onPhone.id, rows: onPhone.rows, tabs: onPhone.tabs, scroll: onPhone.scroll });

// Saved work this build cannot open (a check got stricter since it was saved) is set aside,
// not dropped: the studio starts fresh, says so at once, and autosave does not write over it.
await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(600); // a pending autosave lands first
const older = await page.eval<string>(`(() => {
  const saved = JSON.parse(localStorage.getItem("scene-studio/v1"));
  saved.scene.id = "old scene.v1"; // accepted before ids were limited to letters, digits, - and _
  saved.page.scene.id = saved.scene.id;
  const raw = JSON.stringify(saved);
  localStorage.setItem("scene-studio/v1", raw);
  return raw;
})()`);
await page.goto(target, 1200);
await hookDownloads();
const aside = await page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); return {
  dialog: (document.querySelector("dialog[open] #aside-h") || {}).textContent,
  reasons: [...document.querySelectorAll("dialog[open] .errors li")].map((li) => li.textContent),
  drawings: s.scene.layers.filter((l) => l.type !== "background").length,
  kept: localStorage.getItem("scene-studio/v1/set-aside") === ${JSON.stringify(older)},
  current: localStorage.getItem("scene-studio/v1"),
}; })()`);
check("saved work that no longer validates is set aside, and the studio says so on a fresh canvas",
  aside.dialog === "Saved work did not open" && aside.reasons.some((r: string) => r.startsWith("scene: id: use only letters")) && aside.drawings === 0 && aside.kept === true && aside.current === null,
  { ...aside, reasons: aside.reasons.slice(0, 1) });
await clickOn('dialog[open] [data-ui="aside-scene"]');
await sleep(300);
const handedBack = (await downloads())["set-aside.scene.json"] || "";
check("the set-aside work downloads as a scene file", handedBack.includes('"id": "old scene.v1"'), handedBack.slice(0, 50).replace(/\s+/g, " "));
await clickOn('dialog[open] [data-ui="aside-close"]');
// new work is saved next to the copy, not over it; a later load offers the copy without asking again
await page.eval(`sceneStudio.store.change((s) => { s.scene.name = "After the copy"; })`);
await sleep(700);
await page.goto(target, 1200);
const later = await page.eval<any>(`({
  dialog: !!document.querySelector("dialog[open]"),
  name: sceneStudio.store.getSnapshot().scene.name,
  kept: localStorage.getItem("scene-studio/v1/set-aside") === ${JSON.stringify(older)},
})`);
check("autosave leaves the set-aside copy alone, and a later load does not ask again", later.dialog === false && later.name === "After the copy" && later.kept === true, later);
await clickOn('[data-ui="more"]');
await clickOn('[data-ui="menu-aside"]');
await clickOn('dialog[open] [data-ui="aside-discard"]');
const gone = await page.eval<any>(`({ kept: localStorage.getItem("scene-studio/v1/set-aside"), dialog: !!document.querySelector("dialog[open]"), offered: sceneStudio.store.getSnapshot().setAside })`);
check("discarding removes the copy and the menu entry", gone.kept === null && gone.dialog === false && gone.offered === false, gone);

await chrome.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
