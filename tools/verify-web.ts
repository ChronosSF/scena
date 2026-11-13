// End-to-end check of the web app (apps/web) in headless Chrome: the studio inside Next.js,
// under the app's Content Security Policy, through real browser input.
//   node tools/verify-web.ts                         the production build (run pnpm build:web first);
//                                                    this starts its server and stops it again
//   node tools/verify-web.ts http://localhost:3100   a server that is already running (the dev server)
// The studio itself is checked end to end in the single-file build (tools/verify-studio.ts).
// This check is about what the web app adds: the server, the policy, and loading the studio
// in the browser only. A screenshot goes to tools/out/.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIRST_FACES_HREF, MORE_FACES_HREF } from "@scena/studio/fonts";
import { isDataBlock, scriptElements } from "@scena/studio/policy";
import { RUNTIME_SHA256 } from "@scena/renderer";
import { launch, repoRoot, sleep } from "./cdp.ts";
import { checks, input } from "./checks.ts";

const web = join(repoRoot, "apps", "web");
const out = join(repoRoot, "tools", "out");
mkdirSync(out, { recursive: true });

const given = process.argv[2];
const PORT = 3190;
const origin = (given || `http://localhost:${PORT}`).replace(/\/+$/, "");

const { check, failed } = checks();

// ── the server ──────────────────────────────────────────────────────────────────────────
let server: ChildProcess | null = null;
let said = "", ended = "";
if (!given) {
  if (!existsSync(join(web, ".next", "BUILD_ID"))) {
    console.error("apps/web is not built: run pnpm build:web first.");
    process.exit(1);
  }
  // node runs Next.js's own entry, with no shell in between, so stopping this process stops the server
  server = spawn(process.execPath, [join(web, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT)],
    { cwd: web, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout!, server.stderr!]) {
    stream.setEncoding("utf8");
    stream.on("data", (text: string) => { said = (said + text).slice(-4000); });
  }
  server.on("error", (e) => { ended = `could not be started (${e.message})`; });
  server.on("close", (code, signal) => { ended = signal ? `was stopped by ${signal}` : `exited with code ${code}`; });
}
const stop = () => { if (server && !ended) server.kill(); };
process.on("exit", stop);

