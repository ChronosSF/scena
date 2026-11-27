# 0007. Server autosave: the draft kept in the account, the last write wins, and nothing is lost unsaid

- **Status:** Proposed. It takes effect when the change that adds server autosave is merged.
- **Date:** 25 November 2026
- **Deciders:** Vittoria (founder), with Claude as the implementer
- **Scope:** [issue 15](https://github.com/ChronosSF/scena/issues/15): a signed-in person's draft
  saved to their account two seconds after the last change, through a server action that
  validates it; the "Saving…", "Saved" and "Offline, retrying" indicator; two tabs, where the last
  write wins and the tab that lost is told; nothing lost on a reload. It also finishes what
  [issue 11](https://github.com/ChronosSF/scena/issues/11) left for sign-in
  ([ADR 0005](0005-database-package.md), What waits): a page draft that round-trips through the
  server, with the validators' messages shown to the person. Not part of it, each its own issue:
  the "Sign in to save and publish" bar, asking which draft to keep, and the activation events
  (16); the handle picker (17); publishing and revisions (20 to 22), and with them the
  "unpublished changes" bar (Decision 10); storing a person's own scene (65); account deletion.

## Context

The plan (§2.3) asks for autosave to the server two seconds after the last change, a "Saved"
indicator, and a draft kept apart from what is published. [ADR 0005](0005-database-package.md)
gave the app `@scena/db`, whose queries write a page's draft only once the scene package's
validators have passed it, and [ADR 0006](0006-sign-in.md) gave it sign-in, with the session in
an `HttpOnly` cookie that only the server reads. Until now the studio in the web app kept the
work in the browser alone, as the single-file build does.

What has to stay true:

1. The single-file build stays exactly as it is: `pnpm verify:studio` passes its 120 checks
   unchanged, and the studio knows nothing of servers or accounts (ADR 0004, ADR 0006
   Decision 11).
2. Who is asking comes from the session. Nothing the browser sends names an account or a page,
   and a request without a session writes nothing.
3. The indicator is always true: it never says the work is in the account when it is not.
4. Nothing is lost without the person being told, in either direction: not the work in this
   browser, and not the page in the account.
5. A visitor who is not signed in has the studio as before: saved in this browser, and nothing
   sent anywhere.

## Decision 1: a server action, with its decisions apart from the session

- **`apps/web/drafts/actions.ts`** has two server actions: `saveDraftToAccount`, which the
  studio's autosave sends the page to, and `accountDraftRevision`, which a tab asks when it is
  looked at again (Decision 4). Each is a POST to the studio's own page, which Next.js accepts
  only from this origin. A route handler was the other way; an action needs no route, no
  address of its own and no parsing of a body, and the sign-in forms are actions already.
- **What they decide is in `drafts/save.ts`**, given who is asking and the page queries rather
  than a session and a database, as `auth/profile.ts` is, so that each decision is tested with
  stand-ins (`test/drafts.test.ts`). `actions.ts` hands it `whoIsAsking` and `@scena/db`.
- **Who is asking is asked first, before anything sent is read.** Without a session the answer
  is `signed-out` and nothing is validated, read or written. With one, the person's one page is
  found from their id (`getPageByUser`): an account or a page named in what was sent is never
  read. A test sends both, and a browser check sends a real save again from outside the browser,
  with no cookie, and finds nothing written.
- **`whoIsAsking`** (`auth/server.ts`) asks Supabase Auth, as `currentAccount` does, and tells
  "no one is signed in" (`signed-out`: no cookie, a session Supabase Auth refuses, no profile)
  from "it could not be told just now" (`unavailable`: no answer, an answer of 429 or 5xx, the
  database down). The browser stops saving to the account on the first and tries again on the
  second. `currentAccount` is now `ask()` with the second folded into "no one", as before.
- **A session whose access token has run out reads as "could not say" to a save.** The reading
  client may not renew (ADR 0006, Decision 5): when the token has run out, auth-js asks for a
  renewal, `readingFetch` refuses it itself (`renewal_not_made_here`), and `getUser` hands back
  that refusal, an `AuthApiError` with status 400. `proxy.ts` renews a session in front of every
  request, the save's too, and leaves it as it came only when its renewal got no answer or was
  refused as one too many; a session Supabase Auth no longer knows has its cookie removed there
  and reads as no cookie here. So a run-out session at a save is one whose renewal could not be
  made just now: the browser tries again, and the next request may renew it. auth-js 2.119.0
  takes an error's `code` from `code` only in an answer that names Supabase's API version in a
  header, and from `error_code` otherwise, so the refusal now carries both, and is known by its
  code, not by its wording. A page (`currentAccount`) still reads it as no one signed in.
- **The validators' messages reach the person.** `@scena/db` refuses an invalid draft with them
  (ADR 0005, Decision 5); the action passes them on as `problems`, and the studio shows them
  after a fixed sentence (Decision 7). This is issue 11's second "done when".

## Decision 2: a page is made before it has an address

The handle picker is issue 17, and the plan (§2.1, step 5) puts choosing a handle right after
sign-in. A signed-in person must be able to save before that exists. **`pages.handle` may now be
null: the page has no address until one is chosen**, and the first save makes the page without
one (`createPage` with no handle). Postgres lets any number of rows have no handle under the
unique constraint, and the handle rule's check passes a null.

The trap was the draft's handle. `saveDraft` writes the row's handle into the stored draft
(ADR 0005, Decision 5), and the studio's "Page address" field shows the draft's handle after a
reload. **A page with no address keeps the handle its draft was sent with**, which has to
follow the handle rule (it is refused with the rule otherwise, before anything is written): what
the person typed into "Page address" is what they see after a reload. It is no address: nothing
finds the page by it (`getPageByHandle`), and two pages may have the same one. Once the page has
an address, the address is written into every draft stored, as before.

Considered and not taken:

- **A placeholder handle made up for the row** (`p-3f9a…`). Every page would then have an
  address nobody chose. Its draft would carry it, so the "Page address" field would change to
  it after the first reload and undo what the person typed there; the placeholder would take a
  name from the shared namespace, and become the `previous_handle` of the first real one, from
  which issue 17's redirect would then lead.
- **The handle in the studio's own "Page address" field as the row's.** That is a handle chosen
  without an availability check or the reserved words shown to the person, which is issue 17,
  and the studio's default, `your-name`, would be taken by the first person who saved.

What issue 17 has to settle because of this: giving a page its first address goes through
`changeHandle` today, which records no previous handle and sets `handle_changed_at`; whether that
is a "change" for the redirect and release rules; whether the picker starts from the handle in
the draft or from the display name (the plan says the name); that publishing requires an
address; and the studio's "Page address" field once pages have addresses. From then on what is
typed there is replaced by the page's address at the next save, the trap above in reverse, so
the field has to become the picker, or show the address and not edit it.

## Decision 3: a draft revision, and the last write wins

`pages.draft_revision integer not null default 1`, in migration `0004_draft_revision.sql`,
written by `pnpm db:generate` (with the handle made nullable). It is 1 when the page is made,
one more with each save, and one more with each change of address, which rewrites the draft. A
save sends the revision it was made from (`base`, or null for a tab that has seen none).
`saveDraft` reads the row's revision under the row lock it already took, writes the draft
whatever the base was, and answers `replaced: true` when the base was not the revision it
replaced: another tab or device saved since, and this save replaced a version its tab never
had. A save that finds the row held by another waits for it, and counts from what that one
wrote: two saves at once take a revision each, and the later says it replaced the other (a
database test holds the row in a transaction of its own to see it).

**The last write wins**, as the issue says: no save is refused for being made from an older
revision, and nothing is merged. A precondition that refused such a save (on the revision, or on
`updated_at`) was the other way; it makes the first write win, and the issue's own case, an
edit in one tab and then another, would keep the first tab's and refuse the second's. A revision
was chosen over `updated_at` because two saves in one millisecond, or a clock that moves back,
would make a timestamp lie, and a counter does not.

## Decision 4: who is told in the two-tab case, and when

**The tab whose version was replaced is told, as soon as it can know.** Its indicator turns to
"Changed elsewhere", and says once, aloud and as a toast, that the page was saved from another
tab or device, that this tab does not have those changes, that editing here replaces them with
this tab's, and that a reload gives the saved one. It learns:

- **at once, from another tab of this browser**: each successful save tells the others on a
  `BroadcastChannel`, and a tab that hears of a revision newer than its own is behind. This is
  the issue's case, two tabs, and costs no request;
- **when it is looked at again**, for another device: on `visibilitychange` to visible and on
  `focus`, a tab asks `accountDraftRevision` (one request), at most once every 15 seconds;
- **from the answer to its own next save**, which replaces the other version (the last write
  wins) and says so: "Saved to your account. It replaced a version saved from another tab or
  device, which this tab did not have."

A tab that hears of a newer save while its own is on its way waits for its answer: if the
other save came after it, this one was replaced, and it is behind. A tab told it is behind keeps
autosaving: an edit there is a newer write, and wins. The notice says so before the person
types. Holding its saves until the person chose was the other way; that is asking which version
to keep, which is issue 16's.

Not done: polling. A tab on another device that is never looked at again learns at its next
save. It costs one request per tab per interval, each one to Supabase Auth (Decision 9).

## Decision 5: only a page on a ready-made scene goes to the account

The server holds the page and not the scene (ADR 0005; storing a person's own scene is issue
65). A page on drawings of the person's own, saved to the account, would open on no other
device. So **only a page on a ready-made scene, as it ships, is sent**; on anything else the
indicator says "Saved in this browser", and its sentence says why: "A page on your own drawings
is not saved to your account yet; a page on a ready-made scene is." Nothing is sent.

"As it ships" matters: "Open Pia's finished desk" makes an editable copy of the desk that keeps
the id `desk`. Its page would pass the server's check against the desk, and open on another
device on the ready-made desk, not on the copy. The browser compares the scene with the shipped
one (`onReadyMadeScene`, once per scene object, since the studio replaces the object whenever
the scene changes). The server cannot see the scene, so it refuses a page whose scene id is not
a ready-made one (`own-scene`), which a test checks with a database that fails if it is asked.

## Decision 6: which work opens for a signed-in person

The studio route reads the person's page with who is signed in, and hands the browser its id,
revision and draft; never the session. Beside the studio's own saved work, this browser keeps a
record (`scena-web/v1/account-draft` in `localStorage`): which page of the account that work was
made from, at which revision, the page as last saved here, the page on its way to the account
until its answer comes, and whether that work holds changes the account has not been heard to
take (`unsent`: false only when the tab that wrote the record knew the work to be the account's
version at that revision, with no try left unanswered). The record is written in the same moment
as the studio's own save (the seam calls the host in that moment, Decision 8), so the two
describe the same work. Then (`whichOpens` in `drafts/autosave.ts`):

| The account | The work in this browser | Opens |
|---|---|---|
| has no page | anything | the work here; its first save makes the page, if it is on a ready-made scene |
| has a page | the same page, whatever order its keys are in | either: they are the same |
| has a page | made from the page at the account's revision, with changes not yet sent (the record says so) | the work here, and it is sent at once |
| has a page, one revision on | made from what the record says was on its way, which the account has | the same |
| has a page, at an earlier revision than the record's | the work the record describes | the work here: the page handed in is an old copy. Sent at once if it has changes not sent, and the server is asked what the account has now |
| has a page, another version | the version the record says the account took, with nothing typed since (`unsent` is false) | the account's page, quietly: nothing set aside, no dialog, nothing said, Saved |
| has a page | anything else | the account's page; the work here is set aside in this browser, kept until discarded, and the person is told |

The third row is "refreshing after edits loses nothing", inside the two seconds too: the
studio saves in this browser 350 ms after the last change, and the record with it. The fourth is
a reload while a save was on its way and its answer had not come.

The fifth is the browser's Back and Forward. The home page's link opens the studio without
loading a new document, and Next.js then brings a route back, on Back and Forward, as the server
sent it the first time: with the account's page as it was then, not as it is. A code review of
the pull request found that the rows below took such a page for news, since they asked only
whether its revision differed from the record's: the older page opened quietly over the newer
work, said "Saved", and the next keystroke wrote it over the newer version in the account. It
was reproduced by hand before it was fixed. A draft's revision only goes up, so a page at an
earlier revision than the record's is an old copy, and the work here stays. The record's
revision is taken for the account's, the work goes at once if the record says it has changes
not sent, and the server is asked at once what the account has (`looked`): a later revision
there is the two-tab warning, and an earlier one, which only a database put back to an older
copy can give, sends the work here. A copy from before the page was made hands in no page at
all; that cannot be told from another person's account with no page, so the work is sent as
the first row has it, and its save says nothing of replacing a version.

The sixth is switching devices: the laptop saved, the phone saved since, the laptop opens again.
Nothing of the person's is only on the laptop, so the phone's version opens in its place with
nothing set aside and nothing said, as often as they go back and forth. Before this row, the
laptop's own saved version was set aside each time, and the second time, with a copy already
kept, the account's page did not open at all and saving stopped.

The row goes by what the record says of this very work, not by its text. That the account once
had the same page says nothing: a title typed back to what it was is a change, and not yet
sent. A first form of this row kept the fingerprints of the last 20 versions the account had,
shared by the browser's tabs, and let work with any of those texts give way quietly. A second
check by hand found what that dropped without a word: a title typed back to an earlier saved
one while signed out, at the next sign-in; and an edit undone after a save that reached the
account and whose answer never came. Both are the last row now. So is work the record does not
describe at all: typed in a tab that has stopped saving, or saved here by another tab of the
browser after the record was written. That last case may set work aside that the account did
have (Costs and risks); it errs towards telling.

The last row is the one that tells. **The account's page opens, and the work in this browser is
set aside**, with the studio's own mechanism for saved work it cannot open (`store.ts`,
`openSaved`), now with a reason a host can give: the "Saved work did not open" dialog opens by
itself, its first sentence says "Your account has a saved version of this page that is not the
one this browser had, so it opened here in its place", and it offers the work as files and a way
to discard it. Nothing is sent over the account's page. Opening the work here was the other way;
the account's page would then be replaced at the first save, with nothing kept of it. It is also
the case of a person who signs in on a computer where someone else's work is in the browser:
their account's page opens, and the other work is kept aside. Asking which to keep is issue 16.

The studio keeps one set-aside copy. If one is already kept, the account's page does not open
(it would lose that copy), nothing is sent over it, and the indicator says why and what to do;
so does a toast, said aloud, in the warning tone, since on a narrow window the indicator is an
icon alone. It is the same when the account's page would not open in this studio (checked before
the studio is asked, so that its refusal can only mean a copy already kept).

