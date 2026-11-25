-- The one thing the local stack's database needs before the app's own migrations
-- (packages/db, `pnpm db:migrate`): citext, in the "extensions" schema, as on a hosted project
-- (docs/adr/0005-database-package.md, "For a Supabase account"). Without this, the app's first
-- migration creates it in "public", where Supabase's advisor flags it. The CLI applies this
-- file when it creates the stack's database; the app's migrations then find citext there and
-- leave it alone. Nothing else of the schema is written here: packages/db owns it.
create extension if not exists citext with schema extensions;
