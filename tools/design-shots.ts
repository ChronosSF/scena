// Screenshots of the studio for docs/design/: desktop light and dark, and a phone.
//   node tools/design-shots.ts                       the static build from file:// (run pnpm build first)
//   node tools/design-shots.ts http://localhost:5173/   the dev server
// Pia's desk is opened and the envelope selected, so the inspector, the selection handles
// and the layer list all show.

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { launch, sleep } from "./cdp.ts";

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
await page.eval(`document.querySelector(".workspace-scroll").scrollTop = 150`);
await shot("studio-375.png");

await chrome.close();
