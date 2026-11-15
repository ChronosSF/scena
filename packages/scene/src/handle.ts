// A page's address: scena.example/<handle>. Every place that checks one uses this rule: the
// page validator, the studio's address field, and the database package (packages/db), which
// also refuses the reserved words.
//
// A person types the text this pattern reads. It has one way to match any input, so it runs in
// linear time however long that input is.

/**
 * The rule as a pattern, in the syntax JavaScript and Postgres share. The database package
 * writes it into a CHECK on a page's handle, so the database holds the same rule and a change
 * here asks for a migration there.
 */
export const HANDLE_PATTERN = "^[a-z0-9][a-z0-9_-]{1,29}$";

const HANDLE = new RegExp(HANDLE_PATTERN);

/** What a handle may be, in words a person can act on. */
export const HANDLE_RULE = "2 to 30 characters: lowercase letters, digits, - and _, starting with a letter or digit";

/** Whether `v` follows the handle rule. Reserved words are the database package's to refuse. */
export function isHandle(v: unknown): v is string {
  return typeof v === "string" && HANDLE.test(v);
}
