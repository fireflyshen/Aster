import assert from "node:assert/strict";
import test from "node:test";
import {
  computeHabitStreak,
  computeHeatmap,
  evaluateHabitOnDate,
  isScheduleMatch,
  resolvePlanForDate,
} from "../habits/logic.ts";
import type {
  Habit,
  HabitDailyLog,
  HabitNegativeEvent,
  HabitRevision,
} from "../habits/model.ts";

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    title: "阅读",
    kind: "positive",
    completionMode: "simple",
    description: "",
    tags: [],
    status: "active",
    abEnabled: false,
    schedule: { type: "daily" },
    plans: [{ id: "default", name: "动作清单", items: [] }],
    sortOrder: 0,
    createdDate: "2026-11-01",
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides,
  };
}

function makeRevision(
  habit: Habit,
  overrides: Partial<HabitRevision> = {},
): HabitRevision {
  return {
    id: "rev-1",
    habitId: habit.id,
    effectiveFromDate: habit.createdDate,
    status: habit.status,
    completionMode: habit.completionMode,
    abEnabled: habit.abEnabled,
    schedule: habit.schedule,
    plans: habit.plans,
    createdAtMs: habit.createdAtMs,
    ...overrides,
  };
}

test("schedule matching supports daily, weekly ISO weekdays, and interval from anchor", () => {
  assert.equal(isScheduleMatch({ type: "daily" }, "2026-11-15"), true);

  // 2026-11-15 is Sunday (7); 2026-11-16 is Monday (1)
  const monWedFri = { type: "weekly" as const, weekdays: [1, 3, 5] };
  assert.equal(isScheduleMatch(monWedFri, "2026-11-15"), false);
  assert.equal(isScheduleMatch(monWedFri, "2026-11-16"), true);
  assert.equal(isScheduleMatch(monWedFri, "2026-11-18"), true);

  const every3 = {
    type: "interval" as const,
    intervalDays: 3,
    anchorDate: "2026-11-10",
  };
  assert.equal(isScheduleMatch(every3, "2026-11-07"), false);
  assert.equal(isScheduleMatch(every3, "2026-11-10"), true);
  assert.equal(isScheduleMatch(every3, "2026-11-11"), false);
  assert.equal(isScheduleMatch(every3, "2026-11-13"), true);
});

test("negative habit is in_progress today without events, achieved after midnight without events, and broken if any event exists", () => {
  const habit = makeHabit({
    id: "neg-1",
    title: "不喝含糖饮料",
    kind: "negative",
    createdDate: "2026-11-10",
  });
  const revs = [makeRevision(habit)];
  const logs = new Map<string, HabitDailyLog>();
  const events = new Map<string, HabitNegativeEvent[]>([
    [
      "2026-11-12",
      [
        {
          id: "e1",
          habitId: "neg-1",
          date: "2026-11-12",
          occurredAtMs: 1000,
          note: "聚餐",
          createdAtMs: 1000,
        },
      ],
    ],
  ]);

  const pastClean = evaluateHabitOnDate({
    habit,
    revisions: revs,
    logsByDate: logs,
    eventsByDate: events,
    date: "2026-11-11",
    todayDate: "2026-11-15",
  });
  assert.equal(pastClean.status, "achieved");
  assert.equal(pastClean.achieved, true);

  const pastBroken = evaluateHabitOnDate({
    habit,
    revisions: revs,
    logsByDate: logs,
    eventsByDate: events,
    date: "2026-11-12",
    todayDate: "2026-11-15",
  });
  assert.equal(pastBroken.status, "broken");
  assert.equal(pastBroken.achieved, false);

  const todayClean = evaluateHabitOnDate({
    habit,
    revisions: revs,
    logsByDate: logs,
    eventsByDate: events,
    date: "2026-11-15",
    todayDate: "2026-11-15",
  });
  assert.equal(todayClean.status, "in_progress");
  assert.equal(todayClean.achieved, false);

  const streak = computeHabitStreak({
    habit,
    revisions: revs,
    logsByDate: logs,
    eventsByDate: events,
    todayDate: "2026-11-15",
  });
  // Nov 13 & Nov 14 clean; Nov 15 still in progress -> streak 2 days
  assert.equal(streak.currentStreak, 2);
  assert.equal(streak.longestStreak, 2);
  assert.equal(streak.unit, "天");
});

