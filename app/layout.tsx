import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paw Patrol",
  description: "3D building map and live tracking across Boston and Cambridge.",
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
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
