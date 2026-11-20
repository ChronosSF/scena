// The connection: postgres.js under Drizzle. The address comes from DATABASE_URL in the
// environment, never from the code, so no password is written into a source file.

import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

/** A connection pool. Pass it to the queries; close it with disconnect(). */
export type Database = PostgresJsDatabase & { $client: postgres.Sql };

export interface ConnectOptions {
  /** Connections in the pool. 10 by default. */
  max?: number;
  /**
   * Prepared statements, on by default. A pooler in transaction mode, such as Supabase's on
   * port 6543, hands each transaction to any connection, and needs them off.
   */
  prepare?: boolean;
}

export function connect(url: string | undefined = process.env.DATABASE_URL, options: ConnectOptions = {}): Database {
  if (!url) throw new Error("DATABASE_URL is not set. For the local database, run `docker compose up -d --wait` and set DATABASE_URL to the address in .env.example.");
  const client = postgres(url, {
    max: options.max ?? 10,
    prepare: options.prepare ?? true,
    // Postgres's notices ("already exists, skipping") are for a person at a console, not a log.
    onnotice: () => {},
  });
  return drizzle({ client });
}

/** Closes the pool once its queries are done. */
export async function disconnect(db: Database): Promise<void> {
  await db.$client.end();
}
