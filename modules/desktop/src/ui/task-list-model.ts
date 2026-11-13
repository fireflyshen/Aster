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

/** Builds the Raycast list item accessories (labels, timer duration, priority, date). */
export function taskAccessories(
  task: TaskwarriorTask,
  organization: Organization | undefined,
): List.Item.Accessory[] {
  const trackedSeconds =
    organization?.energy?.taskSeconds?.[task.uuid.toLowerCase()];
  const accessories: List.Item.Accessory[] = task.tags
    .slice(0, 2)
    .map((tag) => ({
      tag: {
        value: tag,
        color: itemColor(
          organization?.tags.find((item) => item.name === tag)?.color || "gray",
        ),
      },
    }));

  if (trackedSeconds && trackedSeconds > 0) {
    accessories.push({
      text: formatDuration(trackedSeconds),
      icon: Icon.Stopwatch,
    });
  }
  if (task.priority && task.status !== "completed") {
    accessories.push({
      tag: {
        value: task.priority,
        color: task.priority === "H" ? Color.Red : Color.SecondaryText,
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
    accessories.push({
      text: displayDate(date),
      icon: taskGroup(task) === "waiting" ? Icon.Clock : Icon.Calendar,
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
  if (task.status === "completed") return Icon.CheckCircle;
  if (task.start) return Icon.Play;
  if (group === "overdue") {
    return { source: Icon.Circle, tintColor: Color.Red };
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
