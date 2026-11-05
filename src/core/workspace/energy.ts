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
  remaining: number;
  bonus: number;
  elixirCount: number;
  trackedSecondsToday: number;
  activeCount: number;
  calculatedAt: string;
  taskSeconds: Record<string, number>;
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
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  return parseTaskwarriorDate(value);
}

export function energyDayWindow(now = new Date()): {
  day: string;
  start: Date;
} {
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

const UUID_TAG_PATTERN = /^uuid:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function parseTimewarriorIntervals(output: string): TimewarriorInterval[] {
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
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [];
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
  const bonus = sameDay && typeof state?.bonus === "number" && state.bonus > 0 ? Math.floor(state.bonus) : 0;
  const elixirCount =
    sameDay && typeof state?.elixirCount === "number" && state.elixirCount > 0 ? Math.floor(state.elixirCount) : 0;
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
    const durationSec = Math.max(0, Math.floor((end.getTime() - interval.start.getTime()) / 1000));
    const uuid = interval.uuid?.toLowerCase();
    const isCompleted = uuid ? completedUuids.has(uuid) : false;

    // Ignore accidental starts that were stopped within 60 seconds without completing the task.
    if (interval.end && durationSec < MIN_VALID_INTERVAL_SECONDS && !isCompleted) {
      continue;
    }

    if (uuid) {
      tasksWithIntervals.add(uuid);
      taskSeconds[uuid] = (taskSeconds[uuid] || 0) + durationSec;
    }

    if (end > dayStart && interval.start < now) {
      const clippedStart = Math.max(interval.start.getTime(), dayStart.getTime());
      const clippedEnd = Math.min(end.getTime(), now.getTime());
      const todaySec = Math.max(0, Math.floor((clippedEnd - clippedStart) / 1000));
      trackedSecondsToday += todaySec;
    }
  }

  // Fallback for active tasks if Timewarrior is not yet tracking them (e.g. local/test mode without hook).
  for (const [uuid, startDate] of activeTasks.entries()) {
    if (!tasksWithIntervals.has(uuid) && startDate < now) {
      const durationSec = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / 1000));
      taskSeconds[uuid] = (taskSeconds[uuid] || 0) + durationSec;
      const clippedStart = Math.max(startDate.getTime(), dayStart.getTime());
      const todaySec = Math.max(0, Math.floor((now.getTime() - clippedStart) / 1000));
      trackedSecondsToday += todaySec;
    }
  }

  const entryCost = engagedTodayUuids.size * START_ENERGY_COST;
  const durationCost = Math.floor(trackedSecondsToday / SECONDS_PER_ENERGY_POINT);
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
  };
}

export function applyEnergyElixir(summary: EnergySummary): EnergyState {
  const overdraft = Math.max(0, summary.used - DAILY_ENERGY_MAX);
  const baseBonus = Math.max(summary.bonus, overdraft);
  return {
    day: summary.day,
    bonus: baseBonus + ELIXIR_ENERGY_BONUS,
    elixirCount: summary.elixirCount + 1,
  };
}

export function liveEnergySummary(summary?: EnergySummary, now = new Date()): EnergySummary | undefined {
  if (!summary) return undefined;
  const currentWindow = energyDayWindow(now);
  if (currentWindow.day !== summary.day) {
    return {
      day: currentWindow.day,
      max: DAILY_ENERGY_MAX,
      used: summary.activeCount * START_ENERGY_COST,
      remaining: Math.max(0, DAILY_ENERGY_MAX - summary.activeCount * START_ENERGY_COST),
      bonus: 0,
      elixirCount: 0,
      trackedSecondsToday: 0,
      activeCount: summary.activeCount,
      calculatedAt: now.toISOString(),
      taskSeconds: summary.taskSeconds,
    };
  }
  if (summary.activeCount <= 0) return summary;
  const baseTime = new Date(summary.calculatedAt).getTime();
  if (Number.isNaN(baseTime) || now.getTime() <= baseTime) return summary;
  const deltaSec = Math.floor((now.getTime() - baseTime) / 1000);
  const trackedSecondsToday = summary.trackedSecondsToday + deltaSec;
  const previousDurationCost = Math.floor(summary.trackedSecondsToday / SECONDS_PER_ENERGY_POINT);
  const nextDurationCost = Math.floor(trackedSecondsToday / SECONDS_PER_ENERGY_POINT);
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
