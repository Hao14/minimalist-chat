import { roleHasCapability } from "@searvia/shared-types";

import styles from "@/components/application/application-shell.module.css";
import { ProjectForm } from "@/components/application/ProjectForm";
import { requireOrganizationScope } from "@/lib/session";

export default async function NewProjectPage() {
  const { scope } = await requireOrganizationScope();
  const canCreate = roleHasCapability(scope.membership.role, "project:create");

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>New project</p>
        <h1>Add a website.</h1>
        <p className={styles.lede}>
          Searvia safely normalizes the origin and stores the crawl policy without making a network
          request.
        </p>
      </header>
      {canCreate ? (
        <section className={styles.formCard} aria-label="New project settings">
          <ProjectForm mode="project" />
        </section>
      ) : (
        <section className={styles.emptyState}>
          <h2>Project creation is unavailable.</h2>
          <p>Your {scope.membership.role} role does not permit creating projects.</p>
        </section>
      )}
    </>
  );
}
