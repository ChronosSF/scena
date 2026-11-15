# 0005. The database package: Drizzle over postgres.js, migrations from the schema, drafts checked by the scene package

- **Status:** Proposed. It takes effect when the change that adds `packages/db` is merged.
- **Date:** 15 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer
- **Scope:** the first part of [issue 11](https://github.com/ChronosSF/scena/issues/11): the
  package `@scena/db`, the schema for users, pages, reserved handles and the audit log, its
  migrations, the typed queries the next issues need, validation on write, the handle rule, the
  local database and CI. The API route that the issue's second "done when" names is not part of
  it: it waits for sign-in (below). Nor are a Supabase project, row-level security policies, the
  later tables, a list of offensive terms, or the handle's redirect and release rules (issue 17).

## Context

[The plan](../development-plan.md) (§4.3) puts Postgres and auth on Supabase, with Drizzle for
the schema and migrations "so the database is plain Postgres and portable", and §5 lists the
tables. [ADR 0001](0001-tech-stack.md) deferred Supabase until a feature needed it, and kept the
hand-written validators instead of zod until there was a server boundary. [ADR 0004](0004-one-studio-two-apps.md)
gave that question to this issue. Sign-in, server autosave, try-before-sign-up and the handle
picker (issues 10, 15, 16, 17) all stand on this package.

What has to stay true:

1. Internal packages have no build step: `exports` point at TypeScript source, relative imports
   carry `.ts`, the syntax is erasable.
2. The format is defined once, in `@scena/scene`. A stored document is what the renderer reads.
3. No account exists for any hosted service, and none is created here.
4. No password or key is written into code, tests or scripts.
5. `pnpm check` works on a machine without a database.

## Decision 1: Drizzle ORM over postgres.js

| Package | Version | Published | Role |
|---|---|---|---|
| `drizzle-orm` | 0.45.4 | 8 October 2026 | schema and queries; a dependency of `@scena/db` |
| `postgres` (postgres.js) | 3.4.9 | 5 April 2026 | the driver; a dependency |
| `drizzle-kit` | 0.31.11 | 21 September 2026 | writes migrations from the schema; a development dependency |

All three are pinned exactly. Each is the newest stable release that had been public for a week,
the rule `.github/dependabot.yml` sets, with one exception: postgres.js. Its 4.x line is a
rewrite of everything below the API, first published on 29 October 2026, and the same file waits
a month before it proposes a new major. drizzle-orm 0.45.4 was released three weeks before
postgres.js 4 existed, so it was never tested against it. The 1.0 releases of drizzle-orm and
drizzle-kit are still release candidates. Move to postgres.js 4 when Dependabot proposes it.

**Why postgres.js and not `pg`.** It has no dependencies of its own, ships its own types (`pg`
needs `@types/pg` as well), and is the driver the Drizzle and Supabase guides pair with Drizzle.
Behind Supabase's pooler in transaction mode it needs prepared statements off, which
`connect(url, { prepare: false })` does.

**No build step was needed.** Node 24 runs the scripts as they are. drizzle-kit reads
`src/schema.ts` through its own loader, `.ts` imports included. Nothing was added to
`onlyBuiltDependencies`: the esbuild that drizzle-kit brings runs its install check under the
existing `esbuild` entry.

**What drizzle-kit brings.** tsx, esbuild 0.25.12, and `@esbuild-kit/esm-loader`, which is
deprecated and asks for esbuild 0.18.20. That release has a moderate advisory against it
([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), esbuild's development
server answering other origins). drizzle-kit does not start that server, but the copy would sit
in the lockfile with an open advisory. So `pnpm-workspace.yaml` has one override: the loader gets
the esbuild 0.25.12 that drizzle-kit itself uses. drizzle-kit works with it (`pnpm db:check` runs
it through that loader), 0.18.20 is not installed, and `pnpm audit` reports nothing. The
override goes when drizzle-kit no longer brings the loader. With tsx in the workspace, the
lockfile also records it as vite's optional peer; vite uses it only to load a PostCSS
configuration written in TypeScript, and this repository has none.

## Decision 2: migrations are written from the schema and checked in

```
edit src/schema.ts → pnpm db:generate → read the SQL it wrote → check it in → pnpm db:migrate
```

- **`pnpm db:generate`** is `drizzle-kit generate`. Its configuration names no database, so
  drizzle-kit's `push`, which changes a database without a migration, cannot be used by mistake.
- **`pnpm db:migrate`** applies, in order, the migrations the database at `DATABASE_URL` has not
  had, with Drizzle's migrator, which records them in `drizzle.__drizzle_migrations`, outside the
  public schema. Then it writes the public reserved handles (Decision 6). Running it again changes
  nothing; a test applies everything twice and compares the catalogue before and after.
- **`pnpm db:check`** fails when the schema and the migrations disagree. drizzle-kit is asked to
  write a migration from the schema into a scratch copy of `migrations/`: if it writes anything,
  the check fails and prints the SQL that is missing. Then `drizzle-kit check` reads the real
  folder; its exit status is the answer, not the wording of what it prints. It needs no
  database. `pnpm check` runs it once, before the tests. It is not a Vitest test: it starts
  drizzle-kit twice, and a plain `pnpm test` should not pay for that.
- **`0000_citext.sql` is the one migration written by hand** (`drizzle-kit generate --custom`),
  because drizzle-kit does not write extensions: `CREATE EXTENSION IF NOT EXISTS citext`.
  `0001_tables.sql` and `0002_handle_rule.sql` are generated.

## Decision 3: the schema

| Table | Column | Type | Constraints |
|---|---|---|---|
| `users` | `id` | uuid | primary key, no default |
| | `email` | citext | not null; unique among accounts not deleted (`users_email_live`) |
| | `display_name` | text | cut to the page format's limit when the profile is made |
| | `locale` | text | not null, default `'en'` |
| | `created_at` | timestamptz | not null, default `now()` |
| | `deleted_at` | timestamptz | |
| `pages` | `id` | uuid | primary key, default `gen_random_uuid()` |
| | `user_id` | uuid | not null, unique (`pages_user_id_unique`), references `users` on delete cascade |
| | `handle` | citext | not null, unique (`pages_handle_unique`); the handle rule as a check (`pages_handle_rule`) |
| | `previous_handle` | citext | |
| | `handle_changed_at` | timestamptz | |
| | `draft` | jsonb | not null; a PageDocument the validators passed |
| | `status` | enum `page_status` | not null, default `'draft'`; `draft`, `published`, `unpublished` |
| | `created_at`, `updated_at` | timestamptz | not null, default `now()` |
| `handles_reserved` | `handle` | citext | primary key |
| `audit_log` | `id` | bigint | primary key, generated always as identity |
| | `user_id` | uuid | references `users` on delete set null; indexed |
| | `action`, `target` | text | not null |
| | `meta` | jsonb | not null, default `'{}'` |
| | `created_at` | timestamptz | not null, default `now()` |

The details the plan leaves open:

- **Ids.** `users.id` is the auth provider's id for the person (below). `pages.id` is a random
  uuid made by the database: a page's id goes into the public file names of its published
  revisions (§6.1), where a counter would tell anyone how many pages there are and which came
  first. `audit_log.id` is a counter: entries are never shown outside, and it keeps them in the
  order they were written.
- **The link to the auth user.** `users.id` is Supabase Auth's user id, with no default, and no
  foreign key to `auth.users`. The profile row is made from a signed-in session, which brings the
  id (issue 10). A foreign key into Supabase's `auth` schema would tie the schema to Supabase and
  stop it from being created on plain Postgres, here and in CI. The cost: deleting a person in
  Supabase Auth does not delete their profile. Account deletion (§7.1) removes both, in code.
- **`published_revision_id` is not there yet.** It arrives with `page_revisions` in milestone M2,
  in the migration that creates that table, with its foreign key. A column now could not have
  the foreign key, would always be null, and would say something the schema cannot back. Adding
  a nullable column later is a change to the catalogue alone. `status` already has `published`
  and `unpublished`, as the plan has them; nothing sets them until publishing exists.
- **`updated_at`** defaults to `now()` and every update made through the package sets it to
  `now()` (Drizzle's `$onUpdate`), from the database's clock, like `created_at`. `handle_changed_at`
  is set the same way. No trigger: a trigger is hand-written SQL that drizzle-kit and the drift
  check cannot see, and the package is the only writer. The cost: an update typed by hand in an
  SQL editor leaves `updated_at` as it was.
- **A deleted account and its email.** `deleted_at` marks an account as deleted while the
  deletion (§7.1) is carried out. The email is unique among accounts that are not deleted (a
  partial unique index), so the person can sign up again in the meantime, with a new auth id.
  `getUser` returns nothing for a deleted account, and `createUser` for the same id answers
  `deleted`, not `exists`: the two agree, so a sign-in that reads and then makes a profile is
  told why it can do neither.
- **A display name is held to the page format's limit** (`LIMITS.displayName` in the scene
  package, 40), because it is the name a page's profile starts with. It comes from the auth
  provider, so a longer one is cut to fit, between characters, and not refused: nobody should
  fail to sign in over the length of their name.
- **`status` is a Postgres enum.** Adding a value later is one statement.
- **Foreign keys.** A page goes with its account (cascade). An audit entry outlives the account
  it names (set null).
- **`handles_reserved`** has the one column the plan gives it.

## Decision 4: row-level security on every table, with no policies

The migration enables row-level security on all four tables and creates no policy. On Supabase,
the Data API reaches every table in the public schema with the project's public key, as the
`anon` and `authenticated` roles, which Supabase grants every privilege on new tables. Row-level
security with no policy gives those roles no rows to read and refuses every row they would write.
The app talks to Postgres through its own server-side connection, as the tables' owner, which
row-level security does not limit; Supabase's `service_role` bypasses it as well.

A test gives a role that is not the owner the same privileges Supabase gives `anon` and
`authenticated`, and checks that it reads no row of any table, changes or deletes none, and that
each insert is refused by the row-level security check (not by a missing privilege). Another test
checks that every table in the public schema has it switched on, so a table added later without
it fails.

I found no reason it is wrong. Three things to know:

- It does not protect the app from itself: the owner's connection ignores it, so a query of the
  app's that forgets its `where` is not caught. The writes take the signed-in person's id and
  touch only that person's page, for that reason.
- If the app ever reads through the Data API with the public key (supabase-js in the browser,
  Realtime), those reads need policies first, and get nothing until they have them.
- `FORCE ROW LEVEL SECURITY` is not used: it would stop the owner too. Drizzle's own record of
  migrations is in the `drizzle` schema, which the Data API does not expose unless told to.

## Decision 5: every draft is validated on write, by the scene package; no zod

**The hand-written validators stay, and zod is not added.** They are the format's definition:
the studio shows their messages as they are, with the path of each problem, and they are tested.
zod would be a second definition of the same format to keep in step with the first, or a
rewrite of the first with its messages to reproduce. At the server boundary nothing needs a
schema library: a route passes the request's body, as `unknown`, to the package, and the package
runs the validators. Revisit if an API ever needs types or documentation generated from a schema.

**How validation cannot be skipped:**

- The tables are not exported. Code outside the package writes only through its queries.
- The `draft` column takes a `CheckedDraft`, a type that only `checkDraft` returns. A query that
  writes a draft without checking it does not compile.
- `checkDraft` migrates the document to the current schema (`migrate`) and runs `validatePage`.
  A page on one of the ready-made scenes is checked against that scene as well: its palette, and
  which links it may turn off. It runs before anything is asked of the database; the tests give
  the queries a stand-in database that fails if it is touched.
- Three more checks, for storage. A draft nests at most 32 levels deep: this is checked first,
  and without recursion, because everything after it walks the document by calling itself and
  would run out of stack on one nested deep enough. A draft is at most 64 KB as JSON (the
  validators read the fields they know, so a field they do not know could carry anything). And
  text Postgres cannot keep in jsonb (the character U+0000, half of a surrogate pair) is refused
  with its path rather than failing inside the database.
- An invalid draft writes nothing. The answer is `{ ok: false, reason: "invalid", problems }`,
  where `problems` are the validators' own messages, each with its path:
  `links["shop"].url: use https:// or mailto:`. Other refusals have the same shape: `reserved`,
  `taken`, `exists`, `deleted`, `not-found`, each with a sentence a person can act on.

**The draft's handle is the page's.** A PageDocument carries a `handle`, and so does the row. The
row's is the address. The package writes it into every draft it stores, whatever handle the draft
was sent with, so the two never disagree; the address changes only through `changeHandle`, which
checks it. A draft made before sign-up, with the studio's placeholder handle, can be saved as it
is once the person has picked one.

## Decision 6: one handle rule, and the reserved words on top

- **The rule is in `@scena/scene`:** `isHandle` and `HANDLE_RULE`, used by the page validator, the
  studio's address field and this package. The pattern is the one both places had,
  `^[a-z0-9][a-z0-9_-]{1,29}$`, so nothing that was accepted is refused, or the other way round.
  The two messages, which differed, are now one: "2 to 30 characters: lowercase letters, digits,
  - and _, starting with a letter or digit". A test fails if the pattern is written anywhere else.
- **The database holds the rule too.** `pages.handle` has a check built from the scene package's
  `HANDLE_PATTERN`, compared as text because citext would match it whatever the case. A row
  written around the package cannot carry a handle the rest of the system takes to be
  impossible, and a change to the pattern shows in `pnpm db:check` as a missing migration.
- **Reserved words.** The public list is in `packages/db/src/reserved.ts`: the plan's routes
  (`app`, `api`, `_`, `admin`, `help`), the web app's (`studio`), the routes sign-in, billing and
  publishing will need, the pages a product site has, the service's own names, host names, and
  words software reads as something else (`null`). `pnpm db:migrate` writes it into
  `handles_reserved`, leaving rows already there alone. The package refuses a handle that is on
  the list or in the table, so a word added to the table directly is refused without a change to
  the code. Removing a word from the list does not free it where the table has it.
- **Offensive terms are not in the repository.** The list has a marked, empty place for them.
  Where such a list comes from, and whether it is kept in a public repository at all, is the
  founder's decision. The table makes either answer work.
- **Duplicates.** Handles are unique, and the check keeps them lowercase, so no second spelling
  of a handle can exist, whatever wrote it. They are `citext`, so a read by handle ignores case.
- **A change** keeps the old handle in `previous_handle` and the time in `handle_changed_at`. A
  change to the handle the page already has changes nothing. The stored draft is not validated
  again for it: only its handle changes, and a rule that has tightened since the draft was saved
  must not hold up a change of address.
- **Left for issue 17:** the live availability check, the 30-day redirect, the 90-day release,
  and whether a handle someone has just left is held for the redirect. Today it is free at once.

## Decision 7: Postgres 17

Supabase's changelog of 18 May 2026 says "Postgres 17 is what we currently default to on the
Supabase platform", and its upgrade guide names 17 (17.11) as the version projects move to. I
found no announcement that new projects are offered 18. This comes from Supabase's public pages,
not from the dashboard, since there is no account.

The local container and CI use one build, named by its digest
(`postgres:17-alpine@sha256:eee6c6e1…`): Postgres 17.11, built on 21 October 2026, for every
platform the tag has. The tag alone is whatever was pushed last; on 15 November 2026 it was a
build three days old, and Dependabot's configuration covers npm and the workflow's actions, not
images. A test fails when `compose.yaml` and the CI workflow name different images. To move to a
newer build, take one that has been public for a week, as for a package, and change both.

## Decision 8: how the tests get a database

- **`DATABASE_URL` from the environment**, and nothing else. No file is loaded by itself.
- **Without it**, the database tests are reported as skipped, by name, in Vitest's summary; they
  do not pass. Everything else runs.
- **With it**, the test file makes a database of its own on that server (`scena_test_`, the time
  and a random suffix) and a role for the row-level security tests, applies the migrations,
  runs, and drops both. It never reads or writes the database `DATABASE_URL` names. That needs a
  user who may create databases and roles: the local one and CI's are superusers.
- **A run that is cut short** leaves its database and its role on the server. The next run
  removes those whose name says they are more than an hour old, and leaves younger ones alone,
  since they may belong to a run that is still going.
- **Locally**, `compose.yaml` starts Postgres 17 as the container `scena-postgres` (project
  `scena`), on `127.0.0.1:5435` only, with a health check and a named volume. Its password is a
  development one for that container alone, written in `compose.yaml` and `.env.example`; the
  code and tests read the address from `DATABASE_URL`.
- **In CI**, the job "Typecheck, test and build" gets a Postgres 17 service with no password
  (`trust`: it lives as long as the job and only the runner reaches it), sets `DATABASE_URL`,
  applies the migrations to the empty database, then runs `pnpm check`, which compares the
  migrations with the schema and runs the database tests. Both job names are unchanged.

## Checks

- `pnpm check` runs 75 tests of the database package, besides the 186 there were. 21 of them need
  the database. With `DATABASE_URL` unset they are reported as skipped; with it set, all 261 pass.
  It also runs `pnpm db:check` once, before the tests.
- Without a database: the handle rule (accepted and refused handles, the reserved words and their
  capitals), every refusal of the draft before a query (a draft nested too deep among them), the
  profile's fields, that nothing which runs in a browser imports the package, that the handle
  pattern is written once, and that `compose.yaml` and CI name the same image by its digest.
- With a database: migrations from empty and twice, the column types, profiles (a deleted
  account, a long name), a draft saved and read back unchanged, an invalid draft refused with
  the validators' messages and nothing written, the stored draft's handle, a page saved only by
  its own account, a taken handle refused by the database in any case, the handle rule held by
  the database with the scene package's answers, a reserved handle refused from the list and
  from the table, a second page refused, a handle change (also with a stored draft a newer rule
  would refuse), the audit log, a test database left behind, and row-level security.
- After the review, each of its fixes was taken back out in turn (the handle change checking
  the draft again, the deleted account's answer, the database's handle rule, the depth check,
  the removal of test databases left behind, the cut of a long name, and the image named by its
  tag or by another digest), and each made a test fail.
- Each of 22 deliberate breaks was run once against the tests, and each made at least one fail:
  the validation call removed (from `checkDraft`, `saveDraft` and `createPage` in turn), the
  reserved list and the reserved table not read, each unique constraint removed from the
  migration, the handle's unique constraint removed from the schema, `citext` replaced by text,
  row-level security removed from the migration and from the schema, `updated_at`,
  `previous_handle` and `handle_changed_at` not written, the owner check removed, the storage and
  size checks removed, the seed removed, and the handle pattern copied back into the validator or
  widened to capitals.

## What waits

**For sign-in (issue 10):** the API route of the issue's second "done when", a page draft that
round-trips through a route with the validation errors shown to the client. A route that writes
drafts has to know who is asking, and nothing can tell it yet; an open write route must not exist
even for a day. The package is ready for it: the route reads the person from the session and
calls `saveDraft(db, { pageId, userId, draft: await request.json() })`, and a refusal's `problems`
go back to the client as they are. Also with sign-in: making the profile at the first sign-in
(`createUser`), and the `is_admin` flag that issue 10 lists.

**For a Supabase account:** the project; its connection string, and whether the app uses the
direct connection or the pooler (transaction mode needs `prepare: false`); enabling `citext` in
the `extensions` schema before the first migration, since otherwise it lands in `public`, which
Supabase's advisor flags; running `pnpm db:migrate` against it; and confirming in the dashboard
the Postgres major and the privileges `anon` and `authenticated` get.

**Left out of the queries, on purpose:** marking an account deleted and removing it, listing or
deleting pages, publishing, reading the audit log, and the availability check. Each arrives with
the issue that needs it.

## Consequences

**Good**

- The next issues have a schema, a migration flow and the queries they need, and none of them
  can store a draft the studio would refuse.
- The format stays defined once. The database stores what the renderer reads, and the studio, the
  server and the tests share one validator and one handle rule.
- The schema is plain Postgres: it runs in a local container, in CI and on Supabase alike.
- The checks run without a database, and the database tests run wherever there is one, without
  leaving anything behind.

**Costs and risks**

- drizzle-kit brings a deprecated loader, which is held to a newer esbuild by an override in
  `pnpm-workspace.yaml`. An override is one more thing to remember: it goes when drizzle-kit
  drops that loader, and a drizzle-kit update should be followed by `pnpm db:check`.
- The reserved words are written by `pnpm db:migrate`, not by a migration file. A database
  migrated with another tool (`drizzle-kit migrate`, Supabase's CLI) has an empty
  `handles_reserved`; the list in the code is still applied.
- A draft on a ready-made scene is checked against that scene as it ships now. If a scene drops a
  palette, drafts that use it stop saving until they change it. Scene versions will need a rule.
- The validators do not refuse fields they do not know, so a draft can carry up to 64 KB of them.
- A page on a scene of the person's own is checked on its own: there is nowhere to store its
  scene yet, and issue 11 does not list a table for scenes.
- A transaction-mode pooler and prepared statements do not mix; the option has to be set when
  the connection string is chosen.

## Open questions

- Where the list of offensive terms comes from, and where it is kept.
- Whether the format should refuse fields it does not know, which would make the size limit a
  backstop rather than the only bound.
- Where a scene of the person's own is stored on the server (the plan's `scenes` and
  `scene_versions`), so that its pages can be checked against it.
- Whether a handle that has just been left stays held while its redirect lasts (issue 17).
- What a deleted account's page does. `getUser` and `createUser` both treat an account marked
  deleted as gone, but the page queries do not look at the mark: its page is still found by its
  handle and can still be saved. Nothing marks an account deleted yet; the work that does (account deletion,
  issue 27) has to settle it, in the queries.
