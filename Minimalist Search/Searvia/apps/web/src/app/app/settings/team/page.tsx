import { roleHasCapability } from "@searvia/shared-types";
import { UsersRound } from "lucide-react";

import styles from "@/components/application/application-shell.module.css";
import { getSearviaRepository } from "@/lib/database";
import { requireOrganizationScope } from "@/lib/session";

export default async function TeamSettingsPage() {
  const { scope } = await requireOrganizationScope();
  const canReadTeam = roleHasCapability(scope.membership.role, "team:read");

  if (!canReadTeam) {
    return (
      <section className={styles.emptyState}>
        <span className={styles.emptyIcon}>
          <UsersRound aria-hidden="true" size={23} />
        </span>
        <h1>Team settings are unavailable.</h1>
        <p>Your {scope.membership.role} role does not permit reading organization membership.</p>
      </section>
    );
  }

  const [members, invitations] = await Promise.all([
    getSearviaRepository().listTeam(scope),
    getSearviaRepository().listPendingInvitations(scope),
  ]);

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Team settings</p>
        <h1>People in {scope.organization.name}.</h1>
        <p className={styles.lede}>Membership and roles are loaded from this organization only.</p>
      </header>

      <section className={styles.tableCard} aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        <div className={styles.tableScroller}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>{member.name}</td>
                  <td>{member.email}</td>
                  <td>{member.role}</td>
                  <td>{member.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.tableCard} aria-labelledby="invitations-heading">
        <h2 id="invitations-heading">Pending invitations</h2>
        {invitations.length === 0 ? (
          <p className={styles.cardCopy}>No pending invitations.</p>
        ) : (
          <div className={styles.tableScroller}>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.email}</td>
                    <td>{invitation.role}</td>
                    <td>{invitation.expiresAt.toLocaleDateString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
