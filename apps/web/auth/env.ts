// The sign-in configuration, as this server process has it. Server code only: proxy.ts, pages,
// route handlers and server actions. Nothing a browser loads may import this file, or anything
// that does (test/boundary.test.ts holds the app to that).

import { readAuthConfig, type AuthConfig } from "./config.ts";

let config: AuthConfig | null | undefined;

/** Sign-in as the environment sets it up, or null when it is not set up. Throws on a wrong configuration. */
export function authConfig(): AuthConfig | null {
  if (config === undefined) config = readAuthConfig(process.env);
  return config;
}
