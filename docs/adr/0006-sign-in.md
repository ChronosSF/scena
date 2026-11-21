# 0006. Sign-in: Supabase Auth from the server alone, a session cookie of the app's own, and a local stack to test it on

- **Status:** Proposed. It takes effect when the change that adds sign-in is merged.
- **Date:** 20 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer
- **Scope:** [issue 10](https://github.com/ChronosSF/scena/issues/10): sign-in by email (a link
  and a code in the same email) and by Google, sessions in cookies with `@supabase/ssr`, renewal
  and sign-out, the profile made at the first sign-in, the `is_admin` flag and `/admin`, what the
  publish step will ask to know an address is verified, and the way into sign-in from the studio
  and back. Not part of it, each its own issue: server autosave (15), the "sign in to save and
  publish" bar and uploading the local draft at sign-in (16), the handle picker (17), publishing,
  account deletion and export.

## Context

The plan (§2.1) lets a visitor try the studio before giving an email, and asks them to sign in at
"Save" or "Publish"; §7.1 puts auth on Supabase, with an email link that also shows a code for
people who open the email on another device, and Google. [ADR 0004](0004-one-studio-two-apps.md)
gave the web app a server, a nonce-based policy with `form-action 'none'`, and a `proxy.ts` in
front of every request. [ADR 0005](0005-database-package.md) gave it `@scena/db`, whose
`createUser` makes the profile from a signed-in session, under the auth provider's id.

What has to stay true:

1. No Supabase account exists. Everything is built and checked against Supabase's local stack.
2. The browser never holds a Supabase client or reads the session, so the session cookie can be
   `HttpOnly`. Sign-in, renewal and sign-out happen in server actions, route handlers and
   `proxy.ts`.
3. No key, token or password is written into code, tests or scripts, and the app never uses the
   secret (service-role) key.
