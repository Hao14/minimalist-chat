"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe2 } from "lucide-react";

import { brandConfig } from "@/config/brand";
import styles from "./MarketingHome.module.css";

type SiteCaptureFormProps = {
  placement: "hero" | "closing";
};

const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;
const TOP_LEVEL_DOMAIN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i;
const IPV4_ADDRESS = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function normalizePublicWebsite(rawValue: string): string | null {
  const value = rawValue.trim();

  if (!value || /\s/.test(value)) {
    return null;
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const labels = hostname.split(".");

    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      hostname.length > 253 ||
      labels.length < 2 ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      IPV4_ADDRESS.test(hostname) ||
      hostname.includes(":") ||
      labels.some((label) => !DOMAIN_LABEL.test(label)) ||
      !TOP_LEVEL_DOMAIN.test(labels.at(-1) ?? "")
    ) {
      return null;
    }

    return `${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return null;
  }
}

export function SiteCaptureForm({ placement }: SiteCaptureFormProps) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedWebsite = normalizePublicWebsite(website);

    if (!normalizedWebsite) {
      setError("Enter a public domain such as example.com.");
      return;
    }

    setError("");
    router.push(`/signup?site=${encodeURIComponent(normalizedWebsite)}`);
  }

  const isClosing = placement === "closing";

  return (
    <form
      className={`${styles.captureForm} ${
        isClosing ? styles.captureFormClosing : styles.captureFormHero
      }`}
      onSubmit={handleSubmit}
      noValidate
    >
      <span className={styles.formEnergy} aria-hidden="true">
        <span />
      </span>
      <div className={styles.captureControl}>
        <Globe2 aria-hidden="true" size={22} strokeWidth={1.7} />
        <label className={styles.visuallyHidden} htmlFor={inputId}>
          Website URL
        </label>
        <input
          id={inputId}
          name="site"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="Enter your website URL"
          value={website}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setWebsite(event.target.value);
            if (error) setError("");
          }}
        />
      </div>
      <button type="submit" className={styles.primaryButton}>
        {brandConfig.callsToAction.primary}
        <ArrowRight aria-hidden="true" size={18} />
      </button>
      <p
        id={errorId}
        className={styles.captureError}
        role={error ? "alert" : undefined}
        aria-live="polite"
      >
        {error}
      </p>
    </form>
  );
}