What opens is saved in this browser at once, not 350 ms later: the copy set aside, the studio's
own saved work and the record change in the same moment. A tab closed inside those 350 ms used to
leave the old work both under the studio's key and aside, with a record that described the
account's page, and the next load found a copy kept already and stopped.

## Decision 7: the indicator says where the work is

Where "Saved in this browser" is today, a signed-in person sees words from a fixed list
(`drafts/messages.ts`): "Saving…" from the change until the server's answer, "Saved" once the
server has said so for the work that is open, "Offline, retrying" when a save got no answer,
"Not saved, retrying" when the server answered that it could not save just now, "Not saved"
with the validators' messages when it refused the draft, "Changed elsewhere" (Decision 4), and
"Saved in this browser" with the reason for a page on drawings of one's own or after the session
ended. Only "Saved" says the account has the work; a test holds every other state to saying
where the work is. A save that throws is told apart by what threw (`Browser.failed`, which
`MountedStudio.tsx` answers): a fetch that failed altogether is "Offline, retrying"; an answer
that was an error is "Not saved, retrying", since the connection is not at fault; and an action
the server no longer knows, which is a tab from before the app was deployed again, is "Reload
to save". That tab stops sending, since no retry can help it, and goes on writing the record,
so the work goes to the account when the page is loaded again. A refusal that arrives after
the page was changed again is of a page no longer open: it is neither shown nor said, and the
work that is open goes instead. The words are shown beside the icon from 1180 px, the width at which the
account slot's words show; below it the icon alone, with the whole sentence in the tooltip and
for screen readers, at every width. With a host the indicator shows on a phone too (it is hidden
there without one, as before): someone on a phone has to see "Offline". The studio's own
warnings (work that would not open again, or is too big for this browser) are shown before the
host's, since nothing was saved anywhere then.

