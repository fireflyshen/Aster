import type { Task } from "@shared/tasks";
import { addDays, format } from "date-fns";

/** Normalizes compact Taskwarrior timestamps (YYYYMMDDTHHMM[SS]Z) to ISO-8601. */
export function isoDue(value: string): string {
  return value
    .replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:00Z")
    .replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      "$1-$2-$3T$4:$5:$6Z",
    );
}

/** Converts a raw due timestamp or YYYY-MM-DD string to YYYY-MM-DD in local time. */
export function toDueDay(raw?: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(isoDue(raw));
  return Number.isNaN(parsed.getTime()) ? "" : format(parsed, "yyyy-MM-dd");
}

/** Formats a due date concisely in Todoist style ("今天", "明天", "昨天", "M月d日"). */
export function dueLabel(value: string): string {
  const date = new Date(isoDue(value));
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  const day =
    +local === +today
      ? "今天"
      : +local === +tomorrow
        ? "明天"
        : +local === +yesterday
          ? "昨天"
          : format(date, "M月d日");
  return (
    day +
    (date.getHours() || date.getMinutes()
      ? ` ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
      : "")
  );
}

export function isTaskOverdue(task: Pick<Task, "status" | "due">): boolean {
  if (task.status === "completed" || !task.due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(isoDue(task.due)) < today;
}

/** Formats comment timestamps relative to today/yesterday. */
export function formatCommentTime(raw?: string): string {
  if (!raw) return "刚刚";
  const date = new Date(isoDue(raw));
  if (Number.isNaN(date.getTime())) return raw;
  const now = new Date();
  const dayStr = format(date, "yyyy-MM-dd");
  if (dayStr === format(now, "yyyy-MM-dd")) return `今天 ${format(date, "HH:mm")}`;
  if (dayStr === format(addDays(now, -1), "yyyy-MM-dd"))
    return `昨天 ${format(date, "HH:mm")}`;
  return format(date, "yyyy-MM-dd HH:mm");
}
