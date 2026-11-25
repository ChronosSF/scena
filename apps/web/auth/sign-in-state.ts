// What the sign-in form shows, as the server action hands it back (actions.ts). Shared by the
// form in the browser and the action on the server, so it holds nothing but plain data.

export interface SignInState {
  /** Asking for the email, or typing the code from it. */
  step: "email" | "code";
  /** The address the person typed. It is theirs, and it is sent back so the code step can name it. */
  email: string;
  /** What went wrong just now, as a sentence for the person, or null. */
  problem: string | null;
  /** The field the problem is about. */
  field: "email" | "code" | null;
  /** How many emails were sent from this page, so that a new one is announced as new. */
  sent: number;
}

export const START: SignInState = { step: "email", email: "", problem: null, field: null, sent: 0 };