const answers = async (): Promise<boolean> => {
  try { return (await fetch(`${origin}/`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
};
// The server this check started says "Ready" once it is listening, and only then is an answer
// on the port its answer. If the port is taken, whatever holds it answers at once, with some
// other build, while this server is still on its way to failing: its own word is what ties
// the checks to this build. A server that was given has no word to wait for.
const itSaysReady = () => /\bReady\b/.test(said);
const started = Date.now();
let up = false;
while (!up && !ended && Date.now() - started < 30_000) {
  up = (!server || itSaysReady()) && (await answers());
  if (!up) await sleep(200);
}
if (!up || (server && ended)) {
  const lines = said.split("\n").map((l) => l.trim()).filter(Boolean).slice(-12);
  const why = given ? "nothing is listening there" : ended ? `its server ${ended}` : `its server ${itSaysReady() ? "said it was ready and did not answer" : "had not said it was ready"} after 30 s`;
  console.error([`The web app is not being served at ${origin}: ${why}.`, ...(lines.length ? ["  It said:", ...lines.map((l) => `    ${l}`)] : [])].join("\n"));
  stop();
  process.exit(1);
}

// ── what the server sends ───────────────────────────────────────────────────────────────
const get = async (path: string, headers: Record<string, string> = {}) => {
  const r = await fetch(origin + path, { headers });
  return { status: r.status, policy: r.headers.get("content-security-policy") || "", powered: r.headers.get("x-powered-by"), html: await r.text() };
};
const nonceOf = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1] || "";
const directive = (policy: string, name: string) => policy.split("; ").find((d) => d.startsWith(`${name} `)) || "";

const first = await get("/studio"), again = await get("/studio");
const scriptSrc = directive(first.policy, "script-src");
// A dev server may evaluate (React rebuilds server error stacks that way). The build this
// check starts may not. A server that was given is one or the other, and the log says which.
const evaluates = /'unsafe-eval'/.test(scriptSrc);
if (given) console.log(`NOTE  ${origin} ${evaluates ? "may evaluate code, as a dev server does" : "may not evaluate code, as a production build"}`);
check("the studio route answers under a policy that names its scripts by a nonce and the page runtime by hash",
  first.status === 200 && directive(first.policy, "default-src") === "default-src 'none'" && /^script-src 'nonce-[A-Za-z0-9+/=]{22,}' 'self' /.test(scriptSrc)
  && scriptSrc.includes(`'sha256-${RUNTIME_SHA256}'`) && !/'unsafe-inline'|'strict-dynamic'|\*|https?:/.test(scriptSrc) && (!!given || !evaluates)
  && directive(first.policy, "frame-ancestors") === "frame-ancestors 'none'" && first.powered === null,
  { status: first.status, policy: first.policy.replace(nonceOf(first.policy), "…").slice(0, 200) });
check("every request gets a nonce of its own", nonceOf(first.policy).length >= 22 && nonceOf(again.policy).length >= 22 && nonceOf(first.policy) !== nonceOf(again.policy));

/** The scripts of a document the server sent, and the ones that do not carry the nonce of its policy. */
const scriptsOf = (r: { html: string; policy: string }) => {
  const all = scriptElements(r.html).filter((s) => !isDataBlock(s));
  return { all, unnamed: all.filter((s) => !nonceOf(r.policy) || !s.attrs.includes(`nonce="${nonceOf(r.policy)}"`)) };
};
const scripts = scriptsOf(first);
check("every script the server sends carries the nonce of its request", scripts.all.length > 0 && scripts.unnamed.length === 0,
  { scripts: scripts.all.length, without: scripts.unnamed.map((s) => (s.attrs + s.body).slice(0, 80)) });
// What a request says about itself changes nothing. One that calls itself a prefetch is still
// answered with the document, and a browser may go on to show that document.
const saysPrefetch: Record<string, string>[] = [{ purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" }, { "next-router-prefetch": "1" }];
const marked = await Promise.all(saysPrefetch.map(async (headers) => {
  const r = await get("/studio", headers);
  return { sent: Object.keys(headers)[0], status: r.status, policy: nonceOf(r.policy).length >= 22, scripts: scriptsOf(r).all.length, unnamed: scriptsOf(r).unnamed.length };
}));
check("a request that calls itself a prefetch is answered under the policy like any other",
  marked.every((r) => r.status === 200 && r.policy && r.scripts > 0 && r.unnamed === 0), marked);
check("the server sends none of the studio: it is loaded in the browser",
  first.html.includes("Opening the studio") && !/data-ui="more"|id="stage"|id="panel-layers"/.test(first.html) && first.html.includes('id="root"'));
check("the document links the studio's first typefaces", first.html.includes(FIRST_FACES_HREF.replace(/&/g, "&amp;")));

const home = await get("/");
check("the home page answers under the same policy and links to the studio",
  home.status === 200 && directive(home.policy, "default-src") === "default-src 'none'" && nonceOf(home.policy).length >= 22 && home.html.includes('href="/studio"'), { status: home.status });
const missing = await get("/no-such-page");
check("a page that does not exist is a 404 under the policy too", missing.status === 404 && nonceOf(missing.policy).length >= 22, { status: missing.status });

// ── the studio, in a browser ────────────────────────────────────────────────────────────
const chrome = await launch({ port: 9347, fileAccess: false });
const page = await chrome.newPage();
await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: "light" }] });

const { clickOn, typeInto } = input(page);
/** The studio is there once its module has loaded and its top bar is on screen. */
async function studioLoaded(): Promise<boolean> {
  for (let i = 0; i < 150; i++) {
    if (await page.eval<boolean>(`typeof window.sceneStudio === "object" && !!document.querySelector('[data-ui="more"]')`)) return true;
    await sleep(100);
  }
  return false;
}
const errorsSince = (from: number) => page.logs.slice(from).filter((l) => /^(error|exception|console\.error)/i.test(l) && !/fonts\.g/.test(l));

