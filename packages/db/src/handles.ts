// The handle rule as the database package applies it: the scene package's rule (one pattern
// for the validator, the studio and this package), and then the reserved words. The database
// adds the last word on duplicates: handles are citext and unique, so "Pia" and "pia" are one.

import { HANDLE_RULE, isHandle } from "@scena/scene";
import { RESERVED_HANDLES } from "./reserved.ts";
import { refuse, type Refusal } from "./result.ts";

const RESERVED = new Set(RESERVED_HANDLES.map((h) => h.toLowerCase()));

/** Whether a handle is on the public reserved list, whatever its case. */
export const isReserved = (handle: string): boolean => RESERVED.has(handle.toLowerCase());

export const reservedRefusal = (handle: string): Refusal =>
  refuse("reserved", `handle: "${handle}" is kept for the site itself; choose another address`);

export const takenRefusal = (handle: string): Refusal =>
  refuse("taken", `handle: "${handle}" is taken; choose another address`);

/**
 * Why a handle cannot be a page's address, without asking the database: it breaks the handle
 * rule, or it is on the public reserved list. Null when neither is so. The database still has
 * the last word, on its own reserved rows and on handles that are taken.
 */
export function handleProblem(handle: unknown): Refusal | null {
  if (!isHandle(handle)) return refuse("invalid", `handle: ${HANDLE_RULE}`);
  if (isReserved(handle)) return reservedRefusal(handle);
  return null;
}
