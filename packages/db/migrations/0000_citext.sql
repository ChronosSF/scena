-- Written by hand (drizzle-kit generate --custom): drizzle-kit does not write extensions.
-- citext is text compared without regard to case. Emails and handles use it, so their
-- uniqueness ignores case. It ships with Postgres and with Supabase. On Supabase, where
-- extensions go in the "extensions" schema, enable it there first; this then leaves it alone.
CREATE EXTENSION IF NOT EXISTS citext;
