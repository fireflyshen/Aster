import { isVirtualTag, uniqueTags } from "./options.ts";
import { validateRecurrence, validateUntil } from "./recurrence.ts";
import { isValidTaskState, type TaskState } from "./state.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITE_OVERRIDES = [
  "rc.confirmation=off",
  "rc.recurrence.confirmation=no",
];

export interface TaskInput {
  description: string;
  project?: string;
  due?: string;
  priority?: string;
  tags: string[];
  recur?: string;
  until?: string;
  note?: string;
  state?: TaskState | "";
  waitreason?: string;
  scheduled?: string;
  wait?: string;
  statechanged?: string;
}

function sanitizeSingleLineText(
  value: string,
  field: string,
  maxLength = 200,
): string {
  if (/[\0\r\n]/.test(value)) {
    throw new Error(`${field} cannot contain line breaks.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

export function requireUuid(uuid: string): string {
  if (!UUID_PATTERN.test(uuid))
    throw new Error("Taskwarrior returned an invalid task UUID.");
  return uuid;
}

function fields(input: TaskInput): string[] {
  const description = input.description.trim();
  if (!description) throw new Error("Task description is required.");
  const tags = uniqueTags(input.tags);
  const reserved = tags.find(isVirtualTag);
  if (reserved)
    throw new Error(`“${reserved}” is a reserved Taskwarrior virtual tag.`);
  const args = [
    `description:${description}`,
    `project:${input.project?.trim() || ""}`,
    `due:${input.due || ""}`,
    `priority:${["H", "M", "L"].includes(input.priority || "") ? input.priority : ""}`,
    "tags:",
    ...tags.map((tag) => `+${tag}`),
    ...(input.recur === undefined
      ? []
      : [`recur:${validateRecurrence(input.recur)}`]),
    ...(input.until === undefined
      ? []
      : [`until:${validateUntil(input.until, input.due)}`]),
  ];
  if (input.state !== undefined) {
    if (input.state !== "" && !isValidTaskState(input.state)) {
      throw new Error("Invalid task state.");
    }
    args.push(`state:${input.state}`);
  }
  if (input.waitreason !== undefined) {
    args.push(
      `waitreason:${sanitizeSingleLineText(input.waitreason, "Wait reason")}`,
    );
  }
  if (input.scheduled !== undefined) {
    args.push(
      `scheduled:${sanitizeSingleLineText(input.scheduled, "Scheduled date")}`,
    );
  }
  if (input.wait !== undefined) {
    args.push(`wait:${sanitizeSingleLineText(input.wait, "Wait date")}`);
  }
  if (input.statechanged !== undefined) {
    args.push(
      `statechanged:${sanitizeSingleLineText(input.statechanged, "State changed time")}`,
    );
  }
  return args;
}

export interface StateModifyInput {
  state?: TaskState | "";
  waitreason?: string;
  wait?: string;
  scheduled?: string;
  statechanged?: string;
}

/** Builds Taskwarrior `modify` arguments for updating state machine UDA and timing fields. */
export function stateArguments(
  uuid: string,
  values: StateModifyInput,
): string[] {
  const args: string[] = [requireUuid(uuid), "modify"];
  if (values.state !== undefined) {
    if (values.state !== "" && !isValidTaskState(values.state)) {
      throw new Error("Invalid task state.");
    }
    args.push(`state:${values.state}`);
  }
  if (values.waitreason !== undefined) {
    args.push(
      `waitreason:${sanitizeSingleLineText(values.waitreason, "Wait reason")}`,
    );
  }
  if (values.wait !== undefined) {
    args.push(`wait:${sanitizeSingleLineText(values.wait, "Wait date")}`);
  }
  if (values.scheduled !== undefined) {
    args.push(
      `scheduled:${sanitizeSingleLineText(values.scheduled, "Scheduled date")}`,
    );
  }
  const changed = sanitizeSingleLineText(
    values.statechanged ?? "now",
    "State changed time",
  );
  args.push(`statechanged:${changed}`);
  return [...args, ...WRITE_OVERRIDES];
}

/** Builds Taskwarrior `modify` arguments for setting the normalized dependency UUID list. */
export function dependsArguments(uuid: string, depends: string[]): string[] {
  const unique = [...new Set(depends.map((dep) => requireUuid(dep)))];
  return [
    requireUuid(uuid),
    "modify",
    `depends:${unique.join(",")}`,
    ...WRITE_OVERRIDES,
  ];
}

export function addTaskArguments(input: TaskInput): string[] {
  if (input.recur && !input.due)
    throw new Error("Choose a first due date for this repeating task.");
  return ["add", ...fields(input), ...WRITE_OVERRIDES];
}

export function editTaskArguments(uuid: string, input: TaskInput): string[] {
  return [requireUuid(uuid), "modify", ...fields(input), ...WRITE_OVERRIDES];
}

export function taskActionArguments(
  uuid: string,
  action: "done" | "start" | "stop" | "delete",
): string[] {
  return [requireUuid(uuid), action, ...WRITE_OVERRIDES];
}

export function reopenTaskArguments(uuid: string): string[] {
  return [requireUuid(uuid), "modify", "status:pending", ...WRITE_OVERRIDES];
}

export function waitTaskArguments(uuid: string, wait: string): string[] {
  return [requireUuid(uuid), "modify", `wait:${wait}`, ...WRITE_OVERRIDES];
}
