import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowRight, Map, Video } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";
import { LandingTheme, LandingThemeToggle } from "./LandingTheme";
import { ResponseNetwork } from "./ResponseNetwork";
import styles from "./WorkspaceHome.module.css";

const workspaces = [
  {
    title: "Dispatch",
    href: "/dispatch",
    image: "dispatch-station",
    label: "Coordinate the response",
  },
  { title: "Officer", href: "/officer", image: "officers", label: "Stay connected in the field" },
  { title: "Hospital", href: "/hospital", image: "medic", label: "Prepare for the handoff" },
];

export function WorkspaceHome() {
  return (
    <LandingTheme className={styles.page}>
      <a className="skip-link" href="#workspaces">
        Skip to workspaces
      </a>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Paw Patrol home">
          <BrandLogo /> Paw Patrol
        </Link>
        <nav aria-label="Landing navigation" className={styles.headerNav}>
          <LandingThemeToggle />
          <a href="#workspaces" className={styles.workspaceLink}>
            Workspaces <ArrowDown size={14} aria-hidden="true" />
          </a>
          <Link className={styles.signIn} href="/sign-in">
            Officer sign-in <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      <main id="workspace" className={styles.main}>
        <ContainerScroll
          titleComponent={
            <div className={styles.heroCopy}>
              <h1>
                One shared <span>picture.</span>
              </h1>
              <Link className={styles.primary} href="/?demo=1">
                Explore the demo <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>
          }
        >
          <ResponseNetwork />
        </ContainerScroll>
        <section id="workspaces" className={styles.workspaces} aria-labelledby="workspaces-heading">
          <h2 id="workspaces-heading" className={styles.sectionTitle}>
            Your workspace.
          </h2>
          <div className={styles.cards}>
            {workspaces.map(({ title, href, image, label }) => (
              <Link href={href} className={styles.card} key={title}>
                <span className={styles.cardArtwork}>
                  <Image
                    src={`/illustrations/${image}.png`}
                    width={2000}
                    height={2000}
                    alt=""
                    sizes="(max-width: 760px) 160px, 320px"
                    className={styles.roleIllustration}
                  />
                </span>
                <span className={styles.cardContent}>
                  <span className={styles.cardLabel}>{label}</span>
                  <span className={styles.cardTitle}>
                    <h3>{title}</h3>
                    <ArrowRight size={21} aria-hidden="true" />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
        <footer className={styles.utilities}>
          <Link href="/map">
            <Map size={16} aria-hidden="true" /> Operations map
          </Link>
          <Link href="/capture">
            <Video size={16} aria-hidden="true" /> Connect a camera
          </Link>
        </footer>
      </main>
    </LandingTheme>
  );
}
