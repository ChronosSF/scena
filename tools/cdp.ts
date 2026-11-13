// Minimal Chrome DevTools Protocol client: launches headless Chrome or Edge and talks
// to it with Node's built-in WebSocket. Used by the verify-* and measure tools.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/** A test drawing in fixtures/, by file name. */
export const fixture = (f: string) => join(repoRoot, "fixtures", f);

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter((p): p is string => !!p);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = any;
interface Message { id?: number; method?: string; params?: Json; result?: Json; error?: { message: string }; sessionId?: string }

export interface Page {
  send: (method: string, params?: Json) => Promise<Json>;
  goto: (url: string, waitMs?: number) => Promise<void>;
  eval: <T = Json>(expression: string, contextId?: number) => Promise<T>;
  /**
   * Call a function in the page. `fn` is the source of a function; `args` reach it as values,
   * through the protocol. Use this, not eval, whenever the page needs data from the tool: data
   * written into an expression becomes code, and has to be escaped to stay data.
   */
  call: <T = Json>(fn: string, ...args: Json[]) => Promise<T>;
  /** The same, in a child frame chosen as for frameEval (undefined: the most recently attached). */
  frameCall: <T = Json>(index: number | undefined, fn: string, ...args: Json[]) => Promise<T>;
  screenshot: () => Promise<Buffer>;
  /**
   * Evaluate in a child frame (out-of-process iframes, such as sandboxed srcdoc frames): the
   * most recently attached one, or the one at `index`, counting the frames still attached in
   * the order they appeared.
   */
  frameEval: <T = Json>(expression: string, index?: number) => Promise<T>;
  /** Send a command to a child frame, chosen as for frameEval (emulation does not reach out-of-process frames). */
  frameSend: (method: string, params?: Json, index?: number) => Promise<Json>;
  /** How many child frames are attached now. A frame that has gone (a closed dialog, a view left) is not counted. */
  frameCount: () => number;
  click: (x: number, y: number) => Promise<void>;
  drag: (from: [number, number], to: [number, number], steps?: number) => Promise<void>;
  key: (key: string, code?: string) => Promise<void>;
  /** Put files into a file input, as the file chooser would. */
  setFiles: (selector: string, files: string[]) => Promise<void>;
  logs: string[];
  close: () => Promise<void>;
}

export interface Browser {
  newPage: () => Promise<Page>;
  trace: <T>(fn: () => Promise<T>, categories: string[]) => Promise<{ result: T; events: Json[] }>;
  close: () => Promise<void>;
}

/** How long Chrome gets to open its debugging port. A first start on a CI runner can take several seconds. */
const START_MS = 30_000;

/** Why Chrome did not start, with the last lines it wrote: without them a failure says nothing about its cause. */
function startFailure(exe: string, port: number, what: string, said: string): string {
  const lines = said.split("\n").map((l) => l.trim()).filter(Boolean).slice(-12);
  return [
    `Chrome did not open its debugging port (${port}): it ${what}.`,
    `  ${exe}`,
    ...(lines.length ? ["  Chrome said:", ...lines.map((l) => `    ${l}`)] : ["  Chrome said nothing."]),
  ].join("\n");
}

