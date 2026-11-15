// The checked-in migrations say what the schema says (scripts/drift.ts). Needs no database:
// drizzle-kit compares src/schema.ts with the snapshots in migrations/meta.
import { expect, test } from "vitest";
import { migrationDrift } from "../scripts/drift.ts";

test("the migrations match the schema", () => {
  const drift = migrationDrift();
  expect(drift.ok ? "" : drift.problem).toBe("");
}, 120_000);
