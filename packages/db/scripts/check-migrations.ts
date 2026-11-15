// pnpm db:check: fails when src/schema.ts and the checked-in migrations disagree. Needs no database.
import { migrationDrift } from "./drift.ts";

const drift = migrationDrift();
if (drift.ok) {
  console.log("db:check: the migrations match the schema");
} else {
  console.error(`db:check: ${drift.problem}`);
  process.exitCode = 1;
}
