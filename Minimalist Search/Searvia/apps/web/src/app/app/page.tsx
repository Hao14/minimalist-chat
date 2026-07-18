import { ArrowRight, FolderKanban, ShieldCheck } from "lucide-react";
import Link from "next/link";

import styles from "@/components/application/application-shell.module.css";
import { getSearviaRepository } from "@/lib/database";
import { requireOrganizationScope } from "@/lib/session";

export default async function ApplicationOverviewPage() {
  const { scope } = await requireOrganizationScope();
  const projects = await getSearviaRepository().listProjects(scope);

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Organization overview</p>
        <h1>{scope.organization.name}</h1>
        <p className={styles.lede}>
          Your workspace is backed by tenant-scoped organization and project records. Crawl results
          appear only after a real audit runs.
        </p>
      </header>

      <div className={styles.statusCallout} role="status">
        <ShieldCheck aria-hidden="true" size={21} strokeWidth={1.7} />
        <div>
          <strong>{scope.membership.role} access</strong>
          <p>Every project read and write is authorized against this active organization.</p>
        </div>
      </div>

      <section className={styles.cardGrid} aria-label="Workspace summary">
        <article className={styles.card}>
          <FolderKanban aria-hidden="true" size={21} />
          <h2>
            {projects.length} {projects.length === 1 ? "project" : "projects"}
          </h2>
          <p className={styles.cardCopy}>Persisted projects visible to your membership.</p>
        </article>
        <article className={styles.card}>
          <h2>Audit data</h2>
          <p className={styles.cardCopy}>
            Audit scoring is not implemented yet. Real crawl evidence remains available in each
            project.
          </p>
        </article>
      </section>

      <div className={styles.actions}>
        <Link className={styles.primaryAction} href="/app/projects">
          View projects
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
      </div>
    </>
  );
}
