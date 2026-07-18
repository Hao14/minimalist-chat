"use client";

import { useActionState } from "react";

import { createOnboardingAction, createProjectAction } from "@/app/app/actions";

import styles from "./application-shell.module.css";

interface ProjectFormProps {
  readonly mode: "onboarding" | "project";
  readonly initialWebsite?: string;
}

const initialActionState = {
  status: "idle" as const,
  message: "",
  fieldErrors: {},
};

function FieldError({
  id,
  message,
}: {
  readonly id: string;
  readonly message: string | undefined;
}) {
  return message === undefined ? null : (
    <p className={styles.fieldError} id={id} role="alert">
      {message}
    </p>
  );
}

export function ProjectForm({ mode, initialWebsite = "" }: ProjectFormProps) {
  const action = mode === "onboarding" ? createOnboardingAction : createProjectAction;
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className={styles.projectForm} noValidate>
      {mode === "onboarding" ? (
        <label>
          <span>Organization name</span>
          <input
            aria-describedby={
              state.fieldErrors.organizationName ? "organizationName-error" : undefined
            }
            aria-invalid={state.fieldErrors.organizationName !== undefined}
            autoComplete="organization"
            defaultValue="My organization"
            maxLength={160}
            name="organizationName"
            required
          />
          <FieldError id="organizationName-error" message={state.fieldErrors.organizationName} />
        </label>
      ) : null}

      <label>
        <span>Project name</span>
        <input
          aria-describedby={state.fieldErrors.projectName ? "projectName-error" : undefined}
          aria-invalid={state.fieldErrors.projectName !== undefined}
          autoComplete="off"
          maxLength={160}
          name="projectName"
          placeholder="Marketing website"
          required
        />
        <FieldError id="projectName-error" message={state.fieldErrors.projectName} />
      </label>

      <label>
        <span>Website domain or URL</span>
        <input
          aria-describedby={state.fieldErrors.website ? "website-error" : "website-hint"}
          aria-invalid={state.fieldErrors.website !== undefined}
          autoComplete="url"
          defaultValue={initialWebsite}
          inputMode="url"
          maxLength={2048}
          name="website"
          placeholder="example.com"
          required
        />
        <small id="website-hint">
          Only the normalized origin is stored. No website is fetched yet.
        </small>
        <FieldError id="website-error" message={state.fieldErrors.website} />
      </label>

      <div className={styles.formColumns}>
        <label>
          <span>Maximum pages</span>
          <input
            aria-describedby={state.fieldErrors.pageLimit ? "pageLimit-error" : undefined}
            aria-invalid={state.fieldErrors.pageLimit !== undefined}
            defaultValue="100"
            inputMode="numeric"
            max="100"
            min="1"
            name="pageLimit"
            required
            type="number"
          />
          <FieldError id="pageLimit-error" message={state.fieldErrors.pageLimit} />
        </label>
        <label>
          <span>Maximum depth</span>
          <input
            aria-describedby={state.fieldErrors.maxDepth ? "maxDepth-error" : undefined}
            aria-invalid={state.fieldErrors.maxDepth !== undefined}
            defaultValue="5"
            inputMode="numeric"
            max="10"
            min="0"
            name="maxDepth"
            required
            type="number"
          />
          <FieldError id="maxDepth-error" message={state.fieldErrors.maxDepth} />
        </label>
      </div>

      <label>
        <span>Query parameters</span>
        <select defaultValue="ignore_tracking" name="queryPolicy">
          <option value="ignore_tracking">Ignore tracking parameters</option>
          <option value="ignore_all">Ignore all parameters</option>
          <option value="keep">Keep parameters</option>
        </select>
        <FieldError id="queryPolicy-error" message={state.fieldErrors.queryPolicy} />
      </label>

      <label className={styles.checkboxField}>
        <input name="includeSubdomains" type="checkbox" />
        <span>Include subdomains when crawling</span>
      </label>

      <label className={styles.checkboxField}>
        <input name="renderingEnabled" type="checkbox" />
        <span>Allow limited browser rendering when raw HTML has no meaningful content</span>
      </label>

      <label>
        <span>Submitted sitemaps (optional)</span>
        <textarea
          aria-describedby={
            state.fieldErrors.submittedSitemapUrls
              ? "submittedSitemapUrls-error"
              : "submittedSitemapUrls-hint"
          }
          aria-invalid={state.fieldErrors.submittedSitemapUrls !== undefined}
          maxLength={40_979}
          name="submittedSitemapUrls"
          placeholder={"https://example.com/sitemap.xml\nhttps://example.com/news-sitemap.xml.gz"}
          rows={4}
        />
        <small id="submittedSitemapUrls-hint">
          Enter up to 20 complete HTTP or HTTPS URLs, one per line. Redirects and destinations are
          validated by the crawler before fetching.
        </small>
        <FieldError
          id="submittedSitemapUrls-error"
          message={state.fieldErrors.submittedSitemapUrls}
        />
      </label>

      {state.status === "error" ? (
        <p className={styles.formError} role="alert">
          {state.message}
        </p>
      ) : null}

      <button className={styles.primaryButton} disabled={pending} type="submit">
        {pending
          ? "Saving…"
          : mode === "onboarding"
            ? "Create organization and project"
            : "Create project"}
      </button>
    </form>
  );
}