4. No cookie is ever set on the public pages' origin (the issue's second "done when").
5. The single-file studio has no accounts and gains none; `pnpm verify:studio` passes unchanged.
6. A new visitor signs in from the studio without losing their draft (the issue's first).

## Considered and not taken: a sign-in library in the app, on a Postgres of the app's own

Asked on 21 November 2026, before this change was committed: would a library in the app (Auth.js
or Better Auth), writing to a plain Postgres on one cloud account, be cheaper or simpler than
Supabase Auth? Supabase Auth stays. What was weighed:

- **What Supabase is used for.** Auth only. The database is plain Postgres through Drizzle
  ([ADR 0005](0005-database-package.md)); Supabase's REST layer, Realtime and Storage are not
  used. So the choice is where sign-in runs, not where the data lives.
- **Cost.** Hosted Supabase is one fixed charge for the database and auth together ($25 a month
  in the plan, §6.5). A managed Postgres elsewhere with the library in the app was not priced
  against current rates; it is a fixed charge of the same order. Running Supabase's own
  containers on a cloud account would cost more than either, and is not the plan. What grows
  with use is serving the public pages, which this choice does not touch: at the plan's scale
  (1M views a day, 1,000 custom domains), from the vendors' prices as read on 20 November 2026,
  about $130 a month on Cloudflare as planned, against about $220 to $490 on CloudFront.
- **What a library would have to do again.** The email with a link and a code, renewal with
  single-use refresh tokens, the limit per address, Google, and every check listed below, which
  run against the real Supabase Auth. Neither library was tried.
- **The way out stays short.** Supabase Auth is called from five files (`auth/actions.ts`,
  `auth/server.ts`, `auth/session.ts` and the two routes under `app/auth/`), through clients
  made in `auth/supabase.ts`, and nothing a browser loads may reach them
  (`test/boundary.test.ts`). The profile is a row of the app's own `users` table under the auth
  provider's id, so a move would carry those ids over and replace those files.

## Decision 1: the versions, and the CLI run where it is needed

| Package | Version | Published | Role |
|---|---|---|---|
| `@supabase/ssr` | 0.12.7 | 8 September 2026 | the session in cookies; a dependency of `apps/web` |
| `@supabase/supabase-js` | 2.119.0 | 4 November 2026 | its peer, and the client that asks for the email; a dependency |
| Supabase CLI (`supabase` on npm) | 2.122.1 | 2 November 2026 | runs the local stack; not installed with the workspace |

Each is pinned exactly and is the newest release that had been public for a week. supabase-js
2.119.1 and 2.119.2 were two days and one day old. The CLI's 3.x line is a new major whose first
release, 3.0.0, came out on 2 November 2026, under the month a new major waits; 2.122.1 is the
newest of the 2.x line (its "v2.stable" tag). What they bring is no newer: the five
`@supabase/*-js` 2.119.0 packages that supabase-js pins, published with it, and `cookie` 1.1.1,
`tslib` 2.8.1, `iceberg-js` 0.8.1 and `@supabase/phoenix` 0.4.5, all months old. `pnpm audit`
reports nothing. The CLI starts GoTrue v2.197.0, Postgres
17.11.0.006 (Supabase's image), Kong 2.8.1 and Mailpit v1.31.3.

**The CLI is run by `pnpm dlx supabase@2.122.1`, through `tools/stack.ts` (`pnpm stack:*`), here
and in CI, and is not a dependency.** Its npm package brings the binary for each platform as an
optional dependency, about 150 MB. As a devDependency, every `pnpm install` of every CI job would
fetch it; through `pnpm dlx`, only the job that starts the stack does, and the version is written
once, in `tools/stack.ts`. No new GitHub Action was needed. The CLI reports usage to its maker
(the binary carries PostHog); `tools/stack.ts` sets `SUPABASE_TELEMETRY_DISABLED=1`, as the
repository does for Next.js.

## Decision 2: everything happens on the server

- **The browser gets no Supabase client, no key and no session.** `SUPABASE_URL` and
  `SUPABASE_PUBLISHABLE_KEY` have no `NEXT_PUBLIC_` prefix, so Next.js never writes them into a
  browser file. The forms post to server actions (`auth/actions.ts`); Google goes through two
  route handlers; renewal is in `proxy.ts`. A page that shows who is signed in is handed the
  address, never the session.
- **A page asks Supabase Auth who is signed in** (`getUser`, in `auth/server.ts`), not the
  cookie: a session signed out elsewhere still has a cookie. Then it reads the profile. A visitor
  with no session cookie costs no request to Supabase Auth.
- **The publishable key only.** `auth/config.ts` refuses a secret key (`sb_secret_…`) or a
  service-role key wherever it is put, and refuses half a configuration. Nothing in the app
  needed the secret key: profiles are written through the app's own database connection
  (ADR 0005), and every Supabase Auth call is the person's own.
- **What a browser may load is checked** (`apps/web/test/boundary.test.ts`): the walk starts at
  every client component and follows its imports, into the workspace packages too, and fails on
  `@scena/db`, `@supabase/*`, `next/headers`, `server-only`, the session's modules or a read of
  `process.env`. A server action module is where it stops: the browser gets a reference to it.
  `auth/server.ts` and `auth/db.ts` also import `server-only`, which Next.js turns into a build
  error in a client bundle.

## Decision 3: one email, with a link to a button and a code

- **One template for a new address and a known one** (`supabase/templates/sign-in.html`, used
  for Supabase's "Confirm signup" and "Magic link"). Asking for an email gives the same answer
  for any address: sign-up is on, so a new address gets the confirmation email and a known one
  the magic-link email, with the same link and code. A project with sign-up off would answer a
  new address differently; that error is not repeated to the person either.
- **The link leads to this app's confirm page, which signs in only when its button is pressed**
  (a POST to `confirmLink`). Mail scanners and link previews open links; Supabase's own link
  signs in on GET, and would be spent before the person clicks.
- **The link is `{{ .RedirectTo }}#token_hash={{ .TokenHash }}`.** The app asks for the email
  with `emailRedirectTo` set to `<SCENA_SITE_URL>/auth/confirm?next=/studio`, and the token's
  hash follows a `#`, which a browser never sends to a server: no request log has it (the dev
  server logs every request's address, and so will a host). The confirm page reads it, takes it
  out of the address bar and the history, and posts it with the button. Opened in another
  browser or on another device, the link works the same: it needs nothing kept where the email
  was asked for, and the email is asked for by a client that holds no session, so no PKCE
  verifier cookie is set then. `verifyOtp({ token_hash, type: "email" })` takes the hash of
  either template; `verifyOtp({ email, token, type: "email" })` the typed code.
- **What a person is told** is a sentence from fixed lists (`auth/messages.ts`), chosen by
  Supabase Auth's error code and never its wording: a wrong code and an expired one read the
  same; a used link and an older link read the same; the limits read "wait a minute"; a server
  that does not answer reads "try again in a moment". The sign-in page shows them in a live
  region that is in the page from the start.
- **The code step is only for an address this page has sent an email to.** Supabase Auth gives
  one code (`over_email_send_rate_limit`) for the limit per address, where an email went out a
  moment ago, and for the project's own limit per hour, where none did. So the sentence for it
  does not say an email was sent, and a first ask that is refused, for this address or for
  another one typed from the code step, stays on the email step. Someone who reloads the page
  and asks again within the minute is not offered the code field for it; the link in the email
  they have still works.

## Decision 4: the session cookie

- `HttpOnly`, `SameSite=Lax`, `Path=/`, **no `Domain`** (the browser keeps it for this host
  alone), 400 days (the most a browser keeps; the session lasts as long as Supabase Auth says).
- **Over https its name is `__Host-scena-auth`, and it is `Secure`.** The prefix makes the
  browser itself refuse the cookie unless it is Secure, has `Path=/` and no `Domain`, so
  host-only is a rule of the browser and not only of `auth/cookie.ts`. The app's own origin is
  `app.<domain>` and the public pages are on `<domain>` (plan §6.3): a host-only cookie of the
  app never reaches them, which is the issue's "no cookie on the public page origin".
- **Over plain http it is `scena-auth`, not Secure.** Plain http is accepted for `localhost`,
  `127.0.0.1` and `[::1]` alone (`auth/config.ts` refuses it for any other host); a `__Host-`
  cookie must be Secure, so the prefix is left out there.
- A long session is written in pieces (`scena-auth.0`, `.1`) by `@supabase/ssr`. Google's flow
  keeps its PKCE verifier in `scena-auth-code-verifier`, with the same attributes, until the
  person comes back.

## Decision 5: `proxy.ts` renews the session before the page renders

A session's access token lasts an hour. When it has run out, the refresh token buys a new pair,
and it is single-use. A page cannot set cookies once it streams, so a page that renewed the
session itself would spend the refresh token and lose the new one. `auth/session.ts` does it in
`proxy.ts`, which already makes the nonce: only for a request with a session cookie (no request
to Supabase Auth otherwise), with `getSession()`, which renews a session that has run out and
removes one that cannot be renewed. The new cookies go into the request the page renders with
(so the page reads the new session and does not renew it again) and into the response, with the
cache headers `@supabase/ssr` asks for. Next.js 16 also hands the cookies a proxy sets to
`cookies()` in the same request on its own; the proxy writes them into the request as well, as
Supabase's guide does, so that the request's `Cookie` header agrees for any code that reads it
and the rule does not rest on that behaviour (which Next.js's source marks as unfinished for
some callers). Static files are outside the proxy's matcher and never
get a cookie. A renewal Supabase Auth refuses removes the session; one that throws (the
configuration is wrong, the network is down) is logged and leaves the request as it came. Either
way the page renders as for someone signed out, and the studio still opens.

Two cases leave the session where it is, since neither says anything about it. A renewal
refused as one too many (429) is not passed on: the library removes a session on any refusal,
and Supabase Auth counts renewals by the server's address (Costs and risks), so a person would
be signed out for a limit they never met. And a page never renews: the library renews a session
that is about to run out wherever it is read, a page cannot send the new cookie, and the
refresh token would be spent for nothing. `currentAccount` reads through a client whose request
for a renewal is answered as refused without being sent (`auth/supabase.ts`). A session with
time left is read as it is, one that has run out reads as no one signed in, and the proxy
renews it in front of the next request.

## Decision 6: the way back is looked up, not parsed

`/sign-in?next=…`, the forms, the link in the email and Google's way back carry where to return.
`auth/return-to.ts` looks the value up in a fixed list (`/studio`, `/admin`) by equality, and
anything else is `/studio`. No address is parsed or tested by its text, so nothing on another
host, and no path the list does not name, can come out of it. The redirects are built on
`SCENA_SITE_URL`, never on a request's `Host`.

## Decision 7: the profile at the first sign-in, and every refusal

After Supabase Auth accepts a sign-in (the link, the code, Google), `settleSignIn` reads the
profile and makes it with `createUser` if there is none (`auth/profile.ts`). The name is Google's
`full_name` or `name`; the locale is left to its default, since a provider's locale is not always
a language tag and a sign-in must not fail on one. The answers:

| `createUser` says | The person |
|---|---|
| made | is signed in |
| `exists` | made a moment ago by another sign-in: read again, signed in |
| `deleted` | is signed out (here and at Supabase Auth) and told the account is being deleted |
| `taken` | is signed out and told the address belongs to an older account; nothing is merged or moved |
| `invalid`, or the database fails | is signed out and told to try again; the reason goes to the server's log |

**`taken`** means a live profile holds the address under another auth id: Supabase Auth links a
person's email and Google sign-ins into one user with one id, so this happens only when an auth
user was removed outside the app and the same address signed up again. The new sign-in has proved
it controls the address, but not that it is the person the older profile belongs to (an address
can change hands), and moving the profile to the new id would hand that person's page over.
Only someone looking at both can tell, so the sign-in is refused and asks them to get in touch.

## Decision 8: `is_admin`, set by hand

`users.is_admin boolean not null default false`, in migration `0003_admin_flag.sql`, written by
`pnpm db:generate`. `getUser` reads it with the profile; nothing in the package or the app writes
it, and a test fails if a query or the app's SQL names it otherwise. It is set by a person at an
SQL prompt (the Supabase dashboard's SQL editor, as the database's owner):

```sql
update users set is_admin = true where email = 'vittoria@…' and deleted_at is null;
```

`/admin` answers 404, the same page as for an address that does not exist, to anyone signed out
or without the flag, so the route does not say it is there. It opens with the flag; what it will
hold (unpublishing reported pages, reviewing scenes) comes with the work that needs it.

## Decision 9: what the publish step asks

`verifiedAccount()` in `auth/server.ts` answers `{ ok: true, account }` for a signed-in person
whose address Supabase Auth has confirmed (`email_confirmed_at`), and `signed-out` or
`unverified` otherwise, asking Supabase Auth on each call. Signing in by the link or the code
confirms the address; Google confirms it for an address Google has verified.

## Decision 10: Google, wired and switched off by default

- The button is a **link** to `GET /auth/google?next=…`, not a form. Chrome holds every redirect
  that follows a form to the page's `form-action`, and this one goes on to Supabase Auth and to
  Google, so a form would need both hosts in the policy. A GET that only starts the flow spends
  nothing. The route asks `@supabase/ssr` for the address (PKCE: the verifier goes into a cookie
  of the app), checks it is Supabase Auth's by origin, and sends the person there.
  `/auth/callback` exchanges the code with that verifier, so a code started in another browser is
  refused, then settles the profile as for any sign-in.
- **Switched off unless configured, in both places.** The app shows the button and answers
  `/auth/google` only with `SCENA_GOOGLE_SIGN_IN=on`. In `config.toml`, Google is `enabled = false`
  and its client id and secret are `env(…)`: the CLI does not read a boolean from `env()` (it
  refuses the file), but it does take `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true` from the
  environment over the file, which is how CI and anyone with credentials switch it on.
- Without Google credentials nothing past Google's address can be tried. The checks follow the
  way to `accounts.google.com` with the configured client id, and stop there.

## Decision 11: one prop on the studio, and the draft stays where it is

`Studio` takes `account?: ReactNode`, which its top bar shows before the More menu. `apps/web`
fills it with a "Sign in" link, or the address and "Sign out"; `apps/studio` leaves it out and
renders exactly as before (`pnpm verify:studio`: 120 checks, unchanged). The studio knows nothing
of accounts.

The slot gives way as the window narrows, before the studio's own controls do: the address is
shown from 1400 px, the words "Sign in" and "Sign out" from 1180 px, and below that the icon
alone, a person to sign in and a way out to sign out, with the address in the button's tooltip
and, at every width, for screen readers. The two widths depend on what the bar holds, so they
are in the studio's stylesheet with the bar's own, not in the web app: the slot marks its
address `account-wide` and its words `account-words`, and `studio.css` says where each is
shown. A control added to the bar changes the numbers in the file that adds it. The studio's
bar also gained one rule for a slot of any
width: its right-hand side is never narrower than what is in it, so the centre moves left
instead of being run over. Without a slot the right-hand side fits in its half, and the
single-file build's bar lays out as it did.

The draft is in the studio's storage in this browser, and sign-in does not touch it. "Sign in" is
a link the router follows inside the same document, so the studio's pending autosave (it waits
350 ms after the last change) still runs on the way out; a check types a title and presses Sign
in at once, and finds the title saved and back in the studio after signing in. By the code the
person comes back in the same document; by the link, the confirm page and the studio load from
scratch and read the saved draft. What happens to the local draft once there is a server copy is
issue 16.

## Decision 12: the policy lets forms post to this origin

`form-action 'none'` became `form-action 'self'`, the smallest change that lets the sign-in forms
post. Every form of the app posts here and every redirect after one stays here; the way to Google
is a link. Nothing else in the policy changed, and `test/csp.test.ts` holds it to that.

## Decision 13: the local stack

- **`supabase/config.toml`, project id `scena`**: the containers are `supabase_db_scena`,
  `supabase_auth_scena`, `supabase_kong_scena` and `supabase_inbucket_scena` (Mailpit), the
  volume `supabase_db_scena`, the network `supabase_network_scena`. Only what sign-in needs is
  started: Realtime, Storage, the Studio, Edge Functions, analytics and the pooler are off in
  the file, and PostgREST and postgres-meta are left out by `pnpm stack:start`.
- **Ports 54420 to 54424** (gateway 54421, Postgres 54422, mail catcher 54424, the shadow
  database 54420 used by the CLI's `db diff` only), a block of their own beside the CLI's usual
  54321 to 54327, and none of 3000, 5432 to 5435 or 55432.
- **The CLI publishes them on every interface** (`0.0.0.0` and `[::]`), not on `127.0.0.1`. I
  found no setting for it in 2.122.1 (the file's keys, its flags, and the names in its binary);
  Docker's own default address could change it, but that is a setting of Docker for every
  project on the machine. The database's password is the CLI's well-known local one, so on a
  network that is not trusted, stop the stack (`pnpm stack:stop`).
- **Limits** far above a hosted project's (1000 emails an hour, 1000 verifications), with five
  seconds between two emails to one address: the checks send many, and one of them asks twice in
  a row on purpose. A hosted project's limits are set in its dashboard.
- **`enable_confirmations = true`**, as on a hosted project, so a new address gets the
  confirmation template locally too.
- **citext in `extensions`.** `supabase/migrations/20261120000000_citext_in_extensions.sql`,
  which the CLI applies when it creates the database, puts it there before the app's migrations
  run. Without it, `pnpm db:migrate` against Supabase's image created citext in `public` (tried
  once: `0000_citext.sql` ran as the `postgres` role, whose first schema is `public`), which
  Supabase's advisor flags. With it, all four migrations apply, citext is in `extensions`, the
  four citext columns resolve to `extensions.citext`, row-level security is on in all four
  tables, the 144 reserved handles are written, and a second run changes nothing. That is the
  part of ADR 0005's "For a Supabase account" this stack verifies.

## Decision 14: which database the web app uses

**For the web app, the stack's Postgres**, the way production has the app's tables beside
Supabase Auth in one database: `pnpm stack:start` applies `pnpm db:migrate` there, and
`pnpm stack:env` gives the app that `DATABASE_URL`. The package's own tests stay on
`scena-postgres` (`compose.yaml`), unchanged: they need a server where they may make and drop
databases and roles, and the stack's `postgres` role is not a superuser.

## Decision 15: CI

The sign-in checks run in the existing **"Parity and headless Chrome"** job, whose name is
unchanged: `pnpm stack:start` before the build, with Google switched on under a client id that is
no one's, then `pnpm verify:web` as before. `tools/verify-web.ts` asks the CLI where the stack
is. Without a stack, it reports the sign-in checks as skipped with the reason and runs the rest
against a server without sign-in; on CI a missing stack fails the run instead, since CI starts
one. The job's time limit went from 15 to 25 minutes for the first pull of the stack's images.

## Checks

- `pnpm check` runs 334 tests, 69 more than before. Without `DATABASE_URL`, 23 database tests are
  reported as skipped and 311 pass; with it, all 334 pass.
  - `apps/web/test/session.test.ts` (9), with a stand-in for Supabase Auth: the proxy's renewal
    for a visitor, a session that has run out, one Supabase Auth no longer knows, and one
    refused as one too many; a page reading a session without renewing it, by the client and
    by `currentAccount`; the cookies and the cache headers on a response; the one database pool.
  - `apps/web/test/auth.test.ts` (35): the return address, by every kind of address that is not
    on the list; the cookie's name and attributes over https and http, the header as a browser
    gets it, and which names are its pieces; the configuration (on, off, half, a secret or
    service-role key, http elsewhere than this machine, an address with a path, the Google
    switch); the sentences for every error code, and that none says whether an address has an
    account; the fixed notices; a verified address.
  - `apps/web/test/profile.test.ts` (9): the profile made from Supabase Auth's user, and each
    answer of `createUser`.
  - `apps/web/test/boundary.test.ts` (4): the walk of what the browser gets, and that it catches
    each kind of mistake.
  - `apps/web/test/stack.test.ts` (9): the stack's name, ports and services, the pinned CLI, the
    limits, Google off, the one template with the link and the code, and that writing the
    stack's variables into `.env.local` keeps the file's other lines.
  - `apps/web/test/csp.test.ts` (6, one new): `form-action 'self'` and no host of Supabase's or
    Google's.
  - `packages/db`: the admin flag with a database (off, set by hand, read with the profile, gone
    with a deleted account) and without one (nothing writes it).
- `pnpm verify:web`: 67 checks with Google on, as CI runs it (66 with it off), the 23 of before
  and the rest for sign-in, against the stack, in browser contexts of their own, with the
  emails read from the mail catcher (about 80 seconds on this machine):
  - nothing sets a cookie for a visitor; `/admin` is a 404 for them; the return address;
  - a new visitor edits in the studio, presses Sign in at once, asks for the email, opens the
    link, presses the button, and is back in the studio, signed in, with the edit; the email's
    link carries the token after the `#` and the confirm page takes it out of the address bar;
  - the link fetched twice and opened in a browser without the button signs no one in and sets
    nothing, and then still works;
  - the same visitor flow by the code, typed by the keyboard; a second email asked at once is
    answered with a sentence; a wrong code is refused with a sentence read where the field points;
  - another address typed from the code step, when no email can go to it yet, stays on the
    email step, and the page asks for no code it did not send;
  - the link opened in a second, fresh browser signs that one in and not the first; a way back
    changed in the link to another site lands in the studio; a used link and an older link are
    refused with a sentence;
  - the cookie as the browser holds it (HttpOnly, Lax, Path=/, host-only, not Secure over local
    http), no other cookie, neither the page's script nor the sandboxed preview where the page
    runtime runs can read it, no static file of the studio sets a cookie with a live session or
    one that has run out, and the same server under another host name sees no one signed in;
  - a session whose access token has run out (its expiry put a minute back and its access token
    spoiled, in the cookie the browser holds: nothing waits an hour) is renewed once, in front
    of the page: the page sees the new session, the browser keeps it, Supabase Auth's audit log
    has one renewal and its token table one new token, and the next request does not renew
    again;
  - `/admin` is a 404 for a signed-in person without the flag and opens with it;
  - sign-out from the studio, with the work kept, and the old cookie and access token refused;
  - the session cookie as the server writes it (HttpOnly, Lax, Path=/, no Domain, and a
    response no cache may keep), read from the header, since a browser on this host would
    forgive a Domain naming the host itself;
  - a second sign-in finds the profile and makes no other; a deleted account and an address an
    older profile holds are each signed out and told;
  - Google: the button, the way to Supabase Auth and on to `accounts.google.com`, the verifier
    cookie's attributes, and a way back with no code or a forged one; or, when the stack has
    Google off, no button and a 404;
  - the sign-in page with and without the studio's stylesheet, by the keyboard, at 375 px, and
    the studio at 375 px with the slot signed in;
  - the studio's top bar, signed in, at 900, 1024, 1280, 1366 and 1440 px, editing and
    previewing: its three groups keep apart, the page is no wider than the window, and the
    address is shown at 1440 px and not at 1366 px;
  - no page logged an error.
- The same checks pass against the dev server (`pnpm dev:web` with the stack's variables).
- `pnpm verify:studio` (120), `pnpm verify:runtime` (17) and `pnpm parity` pass unchanged;
  `pnpm db:check` passes; `pnpm audit` reports nothing.

## Guards taken out, one at a time

Each was taken out alone, the app rebuilt where a browser check was to catch it, the checks run,
and the file put back byte for byte (a script compared it):

| Taken out | Caught by |
|---|---|
| the return-address list (any text followed) | 19 unit tests; 3 browser checks (the list, the second browser, the changed link) |
| the button on the confirm page (it signs in as it opens) | "opening the link signs no one in" |
| `HttpOnly` | 3 unit tests; the cookie's attributes, what the page's script can see, the verifier cookie |
| the admin flag in `/admin`'s gate | "/admin answers 404 to a signed-in person without the flag" |
| signing out on a refusal (`settleSignIn`) | the deleted account, the address held by an older profile |
| `deleted` answered as signed in (`profile.ts`) | 1 unit test; the deleted account |
| the renewal in `proxy.ts` | the renewal, and "the next request does not renew it again" |
| the static files left out of the proxy's matcher | "no response for the studio's static files sets a cookie" |
| the session-less client for asking for the email | the link's shape, "asking for the email set no cookie", "no other cookie" |
| the token taken out of the address bar | "the confirm page takes the token out of the address bar" |
| sign-out ending the session | both sign-out checks |
| "Sign in" as a router link (a full page load instead) | 5 checks: the same document, the edit saved on the way out, and the edit back after the link, the code and sign-out |
| no `Domain` (one naming the host added) | 3 unit tests; the cookie as the server writes it, the verifier cookie |
| the `__Host-` prefix | 3 unit tests |
| the refusal of a secret key | 1 unit test |
| `form-action 'self'` (opened to every https host) | 2 unit tests |
| the client boundary (a client component importing `auth/server.ts`) | the boundary test |
| `createUser` writing only the fields it names (the flag passed through) | 2 database tests |
| a sentence that says an address has no account | 1 unit test |
| **the renewed cookie written into the page's request** | **nothing**: Next.js 16 hands cookies a proxy sets to `cookies()` in the same request by itself (Decision 5), so the page saw the renewal either way. It stays for the reasons given there. |

A second pass, in review, took out thirteen more, chosen without looking at the table above,
and each made a check fail:

| Taken out | Caught by |
|---|---|
| plain http accepted for any host (`auth/config.ts`) | 1 unit test |
| any text in `?notice=` taken as a notice's key | 1 unit test |
| sign-in set up without `DATABASE_URL` | 2 unit tests |
| an address counted as verified without a time of confirmation | 1 unit test |
| the stack starting PostgREST and postgres-meta as well | 1 unit test |
| a token with any role taken for the publishable key | 1 unit test |
| a page trusting the cookie instead of asking Supabase Auth | "after signing out, the old cookie signs no one in" |
| the code path not settling the profile | 5 checks: the sign-in by the code, the renewal, `/admin`, the deleted account, no errors logged |
| the link path ignoring a refusal and going on to the studio | the address held by an older profile |
| the confirm page without `no-referrer` | "opening the link signs no one in… and sends no referrer" |
| the renewed cookie not sent to the browser (`proxy.ts`) | the renewal, "the next request does not renew it again", the cookie as the server writes it |
| the bar's right-hand side allowed to be narrower than what is in it | the top bar from 900 px up |
| the address shown at every width above the narrow layout | the top bar from 900 px up |

The review also found what no check had looked at: at window widths between the narrow layout
and about 1370 px, the signed-in slot was wider than its half of the bar and ran over the
controls in the centre. Decision 11 has the fix, and the top bar check is new with it.

Two notes on the runs. The first scripted run of the "Sign in as a router link" break reported
one failure, in a check before sign-in (the scene picker's card), and none of the five above;
run again, alone and then by the script, it failed the five each time. The same picker check
failed once more in the review's runs, again right after a build. It is the first thing the
studio is asked to do on a server and a browser that have just started, and it read the cards
after a fixed pause of 1.2 seconds; it now waits for them (`settled`, as the other checks
do). And the cookie's `Domain`
was caught in the browser only through the verifier cookie at first: Chrome keeps a cookie whose
`Domain` names `localhost` itself as host-only, so "the cookie as the server writes it" was added
to read the header.

A code review of the pull request then found ten things, and each fix that changes what the
app does was taken back out in turn:

| Taken out | Caught by |
|---|---|
| a renewal refused as one too many passed on as a dead session (`auth/session.ts`) | 1 unit test |
| `currentAccount` reading through a client that may renew | 1 unit test |
| the reading client sending the renewal | 3 unit tests |
| the limit's sentence saying an email was sent | 1 unit test |
| the code step for any address whose send was refused (`auth/actions.ts`) | "another address that cannot be sent an email yet stays on the email step" |
| the database pool in a variable of its module | 1 unit test |
| `pnpm stack:env --write` replacing the file whole | 1 unit test |
| a response given the session's cookies without the cache headers | 2 unit tests |
| the studio's rule for where the address is shown | the top bar from 900 px up |

## Costs and risks

- **Supabase Auth's limits per IP address see the app's server, not the visitor.** Every
  sign-in call comes from the server, so those limits (sign-ins, verifications, renewals) count
  all visitors together: one person hammering the form slows sign-in for everyone, and the
  limit is not a limit per person. The app needs a limit of its own per visitor before launch.
  (The limit per email address is not affected.) Renewals are counted the same way, and need no
  form: a request with a made-up session cookie makes the proxy ask for one. While that limit
  is used up, a person whose access token has run out is shown as signed out; they keep their
  cookie and are signed in again once a renewal goes through (Decision 5).
- **The link depends on the Site URL and the redirect list agreeing with `SCENA_SITE_URL`.** If
  Supabase Auth does not accept the address the app asks for, it puts its Site URL in its place
  and the link breaks (`https://app.example#token_hash=…`). Supabase Auth accepts any address on
  the Site URL's host, so it holds when the two are the same host; a preview deployment on
  another host needs its own entry in the redirect list.
- **The confirm page needs JavaScript**, to read the token from after the `#`. The studio needs it
  anyway.
- **A link signs in whoever opens it and presses its button, into the account the email was
  sent for.** It is not tied to the browser that asked, which is what lets it work on another
  device, and the confirm page cannot name the account before the button is pressed. So a
  person is not always in the account they think they are in: the studio says which one in its
  top bar, and anything that saves work into the account should say whose it is first (issue
  16, which uploads the local draft at sign-in). Tying the link to the asking browser (PKCE)
  would end this and leave the code as the only way across devices.
- **A refresh token is single-use**: two tabs whose access token runs out at the same moment
  both try to renew; Supabase Auth's reuse interval (10 s) covers most such races, and
  `@supabase/ssr`'s README says the rest come back signed out.
- **Every page of a signed-in person asks Supabase Auth** who they are, one request per page.
- **The verifier cookie of an abandoned Google sign-in** stays, HttpOnly and unused, for 400 days.
- **The local stack listens on every interface**, with the CLI's well-known database password
  (Decision 13). So does `next start` in `pnpm verify:web`, as it did before.
- **Signing out leaves the draft in the browser**, as the studio has always kept it; on a shared
  computer, "Start over" clears it. Issue 16 decides what happens to it once it is uploaded.
- **`@supabase/ssr` is a 0.x package**; a minor release may change its API, as it has before.

## Open questions

- Where a person whose address is `taken` gets in touch: the product has no support address yet.
- The limit per visitor (above), and a CAPTCHA if abuse shows up.
- Session lifetime: a hosted project can end sessions after a time or after inactivity (the
  dashboard's "Sessions"); none is set here.
- An account marked deleted while signed in: its pages read no profile and show it signed out,
  but its Supabase session lives on until account deletion (issue 27) removes the auth user.
- Moving to the CLI's 3.x line once it has been public for a month.

## For a Supabase account

None of this could be done from here. On the hosted project, in this order. The places named in
the dashboard are taken from Supabase's documentation, not from a dashboard, and may be worded
differently there; `supabase/config.toml` has the local value of each setting, by the same name
the CLI gives it.

1. **Postgres**: enable `citext` in the `extensions` schema (Database → Extensions), then run
   `pnpm db:migrate` with the project's connection string (ADR 0005). Confirm the Postgres major
   is 17.
2. **The admin flag**: once Vittoria has signed in once, in the SQL editor:
   `update users set is_admin = true where email = '<her address>' and deleted_at is null;`
3. **URL configuration** (Authentication → URL Configuration): Site URL = the app's origin
   (`https://app.<domain>`), the same value as `SCENA_SITE_URL`; redirect URLs: `https://app.<domain>/**`,
   and one entry per preview host if previews get their own (`https://<preview-host>/**`).
4. **Email templates** (Authentication → Emails): "Confirm signup" and "Magic link" both get the
   body of `supabase/templates/sign-in.html` and the subject "Your Scena sign-in link and code".
   Leave "Confirm email" on, and sign-ups on.
5. **SMTP**: Supabase's own sender only mails the project's team and only a few an hour; set a
   custom SMTP server (the plan names Resend) before anyone else signs in.
6. **Rate limits** (Authentication → Rate Limits): emails per hour, sign-ins and verifications
   per 5 minutes; and the least time between two emails to one address (`max_frequency` in
   `config.toml`; 60 seconds on a hosted project unless changed). Raise the email limit once SMTP
   is set. Keep the per-address interval at a minute or more: it is what stops one address being
   flooded.
7. **OTP**: length 6 and expiry 3600 s (Email provider), as the templates and the sentences say.
8. **Google**: a Google Cloud OAuth client (web application) whose authorised redirect URI is
   `https://<project>.supabase.co/auth/v1/callback`; its client id and secret go into
   Authentication → Providers → Google, which is switched on there. Then `SCENA_GOOGLE_SIGN_IN=on`
   in the app's environment.
9. **Keys**: the app's environment gets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (the
   publishable key, never the secret one), `SCENA_SITE_URL` and `DATABASE_URL`. The secret key
   is not given to the app at all; the app refuses one.
10. **Sessions** (optional): time-box or inactivity limits, if wanted (Open questions).

## Consequences

**Good**

- A visitor can try the studio, sign in at the moment they need to, and come back to their work;
  the same email serves the device it was asked on (the code) and any other (the link).
- No script in a page, the app's own included, can read the session, and the cookie cannot reach
  another host, by the browser's own rule once the app is on https.
- The local stack is the first place the schema has run on Supabase's own Postgres, and every
  check of sign-in runs against the real Supabase Auth, here and in CI.

**Costs**

- A second Docker stack for local work and CI, about 2 GB of images, and a Chrome job that takes
  longer.
- `pnpm verify:web` needs the stack for its sign-in checks; without it they are skipped, visibly.
