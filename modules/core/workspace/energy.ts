import {
  addLocalDays,
  formatCalendarDate,
  isValidTimezone,
  wallPartsAt,
  zonedDateTimeToUtcMs,
} from "../time/zone.ts";
import type { Activity } from "../time/model.ts";
import { parseTaskwarriorDate } from "../tasks/model.ts";

export const DAILY_ENERGY_MAX = 100;
export const ELIXIR_ENERGY_BONUS = 30;
export const START_ENERGY_COST = 5;
export const SECONDS_PER_ENERGY_POINT = 180;
export const MIN_VALID_INTERVAL_SECONDS = 60;
export const ENERGY_RESET_HOUR = 6;

export type TimewarriorInterval = {
  id?: number;
  start: Date;
  end?: Date;
  uuid?: string;
  tags: string[];
};

export type EnergyState = {
  day: string;
  bonus: number;
  elixirCount: number;
};

export type EnergySummary = {
  day: string;
  max: number;
  used: number;
  remaining: number | null;
  bonus: number;
  elixirCount: number;
  trackedSecondsToday: number;
  activeCount: number;
  calculatedAt: string;
  taskSeconds: Record<string, number>;
  mode?: "legacy" | "time";
  timezone?: string;
  resetHour?: number;
  periodLabel?: string;
  complete?: boolean;
  paused?: boolean;
  incompleteReason?: string;
};

export type EnergyChange = {
  revision: number;
  kind: "energy";
  action: "elixir";
};

export type EnergyTaskLike = {
  uuid: string;
  status: string;
  start?: Date | string;
  end?: Date | string;
};

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? undefined : value;
  return parseTaskwarriorDate(value);
}

export function energyDayWindow(
  now = new Date(),
  timezone?: string,
): {
  day: string;
  start: Date;
} {
  if (timezone && isValidTimezone(timezone)) {
    const parts = wallPartsAt(now.getTime(), timezone);
    const localDay = formatCalendarDate(parts.year, parts.month, parts.day);
    const day =
      parts.hour < ENERGY_RESET_HOUR ? addLocalDays(localDay, -1) : localDay;
    const startMs = zonedDateTimeToUtcMs(day, "06:00:00", timezone);
    return { day, start: new Date(startMs) };
  }
  const start = new Date(now);
  if (start.getHours() < ENERGY_RESET_HOUR) {
    start.setDate(start.getDate() - 1);
  }
  start.setHours(ENERGY_RESET_HOUR, 0, 0, 0);
  const year = start.getFullYear();
  const month = String(start.getMonth() + 1).padStart(2, "0");
  const date = String(start.getDate()).padStart(2, "0");
  return { day: `${year}-${month}-${date}`, start };
}

