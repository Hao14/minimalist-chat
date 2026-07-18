export const ONBOARDING_STORAGE_KEY = "searvia:onboarding:v1";

export const ONBOARDING_STEP_COUNT = 7;

export type OwnershipMethod = "later" | "dns" | "html-file" | "meta-tag" | "search-console";

export interface OnboardingState {
  version: 1;
  currentStep: number;
  completedAt?: string;
  account: {
    name: string;
    email: string;
  };
  workspace: {
    name: string;
    role: string;
    teamSize: string;
  };
  website: {
    projectName: string;
    domain: string;
    protocol: "https" | "http";
    hostname: "www" | "apex" | "auto";
    country: string;
    language: string;
    timeZone: string;
  };
  ownership: {
    method: OwnershipMethod;
    verificationStatus: "not_started";
  };
  crawl: {
    pageLimit: number;
    source: "website" | "sitemap" | "url-list";
    includeSubdomains: boolean;
    respectRobots: true;
    delayMs: number;
    concurrency: number;
    renderMode: "html" | "auto" | "javascript";
    includePatterns: string;
    excludePatterns: string;
    queryParameterRule: "keep" | "ignore-tracking" | "ignore-all";
    userAgent: "searvia" | "googlebot-mobile";
  };
  competitors: string[];
  plannedIntegrations: string[];
  audit: {
    mode: "demo";
    demoAcknowledged: boolean;
  };
}

function projectNameFromDomain(value: string) {
  try {
    const normalized = normalizeWebsite(value);
    const hostname = new URL(normalized).hostname.replace(/^www\./, "");
    const label = hostname.split(".")[0] || "My website";
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "";
  }
}

export function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Use an http or https website address.");
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname || (!hostname.includes(".") && hostname !== "localhost")) {
    throw new Error("Enter a complete domain, such as example.com.");
  }

  return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
}

export function createDefaultOnboardingState(site = ""): OnboardingState {
  let normalizedSite = "";
  try {
    normalizedSite = normalizeWebsite(site);
  } catch {
    normalizedSite = site.trim();
  }

  return {
    version: 1,
    currentStep: 1,
    account: { name: "", email: "" },
    workspace: { name: "", role: "", teamSize: "" },
    website: {
      projectName: projectNameFromDomain(normalizedSite),
      domain: normalizedSite,
      protocol: normalizedSite.startsWith("http://") ? "http" : "https",
      hostname: "auto",
      country: "US",
      language: "en",
      timeZone: "America/Los_Angeles",
    },
    ownership: { method: "later", verificationStatus: "not_started" },
    crawl: {
      pageLimit: 100,
      source: "website",
      includeSubdomains: false,
      respectRobots: true,
      delayMs: 750,
      concurrency: 2,
      renderMode: "auto",
      includePatterns: "",
      excludePatterns: "/account/*\n/checkout/*\n/admin/*",
      queryParameterRule: "ignore-tracking",
      userAgent: "searvia",
    },
    competitors: [],
    plannedIntegrations: [],
    audit: { mode: "demo", demoAcknowledged: false },
  };
}

function mergeStoredState(value: Partial<OnboardingState>): OnboardingState {
  const defaults = createDefaultOnboardingState(value.website?.domain ?? "");

  return {
    ...defaults,
    ...value,
    version: 1,
    currentStep: Math.min(ONBOARDING_STEP_COUNT, Math.max(1, Number(value.currentStep) || 1)),
    account: { ...defaults.account, ...value.account },
    workspace: { ...defaults.workspace, ...value.workspace },
    website: { ...defaults.website, ...value.website },
    ownership: { ...defaults.ownership, ...value.ownership },
    crawl: { ...defaults.crawl, ...value.crawl, respectRobots: true },
    competitors: Array.isArray(value.competitors) ? value.competitors.slice(0, 10) : [],
    plannedIntegrations: Array.isArray(value.plannedIntegrations)
      ? value.plannedIntegrations.slice(0, 6)
      : [],
    audit: { ...defaults.audit, ...value.audit, mode: "demo" },
  };
}

export function readOnboardingState() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    if (parsed.version !== 1) return null;
    return mergeStoredState(parsed);
  } catch {
    return null;
  }
}

export function saveOnboardingState(state: OnboardingState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The flow remains usable when storage is unavailable or full.
  }
}

export function seedOnboardingFromSignup({
  name,
  email,
  site,
}: {
  name: string;
  email: string;
  site: string;
}) {
  const existing = readOnboardingState();
  const next = existing ?? createDefaultOnboardingState(site);

  let normalizedSite = site;
  try {
    normalizedSite = normalizeWebsite(site);
  } catch {
    // Signup validation reports the issue before this helper is called.
  }

  const seeded: OnboardingState = {
    ...next,
    account: { name, email },
    workspace: {
      ...next.workspace,
      name: next.workspace.name || (name ? `${name.split(" ")[0]}'s workspace` : ""),
    },
    website: {
      ...next.website,
      domain: normalizedSite,
      projectName: next.website.projectName || projectNameFromDomain(normalizedSite),
      protocol: normalizedSite.startsWith("http://") ? "http" : "https",
    },
  };

  saveOnboardingState(seeded);
}
