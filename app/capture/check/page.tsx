import type { Metadata } from "next";

import { CaptureCheck } from "@/features/camera-triage/CaptureCheck";

export const metadata: Metadata = {
  title: "Paw Patrol · Capture check",
  description: "Check whether this device will provide camera and microphone.",
};

export default function CaptureCheckPage() {
  return <CaptureCheck />;
}
