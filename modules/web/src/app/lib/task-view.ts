import { taskDate } from "@core/tasks/quick-task";
import { inProject } from "@core/workspace/focus";
import type {
  Organization,
  SavedFilter,
  SavedTag,
} from "@core/workspace/organization";
import type { Task, TaskInput, View } from "@shared/tasks";
import { isoDue, toDueDay } from "@/features/tasks/task-date";

export type TaskGroup = "overdue" | "today" | "pending" | "waiting" | "completed";

export const BLANK_TASK_INPUT: TaskInput = {
  description: "",
  project: "",
  due: "",
  tags: [],
  priority: "",
};

/** Classifies a Taskwarrior task into its schedule bucket. */
export function taskGroup(task: Task): TaskGroup {
  if (task.status === "completed") return "completed";
  if (
    (task.wait && new Date(task.wait) > new Date()) ||
    task.status === "waiting"
  ) {
    return "waiting";
  }
  if (task.due) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(isoDue(task.due)) < today) return "overdue";
    today.setDate(today.getDate() + 1);
    if (new Date(isoDue(task.due)) < today) return "today";
  }
  return "pending";
}

/** Formats a local YYYY-MM-DD day key from an ISO or compact UTC timestamp. */
export function localDayKey(value: string): string {
  const date = new Date(isoDue(value));
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Builds a clean Taskwarrior edit payload from an existing task with optional overrides. */
export function taskEditPayload(
  task: Task,
  overrides: Partial<TaskInput> = {},
): TaskInput {
  return {
    description: task.description,
    project: task.project || "",
    priority: task.priority || "",
    tags: task.tags,
    recur: task.recur,
    until: task.until ? taskDate(new Date(task.until)) : undefined,
    due: task.due ? taskDate(new Date(isoDue(task.due))) : "",
    note: "",
    ...overrides,
  };
}

/** Applies view-level project, due date, and active tag defaults to a new task draft. */
export function withViewDefaults<T extends TaskInput>(
  input: T,
  context: {
    currentProject: string;
    view: View;
    activeTagName?: string;
  },
): T {
  const defaultTag = context.activeTagName || "";
  const mergedTags =
    defaultTag && !input.tags.includes(defaultTag)
      ? [...input.tags, defaultTag]
      : input.tags;
  return {
    ...input,
    project: input.project || context.currentProject,
    due: input.due || (context.view === "today" ? taskDate(new Date()) : ""),
    tags: mergedTags,
  };
}

/** Computes sidebar task badges for inbox, today, and waiting views. */
export function computeViewCounts(tasks: Task[]): Partial<Record<View, number>> {
  return {
    pending: tasks.filter(
      (task) =>
        task.status !== "completed" &&
        !task.project &&
        taskGroup(task) !== "waiting",
    ).length,
    today: tasks.filter(
      (task) =>
        task.status !== "completed" &&
        ["overdue", "today"].includes(taskGroup(task)),
    ).length,
    waiting: tasks.filter((task) => taskGroup(task) === "waiting").length,
  };
}

/** Builds the parent-to-sorted-children map and top-level filtering lookup. */
export function computeSubtaskHierarchy(
  tasks: Task[],
  organization: Organization,
): {
  subtasksMap: Map<string, Task[]>;
  taskLinks: Record<string, string>;
} {
  const map = new Map<string, Task[]>();
  const taskByUuid = new Map(tasks.map((t) => [t.uuid, t]));
  const taskLinks = organization.subtasks || {};

  for (const [childUuid, parentUuid] of Object.entries(taskLinks)) {
    const child = taskByUuid.get(childUuid);
    const parent = taskByUuid.get(parentUuid);
    if (child && parent) {
      let children = map.get(parentUuid);
      if (!children) {
        children = [];
        map.set(parentUuid, children);
      }
      children.push(child);
    }
  }

  const orderIndex = new Map(
    (organization.board?.order || []).map((id, index) => [id, index]),
  );
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.status === "completed" && b.status !== "completed") return 1;
      if (a.status !== "completed" && b.status === "completed") return -1;
      const aOrder = orderIndex.get(a.uuid);
      const bOrder = orderIndex.get(b.uuid);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return (b.urgency ?? 0) - (a.urgency ?? 0);
    });
  }

  return { subtasksMap: map, taskLinks };
}

/** Filters loaded tasks according to view, active filter/label, project, search query, and leaving state. */
export function filterVisibleTasks({
  tasks,
  view,
  activeItem,
  inbox,
  currentProject,
  query,
  completingUuid,
}: {
  tasks: Task[];
  view: View;
  activeItem?: SavedFilter | SavedTag;
  inbox: boolean;
  currentProject: string;
  query: string;
  completingUuid?: string;
}): Task[] {
  const needle = query.trim().toLocaleLowerCase();
  return tasks.filter((task) => {
    const isCompleting = completingUuid === task.uuid;
    if (
      view !== "completed" &&
      !activeItem &&
      task.status === "completed" &&
      !isCompleting
    ) {
      return false;
    }
    if (view === "completed" && task.status !== "completed" && !isCompleting) {
      return false;
    }
    const group =
      task.status === "completed" && view === "today"
        ? taskGroup({ ...task, status: "pending", wait: undefined })
        : taskGroup(task);
    return (
      (view !== "today" || ["overdue", "today"].includes(group)) &&
      (view !== "waiting" || group === "waiting") &&
      (!inbox || !task.project) &&
      (!currentProject || inProject(task.project, currentProject)) &&
      (!needle ||
        [task.description, task.project, ...task.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle))
    );
  });
}

/** Builds an editable TaskInput draft from a Task or partial initial input. */
export function taskToDraft(task?: Task, initial?: TaskInput): TaskInput {
  if (!task) return initial || { ...BLANK_TASK_INPUT };
  return {
    description: task.description,
    project: task.project || "",
    priority: task.priority || "",
    tags: task.tags,
    recur: task.recur,
    until: task.until ? taskDate(new Date(task.until)) : undefined,
    note: "",
  };
}

/** Normalizes a Taskwarrior compact UTC timestamp or ISO timestamp to ISO string. */
export function isoDueFromInput(value?: string): string {
  return value ? isoDue(value) : "";
}

/** Extracts YYYY-MM-DD due date value from a Task or initial draft. */
export function formatInitialDue(task?: Task, initial?: TaskInput): string {
  const date = task?.due || initial?.due;
  return date ? toDueDay(date) : "";
}

/** Localized workspace sync connection indicator label. */
export function connectionStatusLabel({
  loading,
  needsCheck,
  connectionError,
  loaded,
}: {
  loading: boolean;
  needsCheck: boolean;
  connectionError: boolean;
  loaded: boolean;
}): string {
  if (loading) return "正在同步…";
  if (needsCheck) return "需要检查状态";
  if (connectionError) return "连接异常";
  if (loaded) return "本地已连接";
  return "未连接";
}
