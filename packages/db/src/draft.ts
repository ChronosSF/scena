// A page's draft is a PageDocument, stored as it is (jsonb). The scene package's validators are
// the definition of a valid one: nothing here restates the format. Every write of a draft goes
// through checkDraft, and the draft column's type takes only what checkDraft returns.

import { HANDLE_MAX, isHandle, migrate, validatePage, type PageDocument } from "@scena/scene";
import { BUILT_IN_SCENES } from "@scena/scenes";

declare const checked: unique symbol;

/**
 * A page document that the validators passed. Only this module makes one, so a query that
 * writes a draft without checking it first does not compile.
 */
export type CheckedDraft = PageDocument & { readonly [checked]: true };

/**
 * `sentHandle` is the handle the draft arrived with when it follows the handle rule, and null
 * when it does not. It is kept only for a page that has no address yet (pages.ts).
 */
export type DraftCheck = { ok: true; draft: CheckedDraft; sentHandle: string | null } | { ok: false; problems: string[] };

/** The largest draft kept, as JSON. A finished page is a few kilobytes. */
export const DRAFT_MAX_BYTES = 64 * 1024;

// The handle a draft is checked with. A draft's handle is not the caller's to choose: the
// page's own handle is written into it before it is stored (withHandle), so the one it arrives
// with is not kept, and is not checked here. (A page with no address yet keeps the one it
// arrives with, if it follows the rule: pages.ts.) This one is as long as a handle can be, so
// that the size measured below is the most the stored draft can come to, whatever handle the
// page has or moves to.
const ANY_HANDLE = "a".repeat(HANDLE_MAX);

/** The deepest a draft may nest. A page document goes four levels down; this leaves room to spare. */
export const DRAFT_MAX_DEPTH = 32;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// Whether a value nests deeper than `limit`. It goes down level by level with a list of its own,
// not by calling itself, so its answer never depends on how much stack there is. The validators
// accept fields they do not know, and such a field can be nested as deep as its sender likes.
function nestsDeeperThan(v: unknown, limit: number): boolean {
  let level: unknown[] = [v];
  for (let depth = 0; level.length; depth++) {
    if (depth > limit) return true;
    const next: unknown[] = [];
    for (const item of level) {
      if (item === null || typeof item !== "object") continue;
      for (const child of Object.values(item)) next.push(child);
    }
    level = next;
  }
  return false;
}

/**
 * Migrates a document to the current schema and runs the scene package's validators on it.
 * A page on one of the ready-made scenes is checked against that scene as well: its palette,
 * and which links it may turn off. The problems are the validators' own messages, each with
 * its path ("links[\"shop\"].url: use https:// or mailto:"), ready to show to a person.
 */
export function checkDraft(doc: unknown): DraftCheck {
  if (!isObject(doc)) return { ok: false, problems: validatePage(doc) };
  // First, because everything after it (the copy, the validators, the checks below) walks the
  // document by calling itself, and would run out of stack on one nested deep enough.
  if (nestsDeeperThan(doc, DRAFT_MAX_DEPTH)) return { ok: false, problems: [`page: nested more than ${DRAFT_MAX_DEPTH} levels deep, which no page document is`] };
  let page: PageDocument;
  try {
    page = migrate(doc, "page");
  } catch (e) {
    return { ok: false, problems: [`schemaVersion: ${(e as Error).message}`] };
  }
  const sentHandle = isHandle(page.handle) ? page.handle : null;
  page.handle = ANY_HANDLE; // migrate returned a copy
  const sceneId = isObject(page.scene) ? page.scene.id : undefined;
  const scene = BUILT_IN_SCENES.find((b) => b.scene.id === sceneId)?.scene;
  const problems = validatePage(page, scene);
  storageProblems(page, "", problems);
  const bytes = new TextEncoder().encode(JSON.stringify(page)).length;
  if (bytes > DRAFT_MAX_BYTES) problems.push(`page: ${Math.ceil(bytes / 1024)} KB, the limit for a saved page is ${DRAFT_MAX_BYTES / 1024} KB`);
  return problems.length ? { ok: false, problems } : { ok: true, draft: page as CheckedDraft, sentHandle };
}

/** The draft with the page's handle in it, which is the only handle a stored draft carries. */
export function withHandle(draft: CheckedDraft, handle: string): CheckedDraft {
  if (!isHandle(handle)) throw new Error(`The page's handle "${handle}" does not follow the handle rule, so no draft can carry it.`);
  return { ...draft, handle };
}

// Postgres's jsonb cannot hold the character U+0000, nor half of a surrogate pair (half of an
// emoji, as text cut in the wrong place leaves it). The validators accept both, and the write
// would then fail inside the database, so they are refused here with their path. The pattern
// has no repetition, so it runs in linear time. A profile's text is held to it too (users.ts).
export const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;
const CANNOT_SAVE = "contains a character that cannot be saved (a null character, or half of an emoji); remove it";

function storageProblems(v: unknown, path: string, out: string[]): void {
  if (typeof v === "string") {
    if (UNSTORABLE.test(v)) out.push(`${path || "page"}: ${CANNOT_SAVE}`);
  } else if (Array.isArray(v)) {
    v.forEach((item, i) => storageProblems(item, `${path}[${i}]`, out));
  } else if (isObject(v)) {
    for (const [key, item] of Object.entries(v)) {
      if (UNSTORABLE.test(key)) { out.push(`${path || "page"}: a name in it ${CANNOT_SAVE}`); continue; }
      // written as the validators write paths: a link by its slot id in brackets, a field after a dot
      const at = path === "links" || !PLAIN_KEY.test(key) ? `${path}[${JSON.stringify(key)}]` : path ? `${path}.${key}` : key;
      storageProblems(item, at, out);
    }
  }
}
