import type { Metadata } from "next";
import { Cormorant_Unicase, Cormorant_Garamond } from "next/font/google";
import "./globals.css";

const display = Cormorant_Unicase({
  weight: "700",
  subsets: ["latin"],
  variable: "--font-display",
});
const prose = Cormorant_Garamond({
  weight: ["500", "600"],
  subsets: ["latin"],
  variable: "--font-prose",
});

export const metadata: Metadata = {
  title: "Paw Patrol · Connected response",
  description:
    "A HackMIT demo of officer safety, coordinated response and hospital handoff. All signals are simulated.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Extensions commonly add attributes to these two elements before React
    // hydrates; that mismatch is not the app's to reconcile.
    <html lang="en" suppressHydrationWarning>
      <body className={`${display.variable} ${prose.variable}`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
