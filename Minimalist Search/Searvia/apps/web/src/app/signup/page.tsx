import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/AuthForm";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/SignupForm";
import { getAuthenticatedSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a Searvia workspace and configure your first visibility audit.",
  robots: { index: false, follow: false },
};

export default async function SignupPage() {
  const session = await getAuthenticatedSession();
  if (session !== null) {
    redirect("/app");
  }

  return (
    <AuthShell mode="signup">
      <Suspense fallback={<AuthForm mode="signup" />}>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
