"use server";
// The server actions of the address picker: the live check of what is typed, and the claim that
// gives the person's page its address or moves it. Each is a POST to the studio's own page,
// which Next.js accepts only from this origin, and each takes what it is sent as if anyone had
// sent it: who is asking comes from the session, and their page from that, never from the
// request. The decisions are in choose.ts; this file gives them the session and the database.

import { changeHandle, getPageByUser, handleAvailability } from "@scena/db";
import { database } from "../auth/db.ts";
import { whoIsAsking } from "../auth/server.ts";
import type { CheckAnswer, ClaimAnswer } from "./answer.ts";
import { addressCheck, addressClaim, type AddressQueries } from "./choose.ts";

const queries = (): AddressQueries => ({
  who: whoIsAsking,
  pageOf: (userId) => getPageByUser(database(), userId),
  availability: (userId, handle) => handleAvailability(database(), { userId, handle }),
  change: (input) => changeHandle(database(), input),
});

/** Whether the signed-in person may take the address they typed (an AddressQuestion), and free ones near it when not. */
export async function checkAddress(sent: unknown): Promise<CheckAnswer> {
  return addressCheck(queries(), sent);
}

/** Gives the signed-in person's page the address they chose (an AddressQuestion's), or moves it there. */
export async function claimAddress(sent: unknown): Promise<ClaimAnswer> {
  return addressClaim(queries(), sent);
}