export async function launch({ port = 9333, headed = false, gpu = true, fileAccess = true } = {}): Promise<Browser> {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("No Chrome or Edge found; set CHROME_PATH.");
  const profile = mkdtempSync(join(tmpdir(), "scena-cdp-"));
  const flags = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"];
  if (fileAccess) flags.push("--allow-file-access-from-files");
  flags.push(headed ? "--window-position=-2400,0" : "--headless=new");
  if (headed) flags.push("--window-size=420,900");
  if (!gpu) flags.push("--disable-gpu", "--disable-gpu-rasterization", "--disable-gpu-compositing");
  const failed = (what: string, said = "") => {
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold the lock briefly */ }
    return new Error(startFailure(exe, port, what, said));
  };
  // Chrome's own messages are kept: when it does not start, they are the only account of why.
  // They are read to the end of its life, so it never waits on a full pipe.
  const proc = (() => {
    try { return spawn(exe, [...flags, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] }); }
    catch (e) { throw failed(`could not be started (${(e as Error).message})`); }
  })();
  let said = "", ended = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (text: string) => { said = (said + text).slice(-6000); });
  proc.on("error", (e) => { ended = `could not be started (${e.message})`; });
  // "close", not "exit": it comes once Chrome's last words have been read as well
  proc.on("close", (code, signal) => { ended = signal ? `was stopped by ${signal}` : `exited with code ${code}`; });
  // Chrome prints the address of its debugging server once it is up, and that is the address to
  // use: it may not be 127.0.0.1 (when that port is taken, Chrome listens on the IPv6 loopback
  // alone). The port is asked as well, for a build that prints nothing. Waiting stops as soon
  // as Chrome has gone.
  const asked = async (): Promise<string> => {
    // a second at most: whatever holds the port may accept the question and never answer it
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).json()).webSocketDebuggerUrl || ""; } catch { return ""; }
  };
  let address = "";
  const started = Date.now();
  while (!address && !ended && Date.now() - started < START_MS) {
    // the space after it shows the address has arrived whole: a pipe may deliver a line in pieces
    address = /DevTools listening on (ws:\/\/\S+)\s/.exec(said)?.[1] || (await asked());
    if (!address) await sleep(100);
  }
  if (!address) {
    proc.kill();
    throw failed(ended || `was still running after ${START_MS / 1000} s`, said);
  }
  // On CI the log says how long the start took, and where Chrome is when that is not
  // 127.0.0.1. The first start on a runner takes seconds, and how many changes with the
  // runner image: a failure to start is read against these lines.
  if (process.env.CI) {
    const usual = address.startsWith(`ws://127.0.0.1:${port}/`);
    console.log(`NOTE  Chrome started in ${((Date.now() - started) / 1000).toFixed(1)} s${usual ? "" : `, at ${address}`}`);
  }
  const ws = new WebSocket(address);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  const listeners: ((m: Message) => void)[] = [];
  ws.onmessage = (ev) => {
    const msg: Message = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    } else if (msg.method) listeners.forEach((fn) => fn(msg));
  };
  const send = (method: string, params: Json = {}, sessionId?: string) => new Promise<Json>((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  async function newPage(): Promise<Page> {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m: string, p?: Json) => send(m, p, sessionId);
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Log.enable");
    // sandboxed and cross-origin iframes run out of process: attach to them as they appear
    const frames: string[] = [];
    listeners.push((msg) => {
      if (msg.method === "Target.attachedToTarget" && msg.sessionId === sessionId && msg.params.targetInfo.type === "iframe") {
        frames.push(msg.params.sessionId);
        void send("Runtime.enable", {}, msg.params.sessionId);
        void send("Runtime.runIfWaitingForDebugger", {}, msg.params.sessionId);
      }
      if (msg.method === "Target.detachedFromTarget" && msg.sessionId === sessionId) {
        const at = frames.indexOf(msg.params.sessionId);
        if (at >= 0) frames.splice(at, 1);
      }
    });
    const frame = (index = -1): string => {
      const fs = frames.at(index);
      if (!fs) throw new Error(index === -1 ? "No child frame is attached." : `No child frame at ${index}: ${frames.length} attached.`);
      return fs;
    };
    await s("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    const logs: string[] = [];
    listeners.push((msg) => {
      if (msg.sessionId !== sessionId && !frames.includes(msg.sessionId || "")) return;
      if (msg.method === "Runtime.consoleAPICalled") logs.push(`console.${msg.params.type}: ${msg.params.args.map((a: Json) => a.value ?? a.description).join(" ")}`);
      if (msg.method === "Runtime.exceptionThrown") logs.push(`exception: ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
      if (msg.method === "Log.entryAdded") logs.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
    });
    const mouse = (type: string, x: number, y: number, extra: Json = {}) => s("Input.dispatchMouseEvent", { type, x, y, button: "left", pointerType: "mouse", ...extra });
    // A function called on the page's global object, its arguments sent as values beside it.
    const callIn = async (session: string, fn: string, args: Json[]) => {
      const global = await send("Runtime.evaluate", { expression: "globalThis" }, session);
      const objectId = global.result.objectId;
      try {
        const r = await send("Runtime.callFunctionOn", { functionDeclaration: fn, objectId, arguments: args.map((value) => ({ value })), awaitPromise: true, returnByValue: true }, session);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      } finally {
        void send("Runtime.releaseObject", { objectId }, session).catch(() => {}); // the page may have gone
      }
    };
    return {
      send: s,
      logs,
      async goto(url, waitMs = 800) {
        const loaded = new Promise<void>((res) => {
          const fn = (msg: Message) => {
            if (msg.sessionId === sessionId && msg.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(fn), 1); res(); }
          };
          listeners.push(fn);
        });
        await s("Page.navigate", { url });
        await loaded;
        await sleep(waitMs);
      },
      async eval(expression, contextId) {
        const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      call: (fn, ...args) => callIn(sessionId, fn, args),
      frameCall: (index, fn, ...args) => callIn(frame(index), fn, args),
      async frameEval(expression, index) {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, frame(index));
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      frameSend: (method, params = {}, index) => send(method, params, frame(index)),
      frameCount: () => frames.length,
      async click(x, y) {
        await mouse("mouseMoved", x, y);
        await mouse("mousePressed", x, y, { clickCount: 1, buttons: 1 });
        await mouse("mouseReleased", x, y, { clickCount: 1 });
      },
      async drag(from, to, steps = 8) {
        await mouse("mouseMoved", from[0], from[1]);
        await mouse("mousePressed", from[0], from[1], { clickCount: 1, buttons: 1 });
        for (let i = 1; i <= steps; i++) {
          await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, { buttons: 1 });
        }
        await mouse("mouseReleased", to[0], to[1], { clickCount: 1 });
      },
      async key(key, code) {
        await s("Input.dispatchKeyEvent", { type: "keyDown", key, code: code || key });
        await s("Input.dispatchKeyEvent", { type: "keyUp", key, code: code || key });
      },
      async setFiles(selector, files) {
        await s("DOM.enable");
        const { root: doc } = await s("DOM.getDocument", { depth: 0 });
        const { nodeId } = await s("DOM.querySelector", { nodeId: doc.nodeId, selector });
        if (!nodeId) throw new Error(`Nothing matches ${selector}`);
        await s("DOM.setFileInputFiles", { nodeId, files });
      },
      async screenshot() { return Buffer.from((await s("Page.captureScreenshot", { format: "png" })).data, "base64"); },
      close: () => send("Target.closeTarget", { targetId }),
    };
  }

  async function trace<T>(fn: () => Promise<T>, categories: string[]) {
    const events: Json[] = [];
    const done = new Promise<void>((res) => {
      const fnL = (msg: Message) => {
        if (msg.method === "Tracing.dataCollected") events.push(...msg.params.value);
        if (msg.method === "Tracing.tracingComplete") { listeners.splice(listeners.indexOf(fnL), 1); res(); }
      };
      listeners.push(fnL);
    });
    await send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: categories } });
    const result = await fn();
    await send("Tracing.end");
    await done;
    return { result, events };
  }

  async function close() {
    try { await send("Browser.close"); } catch { /* already gone */ }
    ws.close();
    await sleep(300);
    proc.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold the lock briefly */ }
  }
  return { newPage, trace, close };
}
