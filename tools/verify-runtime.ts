// Drives the built demo-desk.html (opened from file://) in headless Chrome to check every
// branch of the page runtime's boil control (development plan section 8.2): capability
// gate, lite mode, slow-frame fallback, Save-Data, reduced motion, offscreen, hidden tab
// and the 45 s idle pause. Then demo-frames.html for frame-flip animation (ADR 0002): frames
// flip, hold frame 1 for reduced motion and Save-Data, and pause with the boil. Run `pnpm build` first.
//   pnpm verify:runtime
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { renderPage } from "@scena/renderer";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import { launch, sleep, type Page } from "./cdp.ts";
import { checks } from "./checks.ts";

const distPath = (f: string) => join(dirname(fileURLToPath(import.meta.url)), "..", "apps/studio/dist", f);
const dist = (f: string) => pathToFileURL(distPath(f)).href;
const url = dist("demo-desk.html"), framesUrl = dist("demo-frames.html");
const chrome = await launch({ port: 9336, fileAccess: false });
const { check, failed } = checks();
interface State { boil?: string; ms?: string; lite?: string; octaves: string; seed: string }
const STATE = `(() => { const d = document.documentElement.dataset, t = [...document.querySelectorAll("filter.boil feTurbulence")];
  return { boil: d.boil, ms: d.boilMs, lite: d.lite, octaves: t[0].getAttribute("numOctaves"), seed: t[0].getAttribute("seed") }; })()`;

interface Fresh { cores?: number; memory?: number; saveData?: boolean; reduce?: string; slowFrames?: number; clock?: boolean; height?: number; page?: string }
async function fresh({ cores, memory, saveData, reduce = "no-preference", slowFrames, clock, height = 812, page: target = url }: Fresh = {}): Promise<Page> {
  const page = await chrome.newPage();
  await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height, deviceScaleFactor: 2, mobile: true });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce }] });
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  if (cores) await page.send("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: cores });
  let pre = "";
  if (memory) pre += `Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => ${memory} });`;
  if (saveData) pre += `Object.defineProperty(Navigator.prototype, "connection", { get: () => ({ saveData: true }) });`;
  if (slowFrames) pre += `{ const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((t) => { const end = performance.now() + ${slowFrames}; while (performance.now() < end); cb(t); }); }`;
  if (clock) pre += `{ const now = Date.now.bind(Date); let skew = 0; Date.now = () => now() + skew; window.__advance = (ms) => { skew += ms; }; }`;
  if (pre) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: pre });
  await page.goto(target, 1200);
  return page;
}
const seedsOver = async (page: Page, ms: number) => { const seen = new Set<string>(); for (let i = 0; i < ms / 50; i++) { seen.add((await page.eval<State>(STATE)).seed); await sleep(50); } return [...seen].sort(); };

// 1. capable device
let p = await fresh({ cores: 8, memory: 8 });
let s = await p.eval<State>(STATE);
const logs = p.logs.filter((l) => /^(error|exception)/i.test(l));
check("page loads from file:// with a clean console (no CSP violations)", logs.length === 0, logs);
check("capable device boils with 2 octaves and 3 seeds", s.boil === "on" && !s.lite && s.octaves === "2" && Number(s.ms) < 40, { ...s, seeds: await seedsOver(p, 900) });
await p.close();

// 2. lite mode: 4 cores and 4 GB
p = await fresh({ cores: 4, memory: 4 });
s = await p.eval<State>(STATE);
const liteSeeds = await seedsOver(p, 1200);
check("4 cores + 4 GB starts in lite mode: 1 octave, 2 seeds", s.boil === "on" && s.lite === "1" && s.octaves === "1" && liteSeeds.length === 2, { ...s, seeds: liteSeeds });
await p.close();

// 3. slow frames: the gate measures five seed changes, retries once after 2 s, then goes static
p = await fresh({ cores: 8, memory: 8, slowFrames: 55 });
await sleep(3500);
s = await p.eval<State>(STATE);
const staticSeeds = await seedsOver(p, 600);
check("average frame over 40 ms leaves the scene static", s.boil === "static" && Number(s.ms) > 40 && staticSeeds.length === 1, { ...s, seeds: staticSeeds });
await p.close();

// 4. Save-Data
p = await fresh({ saveData: true });
s = await p.eval<State>(STATE);
check("Save-Data disables the boil", s.boil === "static" && !s.ms, s);
await p.close();

// 5. reduced motion
p = await fresh({ reduce: "reduce" });
s = await p.eval<State>(STATE);
check("prefers-reduced-motion keeps lines still", s.boil !== "on" && (await seedsOver(p, 500)).length === 1, s);
await p.close();