"Saving…" and "Saved" take turns at every save, so each keeps the other's room
(`SaveWords.room`): both are laid in one place, the other unseen, and the indicator is as wide
for either. At 1440 px with the address shown, the right-hand side of the bar is at its least
and pushes the centre, and Edit and Preview moved by 13.6 px at every save before. The rarer
words (the warnings, "Saved in this browser") may still move it.

**Only warnings are read out.** "Saving…", "Saved" and "Saved in this browser" change the
indicator alone, as the indicator was silent before unless it warned; a screen reader finds the
whole sentence on it when it moves there. With a host the indicator is not a live region at all:
its words change at every save, and an element whose role or text changes in the same moment is
not reliably announced. What should be heard is said through the studio's own live region, which
is in the page from the start: each warning state as it begins ("Offline, retrying", "Not saved,
retrying", a refusal, "Changed elsewhere", the session ending, the held states), as a toast in the
warning tone and aloud, once until a save gets an answer; and the studio's own warnings, by the
studio. Without a host, in the single-file build, the indicator is the status region it was, and
its markup is as before.

A save that got no answer is tried again after 2, 4, 8, 16 and 30 seconds, then every 60, and
at once when the browser says it is online again; one the server could not make, the same. When
the browser says so while a try sent offline is still on its way, the try after it goes at once,
not after its wait. An
edit made while a try waits does not bring it forward: the try takes the latest work when it
goes. While the tries go on, the indicator keeps saying so, and does not turn to "Saving…" at a
try or an edit. A refused draft is not sent again until it changes. A session that has ended stops the
saving to the account, the indicator says the work is in this browser and that signing in again
saves it there, and the page reads again who is signed in, so the top bar's slot says so too.

After a try that got no answer, the next save may replace that try's own version, which reached
the server while its answer did not: such a save does not say it replaced another tab's
version, since that may be untrue. The other tab, if there was one, is told as in Decision 4.

## Decision 8: one more prop on the studio, `saving`

`StudioProps.saving` (`packages/studio/src/host.ts`) is what a host that keeps the work
elsewhere gives the studio, and the single-file build leaves out:

| Part | What it is |
|---|---|
| `words` | what the indicator says (with `room`, the words it takes turns with), or null for the studio's own "Saved in this browser" |
| `onChange(work)` | the documents changed: called at once |
| `onSaved(work)` | the studio has just saved the work in this browser: called in the same moment as that write |
| `onOpen(studio)` | the studio is on screen; `studio` has `work()`, `replace(work, why)` and `say(text, tone)` |

`replace` opens the host's work with no undo step (undo would bring back what was set aside,
and the next autosave would write it over what was opened), and saves it in this browser at
once. It sets aside what was open unless it holds nothing of the person's or is the same work,
or `why` is null: the host says it keeps what is open already (Decision 6, sixth row), and
nothing is set aside or said. It refuses rather than lose a copy already set aside. `say` is the
studio's own toast and live region; with a host it is the only way the indicator's news is
heard (Decision 7). The store calls the host through two
hooks that `App.tsx` sets from the props; without a host they are empty, and the store saves in
this browser alone as it always has. The studio knows nothing of servers or accounts: the words,
the reasons and the decisions are the web app's (`drafts/`). `pnpm verify:studio` passes its 120
checks unchanged, and a test holds the indicator without a host to its markup before this change.

