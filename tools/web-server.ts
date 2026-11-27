// The web app's production build (apps/web), served by `next start` for a tool that drives it
// in headless Chrome: tools/verify-web.ts, and the sign-in pictures of tools/design-shots.ts.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, sleep } from "./cdp.ts";

const web = join(repoRoot, "apps", "web");

export interface WebServer {
  origin: string;
  stop: () => void;
}

/** Whether the app answers at `origin`. */
export async function answers(origin: string): Promise<boolean> {
  try { return (await fetch(`${origin}/`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

/**
 * Starts the build on `port`, with `env` over the shell's environment, and waits until it
 * answers. Throws, with the server's last words, when there is no build or it does not come up
 * within 30 s. The server stops when this process exits, or by `stop`.
 */
export async function serveWeb(port: number, env: Record<string, string>): Promise<WebServer> {
  const origin = `http://localhost:${port}`;
  if (!existsSync(join(web, ".next", "BUILD_ID"))) throw new Error("apps/web is not built: run pnpm build:web first.");
  // node runs Next.js's own entry, with no shell in between, so stopping this process stops the server
  const server = spawn(process.execPath, [join(web, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(port)],
    { cwd: web, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let said = "", ended = "";
  for (const stream of [server.stdout!, server.stderr!]) {
    stream.setEncoding("utf8");
    stream.on("data", (text: string) => { said = (said + text).slice(-4000); });
  }
  server.on("error", (e) => { ended = `could not be started (${e.message})`; });
  server.on("close", (code, signal) => { ended = signal ? `was stopped by ${signal}` : `exited with code ${code}`; });
  const stop = () => { if (!ended) server.kill(); };
  process.on("exit", stop);

  // The server says "Ready" once it is listening, and only then is an answer on the port its
  // answer. If the port is taken, whatever holds it answers at once, with some other build,
  // while this server is still on its way to failing: its own word is what ties the caller to
  // this build.
  const itSaysReady = () => /\bReady\b/.test(said);
  const started = Date.now();
  let up = false;
  while (!up && !ended && Date.now() - started < 30_000) {
    up = itSaysReady() && (await answers(origin));
    if (!up) await sleep(200);
  }
  if (!up || ended) {
    stop();
    const lines = said.split("\n").map((l) => l.trim()).filter(Boolean).slice(-12);
    const why = ended ? `its server ${ended}` : `its server ${itSaysReady() ? "said it was ready and did not answer" : "had not said it was ready"} after 30 s`;
    throw new Error([`The web app is not being served at ${origin}: ${why}.`, ...(lines.length ? ["  It said:", ...lines.map((l) => `    ${l}`)] : [])].join("\n"));
  }
  return { origin, stop };
}
