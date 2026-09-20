import Link from "next/link";
import { ArrowDown, ArrowRight, HeartPulse, Map, Radio, Shield, Video } from "lucide-react";
import styles from "./WorkspaceHome.module.css";
import { ResponseNetwork } from "./ResponseNetwork";

const workspaces = [
  {
    number: "01",
    title: "Dispatch",
    role: "COORDINATE THE RESPONSE",
    description:
      "See patrol coverage, review field reports and coordinate the units that need you.",
    href: "/dispatch",
    action: "Open command centre",
    Icon: Radio,
  },
  {
    number: "02",
    title: "Officer",
    role: "STAY CONNECTED IN THE FIELD",
    description:
      "Keep your team in view. Share observations, check your status and request support.",
    href: "/officer",
    action: "Open officer workspace",
    Icon: Shield,
  },
  {
    number: "03",
    title: "Hospital",
    role: "PREPARE FOR THE HANDOFF",
    description: "Review incoming observations, monitor reported vitals and follow the response.",
    href: "/hospital",
    action: "Open hospital workspace",
    Icon: HeartPulse,
  },
];

export function WorkspaceHome() {
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#workspace">
        Skip to workspaces
      </a>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Paw Patrol home">
          <span>
            <Shield size={22} aria-hidden="true" />
          </span>
          Paw Patrol
        </Link>
        <span className={styles.product}>CONNECTED RESPONSE</span>
        <Link className={styles.signIn} href="/sign-in">
          Officer sign-in <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </header>
      <main id="workspace" className={styles.main}>
        <section className={styles.hero} aria-labelledby="home-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span /> ONE TEAM. A SHARED PICTURE.
            </p>
            <h1 id="home-title">
              Closer together.
              <br />
              <span>Ready to respond.</span>
            </h1>
            <p className={styles.description}>
              From the first field observation to the hospital handoff. Bring every team into the
              same picture, when it matters most.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primary} href="/?demo=1">
                Explore the demo <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a className={styles.secondary} href="#workspaces">
                Choose your workspace <ArrowDown size={16} aria-hidden="true" />
              </a>
            </div>
            <p className={styles.demoNote}>HackMIT demonstration · Simulated incident signals</p>
          </div>
          <ResponseNetwork />
        </section>
        <section id="workspaces" className={styles.workspaces} aria-labelledby="workspaces-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>YOUR ROLE. YOUR WORKSPACE.</p>
              <h2 id="workspaces-title">Where are you responding from?</h2>
            </div>
            <span>Three teams. One connected response.</span>
          </div>
          <div className={styles.cards}>
            {workspaces.map(({ number, title, role, description, href, action, Icon }) => (
              <Link href={href} className={styles.card} key={title}>
                <div className={styles.cardTop}>
                  <span className={styles.cardIcon}>
                    <Icon size={24} aria-hidden="true" />
                  </span>
                  <span>{number}</span>
                </div>
                <p className={styles.role}>{role}</p>
                <h3>{title}</h3>
                <p className={styles.cardDescription}>{description}</p>
                <span className={styles.cardAction}>
                  {action}
                  <ArrowRight size={18} aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>
        <div className={styles.utilities}>
          <span>Need a specific tool?</span>
          <Link href="/map">
            <Map size={17} aria-hidden="true" /> Open operations map{" "}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link href="/capture">
            <Video size={17} aria-hidden="true" /> Connect a camera{" "}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </main>
      <footer className={styles.footer}>
        <span>
          Paw Patrol <span aria-hidden="true">/</span> Connected response
        </span>
        <span>Built for HackMIT 2026</span>
      </footer>
    </div>
  );
}
