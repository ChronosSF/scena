// A database of a test file's own, on the server DATABASE_URL names: made empty, and removed
// afterwards with the role the row-level security tests act as. The tests never read or leave
// anything in the database DATABASE_URL points at. A run that is cut short leaves its database
// and its role on the server; the next run removes them once they are an hour old.

import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { connect, disconnect, type Database } from "../src/client.ts";

export const DATABASE_URL = process.env.DATABASE_URL;

export interface TestDatabase {
  db: Database;
  /** A role that is not the tables' owner and logs in nowhere, for the row-level security tests. */
  role: string;
  drop(): Promise<void>;
}

const PREFIX = "scena_test_";
/** How long a test database may stand before another run takes it for one that was left behind. */
const LEFT_BEHIND_MS = 60 * 60 * 1000;

/**
 * Removes the databases and roles of runs that never removed their own: a run that was
 * interrupted, or a machine that went to sleep under one. A name carries the time it was made
 * (scena_test_<milliseconds>_<random>), and one older than an hour belongs to no run that is
 * still going. A younger one is left alone: it may be another run, next to this one.
 */
async function dropLeftBehind(admin: postgres.Sql): Promise<void> {
  const leftBehind = (name: string): boolean => {
    const made = Number(name.slice(PREFIX.length).split("_")[0]);
    return Number.isFinite(made) && made > 0 && Date.now() - made > LEFT_BEHIND_MS;
  };
  // Tidying up must not fail a run: another run may be removing the same ones at this moment.
  const quietly = (drop: PromiseLike<unknown>) => Promise.resolve(drop).then(() => {}, () => {});
  const databases = await admin<{ name: string }[]>`select datname as name from pg_database where starts_with(datname, ${PREFIX})`;
  for (const { name } of databases) if (leftBehind(name)) await quietly(admin`drop database if exists ${admin(name)} with (force)`);
  const roles = await admin<{ name: string }[]>`select rolname as name from pg_roles where starts_with(rolname, ${PREFIX})`;
  for (const { name } of roles) if (leftBehind(name)) await quietly(admin`drop role if exists ${admin(name)}`);
}

export async function createTestDatabase(): Promise<TestDatabase> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const admin = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  await dropLeftBehind(admin);
  // the time it is made goes in its name, which is how a later run knows one that was left behind
  const name = `${PREFIX}${Date.now()}_${randomBytes(4).toString("hex")}`, role = `${name}_outsider`;
  // names are written as identifiers by postgres.js (admin(name)), never pasted into the text
  await admin`create database ${admin(name)}`;
  await admin`create role ${admin(role)} nologin`;
  const url = new URL(DATABASE_URL);
  url.pathname = `/${name}`;
  const db = connect(url.toString(), { max: 4 });
  return {
    db,
    role,
    async drop() {
      await disconnect(db);
      await admin`drop database if exists ${admin(name)} with (force)`;
      await admin`drop role if exists ${admin(role)}`;
      await admin.end();
    },
  };
}
