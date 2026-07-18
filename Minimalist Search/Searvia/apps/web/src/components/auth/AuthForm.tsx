"use client";

import { Eye, EyeOff, Globe2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { normalizeProjectOrigin } from "@searvia/shared-types/project-origin";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { authClient } from "@/lib/auth-client";
import {
  AUTH_GENERIC_ERROR,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  safeApplicationReturnTo,
} from "@/lib/auth-policy";
import styles from "./auth-shell.module.css";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  mode: AuthMode;
  initialSite?: string;
  returnTo?: string;
}

interface FormValues {
  name: string;
  email: string;
  password: string;
  website: string;
  remember: boolean;
  terms: boolean;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;

const inputClass = `${styles.inputControl} h-12 w-full rounded-[10px] border border-[#cfd5df] bg-white px-11 text-[0.94rem] font-medium text-[#171a21] outline-none transition placeholder:text-[#9299a8] hover:border-[#aeb6c5] focus:border-[#1f59ff] focus:ring-4 focus:ring-[#1f59ff]/10 disabled:cursor-not-allowed disabled:bg-[#f4f5f7]`;

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: keyof FormValues;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-[#242832]">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-[#c81e2a]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-[#697284]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function AuthForm({ mode, initialSite = "", returnTo }: AuthFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [values, setValues] = useState<FormValues>(() => ({
    name: "",
    email: "",
    password: "",
    website: initialSite,
    remember: false,
    terms: false,
  }));

  const isSignup = mode === "signup";

  function updateValue<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function validate() {
    const next: FormErrors = {};

    if (isSignup && values.name.trim().length < 2) {
      next.name = "Enter your full name.";
    }

    if (!emailPattern.test(values.email.trim())) {
      next.email = "Enter a valid work email address.";
    }

    if (
      values.password.length < AUTH_PASSWORD_MIN_LENGTH ||
      values.password.length > AUTH_PASSWORD_MAX_LENGTH
    ) {
      next.password = `Use between ${AUTH_PASSWORD_MIN_LENGTH} and ${AUTH_PASSWORD_MAX_LENGTH} characters.`;
    }

    if (isSignup) {
      if (!values.website.trim()) {
        next.website = "Enter the website you want to audit.";
      } else {
        try {
          normalizeProjectOrigin(values.website);
        } catch (error) {
          next.website = error instanceof Error ? error.message : "Enter a valid website address.";
        }
      }

      if (!values.terms) {
        next.terms = "Accept the terms and privacy policy to continue.";
      }
    }

    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionError("");
    const nextErrors = validate();
    setErrors(nextErrors);

    const firstError = Object.keys(nextErrors)[0] as keyof FormValues | undefined;
    if (firstError) {
      window.requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>(`#${firstError}`)?.focus();
      });
      return;
    }

    setIsNavigating(true);
    const email = values.email.trim().toLowerCase();

    try {
      if (isSignup) {
        const signup = await authClient.signUp.email({
          name: values.name.trim(),
          email,
          password: values.password,
        });

        if (signup.error !== null) {
          setSubmissionError(AUTH_GENERIC_ERROR);
          return;
        }
      }

      const signin = await authClient.signIn.email({
        email,
        password: values.password,
        rememberMe: isSignup || values.remember,
      });

      if (signin.error !== null) {
        setSubmissionError(AUTH_GENERIC_ERROR);
        return;
      }

      const destination = isSignup
        ? `/app/onboarding?site=${encodeURIComponent(normalizeProjectOrigin(values.website).origin)}`
        : safeApplicationReturnTo(returnTo);
      router.push(destination);
      router.refresh();
    } catch {
      setSubmissionError(AUTH_GENERIC_ERROR);
    } finally {
      setIsNavigating(false);
    }
  }

  return (
    <div className={styles.authForm}>
      <div className={`${styles.authHeading} mb-8`} data-motion="reveal">
        <h1 className="text-[clamp(2.35rem,5vw,3.35rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-[#111318]">
          {isSignup ? "Start seeing clearly." : "Welcome back."}
        </h1>
        <p className="mt-4 max-w-[44ch] text-[0.96rem] leading-6 text-[#60697a]">
          {isSignup
            ? "Create your workspace, add a website, and shape your first visibility audit."
            : "Sign in to continue to your Searvia workspace."}
        </p>
      </div>

      <button
        type="button"
        disabled
        aria-describedby="google-auth-note"
        className={`${styles.integrationControl} flex h-12 w-full cursor-not-allowed items-center justify-center gap-3 rounded-[10px] border border-[#d8dde5] bg-[#f7f8fa] text-sm font-semibold text-[#808796]`}
        data-motion="fade"
        data-motion-delay="70"
      >
        <span className="grid h-5 w-5 place-items-center rounded border border-[#cbd1dc] bg-white text-[0.7rem] font-bold text-[#4f586a]">
          G
        </span>
        Continue with Google
      </button>
      <p
        id="google-auth-note"
        className={`${styles.integrationNote} mt-1.5 text-center text-[0.69rem] font-medium uppercase tracking-[0.12em] text-[#8a92a0]`}
      >
        Integration required
      </p>

      <div
        className={`${styles.authDivider} my-6 flex items-center gap-4`}
        aria-hidden="true"
        data-motion="fade"
        data-motion-delay="130"
      >
        <span className="h-px flex-1 bg-[#e3e6ec]" />
        <span className="text-xs font-medium text-[#8a92a0]">or use email</span>
        <span className="h-px flex-1 bg-[#e3e6ec]" />
      </div>

      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className={`${styles.authFields} space-y-5`}
        data-motion="reveal"
        data-motion-delay="190"
      >
        {isSignup ? (
          <Field id="name" label="Full name" {...(errors.name ? { error: errors.name } : {})}>
            <div className="relative">
              <UserRound
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-[#7b8495]"
                strokeWidth={1.7}
              />
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                value={values.name}
                onChange={(event) => updateValue("name", event.target.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "name-error" : undefined}
                placeholder="Your name"
                className={inputClass}
              />
            </div>
          </Field>
        ) : null}

        <Field id="email" label="Work email" {...(errors.email ? { error: errors.email } : {})}>
          <div className="relative">
            <Mail
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-[#7b8495]"
              strokeWidth={1.7}
            />
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={values.email}
              onChange={(event) => updateValue("email", event.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
              placeholder="you@company.com"
              className={inputClass}
            />
          </div>
        </Field>

        <Field
          id="password"
          label="Password"
          {...(errors.password ? { error: errors.password } : {})}
          {...(isSignup
            ? { hint: `${AUTH_PASSWORD_MIN_LENGTH}–${AUTH_PASSWORD_MAX_LENGTH} characters.` }
            : {})}
        >
          <div className="relative">
            <LockKeyhole
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-[#7b8495]"
              strokeWidth={1.7}
            />
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={values.password}
              onChange={(event) => updateValue("password", event.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                errors.password ? "password-error" : isSignup ? "password-hint" : undefined
              }
              placeholder={isSignup ? "Create a password" : "Enter your password"}
              className={`${inputClass} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className={`${styles.revealButton} absolute right-1.5 top-1.5 grid h-9 w-9 place-items-center rounded-md text-[#697284] transition hover:bg-[#f0f2f5] hover:text-[#111318] focus-visible:outline-2 focus-visible:outline-[#1f59ff]`}
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" className="h-[18px] w-[18px]" />
              ) : (
                <Eye aria-hidden="true" className="h-[18px] w-[18px]" />
              )}
            </button>
          </div>
        </Field>

        {isSignup ? (
          <Field
            id="website"
            label="Website"
            {...(errors.website ? { error: errors.website } : {})}
            hint="We’ll carry this into onboarding. No crawl starts automatically."
          >
            <div className="relative">
              <Globe2
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-[#7b8495]"
                strokeWidth={1.7}
              />
              <input
                id="website"
                name="website"
                type="url"
                inputMode="url"
                autoComplete="url"
                value={values.website}
                onChange={(event) => updateValue("website", event.target.value)}
                aria-invalid={Boolean(errors.website)}
                aria-describedby={errors.website ? "website-error" : "website-hint"}
                placeholder="https://example.com"
                className={inputClass}
              />
            </div>
          </Field>
        ) : null}

        {isSignup ? (
          <div>
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-5 text-[#596274]">
              <input
                id="terms"
                name="terms"
                type="checkbox"
                checked={values.terms}
                onChange={(event) => updateValue("terms", event.target.checked)}
                aria-invalid={Boolean(errors.terms)}
                aria-describedby={errors.terms ? "terms-error" : undefined}
                className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[#1f59ff]"
              />
              <span>
                I agree to the{" "}
                <Link
                  href="/terms"
                  className="font-semibold text-[#1555f5] underline-offset-4 hover:underline"
                >
                  Terms
                </Link>{" "}
                and{" "}
                <Link
                  href="/privacy"
                  className="font-semibold text-[#1555f5] underline-offset-4 hover:underline"
                >
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            {errors.terms ? (
              <p
                id="terms-error"
                role="alert"
                className="mt-1.5 text-xs font-medium text-[#c81e2a]"
              >
                {errors.terms}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2.5 text-[#596274]">
              <input
                id="remember"
                name="remember"
                type="checkbox"
                checked={values.remember}
                onChange={(event) => updateValue("remember", event.target.checked)}
                className="h-[18px] w-[18px] accent-[#1f59ff]"
              />
              Remember me
            </label>
            <Link
              href="/contact"
              className="font-semibold text-[#1555f5] underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        )}

        {submissionError ? (
          <p
            role="alert"
            className="rounded-[10px] border border-[#f0c4c8] bg-[#fff5f5] px-3.5 py-3 text-sm font-medium text-[#9f1d28]"
          >
            {submissionError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isNavigating}
          className={`${styles.submitButton} flex h-12 w-full items-center justify-center rounded-[10px] bg-[#1f59ff] px-5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(31,89,255,0.18)] transition duration-200 enabled:hover:-translate-y-1 enabled:hover:scale-[1.015] enabled:hover:bg-[#1749d8] enabled:hover:shadow-[0_14px_30px_rgba(31,89,255,0.26)] enabled:active:translate-y-0 enabled:active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#1f59ff] disabled:cursor-wait disabled:opacity-70`}
        >
          {isNavigating ? "Signing in…" : isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p
        className="mt-7 text-center text-sm text-[#6c7484] lg:hidden"
        data-motion="fade"
        data-motion-delay="260"
      >
        {isSignup ? "Already have an account?" : "New to Searvia?"}{" "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="font-semibold text-[#1555f5] underline-offset-4 hover:underline"
        >
          {isSignup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
