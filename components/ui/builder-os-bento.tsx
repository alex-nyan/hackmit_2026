"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import styles from "./builder-os-bento.module.css";

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatNumber(value: number) {
  return Number.isFinite(value) ? numberFormat.format(value) : "—";
}

export function BentoCell({
  children,
  className,
  labelledBy,
  style,
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      className={[styles.cell, className].filter(Boolean).join(" ")}
      aria-labelledby={labelledBy}
      style={style}
    >
      {children}
    </section>
  );
}

export function BentoLabel({
  children,
  icon: Icon,
  trailing,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  trailing?: ReactNode;
}) {
  return (
    <div className={styles.label}>
      {Icon && <Icon size={13} strokeWidth={1.8} aria-hidden="true" />}
      <span className={styles.labelText}>{children}</span>
      {trailing != null && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );
}

export function BentoRing({
  value,
  total,
  label,
}: {
  value: number;
  total: number;
  label: string;
}) {
  const titleId = useId();
  const available = Number.isFinite(value) && value >= 0 && Number.isFinite(total) && total > 0;
  const ratio = available ? Math.min(1, value / total) : 0;
  const percentage = available ? Math.round((value / total) * 100) : null;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const description = available
    ? `${label}: ${formatNumber(value)} of ${formatNumber(total)} (${percentage}%).`
    : `${label}: no ratio available.`;

  return (
    <svg
      className={styles.ring}
      width="96"
      height="96"
      viewBox="0 0 96 96"
      role="img"
      aria-labelledby={titleId}
      focusable="false"
    >
      <title id={titleId}>{description}</title>
      <circle className={styles.ringTrack} cx="48" cy="48" r={radius} />
      <circle
        className={styles.ringValue}
        cx="48"
        cy="48"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
        strokeLinecap={ratio > 0 ? "round" : "butt"}
        transform="rotate(-90 48 48)"
      />
      <text className={styles.ringNumber} x="48" y="46" textAnchor="middle" aria-hidden="true">
        {percentage == null ? "—" : `${percentage}%`}
      </text>
      <text className={styles.ringCaption} x="48" y="61" textAnchor="middle" aria-hidden="true">
        {available ? `${formatNumber(value)} / ${formatNumber(total)}` : "No total"}
      </text>
    </svg>
  );
}

export function BentoSparkline({ values, label }: { values: number[]; label: string }) {
  const titleId = useId();
  const samples = values.filter(Number.isFinite);
  if (!samples.length) {
    return (
      <div
        className={styles.sparklineEmpty}
        role="img"
        aria-label={`${label}: no samples available`}
      >
        Waiting for samples
      </div>
    );
  }

  const minimum = Math.min(...samples);
  const maximum = Math.max(...samples);
  const span = maximum - minimum;
  const width = 240;
  const height = 64;
  const padding = 6;
  let line = "";
  let connected = false;
  let latest = { x: width / 2, y: height / 2 };

  // Preserve missing samples as gaps instead of inventing a connecting trend.
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      connected = false;
      return;
    }
    const x =
      values.length === 1
        ? width / 2
        : padding + (index / (values.length - 1)) * (width - padding * 2);
    const y =
      span === 0
        ? height / 2
        : height - padding - ((value - minimum) / span) * (height - padding * 2);
    line += `${connected ? " L" : " M"}${x},${y}`;
    connected = true;
    latest = { x, y };
  });

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-labelledby={titleId}
      focusable="false"
    >
      <title id={titleId}>
        {`${label}: ${samples.length} ${samples.length === 1 ? "sample" : "samples"}. Latest ${formatNumber(samples[samples.length - 1])}; range ${formatNumber(minimum)} to ${formatNumber(maximum)}.`}
      </title>
      <path className={styles.sparklinePath} d={line.trim()} vectorEffect="non-scaling-stroke" />
      <circle
        className={styles.sparklinePoint}
        cx={latest.x}
        cy={latest.y}
        r="3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function BentoNumber({ value }: { value: number }) {
  return (
    <span className={styles.number} aria-label={Number.isFinite(value) ? undefined : "Unavailable"}>
      {formatNumber(value)}
    </span>
  );
}
