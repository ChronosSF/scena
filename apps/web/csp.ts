// The Content Security Policy of the web app, kept free of Node and Next.js so it can be
// tested (test/csp.test.ts). proxy.ts sends it with every page.
//
// It does the job the single-file build's policy does (apps/studio/csp.ts): the studio writes
// markup that comes from documents into its own DOM, and the policy is the layer behind the
// sanitisers, so that nothing in that markup can run. The two policies differ in how they name
// the app's own scripts. The single-file build has one inlined script and names it by hash.
// Next.js sends many scripts and decides them per build, so here they are named by a nonce
// made for each request, which Next.js puts on its scripts as it renders the page.
import { STUDIO_DIRECTIVES, STUDIO_SOURCES } from "@scena/studio/policy";

export interface PolicyInput {
  /** Made for this request, and never used again (newNonce). */
  nonce: string;
  /**
   * The base64 SHA-256 of the page runtime. The preview and the scene picker show a published
   * page in a frame made from srcdoc; such a frame runs under this policy as well as the
   * page's own, and its one script carries no nonce, so it is named by hash.
   */
  pageRuntimeSha256: string;
  /** The dev server only: React evaluates code there to rebuild server error stacks. */
  dev?: boolean;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The policy for one request. The scripts that run are the ones Next.js rendered for it, which
 * carry the nonce, and this origin's own script files, which those load ('self'); the page
 * runtime runs in a frame. No inline handlers, no javascript: URLs and, outside the dev server,
 * no eval. Nothing loads from anywhere but this origin and the places the studio needs, and a
 * form posts to this origin alone.
 *
 * There is no 'strict-dynamic'. It would let any script that running code adds through the DOM
 * run, inline or from any host, and the single-file build's policy allows neither. If the
 * app's files ever come from another host (an asset prefix), that host is named here.
 */
export function policyFor({ nonce, pageRuntimeSha256, dev = false }: PolicyInput): string {
  // a nonce or a hash is written inside quotes in a header: nothing but base64 may get there
  if (!BASE64.test(nonce) || nonce.length < 22) throw new Error("the nonce must be at least 128 bits, in base64");
  if (!BASE64.test(pageRuntimeSha256)) throw new Error("the page runtime's hash must be base64");
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'self' 'sha256-${pageRuntimeSha256}'${dev ? " 'unsafe-eval'" : ""}`,
    // this origin's own stylesheets, typefaces, images and requests, and what the studio needs
    ...STUDIO_DIRECTIVES.map((d) => `${d} 'self' ${STUDIO_SOURCES[d].join(" ")}`),
    "base-uri 'none'",
    // Sign-in posts forms (the email, the code, the confirm button, sign-out), each to this
    // origin and to nothing else. Chrome holds the redirects that follow a form to this too, so
    // none of the app's forms leads off this origin: the way to Google is a link
    // (app/auth/google/route.ts), and every action redirects to a path of this app.
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** 128 random bits in base64, for one request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
