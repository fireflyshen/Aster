const VIRTUAL_TAGS = new Set([
  "ACTIVE",
  "ANNOTATED",
  "BLOCKED",
  "BLOCKING",
  "CHILD",
  "COMPLETED",
  "DELETED",
  "DUE",
  "DUETODAY",
  "INSTANCE",
  "LATEST",
  "MONTH",
  "ORPHAN",
  "OVERDUE",
  "PARENT",
  "PENDING",
  "PRIORITY",
  "PROJECT",
  "QUARTER",
  "READY",
  "RECURRING",
  "SCHEDULED",
  "TAGGED",
  "TEMPLATE",
  "TODAY",
  "TOMORROW",
  "UDA",
  "UNBLOCKED",
  "UNTIL",
  "WAITING",
  "WEEK",
  "YEAR",
  "YESTERDAY",
]);

export function isVirtualTag(value: string): boolean {
  return VIRTUAL_TAGS.has(value.replace(/^\+/, "").trim().toUpperCase());
}

export function uniqueTags(values: string[]): string[] {
  const tags = new Map<string, string>();
  for (const value of values) {
    const tag = value.replace(/^\+/, "").trim();
    if (tag && !tags.has(tag.toLocaleLowerCase())) tags.set(tag.toLocaleLowerCase(), tag);
  }
  return [...tags.values()];
}

export function parseProjects(output: string): string[] {
  return [
    ...new Set(
      output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
