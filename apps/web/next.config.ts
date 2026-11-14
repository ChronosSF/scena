import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const config: NextConfig = {
  // The workspace packages have no build step: their exports point at TypeScript source
  // (docs/adr/0001-tech-stack.md), so this app compiles them along with its own code.
  transpilePackages: ["@scena/scene", "@scena/renderer", "@scena/scenes", "@scena/studio"],
  // The workspace root, where the lockfile and the packages are.
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
};

export default config;
