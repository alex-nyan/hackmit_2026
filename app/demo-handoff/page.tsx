import type { Metadata } from "next";
import { DemoHandoffBridge } from "@/features/paw-patrol/DemoHandoffBridge";

export const metadata: Metadata = {
  title: "Paw Patrol · Local demo handoff",
  robots: { index: false, follow: false },
};

export default function DemoHandoffPage() {
  return <DemoHandoffBridge />;
}
