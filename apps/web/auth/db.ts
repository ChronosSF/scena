// The database, for the profile a sign-in makes and the pages that read it. Server code only,
// and not proxy.ts, which runs in front of every request and needs no database.

import "server-only";
import { connect, createUser, getUser, type Database } from "@scena/db";
import type { ProfileQueries } from "./profile.ts";

// Kept on globalThis and not in a variable of this module: the dev server loads the module
// again whenever server code changes, and each copy would open a pool and leave the last open.
const held = globalThis as typeof globalThis & { scenaDatabase?: Database };

/**
 * One small pool per server process, opened when it is first needed. Sign-in is set up only
 * with DATABASE_URL (config.ts), so it is there whenever this is called.
 */
export function database(): Database {
  held.scenaDatabase ??= connect(process.env.DATABASE_URL, { max: 5 });
  return held.scenaDatabase;
}

/** The two queries a sign-in needs, on this server's database. */
export const profileQueries = (): ProfileQueries => {
  const on = database();
  return { getUser: (id) => getUser(on, id), createUser: (input) => createUser(on, input) };
};
