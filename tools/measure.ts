// Boil cost measurement in Chrome, phone-sized (375x812 at 3x), with CPU throttling.
//   pnpm measure [--headed] [--soft] [--shots <dir>]      (run pnpm build first)
//   --headed  real window parked off-screen (display refresh rate) instead of headless
//   --soft    software raster (--disable-gpu), closer to a budget Android
// For each page and throttle rate it reports:
//   idle    average ms between animation frames with nothing changing
//   boil    average ms between a seed change and the next animation frame (40 samples)
//   raster  ms of paint + raster work per seed change, from a browser trace
//   gate    what the page runtime's own capability gate decided (demo-desk.html only)
// Then frame-flip animation (ADR 0002): the desk as rendered today against the desk with three
// objects flipping three frames at 6 fps (runtime removed from both, so the probe drives the
// boil and CSS drives the frames). Reported: the boil probe above, and 3 s with no seed changes:
// main-thread busy time and paint + raster time per second, and the average frame interval.
// --shots writes light/dark screenshots of the prototype and demo-desk.html for comparison.

import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { launch } from "./cdp.ts";
import { renderPage } from "@scena/renderer";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import type { SceneDocument } from "@scena/scene";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = (f: string) => pathToFileURL(join(root, f)).href;
const PAGES: [string, string][] = [
  ["prototype (one scene-wide filter)", "fixtures/reference/Pia Morandi, illustrator.html"],
  ["demo-desk.html (per-object filters)", "apps/studio/dist/demo-desk.html"],
];
const RATES = [1, 4, 6];

// Frame-flip pages, written to tools/out/. The runtime is removed so nothing but the probe moves the boil.
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
function animatedDesk(): SceneDocument {
  const s = clone(DESK_SCENE);
  for (const id of ["cup", "sketchbook", "cat"]) {
    const layer = s.layers.find((l) => l.id === id)!;
    const lines = layer.parts!.find((p) => p.role === "lines" && !p.when)!;
    const frames = [lines.asset];
    // frames 2 and 3: the same drawing nudged, as a redraw would be
    [[0.8, -0.6], [-0.7, 0.5]].forEach(([dx, dy], i) => {
      const a = clone(s.assets[lines.asset]!) as { id: string; src: string };
      a.id = `${lines.asset}-f${i + 2}`;
      a.src = `<g transform="translate(${dx} ${dy})">${a.src}</g>`;
      s.assets[a.id] = a as never;
      frames.push(a.id);
    });
    Object.assign(lines, { frames, fps: 6, play: "always" });
  }
  return s;
}
const stripRuntime = (html: string) => html.replace(/<script>[\s\S]*?<\/script>/, "<script></script>");
mkdirSync(join(root, "tools", "out"), { recursive: true });
writeFileSync(join(root, "tools/out/measure-desk.html"), stripRuntime(renderPage(DESK_SCENE, PIA_PAGE).html));
writeFileSync(join(root, "tools/out/measure-frames.html"), stripRuntime(renderPage(animatedDesk(), PIA_PAGE).html));
const FRAME_PAGES: [string, string][] = [
  ["desk, no frames", "tools/out/measure-desk.html"],
  ["desk, 3 objects x 3 frames @ 6 fps", "tools/out/measure-frames.html"],
];

// 3 s with nothing changing but the frame flips
const STILL = `(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < 10; i++) await raf();
  console.timeStamp("still-start");
  const t0 = performance.now(); let n = 0;
  while (performance.now() - t0 < 3000) { await raf(); n++; }
  console.timeStamp("still-end");
  return { frames: n, interval: +((performance.now() - t0) / n).toFixed(1), animations: document.getAnimations().length };
})()`;

const PROBE = `(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const turbs = [...document.querySelectorAll("feTurbulence")];
  const seeds = [2, 7, 13]; let k = 0;
  for (let i = 0; i < 10; i++) await raf();
  const avg = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  const idle = [], boil = [];
  for (let i = 0; i < 20; i++) { const t0 = performance.now(); await raf(); idle.push(performance.now() - t0); }
  console.timeStamp("boil-start");
  for (let i = 0; i < 40; i++) {
    const t0 = performance.now();
    k = (k + 1) % seeds.length;
    turbs.forEach((t) => t.setAttribute("seed", seeds[k]));
    await raf();
    boil.push(performance.now() - t0);
  }
  await raf();
  console.timeStamp("boil-end");
  boil.sort((a, b) => a - b);
  return { idle: avg(idle), boil: avg(boil), p90: +boil[Math.floor(boil.length * 0.9)].toFixed(1), filters: document.querySelectorAll("filter").length };
})()`;

const args = process.argv.slice(2);
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1]! : null;

const headed = args.includes("--headed"), soft = args.includes("--soft");
const chrome = await launch({ headed, gpu: !soft });
const RASTER = new Set(["RasterTask", "Paint", "PaintImage", "GpuRasterization", "Rasterize"]);
const page = await chrome.newPage();
await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 3, mobile: true });