Two changes to the studio came with it. `hasWork` now compares a page whatever the order of its
keys: the account's page comes back from Postgres with its keys in jsonb's order, and was taken
for work when it was not. In the single-file build the order is always the studio's own, and
the answers are the same. And the set-aside copy may carry the host's reason
(`scene-studio/v1/set-aside/why`); work the build could not open is set aside without one, as
before, and its dialog reads as before.

## Decision 9: what each save costs Supabase Auth

Each save asks Supabase Auth who is signed in (`getUser`), one request from the app's server,
as every page of a signed-in person already does (ADR 0006, Costs and risks). A tab asks once
more when it is looked at again, at most every 15 seconds. With the two-second wait, someone who
pauses after every few words sends a save every few seconds, so a busy person makes in the order
of ten to thirty requests a minute, and someone typing without a pause of two seconds makes
none. Which of Supabase Auth's limits applies to reading the user on a hosted project, and at
what rate, was not checked: there is no hosted project, and the local stack sets limits for
sign-ins, verifications and renewals, not for this. As ADR 0006 says, those limits count the
server's address, not the visitor's, so they are shared by everyone.

Considered and not taken: checking the access token on the server with the project's signing
keys, which asks Supabase Auth nothing per save. A session ended elsewhere would then still save
until its access token ran out, up to an hour, and the local stack's keys and supabase-js's
`getClaims` were not tried. Caching the answer per session in the server's memory was not taken
either: a server that runs as many short-lived functions shares no memory, and the issue asks for
no rate limiter. If saves turn out to press on the limits, these are the two to try.

## Decision 10: the unpublished-changes bar waits for publishing

Nothing can be published yet (issues 20 to 22), so there is no published revision for a draft
to differ from. A bar that said "You have unpublished changes" would be untrue for every page,
and a published state made up to compare with would be worse. The bar comes with publishing,
which adds `published_revision_id` (ADR 0005, Decision 3); the draft and the published page are
already apart, as the plan wants: the draft is `pages.draft`, and a published page will be a
revision of its own.

## Checks

