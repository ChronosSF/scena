import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./global.css";

export const metadata: Metadata = {
  title: "Scena",
  description: "An illustrated page for your links: a drawing where every object is a link.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page is rendered for its request, none ahead of time. The Content Security Policy
  // names a page's scripts by a nonce made for that request (proxy.ts), and Next.js can put
  // the nonce on its scripts only as it renders. A page built ahead of time would carry none,
  // and the policy would stop its scripts.
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
