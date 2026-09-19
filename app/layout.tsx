import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GridLens · MIT Harvard Boston Map",
  description: "Explore buildings across MIT, Harvard, Cambridge, and Boston.",
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
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