- `pnpm check` runs 401 tests, 67 more than before. Without `DATABASE_URL`, 25 database tests are
  reported as skipped and 376 pass; with it, all 401 pass.
  - `apps/web/test/drafts.test.ts` (49): the server's decisions with stand-ins (a request
    without a session writes nothing and nothing it sent is read, the account and page from
    the session alone, the first save makes the page, two first saves at once, a page on a scene
    of one's own, the validators' messages through `@scena/db`'s own queries, the base, a
    database that fails, and what its log line may hold); which work opens, by every row of Decision 6, and how the record is
    read; the
    autosave in the browser with fake timers (the two seconds, a change while a save is on its
    way, a reload inside the two seconds, the retries and their waits, the indicator while they
    go on, edits while a try waits, work the account has already ending the tries, each warning
    said once, the routine states not said, a refusal, the session ending, a scene of one's own,
    the account's page opening over other work, switching devices, work typed back to an earlier
    saved version while signed out or after a save with no answer, a set-aside copy already kept
    and an account's page
    that would not open, both said aloud, two tabs, a save heard while one's own is on its way,
    looking again, a save after one that got no answer, nothing sent while the studio is not on
    screen, an old copy of the route with and without changes not sent, one from before the
    page was made, an account behind the record, a refusal that comes late, no question to the
    server after a try with no answer, a save answered with an error, and one the server no
    longer knows); and the indicator's words.
  - `apps/web/test/session.test.ts` (one more): `whoIsAsking` for each answer of Supabase Auth
    and the database, a session that has run out (could not say, to a save; no one, to a page;
    Supabase Auth not asked), and the studio route's read of the page, and what it does when
    that read fails.
  - `apps/web/test/boundary.test.ts`: the new client modules are walked, the walk stops at the
    draft's server actions, and their module is marked as one.
  - `packages/studio/test/host.test.ts` (13): the store tells the host of each change and each
    save, in the moment of the write, and of no save that was not made; the host's work opens
    with what was open set aside and its reason, saved in this browser in the same moment, and
    without setting aside when it is the same work, holds nothing, or the host gives no reason;
    it is refused when a copy is kept already or the work would not open; the indicator without
    a host as before, with one not a live region, the routine words keeping each other's room,
    and the studio's warnings first.
  - `packages/db`: the revision (counted by saves and changes of address, a save from an older
    revision written and said to replace one, two at once, a refused save counts nothing) and a
    page with no address (keeps its draft's handle, found by none, many of them, the first
    address), with a database; the draft's handle and the base checked before the database is
    asked, without one.
