import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ApplicationShell } from "@/components/application/ApplicationShell";
import { getSessionContext } from "@/lib/session";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Your authenticated Searvia organization and projects.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { session, scope } = await getSessionContext();

  return (
    <ApplicationShell
      organization={
        scope === null ? null : { name: scope.organization.name, role: scope.membership.role }
      }
      user={{ name: session.user.name, email: session.user.email }}
    >
      {children}
    </ApplicationShell>
  );
}
