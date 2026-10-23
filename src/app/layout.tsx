import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Questlog",
  description: "An AI-powered to-do list disguised as a retro RPG.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
