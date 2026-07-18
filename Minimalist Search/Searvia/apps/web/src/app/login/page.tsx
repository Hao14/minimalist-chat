import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/AuthForm";
import { AuthShell } from "@/components/auth/AuthShell";
import { getAuthenticatedSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Searvia search visibility workspace.",
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  readonly searchParams: Promise<{ readonly returnTo?: string | readonly string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [parameters, session] = await Promise.all([searchParams, getAuthenticatedSession()]);
  if (session !== null) {
    redirect("/app");
  }
  const returnTo = typeof parameters.returnTo === "string" ? parameters.returnTo : undefined;

  return (
    <AuthShell mode="login">
      <AuthForm mode="login" {...(returnTo === undefined ? {} : { returnTo })} />
    </AuthShell>
  );
}
