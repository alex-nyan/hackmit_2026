import Link from "next/link";
import { AudioDemo } from "@/features/audio-ai/AudioIntelligencePanel";

export default function AudioPage() {
  return (
    <main
      style={{ minHeight: "100vh", background: "#09121c", padding: "28px 20px", color: "#e9eef4" }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <Link href="/" style={{ display: "inline-block", marginBottom: 20, color: "#9ccbe8" }}>
          ← Back to operations
        </Link>
        <AudioDemo />
      </div>
    </main>
  );
}
