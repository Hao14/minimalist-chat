"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSearviaRepository } from "@/lib/database";
import {
  executeOnboardingAction,
  executeProjectAction,
  type ProjectActionState,
} from "@/lib/project-action-service";
import { requireAuthenticatedSession, requireOrganizationScope } from "@/lib/session";

export async function createOnboardingAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await requireAuthenticatedSession();
  const repository = getSearviaRepository();
  const result = await executeOnboardingAction(formData, {
    userId: session.user.id,
    sessionId: session.session.id,
    traceId: randomUUID,
    create: (input) => repository.createOnboarding(input),
  });

  if (!result.success) {
    return result.state;
  }

  revalidatePath("/app", "layout");
  redirect(`/app/projects/${result.projectId}`);
}

export async function createProjectAction(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const { scope } = await requireOrganizationScope();
  const repository = getSearviaRepository();
  const result = await executeProjectAction(formData, {
    scope,
    traceId: randomUUID,
    create: (organizationScope, input) => repository.createProject(organizationScope, input),
  });

  if (!result.success) {
    return result.state;
  }

  revalidatePath("/app/projects");
  redirect(`/app/projects/${result.projectId}`);
}
