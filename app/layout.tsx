import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./operations.css";

export const viewport: Viewport = { themeColor: "#101b1b" };

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
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
