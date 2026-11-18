import { hasTimeAssignment } from "../../../core/time/assignment.ts";
import { normalizeActivityTags } from "../../../core/time/cost.ts";
import { TimeStoreError } from "./time-store-types.ts";

/** Project names belong to the time record; this never edits its linked task. */
export function normalizeActivityProject(project: unknown): string | undefined {
  return typeof project === "string" ? project.trim() || undefined : undefined;
}

export function timeAssignment(
  project: string | null | undefined,
  tags?: readonly string[] | null,
): { projectSnapshot?: string; tags: string[] } {
  const projectSnapshot = normalizeActivityProject(project);
  const normalizedTags = normalizeActivityTags(tags ?? []);
  if (!hasTimeAssignment(projectSnapshot, normalizedTags)) {
    throw new TimeStoreError(
      400,
      "TIME_ASSIGNMENT_REQUIRED",
      "请选择一个项目，或至少一个标签。",
    );
  }
  return { projectSnapshot, tags: normalizedTags };
}
