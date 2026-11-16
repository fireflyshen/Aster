import type { BoardColumn } from "@core/workspace/board";
import type { Task, TaskInput } from "@shared/tasks";
import { addDays, format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { toDueDay } from "./task-date";

export type TaskGroupBy =
  | "none"
  | "today"
  | "completed"
  | "due"
  | "project"
  | "priority"
  | "label";

export type TaskGroupContext = "today" | "completed" | "default";

const COMMON_GROUP_OPTIONS: readonly { value: TaskGroupBy; label: string }[] = [
  { value: "project", label: "项目" },
  { value: "priority", label: "优先级" },
  { value: "label", label: "标签" },
];

export const TASK_GROUP_OPTIONS: readonly {
  value: TaskGroupBy;
  label: string;
}[] = [
  { value: "none", label: "无" },
  { value: "due", label: "截止日期" },
  ...COMMON_GROUP_OPTIONS,
];

/** Returns grouping dropdown options tailored to the active view context. */
export function groupOptionsForContext(
  context: TaskGroupContext = "default",
): readonly { value: TaskGroupBy; label: string }[] {
  if (context === "today") {
    return [
      { value: "today", label: "默认 (逾期/今天)" },
      { value: "none", label: "无" },
      ...COMMON_GROUP_OPTIONS,
    ];
  }
  if (context === "completed") {
    return [
      { value: "completed", label: "完成日期" },
      { value: "none", label: "无" },
      ...COMMON_GROUP_OPTIONS,
    ];
  }
  return TASK_GROUP_OPTIONS;
}

export type TaskGroup = {
  column: BoardColumn;
  items: Task[];
};

/** New tasks inherit the group they are added to; explicit composer input can override it. */
export function taskDefaultsForGroup(
  column: BoardColumn,
  defaults: { project?: string; due?: string } = {},
): TaskInput {
  const result: TaskInput = {
    description: "",
    tags: [],
    project: defaults.project || "",
    due: toDueDay(defaults.due),
  };
  if (column.id.startsWith("group:project:"))
    result.project =
      column.id === "group:project:inbox" && column.name === "收件箱"
        ? ""
        : column.name;
  if (column.id.startsWith("group:due:"))
    result.due =
      column.id === "group:due:none"
        ? ""
        : column.id.slice("group:due:".length);
  if (column.id.startsWith("group:label:") && column.name !== "无标签")
    result.tags = [column.id.slice("group:label:".length)];
  if (column.id.startsWith("group:priority:")) {
    const value = column.id.slice("group:priority:".length);
    if (["H", "M", "L"].includes(value)) result.priority = value;
    else if (value === "none") result.priority = "";
  }
  return result;
}

function formatDueGroupLabel(dueDay: string, now: Date): string {
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
  const yesterdayStr = format(addDays(now, -1), "yyyy-MM-dd");
  const date = parseISO(dueDay);
  const currentYear = now.getFullYear();
  const base =
    date.getFullYear() === currentYear
      ? format(date, "M月d日", { locale: zhCN })
      : format(date, "yyyy年M月d日", { locale: zhCN });
  const weekday = format(date, "EEE", { locale: zhCN });
  if (dueDay === todayStr) return `${base} · 今天 · ${weekday}`;
  if (dueDay === tomorrowStr) return `${base} · 明天 · ${weekday}`;
  if (dueDay === yesterdayStr) return `${base} · 昨天 · ${weekday}`;
  return `${base} · ${weekday}`;
}

function buildDayGroups(
  tasks: Task[],
  now: Date,
  options: {
    getRawDate: (task: Task) => string | undefined;
    idPrefix: string;
    fallbackId: string;
    fallbackName: string;
    descending?: boolean;
  },
): TaskGroup[] {
  const buckets = new Map<string, Task[]>();
  const missing: Task[] = [];
  for (const task of tasks) {
    const day = toDueDay(options.getRawDate(task));
    if (!day) {
      missing.push(task);
      continue;
    }
    const list = buckets.get(day) || [];
    list.push(task);
    buckets.set(day, list);
  }
  const keys = [...buckets.keys()].sort((a, b) =>
    options.descending ? b.localeCompare(a) : a.localeCompare(b),
  );
  const groups: TaskGroup[] = keys.map((day) => ({
    column: {
      id: `${options.idPrefix}:${day}`,
      name: formatDueGroupLabel(day, now),
    },
    items: buckets.get(day) || [],
  }));
  if (missing.length) {
    groups.push({
      column: { id: options.fallbackId, name: options.fallbackName },
      items: missing,
    });
  }
  return groups;
}

/** Groups filtered tasks into read-only virtual columns for list and board views. */
export function buildTaskGroups(
  tasks: Task[],
  groupBy: TaskGroupBy,
  defaultGroupTitle: string,
  now = new Date(),
): TaskGroup[] {
  if (groupBy === "today") {
    const todayStr = format(now, "yyyy-MM-dd");
    const overdue: Task[] = [];
    const todayItems: Task[] = [];
    for (const task of tasks) {
      const dueDay = toDueDay(task.due);
      if (dueDay && dueDay < todayStr && task.status !== "completed") {
        overdue.push(task);
      } else {
        todayItems.push(task);
      }
    }
    const groups: TaskGroup[] = [];
    if (overdue.length > 0) {
      groups.push({
        column: { id: "group:today:overdue", name: "逾期" },
        items: overdue,
      });
    }
    groups.push({
      column: {
        id: "group:today:today",
        name: formatDueGroupLabel(todayStr, now),
      },
      items: todayItems,
    });
    return groups;
  }

  if (groupBy === "none" || tasks.length === 0) {
    return [
      {
        column: { id: "group:none", name: defaultGroupTitle },
        items: tasks,
      },
    ];
  }

  if (groupBy === "due") {
    return buildDayGroups(tasks, now, {
      getRawDate: (task) => task.due,
      idPrefix: "group:due",
      fallbackId: "group:due:none",
      fallbackName: "无截止日期",
    });
  }

  if (groupBy === "completed") {
    return buildDayGroups(tasks, now, {
      getRawDate: (task) => task.end,
      idPrefix: "group:completed",
      fallbackId: "group:completed:unknown",
      fallbackName: "未知日期",
      descending: true,
    });
  }

  if (groupBy === "project") {
    const buckets = new Map<string, Task[]>();
    for (const task of tasks) {
      const proj = task.project || "";
      const list = buckets.get(proj) || [];
      list.push(task);
      buckets.set(proj, list);
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      if (a === "" && b !== "") return -1;
      if (a !== "" && b === "") return 1;
      return a.localeCompare(b, "zh-CN");
    });
    return keys.map((proj) => ({
      column: {
        id: `group:project:${proj || "inbox"}`,
        name: proj || "收件箱",
      },
      items: buckets.get(proj) || [],
    }));
  }

  if (groupBy === "priority") {
    const buckets = new Map<string, Task[]>();
    for (const task of tasks) {
      const p = task.priority || "";
      const list = buckets.get(p) || [];
      list.push(task);
      buckets.set(p, list);
    }
    const order: readonly [string, string][] = [
      ["H", "优先级 1 (P1)"],
      ["M", "优先级 2 (P2)"],
      ["L", "优先级 3 (P3)"],
      ["", "无优先级"],
    ];
    return order
      .filter(([key]) => buckets.has(key))
      .map(([key, label]) => ({
        column: { id: `group:priority:${key || "none"}`, name: label },
        items: buckets.get(key) || [],
      }));
  }

  const buckets = new Map<string, Task[]>();
  const untagged: Task[] = [];
  for (const task of tasks) {
    if (!task.tags.length) {
      untagged.push(task);
      continue;
    }
    for (const tag of task.tags) {
      const list = buckets.get(tag) || [];
      list.push(task);
      buckets.set(tag, list);
    }
  }
  const groups: TaskGroup[] = [...buckets.keys()]
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((tag) => ({
      column: { id: `group:label:${tag}`, name: `@${tag}` },
      items: buckets.get(tag) || [],
    }));
  if (untagged.length) {
    groups.push({
      column: { id: "group:label:none", name: "无标签" },
      items: untagged,
    });
  }
  return groups;
}
