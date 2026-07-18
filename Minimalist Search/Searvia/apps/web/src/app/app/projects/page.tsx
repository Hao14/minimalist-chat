import { ArrowRight, FolderKanban, Plus } from "lucide-react";
import Link from "next/link";

import styles from "@/components/application/application-shell.module.css";
import { getSearviaRepository } from "@/lib/database";
import { requireOrganizationScope } from "@/lib/session";

export default async function ProjectsPage() {
  const { scope } = await requireOrganizationScope();
  const projects = await getSearviaRepository().listProjects(scope);

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Projects</p>
        <h1>Websites in {scope.organization.name}.</h1>
        <p className={styles.lede}>
          Each project has a normalized website origin and a persisted crawl configuration.
        </p>
      </header>

      <div className={styles.actions}>
        <Link className={styles.primaryAction} href="/app/projects/new">
          <Plus aria-hidden="true" size={16} />
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <section className={styles.emptyState} aria-labelledby="projects-empty-heading">
          <span className={styles.emptyIcon}>
            <FolderKanban aria-hidden="true" size={23} strokeWidth={1.6} />
          </span>
          <h2 id="projects-empty-heading">No projects yet.</h2>
          <p>Create your first project to save a website origin and crawl settings.</p>
        </section>
      ) : (
        <ul className={styles.projectList}>
          {projects.map((project) => (
            <li key={project.id}>
              <div>
                <h2>{project.name}</h2>
                <p>{project.normalizedOrigin}</p>
              </div>
              <div className={styles.projectMeta}>
                <span>{project.verificationStatus}</span>
                <span>{project.crawlConfig.pageLimit} page limit</span>
              </div>
              <Link href={`/app/projects/${project.id}`} aria-label={`Open ${project.name}`}>
                Open
                <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
