import type { Metadata } from "next";

import { publicOfficer, readRoster } from "@/features/access/roster";

export const metadata: Metadata = { title: "Paw Patrol - Officer sign-in" };
export const dynamic = "force-dynamic";

const PROBLEMS: Record<string, string> = {
  rejected: "That passcode was not accepted.",
  "no-roster": "No officers are configured for this deployment.",
};

/**
 * Where an officer says who they are.
 *
 * The roster is read on the server and only names reach the browser; a
 * passcode never leaves the environment it was configured in.
 */
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ officer?: string; problem?: string }>;
}) {
  const { officer = "", problem } = await searchParams;
  const roster = readRoster(process.env).map(publicOfficer);

  return (
    <main className="unlock">
      <form className="unlock__card" method="post" action="/api/sign-in">
        <h1>Officer sign-in</h1>
        <p>
          Sign in to your Officer workspace to share your camera and position and watch your team’s
          footage. Use the passcode assigned with your roster entry.
        </p>

        <label className="unlock__label" htmlFor="officer">
          Officer
        </label>
        <select
          id="officer"
          className="unlock__field"
          name="officer"
          defaultValue={officer || roster[0]?.id}
          required
        >
          {roster.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.badge})
            </option>
          ))}
        </select>

        <label className="unlock__label" htmlFor="passcode">
          Passcode
        </label>
        <input
          id="passcode"
          className="unlock__field"
          type="password"
          name="passcode"
          inputMode="numeric"
          autoComplete="current-password"
          aria-label="Passcode"
          required
        />

        {problem ? <p className="unlock__error">{PROBLEMS[problem] ?? "Sign-in failed."}</p> : null}

        {roster.length === 0 && (
          <p className="unlock__error">
            No officer accounts configured. Ask the deployment administrator to add your name, badge
            and passcode to the officer roster.
          </p>
        )}
        <button className="unlock__button" type="submit" disabled={roster.length === 0}>
          Sign in
        </button>
      </form>
    </main>
  );
}
