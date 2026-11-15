// A database of a test file's own, on the server DATABASE_URL names: made empty, and removed
// afterwards with the role the row-level security tests act as. The tests never read or leave
// anything in the database DATABASE_URL points at.

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

export async function createTestDatabase(): Promise<TestDatabase> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const id = randomBytes(6).toString("hex");
  const name = `scena_test_${id}`, role = `scena_test_${id}_outsider`;
  const admin = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
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
