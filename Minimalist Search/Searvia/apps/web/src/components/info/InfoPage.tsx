import Link from "next/link";

import { PublicSiteShell } from "@/components/public/PublicSiteShell";
import styles from "./info-page.module.css";

export type InfoSection = {
  title: string;
  body: string;
};

type InfoPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  sections: ReadonlyArray<InfoSection>;
  action?: { href: string; label: string };
  decorativeMotion?: boolean;
};

export function InfoPage({
  eyebrow,
  title,
  description,
  sections,
  action = { href: "/signup", label: "Start a site audit" },
  decorativeMotion = true,
}: InfoPageProps) {
  return (
    <PublicSiteShell>
      {decorativeMotion ? <div className={styles.frameTicks} aria-hidden="true" /> : null}
      <section
        className={`${styles.hero} ${decorativeMotion ? "" : styles.heroQuiet}`}
        data-motion-overlays={decorativeMotion ? undefined : "off"}
      >
        {decorativeMotion ? (
          <div className={styles.heroStepper} aria-hidden="true">
            <span>01</span>
            <i />
            <span>02</span>
            <i />
            <span>03</span>
          </div>
        ) : null}
        <p className={styles.eyebrow} data-motion={decorativeMotion ? "hero" : undefined}>
          {eyebrow}
        </p>
        <h1
          data-motion={decorativeMotion ? "hero" : undefined}
          data-motion-delay={decorativeMotion ? "70" : undefined}
        >
          {title}
        </h1>
        <p
          className={styles.description}
          data-motion={decorativeMotion ? "hero" : undefined}
          data-motion-delay={decorativeMotion ? "140" : undefined}
        >
          {description}
        </p>
        <Link
          className={styles.action}
          href={action.href}
          data-motion={decorativeMotion ? "hero" : undefined}
          data-motion-delay={decorativeMotion ? "210" : undefined}
        >
          {action.label}
        </Link>
        {decorativeMotion ? (
          <div className={styles.path} aria-hidden="true">
            <span />
            <span />
            <i />
            <b className={styles.pathPacket} />
            <b className={styles.pathPacketSecondary} />
          </div>
        ) : null}
      </section>

      <section
        className={`${styles.sections} ${decorativeMotion ? "" : styles.sectionsQuiet}`}
        aria-label={`${title} details`}
      >
        {sections.map((section, index) => (
          <article
            className={styles.section}
            key={section.title}
            data-motion={decorativeMotion ? "reveal" : undefined}
            data-motion-delay={decorativeMotion ? Math.min(index * 60, 180) : undefined}
          >
            <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
            <div className={styles.sectionBody}>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </div>
            {decorativeMotion ? (
              <span className={styles.sectionSignal} aria-hidden="true">
                <i />
                <b />
              </span>
            ) : null}
          </article>
        ))}
      </section>
    </PublicSiteShell>
  );
}
