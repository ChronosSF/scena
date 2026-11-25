// The database schema: the four tables of the plan's data model that milestone M1 needs
// (docs/development-plan.md §5), in plain Postgres. drizzle-kit writes migrations/ from this
// file (`pnpm db:generate`), and `pnpm db:check` fails when the two disagree. Why each column
// is the way it is: docs/adr/0005-database-package.md.
//
// Every table has row-level security switched on and no policy. On Supabase, the public key
// reaches any table in the public schema through the Data API unless row-level security stops
// it; the app reaches Postgres through its own server-side connection, as the tables' owner,
// which row-level security does not limit.
//
// This file is the schema and nothing else: it is not exported from the package, so code
// outside it cannot write a table directly, around the checks in the queries.

import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { HANDLE_PATTERN } from "@scena/scene";
import type { CheckedDraft } from "./draft.ts";

if (HANDLE_PATTERN.includes("'")) throw new Error("The handle pattern has a quote in it, so it cannot be written into the constraint as it is.");

/** Text compared without regard to case (the citext extension): "Pia" and "pia" are one email, one handle. */
const citext = customType<{ data: string }>({ dataType: () => "citext" });

/** A moment, always with its time zone. */
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** A person's profile. Their identity, and how they sign in, live with the auth provider. */
export const users = pgTable("users", {
  // The auth provider's id for the person (Supabase Auth's user id), so it has no default:
  // the profile is made from a signed-in session, which brings the id.
  id: uuid("id").primaryKey(),
  email: citext("email").notNull(),
  displayName: text("display_name"),
  locale: text("locale").notNull().default("en"),
  // Whoever may open /admin in the web app (plan §7.1). It is set by hand, in SQL, and nothing
  // in this package or the app writes it: no query here names it outside the read of a
  // profile. docs/adr/0006-sign-in.md
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: at("created_at").notNull().defaultNow(),
  deletedAt: at("deleted_at"),
}, (t) => [
  // One live account per address. An account marked deleted lets go of its address, so the
  // person can sign up again while the deletion is carried out.
  uniqueIndex("users_email_live").on(t.email).where(sql`${t.deletedAt} is null`),
]).enableRLS();

export const pageStatus = pgEnum("page_status", ["draft", "published", "unpublished"]);

/** A person's page: its address, and the draft the studio edits (a PageDocument). */
export const pages = pgTable("pages", {
  // Made here, and random: a page's id goes into the public file names of its published
  // revisions (plan §6.1), where a counter would tell how many pages there are.
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  handle: citext("handle").notNull(),
  previousHandle: citext("previous_handle"),
  handleChangedAt: at("handle_changed_at"),
  // Only a document the scene package's validators passed: see draft.ts.
  draft: jsonb("draft").$type<CheckedDraft>().notNull(),
  status: pageStatus("status").notNull().default("draft"),
  createdAt: at("created_at").notNull().defaultNow(),
  // Every update made through Drizzle stamps it, with the database's clock like created_at.
  updatedAt: at("updated_at").notNull().defaultNow().$onUpdate(() => sql`now()`),
}, (t) => [
  unique("pages_handle_unique").on(t.handle),
  // One page per person in phase 1 (plan §5); a later migration drops this to allow more.
  unique("pages_user_id_unique").on(t.userId),
  // The handle rule, which the database holds too: a row written around the package cannot then
  // carry a handle the rest of the system takes to be impossible. The pattern is the scene
  // package's own (HANDLE_PATTERN), written into the constraint as it is: a constraint takes
  // no parameter, and the pattern is a constant of this repository with no quote in it. As
  // text, because citext would match it whatever the case of the letters. A change to the
  // rule shows up in `pnpm db:check` as a migration that is missing.
  check("pages_handle_rule", sql`${t.handle}::text ~ ${sql.raw(`'${HANDLE_PATTERN}'`)}`),
]).enableRLS();

/**
 * Handles no page may take. The public part of the list is in reserved.ts and is written here
 * each time the migrations run; anything else added to this table is refused as well.
 */
export const handlesReserved = pgTable("handles_reserved", {
  handle: citext("handle").primaryKey(),
}).enableRLS();

/** What was done, by whom, to what: publishes, domain changes, plan changes (plan §5). */
export const auditLog = pgTable("audit_log", {
  // A counter: entries are never shown outside, and it keeps them in the order they were written.
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  // The record of what happened outlives the account it names.
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  target: text("target").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: at("created_at").notNull().defaultNow(),
}, (t) => [
  // Lookups by person, and a deleted account's entries are found without reading the table.
  index("audit_log_user_id").on(t.userId),
]).enableRLS();
