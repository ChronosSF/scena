# 0008. Handles: who may take an address, a left one held for 30 days, an unused one released after 90

- **Status:** Proposed. Part 1 takes effect when the change that adds the rules is merged, and
  part 2 when the change that adds the picker is.
- **Date:** 27 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer
- **Scope:** part 1 of [issue 17](https://github.com/ChronosSF/scena/issues/17): the rules for a
  page's address, with no screen, in `@scena/scene` and `@scena/db`, tested against a real
  Postgres. Part 2 (Decisions 9 to 15): the picker, the web app's server actions, the
  inspector's address row, and a last-seen time on the account, so that signing in counts
  against the release. Not part of either: the redirect itself (the Worker's, milestone M2), a
  list of offensive terms, a limit on how often the live check is asked, and what a deleted
  account's page does with its address (issue 27).

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

A page never published (`status = 'draft'`), not written for `HANDLE_RELEASE_DAYS` (90, by
`updated_at`), and whose owner has not been seen for as long (Decision 9) does not keep its
address against a claim: the claim takes it in the same
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

## Decision 9: signing in counts, by a last-seen time on the account

`users.last_seen_at` (migration `0006_last_seen.sql`, written by `pnpm db:generate`) is when the
studio last opened for the person, signed in. **The release (Decision 5) needs both the page
not written and its owner not seen for `HANDLE_RELEASE_DAYS`**; an owner never seen since the
column came counts from the page alone, as before, so no address is kept for good by a time that
was never written. One statement of the rule (`unused` in `handles.ts`), which the check and the
write read through `claimOn`; the owner's time comes with the pages in the one statement that
finds them (`claimants`, a join), and only the pages' rows are locked (`FOR UPDATE OF pages`).

- **Written at most once a day, from the read that is already there.** `studioAccount`
  (`apps/web/auth/server.ts`) reads the profile to open the studio; `noteSeen(db, profile)` is
  given that profile, and asks the database nothing when it says the person was seen within the
  day. Otherwise one `UPDATE`, made only while the row is still due, so two studios opened at
  once write once. No request to Supabase Auth, no second read of the profile.
- **The database's clock**, as for `updated_at`, which the release reads them against, to the
  millisecond so that the time read back is the time written. The day is measured from the app
  server's clock against it; the two differ by the servers' drift.
- **A write that fails is logged, and the studio opens.**

Considered: the time on every request (a write per request, for a day's resolution); in the
proxy (it has no database, ADR 0006); at sign-in only (someone who stays signed in, as the
session's renewal lets them, signs in once and would not be seen again).

## Decision 10: two server actions, in the manner of the drafts'

`apps/web/address/actions.ts` has `checkAddress` and `claimAddress`; what they decide is in
`address/choose.ts`, given who is asking and the queries rather than a session and a database.
Who is asking is read first; the page is found from the session's user; nothing sent names an
account or a page. The answers are fixed lists (`address/answer.ts`), and each case has its own
sentence (`address/messages.ts`); "could not say just now" is told from "signed out", as for the
drafts.

- **The check** answers free, yours, held until a `Date` (React's server actions carry a Date as
  one; the browser shows the day in the person's own time zone, in British English), or invalid,
  reserved or taken. A refusal comes with up to three free addresses near it, each checked in the
  same call: what was typed made into an address, the name on the page as one and run together,
  then the typed one with "-draws", "-studio", "-art", "-2" or "-3". At most six are asked about
  in one call, in turn, until three are free.
- **The claim** answers where the page is now, the draft revision the change moved it to, and
  what the address it left does now (`heldHandle`); `changeHandle`'s own refusal otherwise,
  whatever the check said. With no page in the account it answers `no-page`.

## Decision 11: the picker starts from the name on the page

The field starts from `suggestHandle` of the name on the page that is open in the studio, read
when the picker opens. Not the draft's handle: before an address it is the studio's default
(`your-name`) or text typed into the old field, which may be someone else's address after a
release. Not the profile's name: the page's is the one the person sees and edits, and may be
seconds newer than anything in the account. The name is sent with each check, as text, for the
near ones: it names no account.

## Decision 12: the "Page address" field becomes a row, through one more prop

In the web app with sign-in the address is the account's: typed into the draft it would be
replaced at the next save (ADR 0007, Decision 2), and shown as the page's without a check. So
`StudioProps.address` (`packages/studio/src/host.ts`) gives the studio the address (or null) and
the row's words and control, as `account` gives it the top bar's slot:

- the inspector shows a row in place of the field (Inspector.tsx, studio.css): the address, or
  "No address yet", "Sign in to choose one" or "Not in your account", the host's control, and a
  hint;
- the frame label, the Preview's address bar, the Page panel's head and the export's file names
  show the address, or none, and "page" for the file (`addressOf` in `store.ts`); the site's host
  before it is one constant beside the handle rule (`ADDRESS_PREFIX` in `@scena/scene`);
- the draft carries it: a new address is written in with no undo step, and whatever brings a
  page in afterwards (an edit, undo, redo, other work) carries it (`setAddress`). It is no edit:
  the host is not told, and it reaches this browser's storage with the next save of the work.

The single-file build, and the web app on a server with no sign-in, leave the prop out: the
field is as it was, and `pnpm verify:studio` passes its 120 checks unchanged. Considered: a
`StudioControl` method to set the handle, which would be a second way to do what the prop does.

## Decision 13: a claim goes through the tab's autosave

`changeHandle` moves the draft on a revision and writes the address into the stored draft. The
browser's autosave keeps the revision it last had; were it not to follow, its next save would
read as one that replaced another tab's version, and this tab or another would say "Changed
elsewhere" of the person's own change. So the picker claims through `AccountAutosave.claim`:

- it waits for a save on its way, and no save goes until the claim is answered (one due meanwhile
  goes then), so the revision the claim moved from is this tab's;
- with no page in the account yet (just signed in), the work here goes first, and its save makes
  the page the address is for;
- the claim's revision, one on from this tab's, is taken as this tab's own, and the other tabs of
  this browser are told that it was a change of address alone (`Heard.moved`): one at the
  revision before takes it quietly;
- **a claim is a move only when its answer has an address other than the one the tab had.** A
  claim of the page's own address changes nothing, so the revision it answers may be another
  device's save, and taken as the tab's the next save would go over that version unwarned. The
  picker makes no such claim (its button is off while the line says the address is the page's
  already), and an answer like it is read as any other news of a newer version;
- **while the tab is unsure whether a save it sent was taken** (its answer was lost), the
  claim's revision is taken as the tab's and nothing is said, as for a save's answer (ADR 0007):
  the versions it passed over may be the tab's own;
- the account writes its page's address into every draft it keeps, so a version that differs by
  the handle alone is the same to it: what the tab knows the account has, and the work open
  there, take the address, and nothing is sent for it (`learn`);
- **a tab that only hears of an address writes nothing in this browser**, neither the record nor
  the studio's saved work, which its tabs share: only the claim's own tab records the move;
- **which work opens (ADR 0007, Decision 6) compares pages without their handle**: two that
  differ by it alone are the same work, whatever address each was saved or recorded with. An old
  copy of the route is told first, before "the same": after a claim it is the same work with only
  its address older, and its revision must not be taken for the account's.

The address checks found these. A second tab, open and behind, wrote its older work and
revision over the first tab's as it took a new address in, and the first tab, back on its studio
by Back and Forward, took the route's old copy for news and set its own work aside; it failed in
about half the runs, by which tab wrote last. And on a reload after another device's change, the
work here was compared before the studio had taken the address in (the row, and the address with
it, waits for the studio to say the work is on a ready-made scene), so the account's page opened
over the same work and set it aside; once the work was compared without its handle, the old copy
after a claim read as the same work, and the tab took its older revision and said "Changed
elsewhere" at the server's next answer.

Every answer of the server says the address now (the save's and the revision's too), so the row
follows a change made in another tab or on another device at the tab's next answer. The record
beside the studio's saved work keeps the address at its revision, so an old copy of the route
(Back and Forward, ADR 0007 Decision 6) shows the address the page has from the first paint.

## Decision 14: drawings of one's own show no address

A page on drawings of one's own is not kept in the account (ADR 0007, Decision 5), so the address,
which is the account's page's, is not this page's. The row says "Not in your account", with no
control and a hint that a page on a ready-made scene can have one; nothing else shows an address,
and the picker does not open by itself. Offering the picker there would give the address to a
page the person is not looking at, or to none.

## Decision 15: the picker opens by itself once, after sign-in

When the studio opens for a signed-in person whose page has no address, on a ready-made scene
(plan §2.1, step 5), unless that opening set the work in this browser aside: the dialog that says
so is the one open, and the picker opens by itself at the next opening (`AccountAutosave.open`
says which). "Not now", Escape or a press outside put it off in this browser, by one flag with
nothing of the person's in it (`scena-web/v1/address-later`); the row always opens it. A person
who just signed in lands back on their work, with the picker over it. A check with no answer is
asked again after the autosave's waits (`RETRY_MS`), longer each time.

The theme gained what the picker needed, beside the controls it already had: a field message
that says something good (`.field-msg.ok`), a field with fixed text before what is typed, and the
app pages' news block, moved in so that both scales use one rule (`.message`). The hold's length,
`HANDLE_HOLD_DAYS`, moved to `@scena/scene` so that the picker can say it, and `@scena/db` reads
it from there.

## What ADR 0007 Decision 2 asked

- **Is a first address a change, for the redirect and the release?** No (Decision 3). For the
  release it counts as a write: taking an address stamps `updated_at`.
- **Does publishing require an address?** Yes: a page is published at its address, and one with
  none is found by nothing; M2's publish step refuses it. The release follows from it.
- **Does the picker start from the draft's handle or the name?** The name on the page (Decision 11).
- **The studio's "Page address" field once pages have addresses.** A row that shows the address,
  in the web app with sign-in; the field everywhere else (Decision 12).

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

Part 2: `pnpm check` runs 468 tests with `DATABASE_URL`; without it the 43 database tests are
skipped and 425 pass. With no database: the release with the owner's time, to the millisecond,
and a person seen within the day not noted again (`packages/db/test/rules.test.ts`); the server
actions' decisions with stand-ins (`apps/web/test/address.test.ts`: the session read first, the
account and the page from it alone, each answer, the near ones and their bounds, the claim's
own refusal, a database that fails and what its log line holds), the sentences, and the
picker's questions with fake timers (the 400 ms, lowercase, the stale answer dropped, the retry
at the autosave's waits, the claim only while the line allows it and never of the page's own
address, the flag for "Not now"); how the autosave carries on from a claim
(`apps/web/test/drafts.test.ts`: the revision taken as the tab's, but not from a claim of the
address the page has, and quietly while unsure of a save, the claim and the saves in turn, the
page made first, another tab's change taken quietly, the address from every answer, the old copy
of the route, an opening that sets work aside said to be one); the studio's address
(`packages/studio/test/host.test.ts`); and the studio route noting the person as seen
(`apps/web/test/session.test.ts`). With one: the
last-seen time once a day and once for two studios at once, the release kept while the owner
signs in, to the minute, by the check and the write alike, and the owners' times read in the
statement that finds the pages, which locks the pages alone.

`pnpm verify:web` has 31 checks of the picker and the row (`tools/address-checks.ts`), against the
local stack: the row signed out and on drawings of one's own; the picker by itself after
sign-in, from the name on the page; typing, each answer said once, the line describing the field
and the button, a capital typed in the middle keeping the caret after it; taken with free ones,
kept for the site, against the rule; the claim, and the row, the frame label, the draft and the
export after it; the last-seen time; a second tab open throughout, told nothing by the claim,
and typing in it with no warning; a change from the row, typed after with no warning, and the
address left held until a day in the person's own time zone (two zones 25 hours apart); Back and
Forward; another device's change; the claim sent again with no session; no answer, and the
session ended, with the dialog open; Not now, and the focus back on the row's button; not over
work set aside at sign-in in another browser, but at the next opening there; a person just
signed in on a slow connection, before the first save has made the page; a phone with its
keyboard; 900 to 1440 px with a 30-character address; the round trip; and no error logged. The
picker opens by itself over the studio for a signed-in person whose page has no address, so the
sign-in and autosave checks, which are about other things, put it off in their browsers before
they sign in, as a person who said "Not now" would.

Each guard of part 2, taken out one at a time by a script that replaced one exact piece of code,
ran the tests meant to catch it and put the file back byte for byte (for those only a browser
shows, with the web app built again and the address checks run): 86 guards, each of which
made a test or a check fail. The pull request lists them.

## Costs and risks

- **A person can keep two handles** by moving back and forth before each hold ends, since
  changes are not limited. One address and one held handle at a time, never more.
- **The release read the page row's `updated_at` alone**, so a person who signed in every day
  but wrote nothing to that row could lose their address: someone working on a page of their own
  drawings, which the account does not store yet, or someone only looking. The founder decided
  on 27 November 2026 that signing in counts, and part 2 builds it (Decision 9).
- **The owner of a released page is not told.** They find their page without an address and the
  handle in their draft taken. The page was never published, so nothing public breaks.
- **The live check tells whether an unpublished page has a handle**, and one check of an address
  that cannot be taken asks about up to six more (Decision 10). Nothing limits how often it is
  asked yet (Open questions).
- A claim locks, briefly, every page that ever left its handle, expired holds included.
- **Another device that is open during a change of address is told "Changed elsewhere"** when it
  is looked at again: the server's answer cannot say that the revision moved by the address
  alone. Its row and labels show the new address from that answer. Tabs of the same browser are
  told it was the address, and are not warned.
- **A save from another tab that crosses a claim** (sent in the moment the claim is made) says
  it replaced a version. Within one tab the claim and the saves take turns.
- **A claim at the moment the owner of an unused address signs in** may read their last-seen
  time from before it, and release the address: the owners' rows are read, not locked.
- **The last-seen time is one write a day per person**, and one column more in each profile read.
- **"Not now" is one flag for the browser**, not for an account: a second person who signs in
  where the first put the picker off finds it in the row, and it does not open by itself for them.
- **A page with no address still carries its draft's handle** in the page data it exports and in
  the badge's link (`?from=`); the files are named "page".

## Open questions

- How often a person may ask the live check, and where that is counted. A server that runs as
  short-lived functions shares no memory, so a count per session in memory holds nothing; a row
  per account and minute in Postgres, or a limit at the edge by session cookie, would. The
  debounce (400 ms) and the bound on the near ones keep one person's typing to a few checks a
  second at most.
- Whether the owner of a released page should be told, at their next sign-in or by email.
- Whether changes should be limited, against keeping two handles.
- What a deleted account's page does with its address and its held handle (ADR 0005, issue 27).
