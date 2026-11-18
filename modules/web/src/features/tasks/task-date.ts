import type { Task } from "@shared/tasks";
import { addDays, format } from "date-fns";
import { taskDate } from "@core/tasks/quick-task";
import { translate, type Language } from "@/app/language";

/** Changes only the calendar day, preserving an existing local deadline time. */
export function rescheduledTaskDue(
  rawDue: string | undefined,
  day: string,
): string {
  const target = new Date(`${day}T00:00:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(target.getTime()) ||
    format(target, "yyyy-MM-dd") !== day
  ) {
    throw new Error("请选择有效日期。");
  }
  if (rawDue && !/^\d{4}-\d{2}-\d{2}$/.test(rawDue)) {
    const original = new Date(isoDue(rawDue));
    if (!Number.isNaN(original.getTime()))
      target.setHours(
        original.getHours(),
        original.getMinutes(),
        original.getSeconds(),
        0,
      );
  }
  return taskDate(target);
}

export function taskDateTone(
  day: string,
  now = new Date(),
): "overdue" | "today" | "tomorrow" | "upcoming" | "neutral" {
  if (!day) return "neutral";
  const today = format(now, "yyyy-MM-dd");
  if (day < today) return "overdue";
  if (day === today) return "today";
  if (day === format(addDays(now, 1), "yyyy-MM-dd")) return "tomorrow";
  return day <= format(addDays(now, 7), "yyyy-MM-dd") ? "upcoming" : "neutral";
}

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
export function dueLabel(value: string, locale: Language = "zh-CN"): string {
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
      ? translate(locale, "今天")
      : +local === +tomorrow
        ? translate(locale, "明天")
        : +local === +yesterday
          ? translate(locale, "昨天")
          : locale === "zh-CN"
            ? format(date, "M月d日")
            : new Intl.DateTimeFormat(locale, {
                month: "short",
                day: "numeric",
              }).format(date);
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
  if (dayStr === format(now, "yyyy-MM-dd"))
    return `今天 ${format(date, "HH:mm")}`;
  if (dayStr === format(addDays(now, -1), "yyyy-MM-dd"))
    return `昨天 ${format(date, "HH:mm")}`;
  return format(date, "yyyy-MM-dd HH:mm");
}
