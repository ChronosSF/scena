// What a person is told when sign-in does not go as they asked: plain sentences they can act
// on, chosen from fixed lists. What Supabase Auth says is read for its code only and never
// shown, and no answer differs between an address that has an account and one that has not.
// Tokens and codes appear in none of them.

/** Said on the sign-in page after a redirect, by a fixed key in its address (?notice=…). */
export const NOTICES = {
  link: "That sign-in link has expired or has already been used. Ask for a new email below.",
  deleted: "This account has been deleted, so you have been signed out. It cannot be used again while the deletion is being carried out.",
  taken: "This email address belongs to an older Scena account that does not match this sign-in, so you have been signed out and nothing was changed. Please get in touch, and we will sort it out by hand.",
  profile: "We could not finish signing you in, so you have been signed out. Nothing was lost: try again in a moment.",
  google: "Signing in with Google did not finish. Try again, or use your email address instead.",
  busy: "Too many sign-in attempts have come from here in the last few minutes. Wait a few minutes, then try again.",
  unavailable: "Sign-in is not working right now. Your work in the studio is safe in this browser; try again in a moment.",
  "signed-out": "You have signed out. Your work in the studio stays in this browser.",
} as const;

export type Notice = keyof typeof NOTICES;

const isNotice = (key: unknown): key is Notice => typeof key === "string" && Object.hasOwn(NOTICES, key);

/** The notice for a key from a query string, or null for a key that is not one of them. */
export const noticeFor = (key: unknown): Notice | null => (isNotice(key) ? key : null);

/** What an error from Supabase Auth carries that is safe to read. */
export interface AuthProblem {
  code?: string | undefined;
  status?: number | undefined;
  name?: string | undefined;
}

export const SEND = {
  invalid: "Enter an email address, such as name@example.com.",
  // per address, and the project's own limit per hour: neither says anything about an account
  wait: "An email was sent to this address a moment ago. Use the link or the code in it, or wait a minute and ask again.",
  busy: NOTICES.busy,
  undeliverable: "We could not send an email to that address. Check it for a typo, or try another address.",
  unavailable: NOTICES.unavailable,
} as const;

export const CODE = {
  shape: "The code is the 6 digits in the email. Type them here, without anything else.",
  wrong: "That code is not right, or it has expired. Check that it is from the newest email, or ask for a new one.",
  busy: NOTICES.busy,
  unavailable: NOTICES.unavailable,
} as const;

const unreachable = (p: AuthProblem) => p.name === "AuthRetryableFetchError" || (p.status ?? 0) >= 500 || p.status === 0;

/** What to say when asking for the email failed. */
export function sendProblem(p: AuthProblem): string {
  if (unreachable(p)) return SEND.unavailable;
  switch (p.code) {
    case "over_email_send_rate_limit": return SEND.wait;
    case "over_request_rate_limit": return SEND.busy;
    case "validation_failed":
    case "email_address_invalid": return SEND.invalid;
    case "email_address_not_authorized": return SEND.undeliverable;
    default: return SEND.unavailable;
  }
}

/** What to say when a typed code was not accepted. */
export function codeProblem(p: AuthProblem): string {
  if (unreachable(p)) return CODE.unavailable;
  switch (p.code) {
    case "otp_expired":
    case "otp_invalid":
    case "validation_failed": return CODE.wrong;
    case "over_request_rate_limit": return CODE.busy;
    default: return CODE.unavailable;
  }
}

/** The notice for a link that was not accepted. */
export function linkNotice(p: AuthProblem): Notice {
  if (unreachable(p)) return "unavailable";
  if (p.code === "over_request_rate_limit") return "busy";
  return "link";
}
