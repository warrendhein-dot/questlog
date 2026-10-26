import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Questlog",
  description: "An AI-powered to-do list disguised as a retro RPG.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request. The security policy's nonce is created per request (see
  // src/proxy.ts), and a page built ahead of time has no request to take a nonce from.
  await connection();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
