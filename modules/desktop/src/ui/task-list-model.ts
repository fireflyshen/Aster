import { Color, Icon, type List } from "@raycast/api";
import {
  taskGroup,
  type TaskView,
  type TaskwarriorTask,
} from "../../../core/tasks/model.ts";
import { formatDuration } from "../../../core/workspace/energy.ts";
import {
  itemColor,
  type Organization,
} from "../../../core/workspace/organization.ts";
import {
  buildSubtaskMeta,
  selectSectionTasks,
  type SubtaskMeta,
  type TaskSectionEntry,
} from "../../../core/workspace/subtasks.ts";

export {
  buildSubtaskMeta,
  selectSectionTasks,
  type SubtaskMeta,
  type TaskSectionEntry,
};

export const VIEWS: Array<{
  id: TaskView | "focus" | "later" | "inbox" | "active";
  title: string;
}> = [
  { id: "focus", title: "Focus · Next Steps" },
  { id: "later", title: "Later" },
  { id: "pending", title: "All Pending" },
  { id: "today", title: "Today & Overdue" },
  { id: "inbox", title: "Inbox" },
  { id: "active", title: "In Progress" },
  { id: "waiting", title: "Waiting" },
  { id: "completed", title: "Completed" },
];

export const GROUPS = ["overdue", "today", "pending", "waiting"] as const;

export const GROUP_TITLES = {
  overdue: "Overdue",
  today: "Today",
  pending: "Tasks",
  waiting: "Waiting",
  completed: "Completed",
};

/** Formats a task date for display inside a Raycast list accessory. */
export function displayDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Returns whether a filter ID renders a single ungrouped list instead of due sections. */
export function isCustomFilterView(filter: string): boolean {
  return (
    filter === "focus" ||
    filter === "expression" ||
    filter.startsWith("filter:") ||
    filter.startsWith("column:")
  );
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dueColor(task: TaskwarriorTask, date: Date): Color | undefined {
  if (task.status === "completed") return undefined;
  if (taskGroup(task) === "waiting") return undefined;
  const now = new Date();
  if (date < now) return Color.Red;
  if (isSameCalendarDay(date, now)) return Color.Green;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameCalendarDay(date, tomorrow)) return Color.Orange;
  return undefined;
}

export function priorityTagColor(priority: string): Color {
  if (priority === "H") return Color.Red;
  if (priority === "M") return Color.Orange;
  if (priority === "L") return Color.Blue;
  return Color.SecondaryText;
}

export function priorityBadgeLabel(priority: string): string {
  if (priority === "H") return "P1";
  if (priority === "M") return "P2";
  if (priority === "L") return "P3";
  return priority;
}

export function priorityTextLabel(priority: string): string {
  if (priority === "H") return "P1 · High";
  if (priority === "M") return "P2 · Medium";
  if (priority === "L") return "P3 · Low";
  return priority;
}

