import {
  isDatabaseDomainError,
  type OnboardingInput,
  type OnboardingResult,
  type OrganizationScope,
  type ProjectInput,
  type ProjectRecord,
} from "@searvia/database/runtime";

import { parseProjectFormData, type ProjectFormFieldErrors } from "./project-form";

export interface ProjectActionState {
  readonly status: "idle" | "error";
  readonly message: string;
  readonly fieldErrors: ProjectFormFieldErrors;
}

export const INITIAL_PROJECT_ACTION_STATE: ProjectActionState = Object.freeze({
  status: "idle",
  message: "",
  fieldErrors: {},
});

export type ProjectActionResult =
  | Readonly<{ success: true; projectId: string }>
  | Readonly<{ success: false; state: ProjectActionState }>;

function failure(message: string, fieldErrors: ProjectFormFieldErrors = {}): ProjectActionResult {
  return { success: false, state: { status: "error", message, fieldErrors } };
}

function databaseFailure(error: unknown): ProjectActionResult {
  if (isDatabaseDomainError(error)) {
    if (error.code === "FORBIDDEN") {
      return failure("You do not have permission to create a project.");
    }
    if (error.code === "CONFLICT") {
      return failure(error.message);
    }
    if (error.code === "UNAUTHENTICATED") {
      return failure("Your session expired. Sign in and try again.");
    }
  }

  return failure("The project could not be saved. Try again.");
}

export async function executeOnboardingAction(
  formData: FormData,
  dependencies: Readonly<{
    userId: string;
    sessionId: string;
    traceId: () => string;
    create: (input: OnboardingInput) => Promise<OnboardingResult>;
  }>,
): Promise<ProjectActionResult> {
  const parsed = parseProjectFormData(formData, { onboarding: true });
  if (!parsed.success) {
    return failure("Check the highlighted fields.", parsed.fieldErrors);
  }

  try {
    const result = await dependencies.create({
      ...parsed.data,
      organizationName: parsed.data.organizationName ?? "My organization",
      traceId: dependencies.traceId(),
      userId: dependencies.userId,
      sessionId: dependencies.sessionId,
    });
    return { success: true, projectId: result.projectId };
  } catch (error) {
    return databaseFailure(error);
  }
}

export async function executeProjectAction(
  formData: FormData,
  dependencies: Readonly<{
    scope: OrganizationScope;
    traceId: () => string;
    create: (
      scope: OrganizationScope,
      input: ProjectInput & Readonly<{ traceId: string }>,
    ) => Promise<ProjectRecord>;
  }>,
): Promise<ProjectActionResult> {
  const parsed = parseProjectFormData(formData, { onboarding: false });
  if (!parsed.success) {
    return failure("Check the highlighted fields.", parsed.fieldErrors);
  }

  try {
    const project = await dependencies.create(dependencies.scope, {
      ...parsed.data,
      traceId: dependencies.traceId(),
    });
    return { success: true, projectId: project.id };
  } catch (error) {
    return databaseFailure(error);
  }
}
