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

/** What comes before a handle in a page's address, as a person reads it: scena.example/<handle>. */
export const ADDRESS_PREFIX = "scena.example/";

/** The longest a handle can be, in characters: what the pattern allows. */
export const HANDLE_MAX = 30;

/** What a handle may be, in words a person can act on. */
export const HANDLE_RULE = "2 to 30 characters: lowercase letters, digits, - and _, starting with a letter or digit";

/**
 * How long a page holds the handle it moved away from, counted from the change: nobody else can
 * take it meanwhile, its owner can go back to it, and its redirect lasts as long. The rule that
 * reads it is the database package's (heldHandle); it is here so that the picker can say it.
 */
export const HANDLE_HOLD_DAYS = 30;

/** Whether `v` follows the handle rule. Reserved words are the database package's to refuse. */
export function isHandle(v: unknown): v is string {
  return typeof v === "string" && HANDLE.test(v);
}

// One character at a time, each looked at once, and never more of the result than a handle can
// be, so a name of any length takes linear time.
const KEPT = /^[a-z0-9_]$/;
const MARK = /^\p{M}$/u;

// Latin letters that Unicode does not write as a base letter and a mark, so NFKD leaves them
// whole, spelt as they are without one. The pattern is one character from this list: one way
// to match anything.
const FOLD: Readonly<Record<string, string>> = { ß: "ss", ø: "o", ł: "l", æ: "ae", œ: "oe", đ: "d", ð: "d", þ: "th", ı: "i" };
const FOLDED = new RegExp(`[${Object.keys(FOLD).join("")}]`, "g");

/**
 * A handle made from a person's name, for the handle picker to start from: "Zoë Müller" gives
 * "zoe-muller", "Søren Kjær" "soren-kjaer". Letters lose their marks, everything a handle cannot
 * have becomes one "-" for each run of it, nothing but a letter or digit is left at either end,
 * and it is cut to HANDLE_MAX. Null when what is left is not a handle (a name with no Latin
 * letter or digit in it, or only one). Whether it is reserved or taken is for the database
 * package to answer.
 */
export function suggestHandle(name: string | null): string | null {
  let out = "";
  // NFKD writes a letter and its marks apart ("ë" is "e" and a diaeresis), and spells out
  // compatibility forms ("ﬁ" is "fi", a full-width "Ａ" is "A"); then the marks are dropped.
  for (const c of (name ?? "").normalize("NFKD").toLowerCase().replace(FOLDED, (l) => FOLD[l]!)) {
    if (out.length > HANDLE_MAX) break;
    if (MARK.test(c)) continue;
    if (KEPT.test(c) && (out || c !== "_")) out += c;
    else if (out && !out.endsWith("-")) out += "-";
  }
  out = out.slice(0, HANDLE_MAX);
  let end = out.length;
  while (end > 0 && (out[end - 1] === "-" || out[end - 1] === "_")) end--;
  out = out.slice(0, end);
  return isHandle(out) ? out : null;
}
