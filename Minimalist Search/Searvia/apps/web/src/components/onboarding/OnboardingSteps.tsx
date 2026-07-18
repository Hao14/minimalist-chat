"use client";

import {
  BarChart3,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  FileCode2,
  Gauge,
  Globe2,
  Link2,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";

import { normalizeWebsite, type OnboardingState, type OwnershipMethod } from "./onboarding-state";
import styles from "./onboarding-shell.module.css";

export type StepErrors = Record<string, string>;

interface StepContentProps {
  state: OnboardingState;
  errors: StepErrors;
  setState: Dispatch<SetStateAction<OnboardingState>>;
}

const controlClass = `${styles.control} h-12 w-full rounded-[9px] border border-[#cfd5df] bg-white px-3.5 text-[0.9rem] font-medium text-[#252a34] outline-none transition placeholder:text-[#959ca9] hover:border-[#abb4c3] focus:border-[#1f59ff] focus:ring-4 focus:ring-[#1f59ff]/10 disabled:cursor-not-allowed disabled:bg-[#f3f4f6] disabled:text-[#8b93a2]`;

const textAreaClass = `${styles.textArea} min-h-24 w-full resize-y rounded-[9px] border border-[#cfd5df] bg-white px-3.5 py-3 font-mono text-[0.78rem] leading-5 text-[#252a34] outline-none transition placeholder:text-[#959ca9] hover:border-[#abb4c3] focus:border-[#1f59ff] focus:ring-4 focus:ring-[#1f59ff]/10`;

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-[#2a2f39]">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-[#c71f2d]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-[#6a7384]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SelectControl({
  id,
  value,
  onChange,
  children,
  describedBy,
  invalid,
}: {
  id: string;
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
  describedBy?: string;
  invalid?: boolean;
}) {
  return (
    <div className={`${styles.selectControl} relative`}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={`${controlClass} appearance-none pr-10`}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-3.5 h-5 w-5 text-[#727b8c]"
        strokeWidth={1.8}
      />
    </div>
  );
}

function Notice({
  tone = "blue",
  icon,
  title,
  children,
}: {
  tone?: "blue" | "teal" | "neutral";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const colors = {
    blue: "border-[#bfd0ff] bg-[#f3f6ff] text-[#394f84]",
    teal: "border-[#b7dfdb] bg-[#f2fbfa] text-[#315d59]",
    neutral: "border-[#d9dde5] bg-[#f8f9fa] text-[#596274]",
  };

  return (
    <div
      className={`${styles.notice} flex items-start gap-3 rounded-[11px] border px-4 py-3.5 text-sm leading-6 ${colors[tone]}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="font-semibold text-[#252a34]">{title}</p>
        <div className="mt-0.5 text-xs leading-5">{children}</div>
      </div>
    </div>
  );
}

export function WorkspaceStep({ state, errors, setState }: StepContentProps) {
  const update = (patch: Partial<OnboardingState["workspace"]>) =>
    setState((current) => ({
      ...current,
      workspace: { ...current.workspace, ...patch },
    }));

  return (
    <div className={`${styles.stepContentGroup} space-y-6`}>
      <Field
        id="workspaceName"
        label="Workspace name"
        hint="Usually your company, agency, or client portfolio name."
        {...(errors.workspaceName ? { error: errors.workspaceName } : {})}
      >
        <input
          id="workspaceName"
          name="workspaceName"
          type="text"
          autoComplete="organization"
          value={state.workspace.name}
          onChange={(event) => update({ name: event.target.value })}
          aria-invalid={Boolean(errors.workspaceName)}
          aria-describedby={errors.workspaceName ? "workspaceName-error" : "workspaceName-hint"}
          placeholder="Acme Software"
          className={controlClass}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="role"
          label="What best describes you?"
          {...(errors.role ? { error: errors.role } : {})}
        >
          <SelectControl
            id="role"
            value={state.workspace.role}
            onChange={(role) => update({ role })}
            invalid={Boolean(errors.role)}
            {...(errors.role ? { describedBy: "role-error" } : {})}
          >
            <option value="">Choose a role</option>
            <option value="founder">Founder or owner</option>
            <option value="marketing">Marketing or growth</option>
            <option value="seo">SEO specialist</option>
            <option value="developer">Developer</option>
            <option value="agency">Agency or consultant</option>
            <option value="content">Content team</option>
          </SelectControl>
        </Field>

        <Field
          id="teamSize"
          label="Team size"
          {...(errors.teamSize ? { error: errors.teamSize } : {})}
        >
          <SelectControl
            id="teamSize"
            value={state.workspace.teamSize}
            onChange={(teamSize) => update({ teamSize })}
            invalid={Boolean(errors.teamSize)}
            {...(errors.teamSize ? { describedBy: "teamSize-error" } : {})}
          >
            <option value="">Choose a size</option>
            <option value="1">Just me</option>
            <option value="2-10">2–10 people</option>
            <option value="11-50">11–50 people</option>
            <option value="51-200">51–200 people</option>
            <option value="201+">201+ people</option>
          </SelectControl>
        </Field>
      </div>

      <Notice
        tone="neutral"
        icon={<UsersRound aria-hidden="true" className="h-4 w-4 text-[#596274]" />}
        title="Multi-tenant by design"
      >
        This workspace will keep its projects, members, settings, and usage separate from every
        other workspace.
      </Notice>
    </div>
  );
}

export function WebsiteStep({ state, errors, setState }: StepContentProps) {
  const update = (patch: Partial<OnboardingState["website"]>) =>
    setState((current) => ({
      ...current,
      website: { ...current.website, ...patch },
    }));

  return (
    <div className={`${styles.stepContentGroup} space-y-6`}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="projectName"
          label="Project name"
          {...(errors.projectName ? { error: errors.projectName } : {})}
        >
          <input
            id="projectName"
            name="projectName"
            type="text"
            value={state.website.projectName}
            onChange={(event) => update({ projectName: event.target.value })}
            aria-invalid={Boolean(errors.projectName)}
            aria-describedby={errors.projectName ? "projectName-error" : undefined}
            placeholder="Acme website"
            className={controlClass}
          />
        </Field>

        <Field
          id="domain"
          label="Website URL"
          hint="No crawl starts until you explicitly begin one."
          {...(errors.domain ? { error: errors.domain } : {})}
        >
          <div className="relative">
            <Globe2
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-[#788193]"
              strokeWidth={1.7}
            />
            <input
              id="domain"
              name="domain"
              type="url"
              inputMode="url"
              autoComplete="url"
              value={state.website.domain}
              onChange={(event) => update({ domain: event.target.value })}
              aria-invalid={Boolean(errors.domain)}
              aria-describedby={errors.domain ? "domain-error" : "domain-hint"}
              placeholder="https://example.com"
              className={`${controlClass} pl-11`}
            />
          </div>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="protocol" label="Preferred protocol">
          <SelectControl
            id="protocol"
            value={state.website.protocol}
            onChange={(protocol) => update({ protocol: protocol as "https" | "http" })}
          >
            <option value="https">HTTPS</option>
            <option value="http">HTTP</option>
          </SelectControl>
        </Field>
        <Field id="hostname" label="Preferred hostname">
          <SelectControl
            id="hostname"
            value={state.website.hostname}
            onChange={(hostname) => update({ hostname: hostname as "www" | "apex" | "auto" })}
          >
            <option value="auto">Detect automatically</option>
            <option value="apex">Apex domain</option>
            <option value="www">www hostname</option>
          </SelectControl>
        </Field>
        <Field id="country" label="Primary country">
          <SelectControl
            id="country"
            value={state.website.country}
            onChange={(country) => update({ country })}
          >
            <option value="US">United States</option>
            <option value="CA">Canada</option>
            <option value="GB">United Kingdom</option>
            <option value="AU">Australia</option>
            <option value="DE">Germany</option>
            <option value="FR">France</option>
            <option value="other">Other / global</option>
          </SelectControl>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="language" label="Primary language">
          <SelectControl
            id="language"
            value={state.website.language}
            onChange={(language) => update({ language })}
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="pt">Portuguese</option>
            <option value="ja">Japanese</option>
          </SelectControl>
        </Field>
        <Field id="timeZone" label="Time zone">
          <SelectControl
            id="timeZone"
            value={state.website.timeZone}
            onChange={(timeZone) => update({ timeZone })}
          >
            <option value="America/Los_Angeles">Pacific Time</option>
            <option value="America/Denver">Mountain Time</option>
            <option value="America/Chicago">Central Time</option>
            <option value="America/New_York">Eastern Time</option>
            <option value="Europe/London">London</option>
            <option value="Europe/Berlin">Central European Time</option>
            <option value="Asia/Tokyo">Tokyo</option>
            <option value="UTC">UTC</option>
          </SelectControl>
        </Field>
      </div>
    </div>
  );
}

const ownershipMethods: Array<{
  id: OwnershipMethod;
  title: string;
  description: string;
  icon: typeof ShieldCheck;
  integrationRequired?: boolean;
}> = [
  {
    id: "later",
    title: "Verify later",
    description: "Plan a future limited, respectful public crawl of up to 100 pages.",
    icon: CircleHelp,
  },
  {
    id: "dns",
    title: "DNS TXT record",
    description: "Add a unique verification record with your DNS provider.",
    icon: Globe2,
  },
  {
    id: "html-file",
    title: "HTML file",
    description: "Upload a verification file to the root of your website.",
    icon: FileCode2,
  },
  {
    id: "meta-tag",
    title: "Meta tag",
    description: "Place a verification tag inside the home page head.",
    icon: Code2,
  },
  {
    id: "search-console",
    title: "Search Console",
    description: "Use an authorized Google Search Console property.",
    icon: Search,
    integrationRequired: true,
  },
];

export function OwnershipStep({ state, setState }: StepContentProps) {
  const setMethod = (method: OwnershipMethod) =>
    setState((current) => ({
      ...current,
      ownership: { method, verificationStatus: "not_started" },
    }));

  return (
    <div className={`${styles.stepContentGroup} space-y-6`}>
      <Notice
        tone="blue"
        icon={<ShieldCheck aria-hidden="true" className="h-4 w-4 text-[#1f59ff]" />}
        title="Verification expands safe access"
      >
        It is required for higher crawl limits, authenticated pages, aggressive rendering, and
        private provider data. You can continue without it.
      </Notice>

      <fieldset>
        <legend className="sr-only">Choose an ownership verification method</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {ownershipMethods.map((method) => {
            const Icon = method.icon;
            const selected = state.ownership.method === method.id;
            return (
              <label
                key={method.id}
                className={`${styles.choiceCard} relative flex cursor-pointer items-start gap-3 rounded-[12px] border p-4 transition ${
                  selected
                    ? "border-[#1f59ff] bg-[#f3f6ff] shadow-[0_0_0_3px_rgba(31,89,255,0.08)]"
                    : "border-[#d8dde5] bg-white hover:border-[#abb4c3]"
                }`}
              >
                <input
                  type="radio"
                  name="ownershipMethod"
                  value={method.id}
                  checked={selected}
                  onChange={() => setMethod(method.id)}
                  className="sr-only"
                />
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-[9px] ${selected ? "bg-[#1f59ff] text-white" : "bg-[#f1f3f6] text-[#596274]"}`}
                >
                  <Icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#252a34]">
                    {method.title}
                    {method.integrationRequired ? (
                      <span className="rounded bg-[#eef1f5] px-1.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[#656f80]">
                        Integration required
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[#687183]">
                    {method.description}
                  </span>
                </span>
                <span
                  className={`absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full border ${selected ? "border-[#1f59ff] bg-[#1f59ff] text-white" : "border-[#cbd1da] bg-white"}`}
                >
                  {selected ? (
                    <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {state.ownership.method === "later" ? (
        <Notice
          tone="teal"
          icon={<Gauge aria-hidden="true" className="h-4 w-4 text-[#078c82]" />}
          title="Planned public-audit policy"
        >
          A future Searvia crawler must honor robots.txt, use conservative crawl settings, and stop
          at your selected plan limit. This step starts no crawl and claims no ownership.
        </Notice>
      ) : (
        <Notice
          tone="neutral"
          icon={<LockKeyhole aria-hidden="true" className="h-4 w-4 text-[#596274]" />}
          title="Verification service integration required"
        >
          Your chosen method is saved, but this interface does not claim that the site is verified.
          Complete verification after the service is connected.
        </Notice>
      )}
    </div>
  );
}

export function CrawlStep({ state, errors, setState }: StepContentProps) {
  const update = (patch: Partial<OnboardingState["crawl"]>) =>
    setState((current) => ({
      ...current,
      crawl: { ...current.crawl, ...patch, respectRobots: true },
    }));

  return (
    <div className={`${styles.stepContentGroup} space-y-6`}>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          id="pageLimit"
          label="Page limit"
          hint="Free demo setup: up to 100 pages."
          {...(errors.pageLimit ? { error: errors.pageLimit } : {})}
        >
          <input
            id="pageLimit"
            name="pageLimit"
            type="number"
            min={1}
            max={100}
            step={1}
            value={state.crawl.pageLimit}
            onChange={(event) => update({ pageLimit: Number(event.target.value) })}
            aria-invalid={Boolean(errors.pageLimit)}
            aria-describedby={errors.pageLimit ? "pageLimit-error" : "pageLimit-hint"}
            className={controlClass}
          />
        </Field>
        <Field id="crawlSource" label="Crawl source">
          <SelectControl
            id="crawlSource"
            value={state.crawl.source}
            onChange={(source) => update({ source: source as OnboardingState["crawl"]["source"] })}
          >
            <option value="website">Website links</option>
            <option value="sitemap">XML sitemap</option>
            <option value="url-list">Uploaded URL list</option>
          </SelectControl>
        </Field>
        <Field id="renderMode" label="JavaScript rendering">
          <SelectControl
            id="renderMode"
            value={state.crawl.renderMode}
            onChange={(renderMode) =>
              update({ renderMode: renderMode as OnboardingState["crawl"]["renderMode"] })
            }
          >
            <option value="auto">Auto when needed</option>
            <option value="html">HTML only</option>
            <option value="javascript">Always render</option>
          </SelectControl>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="delayMs"
          label="Delay between requests"
          {...(errors.delayMs ? { error: errors.delayMs } : {})}
        >
          <SelectControl
            id="delayMs"
            value={state.crawl.delayMs}
            onChange={(delayMs) => update({ delayMs: Number(delayMs) })}
            invalid={Boolean(errors.delayMs)}
            {...(errors.delayMs ? { describedBy: "delayMs-error" } : {})}
          >
            <option value={250}>250 ms</option>
            <option value={500}>500 ms</option>
            <option value={750}>750 ms — recommended</option>
            <option value={1000}>1 second</option>
            <option value={2000}>2 seconds</option>
          </SelectControl>
        </Field>
        <Field
          id="concurrency"
          label="Maximum concurrency"
          {...(errors.concurrency ? { error: errors.concurrency } : {})}
        >
          <SelectControl
            id="concurrency"
            value={state.crawl.concurrency}
            onChange={(concurrency) => update({ concurrency: Number(concurrency) })}
            invalid={Boolean(errors.concurrency)}
            {...(errors.concurrency ? { describedBy: "concurrency-error" } : {})}
          >
            <option value={1}>1 request</option>
            <option value={2}>2 requests — recommended</option>
            <option value={3}>3 requests</option>
            <option value={4}>4 requests</option>
          </SelectControl>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-[11px] border border-[#d8dde5] bg-white px-4 py-3 text-sm font-medium text-[#343b48]">
          <input
            type="checkbox"
            checked={state.crawl.includeSubdomains}
            onChange={(event) => update({ includeSubdomains: event.target.checked })}
            className="h-[18px] w-[18px] accent-[#1f59ff]"
          />
          Include subdomains
        </label>
        <label className="flex min-h-16 cursor-not-allowed items-center gap-3 rounded-[11px] border border-[#b7dfdb] bg-[#f2fbfa] px-4 py-3 text-sm font-medium text-[#315d59]">
          <input type="checkbox" checked disabled className="h-[18px] w-[18px] accent-[#078c82]" />
          <span>
            Respect robots.txt
            <span className="block text-[0.68rem] font-normal text-[#5f7f7c]">
              Always enabled by default
            </span>
          </span>
        </label>
      </div>

      <details className="group rounded-[12px] border border-[#d8dde5] bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-sm font-semibold text-[#303641] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f59ff]">
          URL rules and crawler identity
          <ChevronDown aria-hidden="true" className="h-5 w-5 transition group-open:rotate-180" />
        </summary>
        <div className="space-y-5 border-t border-[#e4e7ed] px-4 py-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="includePatterns"
              label="Include patterns"
              hint="One glob pattern per line. Leave empty for all eligible URLs."
            >
              <textarea
                id="includePatterns"
                value={state.crawl.includePatterns}
                onChange={(event) => update({ includePatterns: event.target.value })}
                placeholder="/docs/*"
                className={textAreaClass}
              />
            </Field>
            <Field
              id="excludePatterns"
              label="Exclude patterns"
              hint="Sensitive and destructive paths are excluded by default."
            >
              <textarea
                id="excludePatterns"
                value={state.crawl.excludePatterns}
                onChange={(event) => update({ excludePatterns: event.target.value })}
                className={textAreaClass}
              />
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="queryParameterRule" label="Query-parameter handling">
              <SelectControl
                id="queryParameterRule"
                value={state.crawl.queryParameterRule}
                onChange={(queryParameterRule) =>
                  update({
                    queryParameterRule:
                      queryParameterRule as OnboardingState["crawl"]["queryParameterRule"],
                  })
                }
              >
                <option value="ignore-tracking">Ignore known tracking parameters</option>
                <option value="keep">Keep all parameters</option>
                <option value="ignore-all">Ignore all parameters</option>
              </SelectControl>
            </Field>
            <Field id="userAgent" label="User agent">
              <SelectControl
                id="userAgent"
                value={state.crawl.userAgent}
                onChange={(userAgent) =>
                  update({ userAgent: userAgent as OnboardingState["crawl"]["userAgent"] })
                }
              >
                <option value="searvia">SearviaBot/2.0</option>
                <option value="googlebot-mobile">Googlebot Smartphone (simulation)</option>
              </SelectControl>
            </Field>
          </div>
          <div className="rounded-[9px] border border-[#d9dde5] bg-[#f6f7f9] px-4 py-3 text-xs leading-5 text-[#687183]">
            <span className="font-semibold text-[#343b48]">Authenticated crawling:</span> requires
            verified ownership and encrypted credential storage. Integration required.
          </div>
        </div>
      </details>
    </div>
  );
}

function competitorHostname(value: string) {
  const normalized = normalizeWebsite(value);
  return new URL(normalized).hostname.replace(/^www\./, "").toLowerCase();
}

export function CompetitorsStep({ state, setState }: StepContentProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const suggestions = ["discord.com", "slack.com"];

  function addCompetitor(value: string) {
    try {
      const hostname = competitorHostname(value);
      if (state.competitors.includes(hostname)) {
        setError(`${hostname} is already in your comparison set.`);
        return;
      }
      if (state.competitors.length >= 10) {
        setError("You can add up to 10 competitors during setup.");
        return;
      }
      setState((current) => ({
        ...current,
        competitors: [...current.competitors, hostname],
      }));
      setDraft("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enter a valid competitor domain.");
    }
  }

  function removeCompetitor(hostname: string) {
    setState((current) => ({
      ...current,
      competitors: current.competitors.filter((item) => item !== hostname),
    }));
    setError("");
  }

  return (
    <div className={`${styles.stepContentGroup} space-y-6`}>
      <Notice
        tone="neutral"
        icon={<UsersRound aria-hidden="true" className="h-4 w-4 text-[#596274]" />}
        title="Focused, respectful comparison"
      >
        Adding a competitor does not start an aggressive crawl. Searvia uses limited public
        analysis; ranking, backlink, and traffic comparisons require licensed provider integrations.
      </Notice>

      <div>
        <label
          htmlFor="competitorDomain"
          className="mb-2 block text-sm font-semibold text-[#2a2f39]"
        >
          Competitor domain
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Globe2
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-[#788193]"
              strokeWidth={1.7}
            />
            <input
              id="competitorDomain"
              type="text"
              inputMode="url"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCompetitor(draft);
                }
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "competitor-error" : undefined}
              placeholder="competitor.com"
              className={`${controlClass} pl-11`}
            />
          </div>
          <button
            type="button"
            onClick={() => addCompetitor(draft)}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[9px] border border-[#252a34] bg-white px-5 text-sm font-semibold text-[#252a34] transition hover:bg-[#f3f4f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f59ff]"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add domain
          </button>
        </div>
        {error ? (
          <p
            id="competitor-error"
            role="alert"
            className="mt-1.5 text-xs font-medium text-[#c71f2d]"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-[#727b8b]">
          Suggestions for the demo project
        </p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => {
            const added = state.competitors.includes(suggestion);
            return (
              <button
                key={suggestion}
                type="button"
                onClick={() => (added ? removeCompetitor(suggestion) : addCompetitor(suggestion))}
                className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f59ff] ${
                  added
                    ? "border-[#8fcac4] bg-[#edf9f7] text-[#087e74]"
                    : "border-[#d6dbe4] bg-white text-[#424a59] hover:border-[#aeb6c4]"
                }`}
              >
                {added ? (
                  <Check aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Plus aria-hidden="true" className="h-4 w-4" />
                )}
                {suggestion}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${styles.comparisonPanel} rounded-[12px] border border-[#d8dde5] bg-white`}>
        <div className="flex items-center justify-between border-b border-[#e4e7ed] px-4 py-3.5">
          <p className="text-sm font-semibold text-[#2a2f39]">Comparison set</p>
          <span className="text-xs text-[#737c8d]">{state.competitors.length} of 10</span>
        </div>
        {state.competitors.length ? (
          <ul className="divide-y divide-[#e8eaf0]">
            {state.competitors.map((competitor) => (
              <li
                key={competitor}
                className="flex min-h-14 items-center justify-between gap-4 px-4 py-2.5"
              >
                <span className="flex items-center gap-3 text-sm font-semibold text-[#343b48]">
                  <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[#f0f2f5] text-[#697284]">
                    <Globe2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  {competitor}
                </span>
                <button
                  type="button"
                  onClick={() => removeCompetitor(competitor)}
                  aria-label={`Remove ${competitor}`}
                  className="grid h-9 w-9 place-items-center rounded-[8px] text-[#7b8494] transition hover:bg-[#fff0f1] hover:text-[#c71f2d] focus-visible:outline-2 focus-visible:outline-[#1f59ff]"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-[#737c8d]">
            No competitors added. You can continue and add them later.
          </div>
        )}
      </div>
    </div>
  );
}

const integrations = [
  {
    id: "search-console",
    name: "Search Console",
    description: "Queries, clicks, impressions, and owned-property coverage.",
    icon: Search,
  },
  {
    id: "analytics",
    name: "Analytics",
    description: "Connect visibility work to sessions and conversions.",
    icon: BarChart3,
  },
  {
    id: "pagespeed",
    name: "PageSpeed provider",
    description: "Field and lab performance metrics with source dates.",
    icon: Gauge,
  },
  {
    id: "serp-keywords",
    name: "SERP & keyword data",
    description: "Licensed rankings, volumes, and keyword opportunities.",
    icon: Globe2,
  },
  {
    id: "backlinks",
    name: "Backlink provider",
    description: "Referring domains, links, anchors, and competitor gaps.",
    icon: Link2,
  },
  {
    id: "ai-answers",
    name: "AI-answer provider",
    description: "Evidence-backed brand mentions, citations, and prompt runs.",
    icon: Sparkles,
  },
];

export function IntegrationsStep({ state, setState }: StepContentProps) {
  function togglePlanned(id: string) {
    setState((current) => ({
      ...current,
      plannedIntegrations: current.plannedIntegrations.includes(id)
        ? current.plannedIntegrations.filter((item) => item !== id)
        : [...current.plannedIntegrations, id],
    }));
  }

  return (
    <div className={`${styles.stepContentGroup} space-y-6`}>
      <Notice tone="blue" icon={<PlugZapIcon />} title="No invented provider data">
        These connections are optional. Until a provider is configured, Searvia shows a clear
        integration state instead of fabricated rankings, backlinks, traffic, or AI citations.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-2">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const planned = state.plannedIntegrations.includes(integration.id);
          return (
            <article
              key={integration.id}
              className={`${styles.integrationCard} flex min-h-[178px] flex-col rounded-[12px] border border-[#d8dde5] bg-white p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-[#dce2f4] bg-[#f3f6ff] text-[#1f59ff]">
                  <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <span className="rounded bg-[#eef1f5] px-1.5 py-1 font-mono text-[0.57rem] font-semibold uppercase tracking-[0.08em] text-[#656f80]">
                  Integration required
                </span>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-[#2a2f39]">{integration.name}</h3>
              <p className="mt-1 flex-1 text-xs leading-5 text-[#687183]">
                {integration.description}
              </p>
              <button
                type="button"
                onClick={() => togglePlanned(integration.id)}
                className={`mt-3 inline-flex min-h-9 items-center justify-center gap-2 rounded-[8px] border px-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f59ff] ${
                  planned
                    ? "border-[#8fcac4] bg-[#edf9f7] text-[#087e74]"
                    : "border-[#cfd5df] bg-white text-[#434b5a] hover:bg-[#f4f5f7]"
                }`}
              >
                {planned ? (
                  <Check aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {planned ? "Added to setup plan" : "Add to setup plan"}
              </button>
            </article>
          );
        })}
      </div>

      <p className="text-xs leading-5 text-[#737c8d]">
        Planning a connection does not mark it connected. OAuth credentials, provider terms, and API
        access still need to be configured.
      </p>
    </div>
  );
}

function PlugZapIcon() {
  return (
    <span
      className="grid h-5 w-5 place-items-center rounded bg-[#1f59ff] text-[0.63rem] font-bold text-white"
      aria-hidden="true"
    >
      +
    </span>
  );
}

const auditStages = [
  "Queued",
  "Discovering URLs",
  "Crawling",
  "Rendering",
  "Extracting data",
  "Running rules",
  "Collecting performance metrics",
  "Calculating scores",
  "Creating recommendations",
  "Complete",
];

export function AuditStep({ state, errors, setState }: StepContentProps) {
  const siteLabel = state.website.domain || "No website entered";

  return (
    <div className={`${styles.stepContentGroup} space-y-6`}>
      <div className={`${styles.auditSummary} grid gap-3 sm:grid-cols-3`}>
        <div className="rounded-[11px] border border-[#d8dde5] bg-white p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#778091]">
            Website
          </p>
          <p className="mt-2 truncate text-sm font-semibold text-[#2a2f39]" title={siteLabel}>
            {siteLabel}
          </p>
        </div>
        <div className="rounded-[11px] border border-[#d8dde5] bg-white p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#778091]">
            Public page limit
          </p>
          <p className="mt-2 text-sm font-semibold text-[#2a2f39]">{state.crawl.pageLimit} pages</p>
        </div>
        <div className="rounded-[11px] border border-[#d8dde5] bg-white p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#778091]">
            Competitors
          </p>
          <p className="mt-2 text-sm font-semibold text-[#2a2f39]">
            {state.competitors.length || "None yet"}
          </p>
        </div>
      </div>

      <div
        className={`${styles.auditDemo} overflow-hidden rounded-[14px] border border-[#b8dedb] bg-white`}
      >
        <div className="flex flex-col gap-3 border-b border-[#d8ecea] bg-[#f2fbfa] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#dff5f2] px-2.5 py-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-[#087e74]">
                Demo data
              </span>
              <span className="text-xs font-semibold text-[#54716e]">No live crawl</span>
            </div>
            <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#20252e]">
              Open the guided Searvia workspace
            </h3>
          </div>
          <Sparkles aria-hidden="true" className="h-6 w-6 text-[#079d91]" strokeWidth={1.7} />
        </div>
        <div className="grid gap-5 px-5 py-5 md:grid-cols-[0.88fr_1.12fr]">
          <div>
            <p className="text-sm leading-6 text-[#596274]">
              Explore deterministic sample findings for minimalist.chat, including issue filters,
              crawl comparisons, rankings, backlinks, and AI visibility.
            </p>
            <p className="mt-3 text-xs leading-5 text-[#737c8d]">
              Sample values are fictional and kept separate from live project data. Your website
              will not be fetched when you continue.
            </p>
          </div>
          <div className="rounded-[10px] border border-[#e0e4ea] bg-[#f8f9fa] p-3.5">
            <p className="mb-3 text-[0.66rem] font-semibold uppercase tracking-[0.1em] text-[#737c8d]">
              A live audit reports these stages
            </p>
            <ul className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {auditStages.map((stage, index) => (
                <li key={stage} className="flex items-center gap-2 text-xs text-[#596274]">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[#cfd5df] bg-white font-mono text-[0.58rem] text-[#687183]">
                    {index + 1}
                  </span>
                  {stage}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-[12px] border border-[#d9dde5] bg-[#f7f8fa] px-4 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#2a2f39]">Start a real audit</p>
            <p className="mt-1 text-xs leading-5 text-[#687183]">
              Requires the crawler, queue, persistence, and authenticated project services.
            </p>
          </div>
          <span className="shrink-0 rounded bg-[#e9ecf1] px-2 py-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-[#687183]">
            Integration required
          </span>
        </div>
      </div>

      <div>
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-[11px] border bg-white px-4 py-3.5 text-sm leading-5 ${errors.demoAcknowledged ? "border-[#c71f2d]" : "border-[#d8dde5]"}`}
        >
          <input
            id="demoAcknowledged"
            type="checkbox"
            checked={state.audit.demoAcknowledged}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                audit: { ...current.audit, demoAcknowledged: event.target.checked },
              }))
            }
            aria-invalid={Boolean(errors.demoAcknowledged)}
            aria-describedby={errors.demoAcknowledged ? "demoAcknowledged-error" : undefined}
            className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[#1f59ff]"
          />
          I understand that this opens clearly labeled demo data and does not start a live crawl of
          my website.
        </label>
        {errors.demoAcknowledged ? (
          <p
            id="demoAcknowledged-error"
            role="alert"
            className="mt-1.5 text-xs font-medium text-[#c71f2d]"
          >
            {errors.demoAcknowledged}
          </p>
        ) : null}
      </div>
    </div>
  );
}
