// The database, for the profile a sign-in makes and the pages that read it. Server code only,
// and not proxy.ts, which runs in front of every request and needs no database.

import "server-only";
import { connect, createUser, getUser, type Database } from "@scena/db";
import type { ProfileQueries } from "./profile.ts";

let db: Database | undefined;

/**
 * One small pool per server process, opened when it is first needed. Sign-in is set up only
 * with DATABASE_URL (config.ts), so it is there whenever this is called.
 */
export function database(): Database {
  db ??= connect(process.env.DATABASE_URL, { max: 5 });
  return db;
}

/** The two queries a sign-in needs, on this server's database. */
export const profileQueries = (): ProfileQueries => {
  const on = database();
  return { getUser: (id) => getUser(on, id), createUser: (input) => createUser(on, input) };
};