- `pnpm verify:web`: 90 checks with Google off (91 with it on, as CI runs it), the 66 of before
  and 24 for autosave (`tools/autosave-checks.ts`), against the stack:
  - a visitor who is not signed in has the studio as before and sends nothing;
  - a signed-in person on a canvas of their own drawings is saved in this browser only, told
    why, and sends nothing;
  - choosing a ready-made scene says "Saving…" at once and makes the page, with no address, at
    revision 1, and then says "Saved";
  - an edit reaches the database two seconds after the last keystroke (measured from the key
    to the request, by the page's clock), and the indicator says "Saving…" until then; neither
    word is read out, and the indicator is not a live region;
  - a reload brings the edit back and sends nothing; another device opens the account's page on
    its scene;
  - a reload inside the two seconds loses nothing;
  - with the connection cut, "Offline, retrying", said aloud once, and a second try two seconds
    after the first; with the connection back, the edit arrives at once, before the next try was
    due, with no other keystroke;
  - a draft the server refuses (a character Postgres cannot keep, which the studio's own checks
    let through) has the validators' message in the indicator and said aloud, and nothing is
    written; the studio's own warning, before the account's words, is said aloud too;
  - the save action, sent again from outside the browser with no cookie and another draft,
    writes nothing and answers only `signed-out`;
  - two tabs: the last write wins, the tab whose version was replaced says so at once, the other
    is told as soon as the first saves, and the tab that lost, reloaded, has the saved version;
  - another device, looked at again, learns it has fallen behind;
  - signing in where the account has another version opens the account's, sets the work here
    aside with the reason, and sends nothing over it for longer than the two seconds;
  - switching devices, one person in two browsers: the laptop reloaded after the phone saved
    opens the phone's version with no dialog, nothing set aside or said, nothing sent, and
    "Saved"; then the other way round, and a second time on the laptop;
  - Back and then Forward to the studio, reached by the home page's link: the work saved since
    stays, with nothing set aside, sent or said, in the same document;
  - the dialog for work set aside opens once: not again when the studio comes back from another
    page of the app, with the copy still kept;
  - the top bar with the indicator in its longest words, signed in, at 375, 900, 1024, 1180,
    1200, 1280, 1366 and 1440 px, editing and previewing: its groups keep apart, nothing runs
    off, and the words show from 1180 px; with the own-scene words in Preview at 1180 and 1200
    px both gaps are at their 12 px floor;
  - Edit and Preview stay where they are between "Saving…" and "Saved" at 1180 px and at 1440
    px with the address shown, the indicator one line high with its own word alone showing;
  - no page logged an error.
- `pnpm verify:studio` (120), `pnpm verify:runtime` (17) and `pnpm parity` pass unchanged;
  `pnpm db:check` passes; `pnpm audit` reports nothing.
- One sign-in check failed once in this work: "an older link, once a newer email was sent, is
  refused". Supabase Auth's own log had the two emails five seconds apart, the second refused as
  too soon (429), and no other request in between. The check timed the five seconds from the key
  press that asked for the first email, while Supabase Auth counts from its own send, which comes
  later by however long the request takes to reach it; the margin was 0.4 s. It now takes the
  time once the page has the answer (`tools/sign-in-checks.ts`, `askForEmail`), and so do the
  autosave checks.
- `pnpm verify:studio` failed two checks once, in the last run of the gate: "tapping a drawing in
  the preview opens its panel" and the check that follows from that tap. Nothing of the studio
  had changed since the run before, which passed, and the next run passed all 120. The check
  waits a fixed 1.5 seconds after opening the preview, measures where the drawing is and taps
  there, just after choosing a typeface the preview fetches from Google Fonts; when the typeface
  arrives later, it moves the drawing. `tools/verify-web.ts` met the same and waits for the
  runtime and the typeface (`drawingInFrame`). The check now makes the same wait before it
  measures (three lines in `tools/verify-studio.ts`), with the same tap at the same point; its
  120 checks and what they assert are unchanged.

## Guards taken out, one at a time

Each was taken out alone by a script that replaced one exact piece of code, ran the tests meant
to catch it (the database tests against `scena-postgres`), and put the file back, comparing it
byte for byte. The ones only a browser can catch were taken out the same way, with the web app
rebuilt and the autosave checks run.

| Taken out | Caught by |
|---|---|
| `saveDraft` answering `replaced` from the base | 1 database test |
| `saveDraft` counting a revision | 2 database tests |
| the row lock under which `saveDraft` reads the revision | 1 database test (another save holds the row; this one must count from what that one wrote) |
| the base refused when it is not a whole number | 1 unit test |
| a page with no address keeping its draft's own handle (a fixed one instead) | 1 database test |
| a page with no address refusing a draft whose handle breaks the rule, in `saveDraft` / in `createPage` | 1 database test / 1 unit test and 1 database test |
| a change of address counting a revision | 2 database tests |
| `DROP NOT NULL` in the migration | 1 database test |
| the action answering a request without a session before anything else (a made-up account instead) | 1 unit test; "the save action called without a session writes nothing" |
| the account taken from the session, not from what was sent | 1 unit test |
| a page on a scene of one's own refused by the server | 1 unit test |
| the validators' messages passed on | 1 unit test |
| the second of two first saves at once saving as one that has seen no version | 1 unit test |
| a 429 from Supabase Auth read as "could not say", not as signed out | 1 unit test |
| a page the studio route could not read turning saving off (read as none instead) | 1 unit test |
| the two seconds (half a second instead) | 4 unit tests |
| the waits between tries (2 s each instead) | 2 unit tests |
| an edit not bringing a waiting try forward | 1 unit test |
| the work here opening when it was made from the account's page as it is | 2 unit tests |
| the account's page opening over anything else (the work here instead) | 3 unit tests |
| only a page on a ready-made scene sent / a copy of one not taken for it | 1 unit test / 1 unit test |
| a tab hearing another tab's save | 1 unit test; 2 browser checks, with the channel itself taken out of `MountedStudio.tsx` |
| a save heard while this tab's own is on its way leaving this tab behind | 1 unit test |
| looking again at most every 15 seconds | 1 unit test |
| no "replaced" notice after a try with no answer | 1 unit test |
| a refused page not sent again unchanged | 1 unit test |
| saving stopping once signed out | 1 unit test |
| nothing sent while the studio is not on screen | 1 unit test |
| nothing sent over the account's page when it cannot open | 1 unit test |
| the record written beside the studio's own save | 1 unit test |
| the `online` listener in `MountedStudio.tsx` | "with no connection… back online, the edit reaches the account at once" |
| the `visibilitychange` listener in `MountedStudio.tsx` | "another device learns it has fallen behind when it is looked at again" |
| the host told of a save only when the work was saved in this browser | 1 unit test |
| the host's work refused over a copy already set aside | 1 unit test |
| what was open set aside before the host's work opens | 2 unit tests |
| work this build could not open set aside without a host's reason | 1 unit test |
| `hasWork` comparing whatever the order of the keys | 1 unit test |
| the studio's own warning before the host's words | 1 unit test |
| the indicator without a host as it was (hidden on a phone) / with a host shown on a phone | 1 unit test / 1 unit test |
| the words hidden below 1180 px (`studio.css`) | the top bar check, by the words shown where they should not be; the groups still kept apart at 900 px with them, so the width is the account slot's, chosen to match, not one below which the bar breaks |
| `"use server"` on `drafts/actions.ts` | 2 boundary tests |
| **`keeper.stop()` when the person signs out (`MountedStudio.tsx`)** | **nothing**: the studio stops calling the host once `saving` is gone, so nothing more is sent either way. It stays, to cancel a save already waiting |
| **`router.refresh()` when a save finds the session ended** | **nothing** in the browser: the unit test sees it called, and no check ends a session while the studio is open |
| **the `focus` listener** | **nothing**: the `visibilitychange` one is checked, and a headless browser gives no reliable focus |
| **`detach()` when the studio leaves the screen** | **nothing** in the browser; the unit test checks what the class does with it |

Two notes on the runs. The first run of the row lock's break was missed: the test then started
two saves at once and hoped they would overlap, and they ran one after the other. It now holds
the row in a transaction of its own and waits until Postgres says the save is waiting for the
lock. And the first take-out of the tabs' channel failed a third check, "another device learns
it has fallen behind", which has nothing to do with the channel: that check stopped waiting when
the indicator changed, and read the live region 30 ms before the studio wrote it. It now waits
for both.

A review of the change by hand then found six things (switching devices set the work aside
every time and then stopped saving; the centre of the bar moved at every save; Saving… and Saved
were read out; a window of 350 ms after the account's page opened; a session whose renewal the
proxy could not make read as signed out to a save; and two small ones). Each fix was taken out
in turn in the same way:

| Taken out | Caught by |
|---|---|
| the account's newer page opening quietly over a version it took (`whichOpens`: set aside every time instead) | 2 unit tests; both device-switching checks (and the centre check, which then finds the laptop held, as the review did) |
| work with changes not sent never giving way quietly (the record's word ignored) | 3 unit tests |
| work the record does not describe set aside, not judged by the record | 3 unit tests |
| the record saying what is unsent (nothing, always / nothing, after a try with no answer) | 2 unit tests / 1 unit test |
| a record that does not say read as work not sent | 1 unit test |
| a tab that has stopped saving writing no record | it is held twice, in `saved()` and in `record()`: one taken out alone changes nothing; both, 1 unit test |
| the quiet opening asking the studio to set nothing aside | 1 unit test |
| the studio setting nothing aside when the host gives no reason | 1 unit test |
| the held states said aloud | 1 unit test |
| an account's page that would not open told from a kept copy | 1 unit test |
| the routine words keeping each other's room (`TopBar.tsx`) | 1 unit test; the centre check, at 1440 px |
| the words laid in one place / the other unseen (`studio.css`) | the centre check, by the indicator's height / by both words showing |
| **the words changing places at once (`transition: none`)** | **not reliably**: the centre check failed on it in three of the five runs before it was added, and passed in the one with it taken out (below) |
| the indicator with a host not a live region | 2 unit tests; "Saving… and Saved are not read out", and the studio's own warning |
| offline and retrying said as they begin | 3 unit tests; the offline check |
| each said once until a save gets an answer | 1 unit test |
| an edit / a try on its way during the tries not turning the indicator to "Saving…" | 1 unit test / 1 unit test |
| work the account has already ending the tries | 1 unit test |
| the browser online again during a try: the next one at once | 1 unit test |
| the studio's own warning said with a host | "the studio's own warning … is said aloud" |
| what the host opens saved in this browser at once | 2 unit tests |
| a renewal this client refused itself read as "could not say" | 1 unit test |
| the refusal carrying its code where auth-js reads it (`error_code`) | 1 unit test |

Notes on these runs:

- The rows on which work opens quietly are of the rule as a second check by hand left it
  (Decision 6, sixth row). That check ran the whole gate again, took out the 20 guards of the
  first table once more, with the two whose lines had changed since taken out where they are
  now, and the ones of this table: all were caught by the unit tests but the studio's own
  warning said with a host, which the browser check catches. It then built the app with the
  quiet opening and that warning taken out together: `pnpm verify:web` failed on exactly the two
  device-switching checks, the centre check and the check of the studio's own warning.
- Saying once was missed at first, and the test changed: with the indicator kept on "Offline,
  retrying" during the tries, the state is entered again only when another notice comes in
  between, and a test now has one.
- The first take-out of the quiet opening failed one check and ended the run: the dialog that
  should not have opened kept the next edit from the inspector. The check now closes such a
  dialog once it has noted it, and the take-out fails both device-switching checks.
- The centre check failed in three runs with nothing taken out that it was about, each time
  reading no word shown in the "saving" state. Under reduced motion, which the checks emulate,
  the studio's rule gives every element a 1 ms transition of every property, `visibility`
  among them; a page that draws no frame at that moment keeps the word at its first value,
  hidden. The words now change places with no transition (`studio.css`). With that, two runs of
  the autosave checks and every run after passed it; taken out, it was missed once.
- While the take-outs ran, `.next` held each taken-out build; the gate below ran on a fresh one.
- After a gate that passed, a run of the autosave checks alone failed the offline check once: the
  connection came back, and the edit arrived only at the next try, four seconds on. The check
  goes back online as soon as the second try has been sent; that try's failure had not come back
  yet, and `online()` did nothing while a try was on its way, so the browser's word was lost.
  That was the code's gap, not only the check's: it now keeps the word, and the try after the
  failing one goes at once (a unit test, and the take-out above). The gate was run again.

A code review of the pull request then found six things: Back and Forward opening an older
page over newer work, quietly; a refusal that came late leaving the corrected page unsent;
every failed save read as "Offline", a tab from before a deploy among them; a tab told that
another device had saved when the save was its own; the set-aside dialog opening again each
time the studio came back; and a failed query's log line holding the person's page. The first
was reproduced by hand before it was fixed, and tried again by hand after. Each fix was taken
out in turn:

| Taken out | Caught by |
|---|---|
| a page at an earlier revision than the record's taken for an old copy (`whichOpens`) | 4 unit tests; the Back and Forward check |
| the record's revision taken for the account's, on an old copy | 3 unit tests |
| an old copy's work taken for sent only when the record says so / nothing said of what its save replaces | 1 unit test / 1 unit test |
| nothing said of replacing a version when no page was handed in and the record has the work | 1 unit test |
| the server asked at once after an old copy | 2 unit tests |
| an account behind the record's revision given the work here | 1 unit test |
| the work that is open going after a late refusal | 1 unit test |
| no question to the server after a try with no answer | 2 unit tests |
| an answer that was an error told from no answer (the class / `MountedStudio.tsx`) | 1 unit test / the offline check, which then reads "Not saved, retrying" |
| a save the server no longer knows ending the tries | 1 unit test |
| that tab going on writing the record / not hearing other tabs / keeping its words at an edit | 1 unit test each |
| the log line without the statement, for a save / a read / an error with no cause | 1 unit test each |
| the set-aside dialog opening only as the count goes up (`App.tsx`) | the check that it opens once |
| **an action the server does not know told from other errors (`unstable_isUnrecognizedActionError`, `MountedStudio.tsx`)** | **nothing**: it needs the app built again under an open tab |

Notes on these runs:

- The tab's words at an edit were missed at first: the test reached that line only after two
  failed tries, when the indicator is left alone anyway. It now has a first try the server does
  not know.
- The three that only a browser shows (the first row, the dialog, and `MountedStudio.tsx`'s
  part of the error) were taken out together in one build. `pnpm verify:web` failed on the
  Back and Forward check, the dialog check and the offline check, and on the centre check,
  whose laptop the old page had left behind. So the built app brings the old copy back too,
  not only the development server.
- The 42 take-outs of the tables above were run again on this tree, with the same result.

## What waits

- **The unpublished-changes bar**, with publishing (Decision 10).
- **Asking which draft to keep** when the account and this browser differ, and saying whose
  account the work goes into at sign-in (issue 16). Until then the account's page opens and the
  work here is set aside (Decision 6).
- **The handle picker** (issue 17), and what Decision 2 leaves it.
- **A person's own scene on the server** (issue 65); until then their page stays in the browser.
- **Revisions** (issues 20 to 22): with them, a version replaced by the last write could be
  brought back. Today it cannot.

## Costs and risks

- **A version replaced by the last write is gone.** The tab that had it is told, if it is still
  open; a tab that was closed after saving is told nothing, and a tab that had not seen its
  changes replaces them with its own, saying only that it replaced a version it did not have.
- **And it is gone from the device that made it, too, once that device opens again.** The
  account took the version and nothing was typed there since, so that device's record says
  nothing is unsent, and the account's newer page opens over it quietly (Decision 6, sixth row):
  nothing of it is kept aside. The tab that replaced it
  was told at the time. Keeping it would need the server to remember where a replacing save came
  from and what it replaced; that is for issue 16, or for revisions (20 to 22), which would keep
  every version anyway.
- **One request to Supabase Auth per save**, from the server's address (Decision 9).
- **Someone else's work in the browser goes into an account that has no page yet**, at its first
  save, when a person signs in on a computer another person used (Decision 6, first row). Saying
  whose account the work goes into before it does is issue 16 (ADR 0006, Costs and risks).
- **A reload within 350 ms of the last keystroke loses that keystroke**, in this browser and so
  in the account: the studio saves in this browser 350 ms after a change, as it always has, and
  nothing here changed that.
- **Signing out within two seconds of an edit** leaves the edit in this browser, not in the
  account; it goes at the next sign-in on this browser (Decision 6, third row).
- **The record is per browser, and the studio's saved work is shared by its tabs.** Two tabs
  write both, so the record may describe one tab's work while the studio's saved work is the
  other's: one tab's save is answered after the other has saved its work here, and the browser
  is closed before the other's own save is answered. The record then says nothing of the work
  that is here, and when the account has another version that work is set aside and the person
  is told. Nothing is lost, though the account may have had that version, so the dialog can open
  when nothing was in conflict.
- **A tab of another device that is never looked at again** learns it was replaced only at its
  next save (Decision 4).
- **A tab that was offline when its try got no answer** says nothing of a replacement at its next
  save (Decision 7), so a real one is not said there; the tab that lost is still told.
- **A save that reached the account and whose answer never came**, from a browser closed before
  its next try, **followed by a save from another device**, leaves the first device's version
  reading as unsent: its record never heard that the account took it. It is set aside and said
  when that device opens again. Nothing is lost.
- **The account's page is in the studio route's HTML**, for the person it belongs to; the server
  renders it for each request and caches nothing. The browser does keep the route as it was
  sent, for Back and Forward (Decision 6, fifth row), so the page handed in can be an old copy.
  One that this browser has saved over since is known by its revision. One that only another
  device has saved over since is not, and is found as any open tab finds it: when the tab is
  looked at again, or from the answer to its next save.
- **A tab from before a deploy does not save to the account** until it is loaded again, and says
  so (Decision 7). What is typed there meanwhile is in this browser, and goes when it is.
- **A failed query's log line has what the database said, not the statement**, whose parameters
  include the person's page (`whatFailed` in `drafts/save.ts`), for a save and for the reads
  `auth/server.ts` makes for the studio.
- **"Start over", then a ready-made scene, replaces the account's page at the next save**, as any
  edit does. The studio's dialogs say what happens "in this browser", which is true of each step,
  and Undo brings the work back until the studio is closed; the account keeps no older version.

## Open questions

- Whether "Saving…" should wait the two seconds out as something quieter ("Edited"), and show
  only while the request is on its way.
- Whether a tab told it is behind should stop autosaving until the person reloads or says to
  keep this tab's version: safer, and the question issue 16 asks for sign-in.
- What Supabase Auth's limits are for reading the user on a hosted project (Decision 9).

## Consequences

**Good**

- A signed-in person's page is in their account two seconds after they stop typing, opens on
  their other devices, and survives a reload at any moment the browser had it.
- The validators the studio, the server and the database share are now the server boundary's too,
  with their messages shown to the person.
- The studio stays one editor with no accounts in it; the web app's part is one prop.

**Costs**

- A nullable handle, which every reader of a page now has to expect.
- A second record in `localStorage` beside the studio's own, and a second place the work can be,
  which the person sees in the indicator.
- 24 more browser checks and the time they take, and a sign-in for each
  person they use.
