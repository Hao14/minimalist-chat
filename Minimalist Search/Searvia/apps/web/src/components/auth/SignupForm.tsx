"use client";

import { useSearchParams } from "next/navigation";

import { AuthForm } from "./AuthForm";

const MAXIMUM_SITE_LENGTH = 2048;

export function SignupForm() {
  const searchParams = useSearchParams();
  const initialSite = (searchParams.get("site") ?? "").slice(0, MAXIMUM_SITE_LENGTH);

  return <AuthForm key={initialSite} mode="signup" initialSite={initialSite} />;
}
