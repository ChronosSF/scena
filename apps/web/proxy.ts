// Runs in front of every page: makes a nonce for the request and sends the Content Security
// Policy that names it (csp.ts). Next.js reads the nonce from the policy on the request and
// puts it on the scripts it renders, which is why every page is rendered for its request
// (app/layout.tsx).
import { NextResponse, type NextRequest } from "next/server";
// the generated module alone: this file runs in front of every request, and needs one constant of the renderer
import { RUNTIME_SHA256 } from "@scena/renderer/runtime";
import { newNonce, policyFor } from "./csp.ts";

export function proxy(request: NextRequest) {
  const policy = policyFor({
    nonce: newNonce(),
    pageRuntimeSha256: RUNTIME_SHA256,
    dev: process.env.NODE_ENV === "development",
  });

  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Everything but the files under _next/static and the icon, which are not documents. No
  // request is let through on what its headers say it is: one that calls itself a prefetch
  // is still answered with a document, and a document without the policy can be shown.
  matcher: ["/((?!_next/static|_next/image|icon\\.svg).*)"],
};
