// pnpm db:migrate: brings the database at DATABASE_URL up to date: the migrations it has not
// had yet, then the public reserved handles (src/migrate.ts). Safe to run again.
import { connect, disconnect } from "../src/client.ts";
import { migrate } from "../src/migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:migrate: DATABASE_URL is not set. For the local database, run `docker compose up -d --wait` and set DATABASE_URL to the address in .env.example.");
  process.exit(1);
}

const db = connect(url, { max: 1 });
try {
  await migrate(db);
  // the host and the database, never the rest of the address, which holds the password
  const where = new URL(url);
  console.log(`db:migrate: ${where.host}${where.pathname} is up to date`);
} catch (e) {
  console.error(`db:migrate: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await disconnect(db);
}
