// Screenshots for docs/design/: the studio on a desktop, light and dark, and on a phone, and the
// sign-in page, the web app's own pages' design.
//   node tools/design-shots.ts                       the static build from file:// (run pnpm build first)
//   node tools/design-shots.ts http://localhost:5173/   the dev server
// Pia's desk is opened with a paper texture under it and her lettered name in the header
// (fixtures/), and the envelope selected, so the inspector, the selection handles, the
// layer list and its Background group all show. The last shot of the studio is the scene
// picker, opened over that, with the scenes that ship.
// The sign-in page comes from the web app's build (pnpm build:web), served for this run with
// the local stack's sign-in (pnpm stack:start); without either, those shots are skipped. It is
// shown at the email step in light, at the code step with its news in dark, and on a phone with
// a code that is not the right shape. Then the address picker over the studio, signed in, with an
// address someone else has, and the inspector's address row once the page has one.

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fixture, launch, sleep } from "./cdp.ts";
import { input, settled } from "./checks.ts";
import { accountPeople } from "./autosave-checks.ts";
import { appEnv, stackStatus } from "./stack.ts";
import { serveWeb } from "./web-server.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "design");
const target = process.argv[2] || pathToFileURL(join(root, "apps/studio/dist/index.html")).href;

const chrome = await launch({ port: 9343, fileAccess: false });
const page = await chrome.newPage();
const media = (scheme: "light" | "dark") => page.send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: scheme }],
});
await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await media("light");

await page.goto(target, 1200);
await page.eval(`localStorage.clear()`);
await page.goto(target, 1500);
await page.eval(`document.querySelector('[data-ui="open-desk"]').click()`);
await sleep(400);
await page.setFiles("#background-file", [fixture("paper-texture.png")]);
await sleep(1500);
await page.eval(`sceneStudio.store.select(null)`);
await sleep(300);
await page.setFiles("#lettering-file", [fixture("pia-lettering.svg")]);
await sleep(1200);
await page.eval(`document.querySelector('[data-layer-button="envelope"]').click()`);
await page.eval(`document.activeElement?.blur()`);
await sleep(3800); // fonts, thumbnails, and the toast has gone
await page.eval(`document.fonts.ready`);

const shot = async (name: string) => {
  await sleep(300);
  writeFileSync(join(out, name), await page.screenshot());
  console.log(`wrote docs/design/${name}`);
};
await shot("studio-light.png");
await media("dark");
await shot("studio-dark.png");
await media("light");
await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await sleep(400);
await page.eval(`document.querySelector(".workspace-scroll").scrollTop = 0`); // the lettered name, then the desk
await shot("studio-375.png");

await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await page.eval(`sceneStudio.openPicker()`);
await sleep(2500); // the cards' pages load their typeface, then paint
await shot("studio-picker.png");

// ── the sign-in page ──────────────────────────────────────────────────────────────────────
const found = stackStatus();
const PORT = 3193;
const server = "stack" in found
  ? await serveWeb(PORT, { ...appEnv(found.stack, `http://localhost:${PORT}`), SCENA_GOOGLE_SIGN_IN: "off" }).catch((e: Error) => { console.log(`skipped the sign-in shots: ${e.message}`); return null; })
  : (console.log(`skipped the sign-in shots: ${found.why}`), null);
