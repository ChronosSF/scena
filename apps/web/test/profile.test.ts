// What a sign-in does with each answer of @scena/db's createUser (auth/profile.ts). The two
// queries are stand-ins here; the same answers from a real database are checked in
// tools/verify-web.ts (a deleted account, an address another profile holds, a second sign-in).
import { describe, expect, test } from "vitest";
import type { NewUser, Result, User } from "@scena/db";
import { NOTICES } from "../auth/messages.ts";
import { profileFor, settleProfile, type AuthUser, type ProfileQueries } from "../auth/profile.ts";

const ID = "0b7e7dee-87b4-4a43-9a9a-6f1c0b2d9a11";
const person: AuthUser = { id: ID, email: "pia@example.com", user_metadata: { email: "pia@example.com", email_verified: true } };
const profile = (over: Partial<User> = {}): User => ({ id: ID, email: "pia@example.com", displayName: null, locale: "en", isAdmin: false, createdAt: new Date(0), ...over });

/** Queries that answer as told, and remember what they were asked. */
function queries(read: (User | null)[], made: Result<{ user: User }>) {
  const asked: { read: string[]; made: NewUser[] } = { read: [], made: [] };
  const q: ProfileQueries = {
    async getUser(id) { asked.read.push(id); return read.length > 1 ? read.shift()! : read[0]!; },
    async createUser(input) { asked.made.push(input); return made; },
  };
  return { q, asked };
}
const refused = (reason: "invalid" | "taken" | "exists" | "deleted", problem: string): Result<{ user: User }> => ({ ok: false, reason, problems: [problem] });

describe("the profile made at the first sign-in", () => {
  test("has Supabase Auth's id and address, and the name Google gave, if any", () => {
    expect(profileFor(person)).toEqual({ id: ID, email: "pia@example.com", displayName: null });
    expect(profileFor({ ...person, user_metadata: { full_name: "Pia Morandi", name: "Pia" } }).displayName).toBe("Pia Morandi");
    expect(profileFor({ ...person, user_metadata: { name: "Pia" } }).displayName).toBe("Pia");
    expect(profileFor({ ...person, user_metadata: { full_name: "   ", name: "Pia" } }).displayName).toBe("Pia");
    expect(profileFor({ ...person, user_metadata: { full_name: 42 } }).displayName).toBeNull();
    expect(profileFor({ ...person, user_metadata: null }).displayName).toBeNull();
    // a provider's locale is not passed on: a sign-in must not fail over one that is not a language tag
    expect(profileFor({ ...person, user_metadata: { locale: "english please" } })).not.toHaveProperty("locale");
    // no address: createUser refuses it as invalid, which settleProfile turns into a sign-out
    expect(profileFor({ id: ID }).email).toBe("");
  });
});

describe("each answer of createUser", () => {
  test("a profile that is there already: signed in, nothing made", async () => {
    const { q, asked } = queries([profile()], { ok: true, user: profile() });
    expect(await settleProfile(q, person)).toEqual({ ok: true, profile: profile(), created: false });
    expect(asked.made).toEqual([]);
  });

  test("none yet: made, and signed in", async () => {
    const { q, asked } = queries([null], { ok: true, user: profile() });
    expect(await settleProfile(q, person)).toEqual({ ok: true, profile: profile(), created: true });
    expect(asked.made).toEqual([{ id: ID, email: "pia@example.com", displayName: null }]);
  });

  test("exists: another sign-in made it a moment ago, so it is read again and the person is signed in", async () => {
    const { q, asked } = queries([null, profile()], refused("exists", "This account already has a profile."));
    expect(await settleProfile(q, person)).toEqual({ ok: true, profile: profile(), created: false });
    expect(asked.read).toEqual([ID, ID]);
  });

  test("exists, and still nothing to read: not signed in", async () => {
    const { q } = queries([null, null], refused("exists", "This account already has a profile."));
    expect(await settleProfile(q, person)).toMatchObject({ ok: false, notice: "profile" });
  });

  test("deleted: signed out, and told the account was deleted", async () => {
    const { q } = queries([null], refused("deleted", "This account was deleted."));
    expect(await settleProfile(q, person)).toEqual({ ok: false, notice: "deleted", problems: ["This account was deleted."] });
    expect(NOTICES.deleted).toMatch(/deleted/);
  });

  test("taken: an older profile has the address under another id; signed out, told, and nothing is merged", async () => {
    const { q, asked } = queries([null], refused("taken", "email: another account uses this address"));
    expect(await settleProfile(q, person)).toEqual({ ok: false, notice: "taken", problems: ["email: another account uses this address"] });
    // one attempt to make it, no other write
    expect(asked.made).toHaveLength(1);
    expect(NOTICES.taken).toMatch(/nothing was changed/);
  });

  test("invalid: signed out, told to try again, and the reason kept for the log", async () => {
    const { q } = queries([null], refused("invalid", "email: expected an email address"));
    expect(await settleProfile(q, { id: ID })).toEqual({ ok: false, notice: "profile", problems: ["email: expected an email address"] });
    // the person is not shown the package's wording
    expect(NOTICES.profile).not.toMatch(/expected/);
  });

  test("a database that fails is not taken for an answer: the error goes to the caller, which signs the person out", async () => {
    const q: ProfileQueries = { getUser: async () => { throw new Error("connection refused"); }, createUser: async () => { throw new Error("never asked"); } };
    await expect(settleProfile(q, person)).rejects.toThrow("connection refused");
  });
});
