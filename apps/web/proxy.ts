// Runs in front of every page: makes a nonce for the request and sends the Content Security
// Policy that names it (csp.ts). Next.js reads the nonce from the policy on the request and
// puts it on the scripts it renders, which is why every page is rendered for its request
// (app/layout.tsx).
import { NextResponse, type NextRequest } from "next/server";
import { RUNTIME_SHA256 } from "@scena/renderer";
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
  matcher: [
    {
      // Pages only. Files under _next/static and the icon are not documents, and a prefetch
      // is not rendered into one.
      source: "/((?!_next/static|_next/image|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
