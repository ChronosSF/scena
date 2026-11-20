// Brings a database up to date: applies the migrations that it has not had yet, in order, then
// writes the public reserved list into handles_reserved. Both steps are safe to repeat: an
// applied migration is skipped, and a word already in the table is left as it is.

import { fileURLToPath } from "node:url";
import { migrate as applyMigrations } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./client.ts";
import { RESERVED_HANDLES } from "./reserved.ts";
import { handlesReserved } from "./schema.ts";

/** The checked-in migrations, written by drizzle-kit from schema.ts. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export async function migrate(db: Database): Promise<void> {
  // Drizzle records what it applied in drizzle.__drizzle_migrations, outside the public schema.
  await applyMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await db.insert(handlesReserved).values(RESERVED_HANDLES.map((handle) => ({ handle }))).onConflictDoNothing();
}
