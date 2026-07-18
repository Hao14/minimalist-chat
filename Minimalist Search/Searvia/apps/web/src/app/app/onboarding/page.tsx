import { redirect } from "next/navigation";

import styles from "@/components/application/application-shell.module.css";
import { ProjectForm } from "@/components/application/ProjectForm";
import { getSessionContext } from "@/lib/session";

interface OnboardingPageProps {
  readonly searchParams: Promise<{ readonly site?: string | readonly string[] }>;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const [{ scope }, parameters] = await Promise.all([getSessionContext(), searchParams]);

  if (scope !== null) {
    redirect("/app/projects");
  }

  const initialWebsite = typeof parameters.site === "string" ? parameters.site.slice(0, 2_048) : "";

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Onboarding</p>
        <h1>Create your first workspace.</h1>
        <p className={styles.lede}>
          Create an organization and project, then choose conservative crawl limits. This step does
          not fetch the submitted website.
        </p>
      </header>
      <section className={styles.formCard} aria-label="Organization and project setup">
        <ProjectForm initialWebsite={initialWebsite} mode="onboarding" />
      </section>
    </>
  );
}
