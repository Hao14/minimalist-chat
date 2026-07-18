import { Settings2, UsersRound } from "lucide-react";
import Link from "next/link";

import styles from "@/components/application/application-shell.module.css";
import { requireOrganizationScope } from "@/lib/session";

export default async function SettingsPage() {
  const { scope } = await requireOrganizationScope();

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Settings</p>
        <h1>{scope.organization.name}</h1>
        <p className={styles.lede}>Organization settings are scoped to your active membership.</p>
      </header>

      <div className={styles.cardGrid}>
        <article className={styles.card}>
          <Settings2 aria-hidden="true" size={21} />
          <h2>Organization</h2>
          <p className={styles.cardCopy}>Role: {scope.membership.role}</p>
        </article>
        <article className={styles.card}>
          <UsersRound aria-hidden="true" size={21} />
          <h2>Team access</h2>
          <p className={styles.cardCopy}>Review members and pending invitations.</p>
          <Link className={styles.inlineLink} href="/app/settings/team">
            Open team settings
          </Link>
        </article>
      </div>
    </>
  );
}
