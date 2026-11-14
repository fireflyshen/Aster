import { Color, Icon, type List } from "@raycast/api";
import { formatDescriptionPreview } from "../../../core/tasks/description.ts";
import {
    taskGroup,
    type TaskView,
    type TaskwarriorTask,
} from "../../../core/tasks/model.ts";
import {
    type BoardState,
    columnTasks,
    inheritSubtaskColumns,
    unsectionedColumn,
} from "../../../core/workspace/board.ts";
import { formatDuration } from "../../../core/workspace/energy.ts";
import { focusProject, projectStatus } from "../../../core/workspace/focus.ts";
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
import { toneColor } from "./palette";

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
    { id: "pending", title: "All Tasks" },
    { id: "today", title: "Today & Overdue" },
    { id: "focus", title: "Focus" },
    { id: "urgency", title: "Urgency · Top Score" },
    { id: "inbox", title: "Inbox" },
    { id: "active", title: "In Progress" },
    { id: "waiting", title: "Waiting" },
    { id: "later", title: "Later" },
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
        filter === "urgency" ||
        filter === "expression" ||
        filter.startsWith("filter:") ||
        filter.startsWith("column:")
    );
}

export interface ProjectColumnSection {
    id: string;
    title: string;
    entries: TaskSectionEntry[];
}

/** Groups a project's tasks into its custom board columns when configured, returning null to fall back to due groups. */
export function buildProjectColumnSections(
    tasks: TaskwarriorTask[],
    allTasks: TaskwarriorTask[],
    board: BoardState,
    projectName: string,
    subtaskMeta: SubtaskMeta,
    organization?: Organization,
): ProjectColumnSection[] | null {
    const projectColumns = board.columns.filter(
        (column) => (column.project || "") === projectName,
    );
    if (projectColumns.length === 0) return null;
    const effectiveBoard = organization
        ? inheritSubtaskColumns(board, allTasks, organization.subtasks || {})
        : board;
    const columns = [unsectionedColumn, ...projectColumns];
    const visibleIds = new Set(columns.map((column) => column.id));
    return columns
        .map((column) => ({
            id: column.id,
            title: column.name,
            entries: selectSectionTasks(
                columnTasks(tasks, effectiveBoard, column.id, visibleIds),
                subtaskMeta,
            ),
        }))
        .filter((section) => section.entries.length > 0);
}

/** Separates pinned Focus next-step tasks from the rest of the active Focus tasks. */
export function partitionFocusTasks(
    tasks: TaskwarriorTask[],
    organization?: Organization,
): { nextSteps: TaskwarriorTask[]; rest: TaskwarriorTask[] } {
    const projects = organization?.projects || [];
    const nextSteps: TaskwarriorTask[] = [];
    const rest: TaskwarriorTask[] = [];
    for (const task of tasks) {
        if (focusProject(task.project, projects)?.nextTask === task.uuid) {
            nextSteps.push(task);
        } else {
            rest.push(task);
        }
    }
    return { nextSteps, rest };
}

function isSameCalendarDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function dueColor(
    task: TaskwarriorTask,
    date: Date,
): Color.ColorLike | undefined {
    if (task.status === "completed") return undefined;
    if (taskGroup(task) === "waiting") return undefined;
    const now = new Date();
    if (date < now) return toneColor("overdue");
    if (isSameCalendarDay(date, now)) return toneColor("today");
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    if (isSameCalendarDay(date, tomorrow)) return toneColor("tomorrow");
    return undefined;
}