test("A/B checklist habit rotates only when completed, and keeps current plan when missed or partial", () => {
  const habit = makeHabit({
    id: "lift",
    title: "力量训练",
    kind: "positive",
    completionMode: "checklist",
    abEnabled: true,
    schedule: { type: "weekly", weekdays: [1, 3, 5] },
    plans: [
      {
        id: "A",
        name: "方案 A",
        items: [
          { id: "a1", title: "俯卧撑", required: true },
          { id: "a2", title: "卧推", required: true },
        ],
      },
      {
        id: "B",
        name: "方案 B",
        items: [{ id: "b1", title: "引体向上", required: true }],
      },
    ],
    createdDate: "2026-11-02", // Monday
  });
  const rev = makeRevision(habit);
  const logs = new Map<string, HabitDailyLog>();

  // Mon 11-02: first time -> Plan A
  assert.equal(resolvePlanForDate(rev, "2026-11-02", logs)?.id, "A");

  // Complete Plan A on Mon 11-02
  logs.set("2026-11-02", {
    id: "l1",
    habitId: "lift",
    date: "2026-11-02",
    completed: true,
    planId: "A",
    note: "",
    createdAtMs: 1,
    updatedAtMs: 1,
  });

  // Wed 11-04: defaults to B
  assert.equal(resolvePlanForDate(rev, "2026-11-04", logs)?.id, "B");

  // Partial on Wed 11-04 (not completed)
  logs.set("2026-11-04", {
    id: "l2",
    habitId: "lift",
    date: "2026-11-04",
    completed: false,
    planId: "B",
    checklistProgress: {},
    note: "",
    createdAtMs: 2,
    updatedAtMs: 2,
  });

  // Fri 11-06: still Plan B because B was not completed!
  assert.equal(resolvePlanForDate(rev, "2026-11-06", logs)?.id, "B");

  // Complete Plan B on Fri 11-06
  logs.set("2026-11-06", {
    id: "l3",
    habitId: "lift",
    date: "2026-11-06",
    completed: true,
    planId: "B",
    note: "",
    createdAtMs: 3,
    updatedAtMs: 3,
  });

  // Next Mon 11-09: rotates back to Plan A
  assert.equal(resolvePlanForDate(rev, "2026-11-09", logs)?.id, "A");
});

