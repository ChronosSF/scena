// Where Google sends a person back, through Supabase Auth: GET /auth/callback?code=…&next=….
// The code is exchanged for a session with the verifier /auth/google kept in this browser, so a
// code that was started anywhere else is refused. Then the profile is settled as for any
// sign-in (auth/server.ts), and the person goes back to where they started.

import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "../../../auth/env.ts";
import type { Notice } from "../../../auth/messages.ts";
import { returnPath } from "../../../auth/return-to.ts";
import { settleSignIn } from "../../../auth/server.ts";
import { CookieJar, sessionClient } from "../../../auth/supabase.ts";

export async function GET(request: NextRequest): Promise<Response> {
  const config = authConfig();
  const next = returnPath(request.nextUrl.searchParams.get("next"));
  const origin = config?.siteOrigin ?? request.nextUrl.origin;
  const signInPage = (notice: Notice) => new URL(`/sign-in?${new URLSearchParams({ notice, next })}`, origin);
  if (!config) return NextResponse.redirect(signInPage("unavailable"), 303);

  const jar = new CookieJar(request.cookies.getAll());
  const supabase = sessionClient(config, jar);
  // Google says no (the person cancelled, or Google refused) with ?error=… and no code
  const code = request.nextUrl.searchParams.get("code");
  let to = signInPage("google");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const refused = await settleSignIn(supabase, data.user);
      to = refused ? signInPage(refused) : new URL(next, config.siteOrigin);
    }
  }
  const response = NextResponse.redirect(to, 303);
  for (const w of jar.writes()) response.cookies.set(w.name, w.value, w.options as Parameters<typeof response.cookies.set>[2]);
  for (const [name, value] of Object.entries(jar.headers())) response.headers.set(name, value);
  return response;
}