if (server) {
  const { pressEnter, typeInto } = input(page);
  const said = () => page.eval<string>(`(document.querySelector('[data-ui="message"]') || {}).textContent || ""`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${server.origin}/sign-in?next=%2Fstudio`, 1200);
  await page.eval(`document.fonts.ready`);
  await shot("app-sign-in-light.png");
  // the code step, as it arrives: the news in its block. The stack sends one email to an
  // address every few seconds, so a run straight after another waits for the next one.
  await typeInto("#email", "pia@example.com");
  for (let tries = 0; tries < 3 && !(await page.eval<boolean>(`!!document.getElementById("code")`)); tries++) {
    if (tries) await sleep(5500);
    await pressEnter();
    await settled(() => page.eval<boolean>(`!!document.getElementById("code") || !!(document.querySelector('[data-ui="message"]') || {}).textContent`), (ok) => ok, 10_000);
  }
  if (await page.eval<boolean>(`!!document.getElementById("code")`)) {
    await page.eval(`document.activeElement?.blur()`);
    await media("dark");
    await shot("app-sign-in-dark.png");
    // a code that is not one, which the page refuses before it asks anyone: said under the field
    await media("light");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await typeInto("#code", "4182");
    await pressEnter();
    await settled(said, (t) => t.startsWith("The code is"), 10_000);
    await page.eval(`document.activeElement?.blur()`);
    await shot("app-sign-in-375.png");
  } else {
    console.log(`skipped the code step's shots: the page said "${await said()}"`);
  }

  // ── the address picker, and the inspector's address row ─────────────────────────────────
  // Pia signs in from the studio on the desk, and the picker opens by itself; an address someone
  // else has shows the line and the free ones near it. The accounts this script made on an
  // earlier run are removed first, so that it shows the same addresses each time.
  if ("stack" in found) {
    const h = accountPeople({ chrome, origin: server.origin, stack: found.stack });
    try {
      await h.sql`delete from users where email like 'shots-%@example.com'`;
      const pia = await h.person();
      await pia.page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await pia.page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: "light" }] });
      await pia.page.goto(`${server.origin}/studio`);
      await h.studioReady(pia);
      await h.chooseDesk(pia);
      await pia.keys.typeInto('#inspector [name="display-name"]', "Pia Morandi");
      await h.signIn(pia, "shots-pia@example.com", false, true);
      // someone else's page at "pia", as another person would have made it
      await settled(() => h.pageOf("shots-pia@example.com"), (row) => !!row, 10_000);
      const [someone] = await h.sql<{ id: string }[]>`insert into users (id, email) values (gen_random_uuid(), 'shots-someone@example.com') returning id`;
      await h.sql`insert into pages (user_id, handle, draft) select ${someone!.id}, 'pia', draft from pages p join users u on u.id = p.user_id where u.email = 'shots-pia@example.com'`;
      const field = 'dialog[open] [data-ui="address-dialog"] input[name="address"]';
      await settled(() => pia.page.eval<string>(`(document.querySelector('[data-ui="address-line"]') || {}).dataset?.line || ""`), (l) => l === "free", 10_000);
      await pia.keys.typeInto(field, "pia");
      await settled(() => pia.page.eval<number>(`document.querySelectorAll('[data-ui="address-free"] .btn').length`), (n) => n > 0, 10_000);
      await sleep(400); // the border's and the icon's colours, past their transition
      writeFileSync(join(out, "studio-address.png"), await pia.page.screenshot());
      console.log("wrote docs/design/studio-address.png");
      await pia.keys.typeInto(field, "pia-morandi");
      await settled(() => pia.page.eval<string>(`(document.querySelector('[data-ui="address-line"]') || {}).dataset?.line || ""`), (l) => l === "free", 10_000);
      await pia.keys.clickOn('[data-ui="address-take"]');
      await settled(() => pia.page.eval<string>(`(document.querySelector('[data-ui="address-row"] .addr-value') || {}).textContent || ""`), (t) => t === "scena.example/pia-morandi", 10_000);
      await pia.page.eval(`document.activeElement?.blur()`);
      await sleep(3800); // the toast has gone
      // the inspector's Profile section, where the row is
      const box = await pia.page.eval<{ x: number; y: number; width: number; height: number }>(`(() => { const r = document.querySelector('[data-ui="address-row"]').closest(".section").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
      const { data } = await pia.page.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
      writeFileSync(join(out, "studio-address-row.png"), Buffer.from(data, "base64"));
      console.log("wrote docs/design/studio-address-row.png");
    } finally {
      await h.done();
    }
  }
  server.stop();
}

await chrome.close();
