"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

import styles from "./application-shell.module.css";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await authClient.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button className={styles.signOutButton} disabled={pending} onClick={signOut} type="button">
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
