import type { Activity, TimePolicy } from "@core/time/model";
import { localDateOf } from "@core/time/zone";

/** Formats seconds cleanly in Chinese without over-precision beyond seconds when <1m. */
export function formatDurationChinese(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe} 秒`;
  const totalMinutes = Math.round(safe / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins} 分钟`;
  if (mins === 0) return `${hours} 小时`;
  return `${hours} 小时 ${mins} 分钟`;
}

/** Compact hours string such as `2.5h` or `45m` for dense summary rows and bars. */
export function formatDurationCompact(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe}s`;
  const mins = Math.round(safe / 60);
  if (mins < 60) return `${mins}m`;
  const hours = safe / 3600;
  return `${hours >= 10 ? hours.toFixed(1) : hours.toFixed(2).replace(/\.00$/, "")}h`;
}

/** Renders `HH:mm` in the configured IANA timezone. */
export function formatClockInZone(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms));
  } catch {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

export function formatTimeRangeInZone(
  startMs: number,
  endMs: number,
  timeZone: string,
): string {
  const startClock = formatClockInZone(startMs, timeZone);
  const endClock = formatClockInZone(endMs, timeZone);
  try {
    const startDate = localDateOf(startMs, timeZone);
    const endDate = localDateOf(endMs, timeZone);
    if (startDate !== endDate) {
      return `${startDate.slice(5)} ${startClock} – ${endDate.slice(5)} ${endClock}`;
    }
  } catch {}
  return `${startClock} – ${endClock}`;
}

export function resolveCategoryLabel(
  categoryId: string,
  policy?: TimePolicy,
): string {
  if (!categoryId || categoryId === "uncategorized") return "未分类";
  return (
    policy?.categories.find((c) => c.id === categoryId)?.name || categoryId
  );
}

export function formatEstimateWindow(
  activity: Activity,
  timeZone: string,
): string | null {
  if (
    activity.windowStartMs !== undefined &&
    activity.windowEndMs !== undefined
  ) {
    return `${formatClockInZone(activity.windowStartMs, timeZone)}–${formatClockInZone(activity.windowEndMs, timeZone)}`;
  }
  return activity.targetDate || null;
}