console.log(`Boil frame cost, 375x812 @3x, ${headed ? "headed" : "headless"} Chrome, ${soft ? "software" : "default"} raster, this machine`);
console.log("page".padEnd(38) + "cpu   idle ms  boil ms  p90 ms  raster ms/change  runtime gate");
for (const [label, file] of PAGES) {
  for (const rate of RATES) {
    await page.send("Emulation.setCPUThrottlingRate", { rate });
    // 1. the runtime's own gate, with motion allowed
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await page.goto(url(file), 1500);
    const gate = await page.eval(`(() => { const d = document.documentElement.dataset; return d.boil ? d.boil + (d.boilMs ? " (" + d.boilMs + " ms" + (d.lite ? ", lite" : "") + ")" : "") : "n/a (no gate)"; })()`);
    // 2. our probe, with the page's own boil stopped via reduced motion
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.goto(url(file), 800);
    const { result: r, events } = await chrome.trace(() => page.eval<{ idle: number; boil: number; p90: number }>(PROBE), ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "blink"]);
    // paint + raster work between the console.timeStamp markers that bracket the 40 seed changes
    const mark = (m: string): number | undefined => events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === m)?.ts;
    const t0 = mark("boil-start"), t1 = mark("boil-end");
    const rasterUs = t0 && t1 ? events.filter((e) => e.ph === "X" && RASTER.has(e.name) && e.dur && e.ts >= t0 && e.ts <= t1).reduce((s, e) => s + e.dur, 0) : NaN;
    const perChange = (rasterUs / 1000 / 40).toFixed(1);
    console.log(label.padEnd(38) + `${rate}x`.padEnd(6) + String(r.idle).padEnd(9) + String(r.boil).padEnd(9) + String(r.p90).padEnd(8) + perChange.padEnd(18) + gate);
  }
}
await page.send("Emulation.setCPUThrottlingRate", { rate: 1 });

console.log("");
console.log("Frame-flip animation, same conditions; the runtime removed from both pages");
console.log("page".padEnd(38) + "cpu   boil ms  p90 ms  raster ms/change | 3 s still: frame ms  main ms/s  raster ms/s  animations");
const CATS = ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "blink"];
for (const [label, file] of FRAME_PAGES) {
  for (const rate of RATES) {
    await page.send("Emulation.setCPUThrottlingRate", { rate });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await page.goto(url(file), 1200);
    const boil = await chrome.trace(() => page.eval<{ idle: number; boil: number; p90: number }>(PROBE), CATS);
    const b0 = boil.events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === "boil-start")?.ts;
    const b1 = boil.events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === "boil-end")?.ts;
    const perChange = b0 && b1 ? (boil.events.filter((e) => e.ph === "X" && RASTER.has(e.name) && e.dur && e.ts >= b0 && e.ts <= b1).reduce((s, e) => s + e.dur, 0) / 1000 / 40).toFixed(1) : "n/a";
    const still = await chrome.trace(() => page.eval<{ frames: number; interval: number; animations: number }>(STILL), CATS);
    const m0 = still.events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === "still-start");
    const m1 = still.events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === "still-end");
    let main = NaN, raster = NaN;
    if (m0 && m1) {
      const secs = (m1.ts - m0.ts) / 1e6;
      const inWindow = (e: { ts: number }) => e.ts >= m0.ts && e.ts <= m1.ts;
      // main thread: top-level tasks on the thread that ran the probe's console.timeStamp
      main = still.events.filter((e) => e.ph === "X" && e.name === "RunTask" && e.tid === m0.tid && e.pid === m0.pid && e.dur && inWindow(e)).reduce((s, e) => s + e.dur, 0) / 1000 / secs;
      raster = still.events.filter((e) => e.ph === "X" && RASTER.has(e.name) && e.dur && inWindow(e)).reduce((s, e) => s + e.dur, 0) / 1000 / secs;
    }
    const r = boil.result, st = still.result;
    console.log(label.padEnd(38) + `${rate}x`.padEnd(6) + String(r.boil).padEnd(9) + String(r.p90).padEnd(8) + perChange.padEnd(18) + "| " +
      String(st.interval).padEnd(19) + main.toFixed(1).padEnd(11) + raster.toFixed(1).padEnd(13) + st.animations);
  }
}
await page.send("Emulation.setCPUThrottlingRate", { rate: 1 });

if (shotsDir) {
  mkdirSync(shotsDir, { recursive: true });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 420, height: 1180, deviceScaleFactor: 1, mobile: false });
  for (const scheme of ["light", "dark"]) {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    for (const [, file] of PAGES) {
      await page.goto(url(file), 1500);
      const name = `${file.replace(/[\\/]/g, "_").replace(".html", "")}-${scheme}.png`;
      writeFileSync(join(shotsDir, name), await page.screenshot());
      console.log("wrote", join(shotsDir, name));
    }
  }
}

const demo = readFileSync(join(root, "apps/studio/dist/demo-desk.html"));
console.log(`demo-desk.html: ${demo.length} B raw, ${gzipSync(demo, { level: 9 }).length} B gzip`);
await chrome.close();
