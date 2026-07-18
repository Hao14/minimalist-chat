import { normalizeProjectOrigin, type NormalizedProjectOrigin } from "@searvia/shared-types";
import { z } from "zod";

const queryPolicySchema = z.enum(["keep", "ignore_tracking", "ignore_all"]);
const MAX_SUBMITTED_SITEMAPS = 20;
const MAX_SITEMAP_URL_LENGTH = 2_048;
const MAX_SITEMAP_INPUT_LENGTH =
  MAX_SUBMITTED_SITEMAPS * MAX_SITEMAP_URL_LENGTH + MAX_SUBMITTED_SITEMAPS - 1;

const projectFieldsSchema = z.object({
  projectName: z.string().trim().min(1, "Enter a project name.").max(160),
  website: z.string().trim().min(1, "Enter a website domain or URL.").max(2_048),
  pageLimit: z.coerce.number().int().min(1).max(100),
  maxDepth: z.coerce.number().int().min(0).max(10),
  includeSubdomains: z.boolean(),
  renderingEnabled: z.boolean(),
  submittedSitemapUrls: z.string().max(MAX_SITEMAP_INPUT_LENGTH),
  queryPolicy: queryPolicySchema,
});

export interface ProjectFormInput {
  readonly organizationName?: string;
  readonly name: string;
  readonly target: NormalizedProjectOrigin;
  readonly crawlConfig: Readonly<{
    pageLimit: number;
    maxDepth: number;
    includeSubdomains: boolean;
    renderingEnabled: boolean;
    submittedSitemapUrls: readonly string[];
    queryPolicy: "keep" | "ignore_tracking" | "ignore_all";
  }>;
}

export type ProjectFormField =
  | "organizationName"
  | "projectName"
  | "website"
  | "pageLimit"
  | "maxDepth"
  | "queryPolicy"
  | "submittedSitemapUrls";

export type ProjectFormFieldErrors = Partial<Record<ProjectFormField, string>>;

export type ProjectFormParseResult =
  | Readonly<{ success: true; data: ProjectFormInput }>
  | Readonly<{ success: false; fieldErrors: ProjectFormFieldErrors }>;

function firstFieldErrors(error: z.ZodError): ProjectFormFieldErrors {
  const errors: ProjectFormFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && errors[field as ProjectFormField] === undefined) {
      errors[field as ProjectFormField] = issue.message;
    }
  }
  return errors;
}

export function normalizeSubmittedSitemapUrls(input: string): readonly string[] {
  const values = input
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length > MAX_SUBMITTED_SITEMAPS) {
    throw new Error(`Enter no more than ${String(MAX_SUBMITTED_SITEMAPS)} sitemap URLs.`);
  }

  const normalized = new Set<string>();
  for (const value of values) {
    if (value.length > MAX_SITEMAP_URL_LENGTH) {
      throw new Error("Each sitemap URL must be 2,048 characters or fewer.");
    }
    if (!/^https?:\/\//iu.test(value)) {
      throw new Error("Each sitemap URL must be a complete HTTP or HTTPS URL.");
    }

    let parsed: URL;
    try {
      normalizeProjectOrigin(value);
      parsed = new URL(value);
    } catch {
      throw new Error("Enter valid HTTP or HTTPS sitemap URLs, one per line.");
    }

    if (parsed.hash !== "") {
      throw new Error("Sitemap URLs cannot contain fragments.");
    }
    normalized.add(parsed.href);
  }

  return Object.freeze([...normalized]);
}

export function parseProjectFormData(
  formData: FormData,
  options: Readonly<{ onboarding: boolean }>,
): ProjectFormParseResult {
  const parsed = projectFieldsSchema.safeParse({
    projectName: formData.get("projectName"),
    website: formData.get("website"),
    pageLimit: formData.get("pageLimit"),
    maxDepth: formData.get("maxDepth"),
    includeSubdomains: formData.get("includeSubdomains") === "on",
    renderingEnabled: formData.get("renderingEnabled") === "on",
    submittedSitemapUrls: String(formData.get("submittedSitemapUrls") ?? ""),
    queryPolicy: formData.get("queryPolicy"),
  });

  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const organizationError =
    options.onboarding && (organizationName.length < 2 || organizationName.length > 160)
      ? "Enter an organization name between 2 and 160 characters."
      : undefined;

  if (!parsed.success || organizationError !== undefined) {
    return {
      success: false,
      fieldErrors: {
        ...(!parsed.success ? firstFieldErrors(parsed.error) : {}),
        ...(organizationError === undefined ? {} : { organizationName: organizationError }),
      },
    };
  }

  let target: NormalizedProjectOrigin;
  try {
    target = normalizeProjectOrigin(parsed.data.website);
  } catch (error) {
    return {
      success: false,
      fieldErrors: {
        website: error instanceof Error ? error.message : "Enter a valid website domain or URL.",
      },
    };
  }

  let submittedSitemapUrls: readonly string[];
  try {
    submittedSitemapUrls = normalizeSubmittedSitemapUrls(parsed.data.submittedSitemapUrls);
  } catch (error) {
    return {
      success: false,
      fieldErrors: {
        submittedSitemapUrls:
          error instanceof Error ? error.message : "Enter valid sitemap URLs, one per line.",
      },
    };
  }

  return {
    success: true,
    data: {
      ...(options.onboarding ? { organizationName } : {}),
      name: parsed.data.projectName,
      target,
      crawlConfig: {
        pageLimit: parsed.data.pageLimit,
        maxDepth: parsed.data.maxDepth,
        includeSubdomains: parsed.data.includeSubdomains,
        renderingEnabled: parsed.data.renderingEnabled,
        submittedSitemapUrls,
        queryPolicy: parsed.data.queryPolicy,
      },
    },
  };
}
