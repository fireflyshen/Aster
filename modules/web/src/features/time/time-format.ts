import {
  computeContinuationCostPreview,
  computeDurationCostCents,
  formatCurrencyCny,
  formatRateConversionHint,
  normalizeHourlyRateCents,
  UNASSIGNED_PROJECT_KEY,
  UNTAGGED_KEY,
  yuanToHourlyRateCents,
} from "@core/time/cost";
import type { Activity, LocatedSegment, TimePolicy } from "@core/time/model";
import { localDateOf } from "@core/time/zone";
import { RequestError } from "@/lib/api";
import { getLanguage, translateUI, type Language } from "@/app/language";

export {
  computeContinuationCostPreview,
  computeDurationCostCents,
  formatCurrencyCny,
  formatRateConversionHint,
  normalizeHourlyRateCents,
  UNASSIGNED_PROJECT_KEY,
  UNTAGGED_KEY,
  yuanToHourlyRateCents,
};

export function projectDisplayName(key: string): string {
  return key === UNASSIGNED_PROJECT_KEY || !key.trim() ? "未关联项目" : key;
}

export function tagDisplayName(key: string): string {
  return key === UNTAGGED_KEY || !key.trim() ? "未设标签" : key;
}

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

/** Renders `HH:mm`, adding `:ss` only when `ms` does not fall on an exact local minute. */
export function formatClockSmart(ms: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    const second = parts.find((p) => p.type === "second")?.value;
    if (hour && minute) {
      return second && second !== "00"
        ? `${hour}:${minute}:${second}`
        : `${hour}:${minute}`;
    }
  } catch {}
  return formatClockInZone(ms, timeZone);
}

/**
 * Snaps a minute-precision `HH:MM:00` start timestamp forward to the end of an
 * adjacent stopped segment that finished inside the same wall-clock minute,
 * avoiding false overlaps caused by sub-minute timer stop seconds.
 */
export function snapMinuteStartToSegments(
  startMs: number,
  endMs: number,
  segments: readonly LocatedSegment[] | undefined,
  excludeActivityId?: string,
): number {
  if (!segments?.length || startMs % 60_000 !== 0) return startMs;
  let snapped = startMs;
  for (const seg of segments) {
    if (excludeActivityId && seg.activityId === excludeActivityId) continue;
    if (seg.running) continue;
    if (seg.endMs > snapped && seg.endMs < startMs + 60_000) {
      snapped = seg.endMs;
    }
  }
  return snapped < endMs ? snapped : startMs;
}

const TIME_ERROR_MESSAGES: Record<string, string> = {
  INVALID_TITLE: "活动标题不能为空（最多 500 个字符）。",
  INVALID_INTERVAL: "结束时间必须晚于开始时间。",
  TIME_ASSIGNMENT_REQUIRED: "选项目或标签",
  ACTIVITY_NOT_FOUND: "未找到对应的时间记录，请刷新后重试。",
  ACTIVITY_VERSION_CONFLICT: "该记录已在其他窗口更新，请刷新后再试。",
  SESSION_VERSION_CONFLICT: "当前计时状态已发生变化，请刷新后再试。",
  ACTIVE_TIMER_EXISTS: "当前已有正在计时的活动，请先结束或切换后再试。",
  TIMING_PLAN_EXPIRED:
    "原计划的最晚停止时间已过，请修改最晚停止时刻后重新开始。",
  TIMING_PLAN_DEPLETED: "该计划的预计可用时长已用完，请加时后再继续。",
  ALREADY_LOCATED: "该记录已经定位到时间线上了。",
  TIME_DISABLED: "时间账本当前处于禁用状态。",
  TIME_RESTORING: "时间账本正在恢复数据，请稍后再试。",
};

type ConflictLike = {
  title?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  suspendMs?: unknown;
};

type TimeErrorLike = Error & {
  code?: unknown;
  details?: unknown;
};

export function formatTimeErrorMessage(
  error: unknown,
  timeZone: string,
): string {
  if (error instanceof RequestError || error instanceof Error) {
    const code =
      error instanceof RequestError
        ? error.code
        : typeof (error as TimeErrorLike).code === "string"
          ? ((error as TimeErrorLike).code as string)
          : undefined;
    const rawDetails =
      error instanceof RequestError
        ? error.details
        : (error as TimeErrorLike).details &&
            typeof (error as TimeErrorLike).details === "object"
          ? ((error as TimeErrorLike).details as Record<string, unknown>)
          : undefined;

    if (code === "INTERVAL_CONFLICT") {
      const rawConflicts = rawDetails?.conflicts;
      if (Array.isArray(rawConflicts) && rawConflicts.length > 0) {
        const first = rawConflicts[0] as ConflictLike;
        const title =
          typeof first.title === "string" && first.title.trim()
            ? first.title.trim()
            : translateUI("已有记录");
        const start =
          typeof first.startMs === "number"
            ? formatClockSmart(first.startMs, timeZone)
            : "";
        const end =
          typeof first.endMs === "number"
            ? formatClockSmart(first.endMs, timeZone)
            : typeof first.suspendMs === "number"
              ? `${formatClockSmart(first.suspendMs, timeZone)} (${translateUI("已暂停")})`
              : translateUI("进行中");
        const range = start ? `（${start} – ${end}）` : "";
        return translateUI("与「{0}」重叠{1}。", title, range);
      }
      return translateUI("与记录重叠");
    }
    if (code && TIME_ERROR_MESSAGES[code]) {
      return translateUI(TIME_ERROR_MESSAGES[code]);
    }
    return translateUI(error.message);
  }
  return String(error);
}

/** Compact ledger labels use one language and avoid fractional hours. */
export function formatLedgerDuration(
  seconds: number,
  locale: Language = getLanguage(),
): string {
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value}${locale === "en" ? "s" : "秒"}`;
  const minutes = Math.floor(value / 60);
  const hours = Math.floor(minutes / 60);
  if (locale === "en")
    return hours
      ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
      : `${minutes}m`;
  if (locale === "ja")
    return hours
      ? `${hours}時間${minutes % 60 ? `${minutes % 60}分` : ""}`
      : `${minutes}分`;
  return hours
    ? `${hours}时${minutes % 60 ? `${minutes % 60}分` : ""}`
    : `${minutes}分`;
}