await page.goto(`${origin}/studio`);
const loaded = await studioLoaded();
const shell = await page.eval<any>(`({
  title: document.title,
  root: getComputedStyle(document.getElementById("root")).display,
  opening: document.body.textContent.includes("Opening the studio"),
  faces: [...document.head.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")),
  more: (document.getElementById("more-faces") || {}).href || "",
  empty: !!document.querySelector('[data-ui="empty"]'),
  work: localStorage.getItem("scene-studio/v1"),
})`);
check("the studio loads in the web app, with its stylesheet and its typefaces, on an empty canvas",
  loaded && shell.title === "Scena Studio" && shell.root === "contents" && shell.opening === false
  && shell.faces.includes(FIRST_FACES_HREF) && shell.more === MORE_FACES_HREF && shell.empty === true && shell.work === null,
  { loaded, title: shell.title, root: shell.root, opening: shell.opening, faces: shell.faces.length, empty: shell.empty });

// the scene picker, from the empty canvas: each card is the published page in a frame, and
// that page's script is the one script here that carries no nonce
await clickOn('[data-ui="empty-scenes"]');
await sleep(1200);
const cards = await page.eval<string[]>(`[...document.querySelectorAll("dialog.picker[open] [data-scene]")].map((c) => c.dataset.scene)`);
const inCard = page.frameCount() ? await page.frameEval<any>(`({ boil: document.documentElement.dataset.boil || "", drawings: document.querySelectorAll(".obj[data-k]").length })`) : null;
check("the scene picker opens, and the page in a card runs its runtime under the policy",
  cards.includes("desk") && !!inCard && inCard.boil !== "" && inCard.drawings > 0, { cards, inCard });

