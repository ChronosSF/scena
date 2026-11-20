// drizzle-kit writes the migrations from the schema (`pnpm db:generate`). It is given no
// database: the migrations are applied by scripts/migrate.ts, which also seeds the reserved
// handles, and drizzle-kit's push, which changes a database without a migration, is not used.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  strict: true,
});
