"use server";
// The server actions that keep a signed-in person's draft in their account: the studio's
// autosave sends the page here (drafts/autosave.ts), and a tab asks here whether another tab or
// device has saved since it last did. Each is a POST to the studio's own page, which Next.js
// accepts only from this origin, and each takes what it is sent as if anyone had sent it: who
// is asking comes from the session, and their page from that, never from the request. The
// decisions are in save.ts; this file gives them the session and the database.

import { createPage, getPageByUser, saveDraft } from "@scena/db";
import { database } from "../auth/db.ts";
import { whoIsAsking } from "../auth/server.ts";
import type { RevisionAnswer, SaveAnswer } from "./answer.ts";
import { accountRevision, saveToAccount, type DraftQueries } from "./save.ts";

const queries = (): DraftQueries => ({
  who: whoIsAsking,
  pageOf: (userId) => getPageByUser(database(), userId),
  create: (userId, draft) => createPage(database(), { userId, draft }),
  save: (input) => saveDraft(database(), input),
});

/** Saves the page the browser sent (a DraftToSave) into the signed-in person's own page. */
export async function saveDraftToAccount(sent: unknown): Promise<SaveAnswer> {
  return saveToAccount(queries(), sent);
}

/** The signed-in person's page: its id and revision now. */
export async function accountDraftRevision(): Promise<RevisionAnswer> {
  return accountRevision(queries());
}
