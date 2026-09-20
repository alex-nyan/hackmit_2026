import type { Metadata, Viewport } from "next";
import { BroadcastDock } from "@/features/live-video/BroadcastDock";
import { WorkspaceNavigationProvider } from "@/features/paw-patrol/WorkspaceLink";
import { parseWorkspace } from "@/features/paw-patrol/workspace";
import { readRoster } from "@/features/access/roster";
import "./globals.css";
import "./operations.css";

export const viewport: Viewport = { themeColor: "#111111" };

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
      <body suppressHydrationWarning>
        <WorkspaceNavigationProvider
          dedicatedWorkspace={parseWorkspace(process.env.PAW_PATROL_WORKSPACE)}
          officerSignIn={readRoster(process.env).length > 0}
          localDevelopment={process.env.NODE_ENV === "development"}
        >
          {children}
        </WorkspaceNavigationProvider>
        <BroadcastDock />
      </body>
    </html>
  );
}