const UUID_TAG_PATTERN =
  /^uuid:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function parseTimewarriorIntervals(
  output: string,
): TimewarriorInterval[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const startIdx = trimmed.indexOf("[");
  const endIdx = trimmed.lastIndexOf("]");
  if (startIdx < 0 || endIdx < startIdx) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(startIdx, endIdx + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const intervals: TimewarriorInterval[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const raw = item as {
      id?: unknown;
      start?: unknown;
      end?: unknown;
      tags?: unknown;
    };
    const start = parseTaskwarriorDate(raw.start);
    if (!start) continue;
    const end = parseTaskwarriorDate(raw.end);
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    let uuid: string | undefined;
    for (const tag of tags) {
      const match = UUID_TAG_PATTERN.exec(tag.trim());
      if (match) {
        uuid = match[1].toLowerCase();
        break;
      }
    }
    intervals.push({
      id: typeof raw.id === "number" ? raw.id : undefined,
      start,
      end,
      uuid,
      tags,
    });
  }
  return intervals;
}

export function calculateEnergy(
  tasks: EnergyTaskLike[],
  intervals: TimewarriorInterval[] = [],
  state?: Partial<EnergyState>,
  now = new Date(),
): EnergySummary {
  const { day, start: dayStart } = energyDayWindow(now);
  const sameDay = state?.day === day;
  const bonus =
    sameDay && typeof state?.bonus === "number" && state.bonus > 0
      ? Math.floor(state.bonus)
      : 0;
  const elixirCount =
    sameDay && typeof state?.elixirCount === "number" && state.elixirCount > 0
      ? Math.floor(state.elixirCount)
      : 0;
  const max = DAILY_ENERGY_MAX + bonus;

  const completedUuids = new Set<string>();
  const engagedTodayUuids = new Set<string>();
  const activeTasks = new Map<string, Date>();

  for (const task of tasks) {
    if (!task.uuid) continue;
    const key = task.uuid.toLowerCase();
    const startDate = toDate(task.start);
    const endDate = toDate(task.end);
    if (task.status === "completed") {
      completedUuids.add(key);
      if (endDate && endDate >= dayStart && endDate <= now) {
        engagedTodayUuids.add(key);
      }
    } else if (startDate && task.status !== "deleted") {
      engagedTodayUuids.add(key);
      activeTasks.set(key, startDate);
    }
  }

  const taskSeconds: Record<string, number> = Object.create(null);
  const tasksWithIntervals = new Set<string>();
  let trackedSecondsToday = 0;

  for (const interval of intervals) {
    const end = interval.end ?? now;
    const durationSec = Math.max(
      0,
      Math.floor((end.getTime() - interval.start.getTime()) / 1000),
    );
    const uuid = interval.uuid?.toLowerCase();
    const isCompleted = uuid ? completedUuids.has(uuid) : false;

    // Ignore accidental starts that were stopped within 60 seconds without completing the task.
    if (
      interval.end &&
      durationSec < MIN_VALID_INTERVAL_SECONDS &&
      !isCompleted
    ) {
      continue;
    }

    if (uuid) {
      tasksWithIntervals.add(uuid);
      taskSeconds[uuid] = (taskSeconds[uuid] || 0) + durationSec;
    }

    if (end > dayStart && interval.start < now) {
      const clippedStart = Math.max(
        interval.start.getTime(),
        dayStart.getTime(),
      );
      const clippedEnd = Math.min(end.getTime(), now.getTime());
      const todaySec = Math.max(
        0,
        Math.floor((clippedEnd - clippedStart) / 1000),
      );
      trackedSecondsToday += todaySec;
    }
  }

  // Fallback for active tasks if Timewarrior is not yet tracking them (e.g. local/test mode without hook).
  for (const [uuid, startDate] of activeTasks.entries()) {
    if (!tasksWithIntervals.has(uuid) && startDate < now) {
      const durationSec = Math.max(
        0,
        Math.floor((now.getTime() - startDate.getTime()) / 1000),
      );
      taskSeconds[uuid] = (taskSeconds[uuid] || 0) + durationSec;
      const clippedStart = Math.max(startDate.getTime(), dayStart.getTime());
      const todaySec = Math.max(
        0,
        Math.floor((now.getTime() - clippedStart) / 1000),
      );
      trackedSecondsToday += todaySec;
    }
  }

  const entryCost = engagedTodayUuids.size * START_ENERGY_COST;
  const durationCost = Math.floor(
    trackedSecondsToday / SECONDS_PER_ENERGY_POINT,
  );
  const used = entryCost + durationCost;
  const remaining = Math.max(0, max - used);

  return {
    day,
    max,
    used,
    remaining,
    bonus,
    elixirCount,
    trackedSecondsToday,
    activeCount: activeTasks.size,
    calculatedAt: now.toISOString(),
    taskSeconds,
    mode: "legacy",
    resetHour: ENERGY_RESET_HOUR,
    complete: true,
    paused: false,
  };
}

export type TimeEnergyInput = {
  tasks: EnergyTaskLike[];
  activities: readonly Activity[];
  activeActivityId: string | null;
  timezone: string;
  cutoverAtMs?: number;
  importedRanges?: ReadonlyArray<{ rangeStartMs?: number; rangeEndMs?: number }>;
  state?: Partial<EnergyState>;
  now?: Date;
};

/**
 * Computes optional 06:00-cycle Energy metrics from Time's located task-linked
 * activities without falling back to Taskwarrior `task.start` timestamps.
 */
export function calculateTimeModeEnergy(input: TimeEnergyInput): EnergySummary {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const { day, start: dayStart } = energyDayWindow(now, input.timezone);
  const dayStartMs = dayStart.getTime();

  const sameDay = input.state?.day === day;
  const bonus =
    sameDay && typeof input.state?.bonus === "number" && input.state.bonus > 0
      ? Math.floor(input.state.bonus)
      : 0;
  const elixirCount =
    sameDay &&
    typeof input.state?.elixirCount === "number" &&
    input.state.elixirCount > 0
      ? Math.floor(input.state.elixirCount)
      : 0;
  const max = DAILY_ENERGY_MAX + bonus;

  const cutoverNeedsImport =
    input.cutoverAtMs !== undefined && input.cutoverAtMs > dayStartMs;
  const cyclePreCutoverImported =
    !cutoverNeedsImport ||
    (input.importedRanges ?? []).some(
      (range) =>
        range.rangeStartMs !== undefined &&
        range.rangeEndMs !== undefined &&
        range.rangeStartMs <= dayStartMs &&
        range.rangeEndMs >= (input.cutoverAtMs ?? dayStartMs),
    );
  const complete = cyclePreCutoverImported;

  const completedUuids = new Set<string>();
  const engagedTodayUuids = new Set<string>();
  for (const task of input.tasks) {
    if (!task.uuid) continue;
    const key = task.uuid.toLowerCase();
    const endDate = toDate(task.end);
    if (task.status === "completed") {
      completedUuids.add(key);
      if (endDate && endDate >= dayStart && endDate <= now) {
        engagedTodayUuids.add(key);
      }
    }
  }

  const taskSeconds: Record<string, number> = Object.create(null);
  let trackedSecondsToday = 0;
  let runningTaskActivityCount = 0;

  for (const activity of input.activities) {
    if (
      activity.kind !== "located" ||
      activity.reviewState === "voided" ||
      activity.reviewState === "conflict" ||
      !activity.taskUuid ||
      activity.startMs === undefined
    ) {
      continue;
    }

    const rawEnd = activity.suspendMs ?? activity.endMs ?? nowMs;
    const endMs = Math.min(rawEnd, nowMs);
    if (endMs <= activity.startMs) continue;

    const durationSec = Math.max(
      0,
      Math.floor((endMs - activity.startMs) / 1000),
    );
    const key = activity.taskUuid.toLowerCase();
    const isCompleted = completedUuids.has(key);

    if (
      activity.endMs !== undefined &&
      durationSec < MIN_VALID_INTERVAL_SECONDS &&
      !isCompleted
    ) {
      continue;
    }

    taskSeconds[key] = (taskSeconds[key] || 0) + durationSec;

    if (endMs > dayStartMs && activity.startMs < nowMs) {
      const clippedStart = Math.max(activity.startMs, dayStartMs);
      const clippedEnd = Math.min(endMs, nowMs);
      const todaySec = Math.max(
        0,
        Math.floor((clippedEnd - clippedStart) / 1000),
      );
      trackedSecondsToday += todaySec;
      engagedTodayUuids.add(key);
    }

    if (
      complete &&
      activity.id === input.activeActivityId &&
      activity.endMs === undefined &&
      activity.suspendMs === undefined
    ) {
      runningTaskActivityCount = 1;
    }
  }

  const entryCost = engagedTodayUuids.size * START_ENERGY_COST;
  const durationCost = Math.floor(
    trackedSecondsToday / SECONDS_PER_ENERGY_POINT,
  );
  const used = entryCost + durationCost;
  const remaining = complete ? Math.max(0, max - used) : null;

  return {
    day,
    max,
    used,
    remaining,
    bonus,
    elixirCount,
    trackedSecondsToday,
    activeCount: complete ? runningTaskActivityCount : 0,
    calculatedAt: now.toISOString(),
    taskSeconds,
    mode: "time",
    timezone: input.timezone,
    resetHour: ENERGY_RESET_HOUR,
    periodLabel: `06:00 周期 (${input.timezone})`,
    complete,
    paused: !complete,
    ...(!complete
      ? {
          incompleteReason:
            "切换当期历史尚未导入，已暂停剩余精力推算",
        }
      : {}),
  };
}

export function applyEnergyElixir(summary: EnergySummary): EnergyState {
  const overdraft =
    summary.paused || summary.remaining === null
      ? 0
      : Math.max(0, summary.used - DAILY_ENERGY_MAX);
  const baseBonus = Math.max(summary.bonus, overdraft);
  return {
    day: summary.day,
    bonus: baseBonus + ELIXIR_ENERGY_BONUS,
    elixirCount: summary.elixirCount + 1,
  };
}

export function liveEnergySummary(
  summary?: EnergySummary,
  now = new Date(),
): EnergySummary | undefined {
  if (!summary) return undefined;
  const currentWindow = energyDayWindow(now, summary.timezone);
  if (currentWindow.day !== summary.day) {
    if (summary.paused || summary.complete === false) {
      return {
        ...summary,
        day: currentWindow.day,
        max: DAILY_ENERGY_MAX,
        used: summary.activeCount * START_ENERGY_COST,
        remaining: Math.max(
          0,
          DAILY_ENERGY_MAX - summary.activeCount * START_ENERGY_COST,
        ),
        bonus: 0,
        elixirCount: 0,
        trackedSecondsToday: 0,
        calculatedAt: now.toISOString(),
        complete: true,
        paused: false,
        incompleteReason: undefined,
      };
    }
    return {
      ...summary,
      day: currentWindow.day,
      max: DAILY_ENERGY_MAX,
      used: summary.activeCount * START_ENERGY_COST,
      remaining: Math.max(
        0,
        DAILY_ENERGY_MAX - summary.activeCount * START_ENERGY_COST,
      ),
      bonus: 0,
      elixirCount: 0,
      trackedSecondsToday: 0,
      calculatedAt: now.toISOString(),
    };
  }
  if (summary.paused || summary.remaining === null || summary.activeCount <= 0) {
    return summary;
  }
  const baseTime = new Date(summary.calculatedAt).getTime();
  if (Number.isNaN(baseTime) || now.getTime() <= baseTime) return summary;
  const deltaSec = Math.floor((now.getTime() - baseTime) / 1000);
  const trackedSecondsToday = summary.trackedSecondsToday + deltaSec;
  const previousDurationCost = Math.floor(
    summary.trackedSecondsToday / SECONDS_PER_ENERGY_POINT,
  );
  const nextDurationCost = Math.floor(
    trackedSecondsToday / SECONDS_PER_ENERGY_POINT,
  );
  const used = summary.used + (nextDurationCost - previousDurationCost);
  const remaining = Math.max(0, summary.max - used);
  return {
    ...summary,
    used,
    remaining,
    trackedSecondsToday,
  };
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}
