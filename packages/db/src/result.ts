// What a write returns. A refusal is an answer, not an exception: an invalid draft or a taken
// handle is something a person did, and the caller shows them the problems. An exception is
// left for what nobody can fix by typing, such as the database being down.

import postgres from "postgres";

/**
 * Why a write was refused:
 * - `invalid`: the input breaks a rule (the draft's format, the handle rule); `problems` are
 *   the validators' messages, each with its path
 * - `reserved`: the handle is kept for the site itself
 * - `taken`: another account has the handle or the email address
 * - `exists`: the account already has the thing being created
 * - `deleted`: the account is marked deleted, so it has no profile to read and none to make
 * - `not-found`: no such account or page, or it is not this account's
 */
export type RefusalReason = "invalid" | "reserved" | "taken" | "exists" | "deleted" | "not-found";

/** A refused write. Nothing was written. Each problem is a sentence a person can act on. */
export interface Refusal {
  ok: false;
  reason: RefusalReason;
  problems: string[];
}

export type Result<T> = ({ ok: true } & T) | Refusal;

export const refuse = (reason: RefusalReason, ...problems: string[]): Refusal => ({ ok: false, reason, problems });

/** The error the Postgres server sent, under whatever Drizzle wrapped around it. */
export function serverError(e: unknown): postgres.PostgresError | undefined {
  for (let c = e, depth = 0; c && depth < 5; c = (c as { cause?: unknown }).cause, depth++) {
    if (c instanceof postgres.PostgresError) return c;
  }
  return undefined;
}

/** The name of the unique constraint a write broke, if that is why it failed. */
export function brokenUnique(e: unknown): string | undefined {
  const err = serverError(e);
  return err?.code === "23505" ? err.constraint_name : undefined;
}

/** Whether a write failed because a row it points at does not exist. */
export const brokenReference = (e: unknown): boolean => serverError(e)?.code === "23503";

// Ids are uuids. One that is not is answered as "no such row" without asking the database,
// which would otherwise fail on the cast. The pattern has fixed lengths, so it runs in linear time.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
