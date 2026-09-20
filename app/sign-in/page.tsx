import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Shield } from "lucide-react";

import { publicOfficer, readRoster } from "@/features/access/roster";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Paw Patrol · Officer sign-in" };
export const dynamic = "force-dynamic";

const PROBLEMS: Record<string, string> = {
  rejected: "That passcode was not accepted. Please try again.",
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
      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="sign-in-title">
          <div className={styles.intro}>
            <span className={styles.eyebrow}>Officer access</span>
            <h1 id="sign-in-title">Sign in to your workspace</h1>
            <p>Choose your officer profile and enter your assigned passcode.</p>
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
              >
                {!hasOfficers && <option value="">No officer accounts available</option>}
                {roster.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · Badge {entry.badge}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="passcode">Passcode</label>
              <input
                id="passcode"
                type="password"
                name="passcode"
                autoComplete="current-password"
                placeholder="Enter your passcode"
                required
                disabled={!hasOfficers}
                aria-invalid={problem === "rejected" || undefined}
                aria-describedby={problem && hasOfficers ? "sign-in-error" : undefined}
              />
            </div>
            {problem && hasOfficers && (
              <p className={styles.error} id="sign-in-error" role="alert">
                {PROBLEMS[problem] ?? "Sign-in failed. Please try again."}
              </p>
            )}
            {!hasOfficers && (
              <div className={styles.notice} role="status">
                <strong>Officer accounts aren’t set up yet</strong>
                <p>Ask your administrator to add your name, badge and passcode to the roster.</p>
              </div>
            )}
            <button className={styles.submit} type="submit" disabled={!hasOfficers}>
              Sign in <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
          <p className={styles.help}>Need a passcode? Contact your team administrator.</p>
        </section>
      </main>
    </div>
  );
}
