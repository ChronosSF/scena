// What passes between the studio in the browser and the server actions that keep a signed-in
// person's draft (actions.ts): plain data, shared by both sides. Nothing here names an
// account: the server finds the person from the session, and their page from that.

import type { PageDocument } from "@scena/scene";

/** The account's page, as the studio route hands it to the browser: what the studio needs, and no more. */
export interface AccountPage {
  pageId: string;
  /** The draft revision it is at (packages/db, draftRevision). */
  revision: number;
  page: PageDocument;
  /** The page's address, or null while it has none: the draft's own handle is then text, and no address (docs/adr/0008-handles.md). */
  address: string | null;
}

/** What the browser sends: the page, and the draft revision it was made from (null: it has seen none). */
export interface DraftToSave {
  page: PageDocument;
  base: number | null;
}

/** Why a save wrote nothing, other than a draft the validators refused. */
export type NotSaved = "signed-out" | "unavailable" | "own-scene";

export type SaveAnswer =
  /**
   * Saved as `revision`. `replaced`: it replaced a version saved from elsewhere that this tab did
   * not have. `address`: the page's address as the save found it, which another tab or device
   * may have changed.
   */
  | { ok: true; pageId: string; revision: number; replaced: boolean; address: string | null }
  | { ok: false; reason: NotSaved }
  /** The validators' messages, each with its path, as packages/db gives them. */
  | { ok: false; reason: "invalid"; problems: string[] };

/** The account's page as it is now: its revision and its address, or nulls when there is no page yet. */
export type RevisionAnswer =
  | { ok: true; pageId: string | null; revision: number | null; address: string | null }
  | { ok: false; reason: "signed-out" | "unavailable" };
