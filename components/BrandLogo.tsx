import Image from "next/image";

/** Shared decorative mark; the adjacent brand text names its home link. */
export function BrandLogo({ size = 40 }: { size?: number }) {
  return (
    <Image
      src="/brand/cap-care-logo.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="eager"
      style={{ display: "block", objectFit: "contain", flexShrink: 0 }}
    />
  );
}
