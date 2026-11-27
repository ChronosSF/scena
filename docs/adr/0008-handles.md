# 0008. Handles: who may take an address, a left one held for 30 days, an unused one released after 90

- **Status:** Proposed. It takes effect when the change that adds the rules is merged.
- **Date:** 27 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer
- **Scope:** part 1 of [issue 17](https://github.com/ChronosSF/scena/issues/17): the rules for a
  page's address, with no screen, in `@scena/scene` and `@scena/db`, tested against a real
  Postgres. Part 2, the picker's screen and the web app's server actions, adds to this record.
  Not part of either: the redirect itself (the Worker's, milestone M2), a list of offensive terms,
  and what a deleted account's page does with its address (issue 27).

## Context

The plan asks for a handle "pre-filled from display name" with a live availability check (§2.1),
a 30-day redirect from an old handle (§1), and "inactive reserved handles released after 90 days"
(§6.6), reserved meaning held by an account, not the reserved words. [ADR 0005](0005-database-package.md)
(Decision 6) left all of this, and whether a left handle is held, to this issue;
[ADR 0007](0007-server-autosave.md) (Decision 2) left questions, answered below. Row-level
security stays on, the tables unexported, and values reach SQL as parameters.

## Decision 1: a handle suggested from a name

`suggestHandle(name)` in `@scena/scene`: lowercase, letters folded to their base letter ("Zoë
Müller" gives `zoe-muller`), and nine that Unicode does not split spelt out from one table
("Søren Kjær" gives `soren-kjaer`, "Groß" `gross`), each run of anything else one `-`, nothing
but a letter or digit at either end, cut to 30, and null when what is left is not a handle. It
reads one character at a time and stops once it has more than a handle holds: linear time on
anything pasted. Whether the handle is reserved or taken is the live check's to say.

## Decision 2: one door to an address

**`createPage` no longer takes a handle** (only tests passed one): a page is always made with
none, as the web app makes it (ADR 0007), and `changeHandle` alone gives or changes an address.
A page made at an address would have been a second door, past the hold below.

## Decision 3: a first address is not a change

A page that had no address gets one with no previous handle: nothing is held or redirects.
`handle_changed_at` is still set: it is when the page took its address.

## Decision 4: a left address is held for 30 days

After a change from A to B, A stays the page's for `HANDLE_HOLD_DAYS` (30) from
`handle_changed_at`: no other page can take it, and its owner can go back to it, which holds B.
**Every left address is held, published or not**: one rule, no status read. Only the latest
previous handle is held, because the row keeps one; a newer change frees the one before at once.
After the 30 days A is anyone's, whatever `previous_handle` still says. **No limit on how often
an address changes.** `heldHandle(page, at)` is the one statement of the rule: the previous
handle a page holds at a moment, and until when. M2's publish step reads it to write the redirect.

## Decision 5: an address nobody used is released after 90 days, at the next claim

A page never published (`status = 'draft'`) and not written for `HANDLE_RELEASE_DAYS` (90, by
`updated_at`) does not keep its address against a claim: the claim takes it in the same
transaction, and that page goes back to no address (handle, previous handle and the time of the
change all null). Its draft keeps the handle as text, which is no address (ADR 0007, Decision 2).
**Nothing runs on a schedule**: an address nobody wants stays where it is. A page that was ever
published keeps its address, taken down or not.

## Decision 6: the live check is advice, and the write asks again

`handleAvailability(db, { userId, handle })` reads and locks nothing. Its answers
(`HandleAvailability`) give the picker one sentence each: `free`; `yours` (the page's address);
`held` with `until` (the person's own previous handle); or the package's refusals, in their own
words: `invalid` (the rule's sentence), `reserved`, `taken`. **Someone else's held handle answers
exactly as a taken one**, so nothing says that a page has just moved; a releasable one answers
free. `changeHandle` checks everything again in its transaction. Both read the rules through
`claimOn`, at the database's `now()`, the clock the times were written with, and in one order:
a word put in the reserved table after a page has it stays that page's address ("yours"), and is
refused to anyone else and to its page as a held handle, since going back would take it anew.

## Decision 7: no two pages ever claim one handle, also at once

A write takes, in its transaction, first a lock on the handle (`pg_advisory_xact_lock`, named by
two numbers: one constant for handles and the handle's hash, apart from the one-number locks
anything else in the database, Supabase Auth included, may take), so claims of one handle take
turns; then, in one statement, every row it may write, in the order of their ids: its page, the
page at the handle, and the pages that left it (`FOR UPDATE`). Then it decides and writes:

- **Two claims of a handle at once**: the second reads after the first has ended, and finds it
  taken. The unique constraint stays as the last word.
- **A claim while the page at the handle leaves it** waits for that row, and reads it as it is
  after the move: holding the handle. Without the wait it could release that page's address
  in the middle of the move.
- **A claim that read the handle as free, overtaken** by a page that takes it and leaves it
  before the claim writes: the handle's lock makes that page wait. No row lock can: that page is
  not at the handle when the claim reads.
- **Deadlock.** A claim waits for the handle's lock holding nothing, then takes its rows in id
  order in one statement (Postgres sorts before it locks), so two claims that each need the
  other's page wait in turn. One with something outside the package (a hand-typed session) is
  ended by Postgres; the write then throws, as when the database is down, and the person tries again.

## Decision 8: the audit log

In the same transaction as the change: `handle.choose` for a first address (`{ to }`),
`handle.change` (`{ from, to }`), and `handle.release` on the page that lost its address
(`{ handle }`), by the person whose claim took it. Dotted names, as `audit.ts` had them.

**Schema:** one index, `pages_previous_handle`, for the lookup every claim and check makes (`0005_previous_handle.sql`).

## What ADR 0007 Decision 2 asked

- **Is a first address a change, for the redirect and the release?** No (Decision 3). For the
  release it counts as a write: taking an address stamps `updated_at`.
- **Does publishing require an address?** Yes: a page is published at its address, and one with
  none is found by nothing; M2's publish step refuses it. The release follows from it.
- **Does the picker start from the draft's handle or the name?** Part 2; `suggestHandle` gives the name's.
- **The studio's "Page address" field once pages have addresses.** Part 2.

## Considered and not taken

- **The rules in SQL** (`handle_changed_at > now() - interval '30 days'`): a second statement of
  the rule beside `heldHandle`, whose days move with the session's time zone. The rows that may
  claim a handle are few: SQL finds and locks them, `claimOn` reads them, and no SQL needs the numbers.
- **A scheduled job** to release addresses: something to run and watch, for what a claim does.
- **A constraint that holds the rule**: a hold ends with time, and an index cannot read the clock.
- **Serializable transactions with retries**: the same safety, with a retry loop in every write.

## Checks

`pnpm check` runs 420 tests, 19 more; without `DATABASE_URL` the 40 database tests are skipped.
With no database (the issue's "Handle rules have unit tests"), `claimOn` and `heldHandle` (each
kind of claim, the hold to the millisecond, the release at its edge) and `suggestHandle`,
megabyte inputs included. With one: each rule above, each answer of the live check, the audit
entries in the change's transaction (by the rows' `xmin`), and races on two connections, a third
holding their rows until both wait; in one, a row is moved in the table so that the two claims
meet the rows in opposite orders, and without the `ORDER BY` Postgres finds a deadlock. Each of
41 guards, taken out one at a time, made a test fail.

## Costs and risks

- **A person can keep two handles** by moving back and forth before each hold ends, since
  changes are not limited. One address and one held handle at a time, never more.
- **The release reads the page row's `updated_at` alone**, so a person who signs in every day
  but writes nothing to that row can lose their address: someone working on a page of their own
  drawings, which the account does not store yet, or someone only looking. A last-seen time on
  the account, written by the web app, would close it; the founder decides.
- **The owner of a released page is not told.** They find their page without an address and the
  handle in their draft taken. The page was never published, so nothing public breaks.
- **The live check tells whether an unpublished page has a handle.** Part 2 should limit how
  often it is asked.
- A claim locks, briefly, every page that ever left its handle, expired holds included.

## Open questions

- Whether the owner of a released page should be told, at their next sign-in or by email.
- Whether changes should be limited, against keeping two handles.
- What a deleted account's page does with its address and its held handle (ADR 0005, issue 27).
