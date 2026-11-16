import { isHabitProject } from "../workspace/focus.ts";
import type { SavedProject } from "../workspace/organization.ts";

export type TaskState = "planned" | "doing" | "waiting" | "parked";
export type EffectiveTaskState = TaskState | "completed";

export const TASK_STATES: readonly TaskState[] = [
  "planned",
  "doing",
  "waiting",
  "parked",
] as const;

export const STATE_LABELS: Record<EffectiveTaskState, string> = {
  planned: "计划中",
  doing: "处理中",
  waiting: "等待中",
  parked: "长期搁置",
  completed: "已完成",
};

export const DOING_LIMIT = 5;
export const PARK_DAYS = 30;

export const STATE_TRANSITIONS: Record<
  EffectiveTaskState,
  readonly EffectiveTaskState[]
> = {
  planned: ["doing", "parked", "completed"],
  doing: ["planned", "waiting", "parked", "completed"],
  waiting: ["doing"],
  parked: ["planned"],
  completed: ["planned"],
};

/** Validates whether a value is one of the persisted Taskwarrior UDA task states. */
export function isValidTaskState(value: unknown): value is TaskState {
  return (
    typeof value === "string" &&
    (value === "planned" ||
      value === "doing" ||
      value === "waiting" ||
      value === "parked")
  );
}

/** Returns whether a state transition between `from` and `to` is allowed by the state machine. */
export function canTransition(
  from: EffectiveTaskState,
  to: EffectiveTaskState,
): boolean {
  if (from === to) return false;
  return STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Lists target active states selectable from a given current state via `state.set`. */
export function allowedStateTargets(from: EffectiveTaskState): TaskState[] {
  return (STATE_TRANSITIONS[from] ?? []).filter((target): target is TaskState =>
    isValidTaskState(target),
  );
}

/** Returns true when a task belongs to a habit project or is bound in habits storage. */
export function isHabitTask(
  task: { uuid: string; project?: string },
  org?: { projects?: SavedProject[] },
  habitUuids?: ReadonlySet<string>,
): boolean {
  if (habitUuids?.has(task.uuid)) return true;
  return Boolean(task.project && isHabitProject(task.project, org?.projects));
}

/** Returns true when a task participates in the state machine (non-habit). */
export function isStateManaged(
  task: { uuid: string; project?: string },
  org?: { projects?: SavedProject[] },
  habitUuids?: ReadonlySet<string>,
): boolean {
  return !isHabitTask(task, org, habitUuids);
}

export type StateLookupTask = {
  uuid: string;
  status: string;
  project?: string;
  state?: TaskState;
};

/** Derives effective state: habits -> null, completed -> "completed", subtasks -> parent chain. */
export function effectiveState(
  task: StateLookupTask,
  org?: { projects?: SavedProject[]; subtasks?: Record<string, string> },
  habitUuids?: ReadonlySet<string>,
  taskByUuid?: ReadonlyMap<string, StateLookupTask>,
): EffectiveTaskState | null {
  if (isHabitTask(task, org, habitUuids)) return null;
  if (task.status === "completed") return "completed";

  const subtasks = org?.subtasks;
  if (subtasks && subtasks[task.uuid] && taskByUuid) {
    let cursor = subtasks[task.uuid];
    const visited = new Set<string>([task.uuid]);
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const ancestor = taskByUuid.get(cursor);
      const next = subtasks[cursor];
      if (!next) {
        if (!ancestor) break;
        if (isHabitTask(ancestor, org, habitUuids)) return null;
        if (ancestor.status === "completed") return "completed";
        return ancestor.state ?? task.state ?? null;
      }
      cursor = next;
    }
  }

  return task.state ?? null;
}

/** Domain error emitted by task state machine validations with HTTP status and machine code. */
export class TaskStateError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "TaskStateError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
