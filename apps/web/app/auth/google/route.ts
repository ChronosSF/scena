// Starts signing in with Google: GET /auth/google?next=/studio, from a plain link on the
// sign-in page. A link and not a form, because Chrome holds every redirect that follows a form
// to the page's form-action, and this one goes on to Supabase Auth and then to Google: the
// policy would have to name both hosts. A GET that only starts the flow uses nothing up.
//
// Supabase Auth's address for the flow is asked for here, on the server, and the code verifier
// it needs at the end is kept in a cookie of this app (with the session cookie's attributes),
// so only the browser that started can finish: /auth/callback exchanges the code with it.
// It answers 404 unless Google is switched on (SCENA_GOOGLE_SIGN_IN=on).

import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "../../../auth/env.ts";
import { returnPath } from "../../../auth/return-to.ts";
import { CookieJar, sessionClient } from "../../../auth/supabase.ts";

export async function GET(request: NextRequest): Promise<Response> {
  const config = authConfig();
  if (!config?.google) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const next = returnPath(request.nextUrl.searchParams.get("next"));

  const jar = new CookieJar(request.cookies.getAll());
  const { data, error } = await sessionClient(config, jar).auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${config.siteOrigin}/auth/callback?${new URLSearchParams({ next })}`, skipBrowserRedirect: true },
  });
  // The address must be Supabase Auth's own, compared by origin: nothing else is followed.
  let to: URL | null = null;
  try { to = data?.url ? new URL(data.url) : null; } catch { to = null; }
  const response = !error && to && to.origin === config.supabaseUrl
    ? NextResponse.redirect(to, 303)
    : NextResponse.redirect(new URL(`/sign-in?${new URLSearchParams({ notice: "google", next })}`, config.siteOrigin), 303);
  jar.applyTo(response);
  return response;
}
