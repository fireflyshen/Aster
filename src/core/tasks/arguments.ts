import { isVirtualTag, uniqueTags } from "./options.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITE_OVERRIDES = ["rc.confirmation=off", "rc.recurrence.confirmation=no"];

export interface TaskInput {
  description: string;
  project?: string;
  due?: string;
  priority?: string;
  tags: string[];
}

function requireUuid(uuid: string): string {
  if (!UUID_PATTERN.test(uuid)) throw new Error("Taskwarrior returned an invalid task UUID.");
  return uuid;
}

function fields(input: TaskInput): string[] {
  const description = input.description.trim();
  if (!description) throw new Error("Task description is required.");
  const tags = uniqueTags(input.tags);
  const reserved = tags.find(isVirtualTag);
  if (reserved) throw new Error(`“${reserved}” is a reserved Taskwarrior virtual tag.`);
  return [
    `description:${description}`,
    `project:${input.project?.trim() || ""}`,
    `due:${input.due || ""}`,
    `priority:${["H", "M", "L"].includes(input.priority || "") ? input.priority : ""}`,
    "tags:",
    ...tags.map((tag) => `+${tag}`),
  ];
}

export function addTaskArguments(input: TaskInput): string[] {
  return ["add", ...fields(input), ...WRITE_OVERRIDES];
}

export function editTaskArguments(uuid: string, input: TaskInput): string[] {
  return [requireUuid(uuid), "modify", ...fields(input), ...WRITE_OVERRIDES];
}

export function taskActionArguments(uuid: string, action: "done" | "start" | "stop" | "delete"): string[] {
  return [requireUuid(uuid), action, ...WRITE_OVERRIDES];
}

export function reopenTaskArguments(uuid: string): string[] {
  return [requireUuid(uuid), "modify", "status:pending", ...WRITE_OVERRIDES];
}

export function waitTaskArguments(uuid: string, wait: string): string[] {
  return [requireUuid(uuid), "modify", `wait:${wait}`, ...WRITE_OVERRIDES];
}
