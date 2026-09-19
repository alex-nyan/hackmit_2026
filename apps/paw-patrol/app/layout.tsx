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
    <html lang="en">
      <body className={`${display.variable} ${prose.variable}`}>
        {children}
      </body>
    </html>
  );
}
