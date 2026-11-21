// Runs in front of every page: makes a nonce for the request and sends the Content Security
// Policy that names it (csp.ts). Next.js reads the nonce from the policy on the request and
// puts it on the scripts it renders, which is why every page is rendered for its request
// (app/layout.tsx).
//
// It also renews a signed-in person's session once its access token has run out
// (auth/session.ts), before the page renders: the renewed cookie goes into the request the page
// renders with and into the response. A visitor with no session cookie costs nothing here, and
// no response of this app sets a cookie for them.
import { NextResponse, type NextRequest } from "next/server";
// the generated module alone: this file runs in front of every request, and needs one constant of the renderer
import { RUNTIME_SHA256 } from "@scena/renderer/runtime";
import { renewSession, type Renewal } from "./auth/session.ts";
import { newNonce, policyFor } from "./csp.ts";

export async function proxy(request: NextRequest) {
  const policy = policyFor({
    nonce: newNonce(),
    pageRuntimeSha256: RUNTIME_SHA256,
    dev: process.env.NODE_ENV === "development",
  });

  // First, so that the request's cookies are the renewed ones when its headers are copied below.
  // A renewal that fails leaves the request as it came: the page then asks Supabase Auth itself
  // and finds no one signed in, rather than the whole app failing with it.
  let renewal: Renewal | null = null;
  try {
    renewal = await renewSession(request);
  } catch (e) {
    console.error(`proxy: the session could not be renewed: ${(e as Error).message}`);
  }

  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  if (renewal) {
    for (const w of renewal.writes) response.cookies.set(w.name, w.value, w.options as Parameters<typeof response.cookies.set>[2]);
    for (const [name, value] of Object.entries(renewal.headers)) response.headers.set(name, value);
  }
  return response;
}

export const config = {
  // Everything but the files under _next/static and the icon, which are not documents. No
  // request is let through on what its headers say it is: one that calls itself a prefetch
  // is still answered with a document, and a document without the policy can be shown. The
  // files left out never get a cookie: a renewal happens on a document, never on a file.
  matcher: ["/((?!_next/static|_next/image|icon\\.svg).*)"],
};