// 6. offscreen: scroll the drawing out of view, then back
p = await fresh({ height: 420 });
await p.eval(`window.scrollTo(0, document.body.scrollHeight)`); await sleep(400);
const off = await p.eval<State>(STATE);
await p.eval(`window.scrollTo(0, 0)`); await sleep(400);
const back = await p.eval<State>(STATE);
check("pauses when the scene scrolls out of view, resumes when back", off.boil === "paused" && back.boil === "on", { off: off.boil, back: back.boil });
await p.close();

// 7. hidden tab
p = await fresh();
await p.send("Emulation.setFocusEmulationEnabled", { enabled: false });
await p.eval(`Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange"))`); await sleep(200);
const hid = await p.eval<State>(STATE);
await p.eval(`Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange"))`); await sleep(300);
const vis = await p.eval<State>(STATE);
check("pauses while the tab is hidden, resumes when shown", hid.boil === "paused" && vis.boil === "on", { hidden: hid.boil, shown: vis.boil });
await p.close();

// 8. idle for 45 s (clock advanced), then a pointer move
p = await fresh({ clock: true });
await p.eval(`window.__advance(46000)`); await sleep(400);
const idle = await p.eval<State>(STATE);
await p.eval(`window.dispatchEvent(new PointerEvent("pointermove"))`); await sleep(300);
const woke = await p.eval<State>(STATE);
check("pauses after 45 s without interaction, resumes on pointer", idle.boil === "paused" && woke.boil === "on", { idle: idle.boil, woke: woke.boil });
await p.close();

// ---------------------------------------------------------------- frames (demo-frames.html: the steaming mug)
// which frame each stack shows ("x" when not exactly one), sampled every 60 ms for `ms`
const FRAMES = `[...document.querySelectorAll(".frs")].map((s) => { const on = [...s.children].map((f) => getComputedStyle(f).opacity === "1"); return on.filter(Boolean).length === 1 ? on.indexOf(true) : "x"; }).join("")`;
const framesOver = async (page: Page, ms: number) => { const seen = new Set<string>(); for (let i = 0; i < ms / 60; i++) { seen.add(await page.eval<string>(FRAMES)); await sleep(60); } return [...seen].sort(); };
const fr = (page: Page) => page.eval<string | undefined>(`document.documentElement.dataset.fr`);

p = await fresh({ page: framesUrl, cores: 8, memory: 8 });
const flogs = p.logs.filter((l) => /^(error|exception)/i.test(l));
const flips = await framesOver(p, 900);
check("frames page: clean console, frames flip and only one shows at a time", !flogs.length && (await fr(p)) === "on" && flips.length >= 2 && flips.every((x) => /^\d+$/.test(x)), { logs: flogs, fr: await fr(p), seen: flips });
await p.close();

p = await fresh({ page: framesUrl, saveData: true });
check("Save-Data holds frame 1", (await fr(p)) === "off" && (await framesOver(p, 600)).join() === "0", { fr: await fr(p) });
await p.close();

p = await fresh({ page: framesUrl, reduce: "reduce" });
check("prefers-reduced-motion holds frame 1", (await framesOver(p, 600)).join() === "0", { fr: await fr(p) });
await p.close();

p = await fresh({ page: framesUrl });
await p.send("Emulation.setFocusEmulationEnabled", { enabled: false });
await p.eval(`Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange"))`); await sleep(200);
const fHidden = { fr: await fr(p), state: await p.eval<string>(`document.querySelector(".fr").getAnimations()[0]?.playState`) };
await p.eval(`Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange"))`); await sleep(300);
const fShown = { fr: await fr(p), state: await p.eval<string>(`document.querySelector(".fr").getAnimations()[0]?.playState`) };
check("frames pause with the boil while the tab is hidden, and resume", fHidden.fr === "paused" && fHidden.state === "paused" && fShown.fr === "on" && fShown.state === "running", { hidden: fHidden, shown: fShown });
await p.close();

p = await fresh({ page: framesUrl, clock: true });
await p.eval(`window.__advance(46000)`); await sleep(400);
const fIdle = await fr(p);
await p.eval(`window.dispatchEvent(new PointerEvent("pointermove"))`); await sleep(300);
check("frames pause after 45 s without interaction, and resume on pointer", fIdle === "paused" && (await fr(p)) === "on", { idle: fIdle, woke: await fr(p) });
await p.close();