test("revisions preserve historical schedule/paused periods without breaking streaks", () => {
  const habit = makeHabit({
    id: "h-rev",
    title: "阅读",
    createdDate: "2026-11-10",
    schedule: { type: "weekly", weekdays: [1, 3, 5] },
  });
  const revisions: HabitRevision[] = [
    makeRevision(habit, {
      id: "r1",
      effectiveFromDate: "2026-11-10",
      status: "active",
      schedule: { type: "daily" },
    }),
    makeRevision(habit, {
      id: "r2",
      effectiveFromDate: "2026-11-12",
      status: "paused",
      schedule: { type: "daily" },
      createdAtMs: 2000,
    }),
    makeRevision(habit, {
      id: "r3",
      effectiveFromDate: "2026-11-14",
      status: "active",
      schedule: { type: "daily" },
      createdAtMs: 3000,
    }),
  ];
  const logs = new Map<string, HabitDailyLog>([
    [
      "2026-11-10",
      {
        id: "l1",
        habitId: "h-rev",
        date: "2026-11-10",
        completed: true,
        note: "",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ],
    [
      "2026-11-11",
      {
        id: "l2",
        habitId: "h-rev",
        date: "2026-11-11",
        completed: true,
        note: "",
        createdAtMs: 2,
        updatedAtMs: 2,
      },
    ],
    [
      "2026-11-14",
      {
        id: "l3",
        habitId: "h-rev",
        date: "2026-11-14",
        completed: true,
        note: "",
        createdAtMs: 3,
        updatedAtMs: 3,
      },
    ],
  ]);

  const streak = computeHabitStreak({
    habit,
    revisions,
    logsByDate: logs,
    eventsByDate: new Map(),
    todayDate: "2026-11-15",
  });
  // 11-10 (done), 11-11 (done), 11-12 & 11-13 (paused -> no break), 11-14 (done), 11-15 (in progress)
  assert.equal(streak.currentStreak, 3);
});

test("heatmap distinguishes unscheduled hollow, zero neutral gray, partial not counted, and today in_progress", () => {
  const reading = makeHabit({
    id: "read",
    title: "阅读",
    project: "学习",
    tags: ["晚间"],
    createdDate: "2026-11-12",
  });
  const lift = makeHabit({
    id: "lift",
    title: "力量训练",
    project: "身体维护",
    completionMode: "checklist",
    plans: [
      {
        id: "default",
        name: "动作清单",
        items: [
          { id: "1", title: "俯卧撑", required: true },
          { id: "2", title: "卧推", required: true },
          { id: "3", title: "侧平举", required: true },
        ],
      },
    ],
    createdDate: "2026-11-12",
  });

  const liftLogs = new Map<string, HabitDailyLog>([
    // 11-13: 2/3 items done -> NOT achieved in heatmap!
    [
      "2026-11-13",
      {
        id: "ll1",
        habitId: "lift",
        date: "2026-11-13",
        completed: false,
        checklistProgress: {
          "1": { done: true },
          "2": { done: true },
          "3": { done: false },
        },
        note: "",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ],
    // 11-14: 3/3 items done -> achieved!
    [
      "2026-11-14",
      {
        id: "ll2",
        habitId: "lift",
        date: "2026-11-14",
        completed: true,
        checklistProgress: {
          "1": { done: true },
          "2": { done: true },
          "3": { done: true },
        },
        note: "",
        createdAtMs: 2,
        updatedAtMs: 2,
      },
    ],
  ]);

  const readLogs = new Map<string, HabitDailyLog>([
    [
      "2026-11-13",
      {
        id: "rl1",
        habitId: "read",
        date: "2026-11-13",
        completed: true,
        note: "",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ],
    [
      "2026-11-14",
      {
        id: "rl2",
        habitId: "read",
        date: "2026-11-14",
        completed: true,
        note: "",
        createdAtMs: 2,
        updatedAtMs: 2,
      },
    ],
  ]);

  const hm = computeHeatmap({
    habits: [
      {
        habit: reading,
        revisions: [makeRevision(reading)],
        logsByDate: readLogs,
        eventsByDate: new Map(),
      },
      {
        habit: lift,
        revisions: [makeRevision(lift)],
        logsByDate: liftLogs,
        eventsByDate: new Map(),
      },
    ],
    startDate: "2026-11-11",
    endDate: "2026-11-15",
    todayDate: "2026-11-15",
  });

  const byDate = new Map(hm.cells.map((c) => [c.date, c]));
  assert.equal(byDate.get("2026-11-11")?.status, "unscheduled");
  assert.equal(byDate.get("2026-11-12")?.status, "zero");
  assert.equal(byDate.get("2026-11-12")?.achievedCount, 0);
  assert.equal(byDate.get("2026-11-13")?.achievedCount, 1); // 2/3 lift did NOT count as 0.5
  assert.equal(byDate.get("2026-11-13")?.scheduledCount, 2);
  assert.equal(byDate.get("2026-11-13")?.status, "level2");
  assert.equal(byDate.get("2026-11-14")?.status, "level4");
  assert.equal(byDate.get("2026-11-15")?.status, "in_progress");

  // Filter by project "身体维护"
  const filteredHm = computeHeatmap({
    habits: [
      {
        habit: reading,
        revisions: [makeRevision(reading)],
        logsByDate: readLogs,
        eventsByDate: new Map(),
      },
      {
        habit: lift,
        revisions: [makeRevision(lift)],
        logsByDate: liftLogs,
        eventsByDate: new Map(),
      },
    ],
    startDate: "2026-11-12",
    endDate: "2026-11-14",
    todayDate: "2026-11-15",
    filters: { project: "身体维护" },
  });
  const fByDate = new Map(filteredHm.cells.map((c) => [c.date, c]));
  assert.equal(fByDate.get("2026-11-13")?.status, "zero");
  assert.equal(fByDate.get("2026-11-14")?.status, "level4");
});
