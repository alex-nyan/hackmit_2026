import Link from "next/link";
import type { Metadata } from "next";
import { BrandLogo } from "@/components/BrandLogo";

export const metadata: Metadata = { title: "Paw Patrol · Locked" };

/**
 * The one page the gate lets through.
 *
 * A plain form post rather than a client component: this runs before anyone
 * is trusted, so it should need as little of the app as possible.
 */
export default async function Unlock({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; wrong?: string }>;
}) {
  const { next = "/", wrong } = await searchParams;

  return (
    <main className="unlock">
      <form className="unlock__card" method="post" action="/api/unlock">
        <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BrandLogo /> Paw Patrol
        </h1>
        <p>This dashboard shows live cameras. Enter the shared passphrase to continue.</p>
        <input type="hidden" name="next" value={next} />
        <input
          className="unlock__field"
          type="password"
          name="passphrase"
          placeholder="Enter shared passphrase…"
          aria-invalid={wrong ? true : undefined}
          aria-describedby={wrong ? "unlock-error" : undefined}
          aria-label="Passphrase"
          autoComplete="current-password"
          required
        />
        {wrong ? (
          <p id="unlock-error" className="unlock__error" role="alert">
            That passphrase was not accepted. Check it and try again.
          </p>
        ) : null}
        <button className="unlock__button" type="submit">
          Unlock
        </button>
        <Link href="/sign-in" className="unlock__button">
          Sign in as a police officer
        </Link>
      </form>
    </main>
  );
}