/** Builds the Raycast list item accessories (subtasks, description, labels, timer duration, priority, date). */
export function taskAccessories(
  task: TaskwarriorTask,
  organization: Organization | undefined,
  subtaskMeta?: SubtaskMeta,
): List.Item.Accessory[] {
  const baseTrackedSeconds =
    organization?.energy?.taskSeconds?.[task.uuid.toLowerCase()] || 0;
  const liveSeconds =
    task.start && task.status !== "completed"
      ? Math.max(0, Math.floor((Date.now() - task.start.getTime()) / 1000))
      : 0;
  const totalSeconds = Math.max(baseTrackedSeconds, liveSeconds);

  const accessories: List.Item.Accessory[] = [];
  const subStats = subtaskMeta?.stats[task.uuid];
  if (subStats && subStats.total > 0) {
    const allDone = subStats.done === subStats.total;
    accessories.push({
      text: `${subStats.done}/${subStats.total}`,
      icon: allDone
        ? { source: Icon.CheckCircle, tintColor: Color.Green }
        : Icon.List,
      tooltip: `${subStats.done} of ${subStats.total} subtasks completed · Press Enter to open`,
    });
  }
  if (organization?.descriptions?.[task.uuid]?.trim()) {
    accessories.push({
      icon: Icon.Document,
      tooltip: "Has task description",
    });
  }

  for (const tag of task.tags.slice(0, 2)) {
    accessories.push({
      tag: {
        value: tag,
        color: itemColor(
          organization?.tags.find((item) => item.name === tag)?.color || "gray",
        ),
      },
    });
  }

  if (totalSeconds > 0 && (liveSeconds > 0 || baseTrackedSeconds >= 60)) {
    accessories.push({
      text:
        liveSeconds > 0
          ? {
              value: formatDuration(totalSeconds),
              color: Color.Green,
            }
          : formatDuration(totalSeconds),
      icon:
        liveSeconds > 0
          ? { source: Icon.Stopwatch, tintColor: Color.Green }
          : Icon.Stopwatch,
      tooltip: liveSeconds > 0 ? "Timer running" : "Tracked time today",
    });
  }
  if (task.priority && task.status !== "completed") {
    accessories.push({
      tag: {
        value: priorityBadgeLabel(task.priority),
        color: priorityTagColor(task.priority),
      },
    });
  }
  const date =
    task.status === "completed"
      ? task.end
      : taskGroup(task) === "waiting"
        ? task.wait
        : task.due;
  if (date) {
    const tint = dueColor(task, date);
    const iconSource =
      taskGroup(task) === "waiting" ? Icon.Clock : Icon.Calendar;
    accessories.push({
      text: tint
        ? { value: displayDate(date), color: tint }
        : displayDate(date),
      icon: tint ? { source: iconSource, tintColor: tint } : iconSource,
    });
  }
  return accessories;
}

/** Resolves the leading status icon for a task row in the current section. */
export function taskItemIcon(
  task: TaskwarriorTask,
  group: string,
  pendingTask: string | undefined,
): List.Item.Props["icon"] {
  if (task.uuid === pendingTask) return Icon.Hourglass;
  if (task.status === "completed") {
    return { source: Icon.CheckCircle, tintColor: Color.Green };
  }
  if (task.start) return { source: Icon.Play, tintColor: Color.Green };
  if (group === "overdue") {
    return { source: Icon.Circle, tintColor: Color.Red };
  }
  if (task.priority === "H") {
    return { source: Icon.Circle, tintColor: Color.Red };
  }
  if (task.priority === "M") {
    return { source: Icon.Circle, tintColor: Color.Orange };
  }
  if (task.priority === "L") {
    return { source: Icon.Circle, tintColor: Color.Blue };
  }
  return Icon.Circle;
}

/** Computes the navigation title displaying timer/energy status and connection label. */
export function listNavigationTitle(
  connectionLabel: string,
  organization: Organization | undefined,
): string {
  if (organization?.timing?.available === false) {
    return `My Tasks · Timer unavailable · ${connectionLabel}`;
  }
  if (organization?.energy) {
    return `My Tasks · ⚡ ${organization.energy.remaining}/${organization.energy.max} · ${connectionLabel}`;
  }
  return `My Tasks · ${connectionLabel}`;
}

/** Computes empty-state title and optional description for the current view state. */
export function emptyViewCopy(
  filter: string,
  isLoading: boolean,
  error: Error | undefined,
  organization: Organization | undefined,
): { title: string; description: string | undefined } {
  const title = error
    ? "Could Not Load Tasks"
    : isLoading
      ? "Loading Tasks…"
      : filter === "focus" && organization
        ? "Choose Your Next Step"
        : filter === "completed"
          ? "No Completed Tasks"
          : "No Tasks in This View";
  const description =
    error?.message ||
    (filter === "focus" && organization
      ? "Use Manage Focus Projects to choose up to three projects and their next tasks."
      : undefined);
  return { title, description };
}