// ---------------------------------------------------------------- a published page in a frame says nothing to its parent
// The studio's Preview renders the page with editorPreview, and then its runtime tells the studio
// which drawing was tapped (issue 14). A page rendered without it, as the built demo page and every
// published page are, posts nothing, whoever frames it. The page rendered with it is the control:
// a tap in that frame reaches the parent, so the silence of the other means something.
const published = readFileSync(distPath("demo-desk.html"), "utf8");
/** A page that frames the given documents side by side, each in a sandboxed srcdoc frame of `height`; returns each frame's index. */
async function framing(pages: Record<string, string>, height: number): Promise<{ page: Page; index: Record<string, number> }> {
  const page = await chrome.newPage();
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 860, deviceScaleFactor: 1, mobile: false });
  await page.goto("data:text/html,<!DOCTYPE html><title>A page that frames others</title>", 300);
  const index: Record<string, number> = {};
  for (const [name, html] of Object.entries(pages)) {
    const before = page.frameCount();
    // the documents reach the page as values (page.call); every message from each frame is kept, whatever it is
    await page.call(`(name, html, height) => new Promise((done) => {
      window.__heard = window.__heard || {};
      window.__heard[name] = [];
      document.body.style.cssText = "margin:0;display:flex";
      const f = document.createElement("iframe");
      f.id = name;
      f.setAttribute("sandbox", "allow-scripts");
      f.style.cssText = "width:375px;height:" + height + "px;border:0;flex:none";
      addEventListener("message", (e) => { if (e.source === f.contentWindow) window.__heard[name].push(e.data); });
      f.addEventListener("load", () => done(true), { once: true });
      f.srcdoc = html;
      document.body.append(f);
    })`, name, html, height);
    for (let i = 0; i < 30 && page.frameCount() === before; i++) await sleep(100);
    index[name] = page.frameCount() - 1;
  }
  await sleep(800);
  return { page, index };
}
const framedPages = { published, preview: renderPage(DESK_SCENE, PIA_PAGE, { demo: true, editorPreview: true }).html };
const { page: framer, index: frameIndex } = await framing(framedPages, 812);
p = framer;
for (const name of Object.keys(framedPages)) {
  const box = await p.call<[number, number]>(`(id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.x, r.y]; }`, name);
  const at = await p.frameCall<[number, number]>(frameIndex[name], `(k) => { const o = [...document.querySelectorAll(".obj")].find((x) => x.getAttribute("data-k") === k); const r = o.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }`, "commissions");
  await p.click(box[0] + at[0], box[1] + at[1]);
  await sleep(300);
}
await sleep(800);
const heard = await p.eval<Record<string, unknown[]>>(`window.__heard`);
const opened = await Promise.all(Object.keys(framedPages).map((name) => p.frameEval<string>(`[...document.querySelectorAll('.obj[aria-pressed="true"]')].map((o) => o.getAttribute("data-k")).join()`, frameIndex[name])));
const embedLogs = p.logs.filter((l) => /^(error|exception)/i.test(l) && !/fonts\.g/.test(l));
check("a published page in a frame posts nothing to its parent when a drawing is tapped; the studio preview's page posts its slot id alone",
  opened.every((k) => k === "commissions") && heard.published?.length === 0 && JSON.stringify(heard.preview) === JSON.stringify([{ type: "scena:tap", slot: "commissions" }]) && !embedLogs.length,
  { opened, heard, logs: embedLogs });
await p.close();

// After an edit the studio renders its preview with the tapped drawing selected, and that page
// brings its open panel into view as it loads, in a pane too short to show it. Only the editor
// flag does that: the same page rendered selected without it stays at its top, as does the demo
// page. All three are in frames as short as the studio's pinned preview on a phone.
const scrolling = { published, selected: renderPage(DESK_SCENE, PIA_PAGE, { demo: true, selected: "commissions" }).html,
  preview: renderPage(DESK_SCENE, PIA_PAGE, { demo: true, selected: "commissions", editorPreview: true }).html };
const { page: shortFrames, index: shortIndex } = await framing(scrolling, 357);
p = shortFrames;
await sleep(1200); // the typeface arrives, and the editor's page puts its panel back in view once more
const PLACE = `({ scrolled: Math.round(scrollY), panel: (() => { const r = document.querySelector(".tag").getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), innerHeight]; })(),
  open: !document.getElementById("tb").hidden, title: document.getElementById("tt").textContent })`;
const placed = Object.fromEntries(await Promise.all(Object.keys(scrolling).map(async (name) => [name, await p.frameEval<any>(PLACE, shortIndex[name])])));
const inView = (f: any) => f.panel[0] >= 0 && f.panel[1] <= f.panel[2];
check("only the studio preview's page scrolls itself, to its open panel; a page without the editor flag stays at its top, selected or not",
  placed.published.scrolled === 0 && !placed.published.open && placed.selected.scrolled === 0 && placed.selected.open && !inView(placed.selected)
  && placed.preview.scrolled > 0 && placed.preview.open && placed.preview.title === "Envelope" && inView(placed.preview), placed);
await p.close();

await chrome.close();
process.exit(failed() ? 1 : 0);
