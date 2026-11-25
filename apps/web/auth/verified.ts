// Whether a signed-in person has shown that the email address on their account is theirs. The
// plan asks for that before a first publish (§6.6). Signing in by the link or the code shows
// it by itself, and so does Google for an address Google has confirmed; Supabase Auth then
// records the moment. Publishing (milestone 2) asks through verifiedAccount() in server.ts,
// which reads this from Supabase Auth on each call rather than from the cookie.

export interface VerifiableUser {
  email?: string | null | undefined;
  email_confirmed_at?: string | null | undefined;
}

export function emailVerified(user: VerifiableUser): boolean {
  return !!user.email && !!user.email_confirmed_at && Number.isFinite(Date.parse(user.email_confirmed_at));
}
