import type { Metadata } from "next";

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
        <h1>Paw Patrol</h1>
        <p>This dashboard shows live cameras. Enter the shared passphrase to continue.</p>
        <input type="hidden" name="next" value={next} />
        <input
          className="unlock__field"
          type="password"
          name="passphrase"
          placeholder="Passphrase"
          aria-label="Passphrase"
          autoComplete="current-password"
          autoFocus
          required
        />
        {wrong ? <p className="unlock__error">That passphrase was not accepted.</p> : null}
        <button className="unlock__button" type="submit">
          Unlock
        </button>
      </form>
    </main>
  );
}
