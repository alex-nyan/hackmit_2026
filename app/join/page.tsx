import type { Metadata } from "next";

import { JoinView } from "@/features/join/JoinView";

export const metadata: Metadata = {
  title: "Paw Patrol · Join the map",
  description: "Put this phone on the live operations map.",
};

/**
 * The page behind the QR code.
 *
 * Deliberately outside the roster. `/capture` is an officer's page and asks who
 * they are, which is right for somebody on the shift and wrong for somebody who
 * was handed a code ten seconds ago. This publishes under a guest id instead:
 * a smaller claim, and one nobody has to be issued a passcode to make.
 *
 * Served by every workspace, pinned or not. Whichever dashboard is in front of
 * the person holding the code is the one whose address they will scan.
 */
export default function JoinPage() {
  return <JoinView />;
}