export function priorityTagColor(priority: string): Color.ColorLike {
    if (priority === "H") return toneColor("p1");
    if (priority === "M") return toneColor("p2");
    if (priority === "L") return toneColor("p3");
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
            ? Math.max(
                  0,
                  Math.floor((Date.now() - task.start.getTime()) / 1000),
              )
            : 0;
    const totalSeconds = Math.max(baseTrackedSeconds, liveSeconds);

    const accessories: List.Item.Accessory[] = [];
    const subStats = subtaskMeta?.stats[task.uuid];
    if (subStats && subStats.total > 0) {
        const allDone = subStats.done === subStats.total;
        accessories.push({
            text: `${subStats.done}/${subStats.total}`,
            icon: allDone
                ? {
                      source: Icon.CheckCircle,
                      tintColor: toneColor("completed"),
                  }
                : Icon.List,
            tooltip: `${subStats.done} of ${subStats.total} subtasks completed · Press Enter to open`,
        });
    }
    const desc = organization?.descriptions?.[task.uuid]?.trim();
    if (desc) {
        accessories.push({
            icon: Icon.Document,
            tooltip: formatDescriptionPreview(desc),
        });
    }

    for (const tag of task.tags.slice(0, 2)) {
        accessories.push({
            tag: {
                value: tag,
                color: itemColor(
                    organization?.tags.find((item) => item.name === tag)
                        ?.color || "gray",
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
                          color: Color.PrimaryText,
                      }
                    : formatDuration(totalSeconds),
            icon:
                liveSeconds > 0
                    ? { source: Icon.Stopwatch, tintColor: toneColor("timer") }
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
    if (
        task.status !== "completed" &&
        Number.isFinite(task.urgency) &&
        task.urgency > 0
    ) {
        accessories.push({
            text: `${task.urgency.toFixed(1)}分`,
            tooltip: `Taskwarrior Urgency: ${task.urgency.toFixed(2)}`,
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
            text:
                tint === toneColor("overdue")
                    ? { value: displayDate(date), color: Color.PrimaryText }
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
        return { source: Icon.CheckCircle, tintColor: toneColor("completed") };
    }
    if (task.start) return { source: Icon.Play, tintColor: toneColor("timer") };
    if (group === "waiting") {
        return { source: Icon.Clock, tintColor: toneColor("waiting") };
    }
    if (group === "overdue") {
        return { source: Icon.Circle, tintColor: toneColor("overdue") };
    }
    if (task.priority === "H") {
        return { source: Icon.Circle, tintColor: toneColor("p1") };
    }
    if (task.priority === "M") {
        return { source: Icon.Circle, tintColor: toneColor("p2") };
    }
    if (task.priority === "L") {
        return { source: Icon.Circle, tintColor: toneColor("p3") };
    }
    return Icon.Circle;
}

/** Computes the navigation title displaying optional section, timer/energy status, and connection label. */
export function listNavigationTitle(
    connectionLabel: string,
    organization: Organization | undefined,
    sectionTitle?: string,
): string {
    const prefix = sectionTitle || "My Tasks";
    if (organization?.timing?.available === false) {
        return `${prefix} · Timer unavailable · ${connectionLabel}`;
    }
    if (organization?.energy) {
        return `${prefix} · ⚡ ${organization.energy.remaining}/${organization.energy.max} · ${connectionLabel}`;
    }
    return `${prefix} · ${connectionLabel}`;
}

/** Computes empty-state title and optional description for the current view state. */
export function emptyViewCopy(
    filter: string,
    isLoading: boolean,
    error: Error | undefined,
    organization: Organization | undefined,
): { title: string; description: string | undefined } {
    const hasActiveFocus = (organization?.projects || []).some(
        (project) => projectStatus(project) === "active",
    );
    const title = error
        ? "Could Not Load Tasks"
        : isLoading
          ? "Loading Tasks…"
          : filter === "focus" && organization
            ? hasActiveFocus
                ? "No Open Tasks in Focus"
                : "Choose Focus Projects"
            : filter.startsWith("project:")
              ? "No Open Tasks in Project"
              : filter === "completed"
                ? "No Completed Tasks"
                : "No Tasks in This View";
    const description =
        error?.message ||
        (filter === "focus" && organization
            ? hasActiveFocus
                ? "Add a task to your Focus projects (⌘N) or Switch View (⌘P)."
                : "Press Enter on Manage Focus & Projects or pick up to three active projects."
            : filter.startsWith("project:")
              ? "Press ⌘N to add a task in this project, or Switch View (⌘P) for All Tasks."
              : undefined);
    return { title, description };
}
