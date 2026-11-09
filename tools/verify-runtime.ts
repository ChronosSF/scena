// Drives the built demo-desk.html (opened from file://) in headless Chrome to check every
// branch of the page runtime's boil control (development plan section 8.2): capability
// gate, lite mode, slow-frame fallback, Save-Data, reduced motion, offscreen, hidden tab
// and the 45 s idle pause. Then demo-frames.html for frame-flip animation (ADR 0002): frames
// flip, hold frame 1 for reduced motion and Save-Data, and pause with the boil. Run `pnpm build` first.
//   pnpm verify:runtime
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { launch, sleep, type Page } from "./cdp.ts";

const dist = (f: string) => pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "apps/studio/dist", f)).href;
const url = dist("demo-desk.html"), framesUrl = dist("demo-frames.html");
const chrome = await launch({ port: 9336, fileAccess: false });
let failures = 0;
const check = (label: string, ok: boolean, detail: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${JSON.stringify(detail)}`); if (!ok) failures++; };
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

await chrome.close();
process.exit(failures ? 1 : 0);
