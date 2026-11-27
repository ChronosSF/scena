// The studio, inside the web app. This file renders on the server and holds only what a server
// can know: the title, the typefaces, the stylesheet, who is signed in, and their saved page.
// The studio itself reads localStorage and the document, so it is loaded in the browser
// (StudioLoader.tsx) and nothing of it is in the HTML the server sends.
import type { Metadata } from "next";
import { FIRST_FACES_HREF } from "@scena/studio/fonts";
import "@scena/studio/studio.css";
import { studioAccount } from "../../auth/server.ts";
import { StudioLoader } from "./StudioLoader.tsx";

export const metadata: Metadata = {
  title: "Scena Studio",
  description: "Bring your own drawings: turn illustrations into a tappable link-in-bio page.",
};

export default async function StudioPage() {
  // the person's address, for the top bar, and their page, for the studio to open or save
  // over: never the session, which stays in its cookie
  const { signIn, signedIn, saved } = await studioAccount();
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={FIRST_FACES_HREF} precedence="default" />
      {/* the studio's stylesheet lays out the children of #root as children of the body */}
      <div id="root">
        <StudioLoader signIn={signIn} signedIn={signedIn} saved={saved} />
      </div>
    </>
  );
}
