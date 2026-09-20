import type { Metadata } from "next";
import { ControlFrame } from "@/features/officer-instance/ControlFrame";
export const metadata: Metadata = {
  title: "Main frame · Paw Patrol",
  robots: { index: false, follow: false },
};
export default function ControlPage() {
  return <ControlFrame />;
}
