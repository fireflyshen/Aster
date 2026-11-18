/** A time entry is organized using the existing project and tag namespaces. */
export function hasTimeAssignment(
  project?: string | null,
  tags?: readonly string[] | null,
): boolean {
  return Boolean(project?.trim() || tags?.some((tag) => tag.trim()));
}