await clickOn('dialog.picker [data-scene="desk"] [data-ui="scene-use"]');
await sleep(400);
const chosen = await page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); return {
  scene: s.scene.id, license: s.scene.license, picker: !!document.querySelector("dialog.picker[open]"),
  rows: [...document.querySelectorAll("[data-link-row]")].map((r) => r.getAttribute("data-link-row")),
  titles: Object.values(s.page.links).every((l) => l.title.length > 0), errs: [...sceneStudio.validateScene(s.scene), ...sceneStudio.validatePage(s.page, s.scene)] }; })()`);
check("choosing the desk opens it to be filled in, with its own default texts",
  chosen.scene === "desk" && chosen.license === "builtin" && chosen.picker === false && chosen.rows.length === 5 && chosen.titles === true && chosen.errs.length === 0, chosen);

// one link, filled in by typing
await clickOn('[data-link-row="newsletter"] .layer-main');
await typeInto('#inspector [name="link-title"]', "Letters from my desk");
await typeInto('#inspector [name="url"]', "example.com/letter");
const typed = await page.eval<any>(`(() => { const l = sceneStudio.store.getSnapshot().page.links.newsletter; return {
  title: l.title, url: l.url, list: (document.querySelector('#stage .st-list a[data-k="newsletter"]') || {}).textContent || "",
  note: [...document.querySelectorAll("#inspector .field-msg")].map((m) => m.textContent).filter(Boolean).join(" | ") }; })()`);
check("typing a link's title and address fills the page",
  typed.title === "Letters from my desk" && typed.url === "example.com/letter" && typed.list.includes("Letters from my desk") && /Will open https:\/\/example\.com\/letter/.test(typed.note), typed);

// the preview is the exported page in a sandboxed frame: a real tap inside it
await clickOn('[data-ui="view-preview"]');
await sleep(1500);
const at = await page.frameEval<[number, number] | null>(`(() => { const o = document.querySelector('.obj[data-k="newsletter"]'); if (!o) return null; const r = o.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const frame = await page.eval<[number, number]>(`(() => { const r = document.getElementById("preview").getBoundingClientRect(); return [r.x, r.y]; })()`);
if (at) await page.click(frame[0] + at[0], frame[1] + at[1]);
await sleep(600);
const tapped = await page.frameEval<any>(`({ title: (document.getElementById("tt") || {}).textContent || "", pressed: (document.querySelector('.obj[data-k="newsletter"]') || { getAttribute: () => "" }).getAttribute("aria-pressed"),
  boil: document.documentElement.dataset.boil || "", own: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') })`);
check("the preview runs the page under the policy: a tap on a drawing opens its panel, with what was typed",
  tapped.pressed === "true" && tapped.title === "Letters from my desk" && tapped.boil !== "" && tapped.own === true, tapped);
writeFileSync(join(out, "web-studio-preview.png"), await page.screenshot());
await clickOn('[data-ui="view-edit"]');
await sleep(700); // autosave waits a moment after the last change

// the work is kept in this browser, for this origin
await page.goto(`${origin}/studio`);
const reloaded = await studioLoaded();
const kept = await page.eval<any>(`(() => { const s = sceneStudio.store.getSnapshot(); return { scene: s.scene.id, license: s.scene.license, url: s.page.links.newsletter && s.page.links.newsletter.url, save: s.saveStatus }; })()`);
check("a reload brings the work back from this browser's storage", reloaded && kept.scene === "desk" && kept.license === "builtin" && kept.url === "example.com/letter", kept);
writeFileSync(join(out, "web-studio.png"), await page.screenshot());

check("the console stayed clean: no error, and nothing the policy had to refuse", errorsSince(0).length === 0, errorsSince(0).join(" | ").slice(0, 600));

// The policy is the layer behind the sanitisers: markup that reaches the studio's DOM must not
// be able to run script. Nothing above was refused; this injects a handler on purpose.
const probe = await page.eval<{ ran: boolean; blocked: string }>(`new Promise((done) => {
  let blocked = "";
  document.addEventListener("securitypolicyviolation", (e) => { blocked = e.violatedDirective; }, { once: true });
  const d = document.createElement("div");
  d.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" onload="window.__cspProbe=1" onerror="window.__cspProbe=1">';
  document.body.append(d);
  setTimeout(() => { d.remove(); done({ ran: !!window.__cspProbe, blocked }); }, 500);
})`);
check("markup injected into the studio cannot run script", probe.ran === false && probe.blocked.startsWith("script-src"), probe);
// The studio shows pages in frames made from markup (the preview, the picker's cards), and such
// a frame runs under this policy. A script in that markup runs only if the policy names it:
// here one frame's script carries the request's nonce and one carries none. The first shows
// that a script in such a frame can run and be heard, so the silence of the second means
// something.
const framed = await page.eval<{ named: boolean; unnamed: boolean }>(`new Promise((done) => {
  const heard = new Set();
  const listen = (e) => { if (typeof e.data === "string" && e.data.startsWith("csp-probe:")) heard.add(e.data); };
  addEventListener("message", listen);
  const nonce = (document.querySelector("script[nonce]") || {}).nonce || "";
  const frames = [["named", ' nonce="' + nonce + '"'], ["unnamed", ""]].map(([name, attr]) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");
    f.srcdoc = "<!DOCTYPE html><script" + attr + ">parent.postMessage('csp-probe:" + name + "', '*')</" + "script>";
    document.body.append(f);
    return f;
  });
  setTimeout(() => { removeEventListener("message", listen); frames.forEach((f) => f.remove()); done({ named: heard.has("csp-probe:named"), unnamed: heard.has("csp-probe:unnamed") }); }, 1000);
})`);
check("in a frame made from markup, a script the policy does not name does not run", framed.named === true && framed.unnamed === false, framed);
// A script that running code adds through the DOM gets nothing for that: its inline text does
// not run without the nonce, and a file on another host is refused before it is asked for. The
// single-file build's policy allows neither, and the app's own files load from this origin.
const added = await page.eval<{ inline: boolean; refused: string[] }>(`new Promise((done) => {
  const refused = [];
  const listen = (e) => { refused.push(e.blockedURI); };
  document.addEventListener("securitypolicyviolation", listen);
  const inline = document.createElement("script");
  inline.textContent = "window.__cspInline = 1";
  const away = document.createElement("script");
  away.src = "https://scripts.example/probe.js";
  document.body.append(inline, away);
  setTimeout(() => { document.removeEventListener("securitypolicyviolation", listen); inline.remove(); away.remove(); done({ inline: !!window.__cspInline, refused }); }, 500);
})`);
check("a script added through the DOM runs only from this origin: not inline, and not from another host",
  added.inline === false && added.refused.includes("inline") && added.refused.some((u) => u.startsWith("https://scripts.example")), added);

// The home page, fresh: it fills the window and does not scroll, on its own styles. The
// studio's stylesheet is global and stays loaded after a visit, so it is measured again then.
const HOME = `(() => { const m = document.querySelector("main"); if (!m) return null; const r = m.getBoundingClientRect(), s = getComputedStyle(m);
  return { box: [r.x, r.y, r.width, r.height].map(Math.round).join(" "), scrolls: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
    font: s.fontFamily, features: s.fontFeatureSettings, smoothing: s.webkitFontSmoothing, color: s.color, background: s.backgroundColor,
    inside: [...m.children].map((c) => { const b = c.getBoundingClientRect(); return Math.round(b.y) + ":" + Math.round(b.height); }).join(" ") }; })()`;
const homeFrom = page.logs.length;
await page.goto(`${origin}/`);
const homeFresh = await page.eval<any>(HOME);
check("the home page fills the window and does not scroll", !!homeFresh && homeFresh.box === "0 0 1440 900" && homeFresh.scrolls === false, homeFresh);

// from the home page, by its link: the studio arrives without a new document
await page.eval(`window.__sameDocument = true`);
await clickOn('a[href="/studio"]');
const arrived = await studioLoaded();
const after = await page.eval<any>(`({ path: location.pathname, same: window.__sameDocument === true, root: getComputedStyle(document.getElementById("root")).display,
  scene: sceneStudio.store.getSnapshot().scene.id, title: document.title })`);
check("the home page's link opens the studio in place, with the saved work",
  arrived && after.path === "/studio" && after.same === true && after.root === "contents" && after.scene === "desk" && after.title === "Scena Studio" && errorsSince(homeFrom).length === 0,
  { ...after, errors: errorsSince(homeFrom).join(" | ").slice(0, 300) });

// and back, still in the same document, with the studio's stylesheet now loaded
await page.eval(`history.back()`);
let homeAgain: any = null;
for (let i = 0; i < 50 && !homeAgain; i++) { await sleep(100); homeAgain = await page.eval<any>(HOME); }
await sleep(300);
homeAgain = await page.eval<any>(HOME);
const stillSame = await page.eval<boolean>(`window.__sameDocument === true && document.styleSheets.length > 1`);
check("the home page looks the same after a visit to the studio", stillSame && JSON.stringify(homeAgain) === JSON.stringify(homeFresh), { fresh: homeFresh, again: homeAgain });

// a phone
await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await page.goto(`${origin}/studio`);
const onPhone = await studioLoaded();
const phone = await page.eval<any>(`({ wide: document.documentElement.scrollWidth, more: !!document.querySelector('[data-ui="more"]'), rows: document.querySelectorAll("[data-link-row]").length })`);
check("at 375 px the studio fits the screen", onPhone && phone.wide <= 375 && phone.more === true, phone);
writeFileSync(join(out, "web-studio-375.png"), await page.screenshot());

await chrome.close();
stop();
console.log(failed() ? `\n${failed()} check(s) failed` : "\nall checks passed");
process.exit(failed() ? 1 : 0);
