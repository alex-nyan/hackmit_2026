import { Backpack, Eye, ScanEye, Shirt, TriangleAlert } from "lucide-react";
import { BentoLabel } from "@/components/ui/builder-os-bento";
import styles from "./InferencePreview.module.css";

// Presentation-only examples. These are not observations or output from a model.
const SAMPLE_OBSERVATIONS = [
  { label: "Dark jacket", category: "Clothing", confidence: 94, icon: Shirt, review: false },
  {
    label: "Black backpack",
    category: "Carried item",
    confidence: 88,
    icon: Backpack,
    review: false,
  },
  { label: "Object unclear", category: "Review item", confidence: 42, icon: ScanEye, review: true },
] as const;

export function InferencePreview({ titleId = "dispatch-inference-title" }: { titleId?: string }) {
  return (
    <div className={styles.preview}>
      <BentoLabel icon={Eye}>Visual observations</BentoLabel>
      <h2 id={titleId}>Inference information</h2>
      <p className={styles.sampleNotice}>
        <span aria-hidden="true" />
        Sample · model not connected
      </p>
      <ul
        className={styles.observations}
        aria-label="Illustrative observations, not real model output"
      >
        {SAMPLE_OBSERVATIONS.map(({ label, category, confidence, icon: Icon, review }) => (
          <li className={styles.observation} data-review={review} key={label}>
            <span className={styles.category}>
              <Icon size={13} aria-hidden="true" />
              {category}
            </span>
            <strong>{label}</strong>
            <span className={styles.confidence}>
              <b>{confidence}%</b>
              <span>sample confidence</span>
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.reviewNote}>
        <TriangleAlert size={13} aria-hidden="true" />
        <span>Human review required · confidence is not certainty.</span>
      </p>
    </div>
  );
}
