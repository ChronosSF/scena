// @scena/db: the database, for server code only (Node, no DOM). Nothing that runs in a browser
// imports it: not the studio, not the renderer.
//
// The tables are not exported. Every write goes through a query here, and the queries that
// write a page's draft run the scene package's validators on it first; an invalid draft writes
// nothing and comes back with their messages. Decisions: docs/adr/0005-database-package.md.

export { connect, disconnect, type ConnectOptions, type Database } from "./client.ts";
export { createUser, getUser, noteSeen, type NewUser, type User } from "./users.ts";
export { changeHandle, createPage, getPageByHandle, getPageByUser, handleAvailability, saveDraft, type Page, type PageStatus } from "./pages.ts";
export { writeAudit, type AuditEntry } from "./audit.ts";
export { handleProblem, heldHandle, type HandleAvailability } from "./handles.ts";
export { RESERVED_HANDLES } from "./reserved.ts";
export { DRAFT_MAX_BYTES } from "./draft.ts";
export type { Refusal, RefusalReason, Result } from "./result.ts";
