const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

type WallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== "string" || timeZone.length > 100) {
    return false;
  }
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function requireValidTimezone(timeZone: string): string {
  if (!isValidTimezone(timeZone)) {
    throw new Error(`Invalid timezone: ${timeZone}`);
  }
  return timeZone;
}

export function parseLocalDate(dateStr: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = DATE_PATTERN.exec(dateStr);
  if (!match) throw new Error(`Invalid local date: ${dateStr}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Calendar date does not exist: ${dateStr}`);
  }
  return { year, month, day };
}

export function parseLocalTime(timeStr: string): {
  hour: number;
  minute: number;
  second: number;
} {
  const match = TIME_PATTERN.exec(timeStr);
  if (!match) throw new Error(`Invalid local time: ${timeStr}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Time out of range: ${timeStr}`);
  }
  return { hour, minute, second };
}

export function formatCalendarDate(
  year: number,
  month: number,
  day: number,
): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addLocalDays(dateStr: string, deltaDays: number): string {
  const { year, month, day } = parseLocalDate(dateStr);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return formatCalendarDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

export function weekdayIndexMondayFirst(dateStr: string): number {
  const { year, month, day } = parseLocalDate(dateStr);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (dayOfWeek + 6) % 7;
}

export function mondayOfWeek(dateStr: string): string {
  return addLocalDays(dateStr, -weekdayIndexMondayFirst(dateStr));
}

export function wallPartsAt(utcMs: number, timeZone: string): WallParts {
  const parts = getFormatter(requireValidTimezone(timeZone)).formatToParts(
    new Date(utcMs),
  );
  const values: Record<string, number> = Object.create(null);
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function localDateOf(utcMs: number, timeZone: string): string {
  const p = wallPartsAt(utcMs, timeZone);
  return formatCalendarDate(p.year, p.month, p.day);
}

/**
 * Resolves a local date + time in an IANA timezone into UTC epoch ms.
 * Handles DST fall-back (deterministic earlier offset) and spring-forward gaps
 * (steps to the post-transition instant).
 */
export function zonedDateTimeToUtcMs(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): number {
  requireValidTimezone(timeZone);
  const { year, month, day } = parseLocalDate(dateStr);
  const { hour, minute, second } = parseLocalTime(timeStr);
  const targetWallMs = Date.UTC(year, month - 1, day, hour, minute, second);

  let guess = targetWallMs;
  for (let i = 0; i < 4; i++) {
    const actual = wallPartsAt(guess, timeZone);
    const actualWallMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const delta = targetWallMs - actualWallMs;
    if (delta === 0) break;
    guess += delta;
  }

  // If the requested wall-clock time fell into a DST spring-forward gap,
  // find the exact instant where the local wall clock enters >= target.
  const check = wallPartsAt(guess, timeZone);
  const checkWallMs = Date.UTC(
    check.year,
    check.month - 1,
    check.day,
    check.hour,
    check.minute,
    check.second,
  );
  if (checkWallMs !== targetWallMs) {
    // Advance forward to the first valid instant at/after the gap.
    let probe = guess;
    for (let step = 0; step < 180; step++) {
      const probeParts = wallPartsAt(probe, timeZone);
      const probeWallMs = Date.UTC(
        probeParts.year,
        probeParts.month - 1,
        probeParts.day,
        probeParts.hour,
        probeParts.minute,
        probeParts.second,
      );
      if (probeWallMs >= targetWallMs) {
        return probe;
      }
      probe += 60_000;
    }
  }
  return guess;
}

export function dayBoundsMs(
  dateStr: string,
  timeZone: string,
): { dayStartMs: number; dayEndMs: number } {
  const nextDate = addLocalDays(dateStr, 1);
  return {
    dayStartMs: zonedDateTimeToUtcMs(dateStr, "00:00:00", timeZone),
    dayEndMs: zonedDateTimeToUtcMs(nextDate, "00:00:00", timeZone),
  };
}

export type DaySlice = {
  date: string;
  dayStartMs: number;
  dayEndMs: number;
  sliceStartMs: number;
  sliceEndMs: number;
};

/**
 * Splits a half-open `[startMs, endMs)` UTC interval along local `00:00` day
 * boundaries in `timeZone`, preserving exact duration across DST & month transitions.
 */
export function splitIntervalByDay(
  startMs: number,
  endMs: number,
  timeZone: string,
): DaySlice[] {
  if (endMs <= startMs) return [];
  let cursorDate = localDateOf(startMs, timeZone);
  const slices: DaySlice[] = [];

  for (let guard = 0; guard < 4000; guard++) {
    const { dayStartMs, dayEndMs } = dayBoundsMs(cursorDate, timeZone);
    if (dayStartMs >= endMs) break;
    const sliceStartMs = Math.max(startMs, dayStartMs);
    const sliceEndMs = Math.min(endMs, dayEndMs);
    if (sliceEndMs > sliceStartMs) {
      slices.push({
        date: cursorDate,
        dayStartMs,
        dayEndMs,
        sliceStartMs,
        sliceEndMs,
      });
    }
    if (dayEndMs >= endMs) break;
    cursorDate = addLocalDays(cursorDate, 1);
  }
  return slices;
}
