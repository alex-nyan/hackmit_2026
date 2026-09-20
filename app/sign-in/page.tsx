import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Shield } from "lucide-react";

import { publicOfficer, readRoster } from "@/features/access/roster";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Paw Patrol · Officer sign-in" };
export const dynamic = "force-dynamic";

const PROBLEMS: Record<string, string> = {
  rejected: "Choose an available officer profile.",
  "no-roster": "No officer accounts are configured yet.",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ officer?: string; problem?: string }>;
}) {
  const { officer = "", problem } = await searchParams;
  const roster = readRoster(process.env).map(publicOfficer);
  const hasOfficers = roster.length > 0;

  return (
    <div className={styles.page}>
      <a className="skip-link" href="#sign-in">
        Skip to sign-in
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Paw Patrol home">
          <span>
            <Shield size={18} aria-hidden="true" />
          </span>
          <strong>Paw Patrol</strong>
        </Link>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to main page
        </Link>
      </header>
      <main id="sign-in" tabIndex={-1} className={styles.main}>
        <div className={styles.welcome}>
          <span>Paw Patrol / Field operations</span>
          <h2>Every unit. One picture.</h2>
          <p>
            Your connection to dispatch, field observations and the teams responding alongside you.
          </p>
          <small>OFFICER WORKSPACE</small>
        </div>
        <section className={styles.card} aria-labelledby="sign-in-title">
          <div className={styles.intro}>
            <span className={styles.eyebrow}>Officer workspace</span>
            <h1 id="sign-in-title">Choose your profile</h1>
            <p>Select your assigned officer profile to enter your field workspace.</p>
          </div>
          <form className={styles.form} method="post" action="/api/sign-in">
            <div className={styles.field}>
              <label htmlFor="officer">Officer</label>
              <select
                id="officer"
                name="officer"
                defaultValue={officer || roster[0]?.id || ""}
                required
                disabled={!hasOfficers}
                aria-invalid={problem === "rejected" || undefined}
                aria-describedby={problem && hasOfficers ? "sign-in-error" : undefined}
              >
                {!hasOfficers && <option value="">No officer accounts available</option>}
                {roster.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · Badge {entry.badge}
                  </option>
                ))}
              </select>
            </div>
            {problem && hasOfficers && (
              <p className={styles.error} id="sign-in-error" role="alert">
                {PROBLEMS[problem] ?? "Sign-in failed. Please try again."}
              </p>
            )}
            {!hasOfficers && (
              <div className={styles.notice} role="status">
                <strong>Officer accounts aren’t set up yet</strong>
                <p>Add an officer to the roster to continue.</p>
              </div>
            )}
            <button className={styles.submit} type="submit" disabled={!hasOfficers}>
              Open officer workspace <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
