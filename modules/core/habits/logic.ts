import { addLocalDays, parseLocalDate } from "../time/zone.ts";
import { inProject } from "../workspace/focus.ts";
import type {
  Habit,
  HabitChecklistEntryProgress,
  HabitChecklistItem,
  HabitCompletionMode,
  HabitDailyLog,
  HabitDayEvaluation,
  HabitNegativeEvent,
  HabitPlan,
  HabitRevision,
  HabitSchedule,
  HabitStreakSummary,
  HeatmapCell,
  HeatmapResponse,
} from "./model.ts";

const WEEKDAY_NAMES_SHORT = ["一", "二", "三", "四", "五", "六", "日"] as const;

/** Returns ISO weekday 1 (Monday) .. 7 (Sunday) for a YYYY-MM-DD local date. */
export function isoWeekday(dateStr: string): number {
  const { year, month, day } = parseLocalDate(dateStr);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

/** Returns signed calendar day difference (toDate - fromDate). */
export function diffCalendarDays(fromDate: string, toDate: string): number {
  const a = parseLocalDate(fromDate);
  const b = parseLocalDate(toDate);
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((msB - msA) / 86_400_000);
}

/** Checks whether a schedule expects execution on the given local YYYY-MM-DD date. */
export function isScheduleMatch(
  schedule: HabitSchedule,
  dateStr: string,
): boolean {
  if (schedule.type === "daily") return true;
  if (schedule.type === "weekly") {
    const day = isoWeekday(dateStr);
    return schedule.weekdays.includes(day);
  }
  const diff = diffCalendarDays(schedule.anchorDate, dateStr);
  if (diff < 0) return false;
  return diff % schedule.intervalDays === 0;
}

/** Formats a human-readable Chinese description of a habit schedule. */
export function formatScheduleLabel(schedule: HabitSchedule): string {
  if (schedule.type === "daily") return "每天";
  if (schedule.type === "weekly") {
    const sorted = [...new Set(schedule.weekdays)]
      .filter((d) => d >= 1 && d <= 7)
      .sort((a, b) => a - b);
    if (sorted.length === 7) return "每天";
    if (sorted.length === 0) return "未指定日期";
    return `每周${sorted.map((d) => WEEKDAY_NAMES_SHORT[d - 1]).join("、")}`;
  }
  return `每 ${schedule.intervalDays} 天`;
}

/** Validates and normalizes a HabitSchedule. */
export function normalizeSchedule(
  input: HabitSchedule,
  fallbackAnchorDate: string,
): HabitSchedule {
  if (!input || typeof input !== "object") {
    throw new Error("Schedule is required.");
  }
  if (input.type === "daily") {
    return { type: "daily" };
  }
  if (input.type === "weekly") {
    if (!Array.isArray(input.weekdays)) {
      throw new Error("Weekly schedule requires weekdays.");
    }
    const weekdays = [...new Set(input.weekdays.map(Number))]
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      .sort((a, b) => a - b);
    if (weekdays.length === 0) {
      throw new Error("请至少选择每周执行的一天。");
    }
    return { type: "weekly", weekdays };
  }
  if (input.type === "interval") {
    const intervalDays = Number(input.intervalDays);
    if (
      !Number.isInteger(intervalDays) ||
      intervalDays < 2 ||
      intervalDays > 365
    ) {
      throw new Error("间隔天数需为 2 到 365 之间的整数。");
    }
    const anchorDate = input.anchorDate || fallbackAnchorDate;
    parseLocalDate(anchorDate);
    return { type: "interval", intervalDays, anchorDate };
  }
  throw new Error("Unsupported schedule type.");
}

/** Normalizes checklist plans for a habit. */
export function normalizePlans(
  plans: readonly HabitPlan[] | undefined,
  abEnabled: boolean,
): HabitPlan[] {
  const cleanItems = (items: readonly HabitChecklistItem[] | undefined) =>
    (items ?? [])
      .map((item, idx) => ({
        id:
          typeof item.id === "string" && item.id.trim()
            ? item.id.trim()
            : `item-${idx + 1}`,
        title: typeof item.title === "string" ? item.title.trim() : "",
        required: item.required !== false,
      }))
      .filter((item) => item.title.length > 0);

  if (abEnabled) {
    const planA = plans?.find((p) => p.id === "A") ?? plans?.[0];
    const planB = plans?.find((p) => p.id === "B") ?? plans?.[1];
    return [
      {
        id: "A",
        name: planA?.name?.trim() || "方案 A",
        items: cleanItems(planA?.items),
      },
      {
        id: "B",
        name: planB?.name?.trim() || "方案 B",
        items: cleanItems(planB?.items),
      },
    ];
  }

  const first = plans?.[0];
  return [
    {
      id: first?.id?.trim() || "default",
      name: first?.name?.trim() || "动作清单",
      items: cleanItems(first?.items),
    },
  ];
}

/** Derives habit checklist plans directly from a Todo's live Aster subtasks. */
export function buildPlansFromSubtasks(
  subtasks: ReadonlyArray<{ uuid: string; description: string }>,
  abEnabled: boolean,
  subtaskPlans: Readonly<Record<string, "A" | "B">> = {},
): { completionMode: HabitCompletionMode; plans: HabitPlan[] } {
  if (subtasks.length === 0) {
    return {
      completionMode: "simple",
      plans: normalizePlans(undefined, false),
    };
  }
  if (!abEnabled) {
    return {
      completionMode: "checklist",
      plans: [
        {
          id: "default",
          name: "动作清单",
          items: subtasks.map((child) => ({
            id: child.uuid,
            title: child.description,
            required: true,
          })),
        },
      ],
    };
  }
  const itemsA: HabitChecklistItem[] = [];
  const itemsB: HabitChecklistItem[] = [];
  for (const child of subtasks) {
    const entry: HabitChecklistItem = {
      id: child.uuid,
      title: child.description,
      required: true,
    };
    if (subtaskPlans[child.uuid] === "B") {
      itemsB.push(entry);
    } else {
      itemsA.push(entry);
    }
  }
  return {
    completionMode: "checklist",
    plans: [
      { id: "A", name: "方案 A", items: itemsA },
      { id: "B", name: "方案 B", items: itemsB },
    ],
  };
}

/** Resolves the revision active on a given local YYYY-MM-DD date. */
export function resolveRevisionForDate(
  revisions: readonly HabitRevision[],
  dateStr: string,
): HabitRevision | undefined {
  let matched: HabitRevision | undefined;
  for (const rev of revisions) {
    if (rev.effectiveFromDate <= dateStr) {
      if (
        !matched ||
        rev.effectiveFromDate > matched.effectiveFromDate ||
        (rev.effectiveFromDate === matched.effectiveFromDate &&
          rev.createdAtMs >= matched.createdAtMs)
      ) {
        matched = rev;
      }
    }
  }
  return matched;
}

/** Resolves which training plan applies on a given date (handling A/B rotation). */
export function resolvePlanForDate(
  revision: HabitRevision,
  dateStr: string,
  logsByDate: ReadonlyMap<string, HabitDailyLog>,
): HabitPlan | undefined {
  if (revision.plans.length === 0) return undefined;
  const existingLog = logsByDate.get(dateStr);
  if (existingLog?.planId) {
    const matched = revision.plans.find((p) => p.id === existingLog.planId);
    if (matched) return matched;
  }
  if (!revision.abEnabled || revision.plans.length < 2) {
    return revision.plans[0];
  }

  const planA = revision.plans[0];
  const planB = revision.plans[1];
  let latestCompletedDate = "";
  let latestCompletedPlanId: string | undefined;

  for (const [logDate, log] of logsByDate) {
    if (logDate >= dateStr) continue;
    if (!log.completed) continue;
    if (log.planId !== planA.id && log.planId !== planB.id) continue;
    if (logDate > latestCompletedDate) {
      latestCompletedDate = logDate;
      latestCompletedPlanId = log.planId;
    }
  }

  if (!latestCompletedPlanId) return planA;
  return latestCompletedPlanId === planA.id ? planB : planA;
}

/** Evaluates whether a checklist is complete given items and per-item progress. */
export function isChecklistCompleted(
  items: readonly HabitChecklistItem[],
  progress: Record<string, HabitChecklistEntryProgress>,
  explicitCompleted = false,
): {
  completed: boolean;
  requiredDoneCount: number;
  requiredTotalCount: number;
} {
  const requiredItems = items.filter((item) => item.required);
  if (requiredItems.length > 0) {
    const requiredDoneCount = requiredItems.filter(
      (item) => progress[item.id]?.done,
    ).length;
    return {
      completed: requiredDoneCount === requiredItems.length,
      requiredDoneCount,
      requiredTotalCount: requiredItems.length,
    };
  }
  if (items.length > 0) {
    const doneCount = items.filter((item) => progress[item.id]?.done).length;
    return {
      completed: doneCount === items.length,
      requiredDoneCount: doneCount,
      requiredTotalCount: items.length,
    };
  }
  return {
    completed: explicitCompleted,
    requiredDoneCount: 0,
    requiredTotalCount: 0,
  };
}

/** Evaluates a habit's state on a given date against its revisions, daily log, and negative events. */
export function evaluateHabitOnDate(params: {
  habit: Habit;
  revisions: readonly HabitRevision[];
  logsByDate: ReadonlyMap<string, HabitDailyLog>;
  eventsByDate: ReadonlyMap<string, readonly HabitNegativeEvent[]>;
  date: string;
  todayDate: string;
}): HabitDayEvaluation {
  const { habit, revisions, logsByDate, eventsByDate, date, todayDate } =
    params;
  const revision = resolveRevisionForDate(revisions, date);
  const log = logsByDate.get(date);
  const events = [...(eventsByDate.get(date) ?? [])].sort(
    (a, b) => a.occurredAtMs - b.occurredAtMs,
  );
  const hasLog = Boolean(log) || events.length > 0;
  const note = log?.note ?? "";

  if (!revision || date > todayDate) {
    return {
      date,
      scheduled: false,
      paused: false,
      archived: false,
      inProgress: false,
      achieved: false,
      status: "unscheduled",
      completionMode: habit.completionMode,
      abEnabled: habit.abEnabled,
      checklistItems: [],
      checklistProgress: {},
      requiredDoneCount: 0,
      requiredTotalCount: 0,
      events,
      note,
      hasLog,
    };
  }

  const paused = revision.status === "paused";
  const archived = revision.status === "archived";
  const scheduled =
    revision.status === "active" && isScheduleMatch(revision.schedule, date);

  if (habit.kind === "negative") {
    if (!scheduled && events.length === 0) {
      return {
        date,
        scheduled: false,
        paused,
        archived,
        inProgress: false,
        achieved: false,
        status: paused ? "paused" : "unscheduled",
        completionMode: "simple",
        abEnabled: false,
        checklistItems: [],
        checklistProgress: {},
        requiredDoneCount: 0,
        requiredTotalCount: 0,
        events,
        note,
        hasLog,
      };
    }

    if (events.length > 0) {
      return {
        date,
        scheduled,
        paused,
        archived,
        inProgress: date === todayDate,
        achieved: false,
        status: "broken",
        completionMode: "simple",
        abEnabled: false,
        checklistItems: [],
        checklistProgress: {},
        requiredDoneCount: 0,
        requiredTotalCount: 0,
        events,
        note,
        hasLog,
      };
    }

    if (date === todayDate) {
      return {
        date,
        scheduled: true,
        paused: false,
        archived: false,
        inProgress: true,
        achieved: false,
        status: "in_progress",
        completionMode: "simple",
        abEnabled: false,
        checklistItems: [],
        checklistProgress: {},
        requiredDoneCount: 0,
        requiredTotalCount: 0,
        events,
        note,
        hasLog,
      };
    }

    return {
      date,
      scheduled: true,
      paused: false,
      archived: false,
      inProgress: false,
      achieved: true,
      status: "achieved",
      completionMode: "simple",
      abEnabled: false,
      checklistItems: [],
      checklistProgress: {},
      requiredDoneCount: 0,
      requiredTotalCount: 0,
      events,
      note,
      hasLog,
    };
  }

  // Positive habit
  const mode = revision.completionMode;
  if (mode === "checklist") {
    const plan = resolvePlanForDate(revision, date, logsByDate);
    const items = log?.checklistSnapshot ?? plan?.items ?? [];
    const progress = log?.checklistProgress ?? {};
    const check = isChecklistCompleted(
      items,
      progress,
      Boolean(log?.completed),
    );
    const anyDone = items.some((item) => progress[item.id]?.done);
    const planId = log?.planId ?? plan?.id;
    const planName =
      revision.plans.find((p) => p.id === planId)?.name ?? plan?.name;

    if (!scheduled && !check.completed && !anyDone) {
      return {
        date,
        scheduled: false,
        paused,
        archived,
        inProgress: false,
        achieved: false,
        status: paused ? "paused" : "unscheduled",
        completionMode: mode,
        abEnabled: revision.abEnabled,
        planId,
        planName,
        checklistItems: items,
        checklistProgress: progress,
        requiredDoneCount: check.requiredDoneCount,
        requiredTotalCount: check.requiredTotalCount,
        events: [],
        note,
        hasLog,
      };
    }

    if (check.completed) {
      return {
        date,
        scheduled,
        paused,
        archived,
        inProgress: false,
        achieved: true,
        status: "achieved",
        completionMode: mode,
        abEnabled: revision.abEnabled,
        planId,
        planName,
        checklistItems: items,
        checklistProgress: progress,
        requiredDoneCount: check.requiredDoneCount,
        requiredTotalCount: check.requiredTotalCount,
        events: [],
        note,
        hasLog,
      };
    }

    return {
      date,
      scheduled,
      paused,
      archived,
      inProgress: date === todayDate,
      achieved: false,
      status: anyDone
        ? "partial"
        : date === todayDate
          ? "in_progress"
          : "missed",
      completionMode: mode,
      abEnabled: revision.abEnabled,
      planId,
      planName,
      checklistItems: items,
      checklistProgress: progress,
      requiredDoneCount: check.requiredDoneCount,
      requiredTotalCount: check.requiredTotalCount,
      events: [],
      note,
      hasLog,
    };
  }

  // Positive + simple
  const completed = Boolean(log?.completed);
  if (!scheduled && !completed) {
    return {
      date,
      scheduled: false,
      paused,
      archived,
      inProgress: false,
      achieved: false,
      status: paused ? "paused" : "unscheduled",
      completionMode: "simple",
      abEnabled: false,
      checklistItems: [],
      checklistProgress: {},
      requiredDoneCount: 0,
      requiredTotalCount: 0,
      events: [],
      note,
      hasLog,
    };
  }

  if (completed) {
    return {
      date,
      scheduled,
      paused,
      archived,
      inProgress: false,
      achieved: true,
      status: "achieved",
      completionMode: "simple",
      abEnabled: false,
      checklistItems: [],
      checklistProgress: {},
      requiredDoneCount: 0,
      requiredTotalCount: 0,
      events: [],
      note,
      hasLog,
    };
  }

  return {
    date,
    scheduled: true,
    paused: false,
    archived: false,
    inProgress: date === todayDate,
    achieved: false,
    status: date === todayDate ? "in_progress" : "missed",
    completionMode: "simple",
    abEnabled: false,
    checklistItems: [],
    checklistProgress: {},
    requiredDoneCount: 0,
    requiredTotalCount: 0,
    events: [],
    note,
    hasLog,
  };
}

/** Computes current streak, longest streak, and 30-day statistics for a habit. */
export function computeHabitStreak(params: {
  habit: Habit;
  revisions: readonly HabitRevision[];
  logsByDate: ReadonlyMap<string, HabitDailyLog>;
  eventsByDate: ReadonlyMap<string, readonly HabitNegativeEvent[]>;
  todayDate: string;
}): HabitStreakSummary {
  const { habit, revisions, logsByDate, eventsByDate, todayDate } = params;
  const earliestRevisionDate = revisions.reduce(
    (min, rev) => (rev.effectiveFromDate < min ? rev.effectiveFromDate : min),
    habit.createdDate,
  );
  const startDate =
    earliestRevisionDate < habit.createdDate
      ? earliestRevisionDate
      : habit.createdDate;
  const yesterday = addLocalDays(todayDate, -1);
  const recentStart = addLocalDays(todayDate, -29);

  let running = 0;
  let longest = 0;
  let recent30Scheduled = 0;
  let recent30Achieved = 0;
  let recent30Events = 0;

  if (startDate <= yesterday) {
    for (let d = startDate; d <= yesterday; d = addLocalDays(d, 1)) {
      const ev = evaluateHabitOnDate({
        habit,
        revisions,
        logsByDate,
        eventsByDate,
        date: d,
        todayDate,
      });
      if (d >= recentStart) {
        recent30Events += ev.events.length;
        if (ev.scheduled) {
          recent30Scheduled += 1;
          if (ev.achieved) recent30Achieved += 1;
        }
      }
      if (!ev.scheduled) continue;
      if (ev.achieved) {
        running += 1;
        if (running > longest) longest = running;
      } else {
        running = 0;
      }
    }
  }

  // Handle today without prematurely penalizing an ongoing day.
  if (startDate <= todayDate) {
    const todayEv = evaluateHabitOnDate({
      habit,
      revisions,
      logsByDate,
      eventsByDate,
      date: todayDate,
      todayDate,
    });
    if (todayDate >= recentStart) {
      recent30Events += todayEv.events.length;
      if (todayEv.scheduled) {
        if (habit.kind === "positive" && todayEv.achieved) {
          recent30Scheduled += 1;
          recent30Achieved += 1;
        } else if (habit.kind === "negative" && todayEv.status === "broken") {
          recent30Scheduled += 1;
        }
      }
    }
    if (todayEv.scheduled) {
      if (habit.kind === "positive" && todayEv.achieved) {
        running += 1;
        if (running > longest) longest = running;
      } else if (habit.kind === "negative" && todayEv.status === "broken") {
        running = 0;
      }
    }
  }

  return {
    currentStreak: running,
    longestStreak: longest,
    unit: habit.schedule.type === "daily" ? "天" : "次",
    recent30Scheduled,
    recent30Achieved,
    recent30Events,
  };
}

/** Checks whether a habit matches optional project, tag, and habitId filters. */
export function habitMatchesFilter(
  habit: Habit,
  filters: { project?: string; tag?: string; habitId?: string },
): boolean {
  if (filters.habitId && habit.id !== filters.habitId) return false;
  if (filters.project && !inProject(habit.project, filters.project)) {
    return false;
  }
  if (filters.tag && !habit.tags.includes(filters.tag)) {
    return false;
  }
  return true;
}

/** Computes the aggregate heatmap over [startDate..endDate] for matching habits. */
export function computeHeatmap(params: {
  habits: Array<{
    habit: Habit;
    revisions: readonly HabitRevision[];
    logsByDate: ReadonlyMap<string, HabitDailyLog>;
    eventsByDate: ReadonlyMap<string, readonly HabitNegativeEvent[]>;
  }>;
  startDate: string;
  endDate: string;
  todayDate: string;
  filters?: { project?: string; tag?: string; habitId?: string };
}): HeatmapResponse {
  const { habits, startDate, endDate, todayDate, filters = {} } = params;
  const matching = habits.filter((entry) =>
    habitMatchesFilter(entry.habit, filters),
  );

  const cells: HeatmapCell[] = [];
  let totalScheduledDays = 0;
  let perfectDays = 0;
  let achievedTotal = 0;
  let scheduledTotal = 0;

  for (let d = startDate; d <= endDate; d = addLocalDays(d, 1)) {
    if (d > todayDate) {
      cells.push({
        date: d,
        status: "future",
        scheduledCount: 0,
        achievedCount: 0,
        ratio: 0,
      });
      continue;
    }

    let scheduledCount = 0;
    let achievedCount = 0;
    let inProgressPositiveDone = 0;
    let inProgressPositiveTotal = 0;
    let inProgressNegativeClean = 0;
    let inProgressNegativeTotal = 0;

    for (const entry of matching) {
      const ev = evaluateHabitOnDate({
        habit: entry.habit,
        revisions: entry.revisions,
        logsByDate: entry.logsByDate,
        eventsByDate: entry.eventsByDate,
        date: d,
        todayDate,
      });
      if (!ev.scheduled) continue;
      scheduledCount += 1;
      if (d === todayDate) {
        if (entry.habit.kind === "positive") {
          inProgressPositiveTotal += 1;
          if (ev.achieved) {
            inProgressPositiveDone += 1;
            achievedCount += 1;
          }
        } else {
          inProgressNegativeTotal += 1;
          if (ev.events.length === 0) {
            inProgressNegativeClean += 1;
          }
        }
      } else if (ev.achieved) {
        achievedCount += 1;
      }
    }

    if (d === todayDate) {
      cells.push({
        date: d,
        status: scheduledCount === 0 ? "unscheduled" : "in_progress",
        scheduledCount,
        achievedCount,
        ratio: scheduledCount > 0 ? achievedCount / scheduledCount : 0,
        inProgressPositiveDone,
        inProgressPositiveTotal,
        inProgressNegativeClean,
        inProgressNegativeTotal,
      });
      continue;
    }

    if (scheduledCount === 0) {
      cells.push({
        date: d,
        status: "unscheduled",
        scheduledCount: 0,
        achievedCount: 0,
        ratio: 0,
      });
      continue;
    }

    totalScheduledDays += 1;
    scheduledTotal += scheduledCount;
    achievedTotal += achievedCount;
    if (achievedCount === scheduledCount) perfectDays += 1;

    const ratio = achievedCount / scheduledCount;
    let status: HeatmapCell["status"] = "zero";
    if (achievedCount === 0) {
      status = "zero";
    } else if (ratio === 1) {
      status = "level4";
    } else if (ratio > 0.67) {
      status = "level3";
    } else if (ratio > 0.34) {
      status = "level2";
    } else {
      status = "level1";
    }

    cells.push({
      date: d,
      status,
      scheduledCount,
      achievedCount,
      ratio,
    });
  }

  return {
    startDate,
    endDate,
    todayDate,
    cells,
    summary: {
      totalScheduledDays,
      perfectDays,
      achievedTotal,
      scheduledTotal,
    },
  };
}
