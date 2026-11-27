// What passes between the address picker in the browser and the server actions that check an
// address and give it to the page (actions.ts): plain data, shared by both sides. Nothing here
// names an account or a page: the server finds the person from the session, and their page
// from that. docs/adr/0008-handles.md

/** Why an address cannot be the page's, by the database package's rules (packages/db, HandleAvailability). */
export type NotTakeable = "invalid" | "reserved" | "taken";

/** Why the server said nothing of the address: no one is signed in, or it could not say just now. */
export type NoAnswer = "signed-out" | "unavailable";

/** What the browser asks about: what was typed, and the name on the page, which the free ones near it are made from. */
export interface AddressQuestion {
  address: string;
  name: string;
}

export type CheckAnswer =
  /** It can be the page's: free, the page's own already, or the address the page left, held for it until `until`. */
  | { ok: true; state: "free" | "yours" }
  | { ok: true; state: "held"; until: Date }
  /** It cannot, and `free` has up to three addresses near it that can, each checked in the same call. */
  | { ok: false; reason: NotTakeable; free: string[] }
  | { ok: false; reason: NoAnswer };

export type ClaimAnswer =
  /**
   * The page is at `address` now, and its draft at `revision`: a change of address moves the
   * draft on by one, and writes the address into it. `held` is what the address it left does
   * now: it leads to the new one, and stays the page's, until `until`; null for a first address.
   */
  | { ok: true; address: string; revision: number; held: { address: string; until: Date } | null }
  /** `no-page`: the account has no page yet for the address to be given to. */
  | { ok: false; reason: NotTakeable | NoAnswer | "no-page" };
