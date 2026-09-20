import type { Metadata } from "next";

import { CameraTriageView } from "@/features/camera-triage";

export const metadata: Metadata = {
  title: "Paw Patrol · Camera",
  description: "Send camera frames for hazard triage.",
};

export default function CapturePage() {
  return <CameraTriageView />;
}
