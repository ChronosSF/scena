// The audit log: one row for each thing worth being able to account for later, such as a
// publish, a domain change or a plan change (plan §5). Entries are only ever added.

import type { Database } from "./client.ts";
import { auditLog } from "./schema.ts";

export interface AuditEntry {
  id: number;
  /** Who did it: null for the system, or once the account is gone. */
  userId: string | null;
  /**
   * What was done, as a dotted name: "page.publish". A page's address writes three: its first
   * ("handle.choose"), a change ("handle.change"), and one taken from it ("handle.release").
   */
  action: string;
  /** What it was done to, as kind and id: "page:<id>". */
  target: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Writes one entry. The caller is the app's own code, so a failure throws. Given a transaction,
 * the entry is written in it, and goes if the change it records does.
 */
export async function writeAudit(db: Pick<Database, "insert">, entry: { userId: string | null; action: string; target: string; meta?: Record<string, unknown> }): Promise<AuditEntry> {
  if (!entry.action || !entry.target) throw new Error("An audit entry needs an action and a target.");
  const [row] = await db.insert(auditLog).values({ userId: entry.userId, action: entry.action, target: entry.target, meta: entry.meta ?? {} }).returning();
  return row!;
}
