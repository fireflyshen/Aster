import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildPlansFromSubtasks,
  computeHabitStreak,
  computeHeatmap,
  evaluateHabitOnDate,
  habitMatchesFilter,
  isChecklistCompleted,
  normalizePlans,
  normalizeSchedule,
  resolvePlanForDate,
  resolveRevisionForDate,
} from "../../../core/habits/logic.ts";
import type {
  BindTaskHabitInput,
  CreateHabitInput,
  DayDetailItem,
  DayDetailResponse,
  Habit,
  HabitBackupPayload,
  HabitChecklistEntryProgress,
  HabitChecklistItem,
  HabitCompletionMode,
  HabitDailyLog,
  HabitDetailResponse,
  HabitKind,
  HabitListItem,
  HabitNegativeEvent,
  HabitPlan,
  HabitRevision,
  HabitSchedule,
  HabitStatus,
  HeatmapResponse,
  TodayHabitsResponse,
  UpdateHabitInput,
} from "../../../core/habits/model.ts";
import {
  addLocalDays,
  localDateOf,
  parseLocalDate,
} from "../../../core/time/zone.ts";
import { initializeHabitDatabase } from "./habit-schema.ts";

export class HabitStoreError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "HabitStoreError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type HabitTaskCatalog = {
  tasks: ReadonlyArray<{
    uuid: string;
    description: string;
    status: string;
    project?: string;
    tags: string[];
  }>;
  subtasks: Readonly<Record<string, string>>;
  descriptions: Readonly<Record<string, string>>;
};

type HabitRow = {
  id: string;
  task_uuid: string | null;
  title: string;
  kind: HabitKind;
  completion_mode: HabitCompletionMode;
  description: string;
  project: string | null;
  tags_json: string;
  status: HabitStatus;
  track_time: number;
  ab_enabled: number;
  subtask_plans_json: string;
  schedule_json: string;
  plans_json: string;
  sort_order: number;
  created_date: string;
  created_at_ms: number;
  updated_at_ms: number;
};

type HabitRevisionRow = {
  id: string;
  habit_id: string;
  effective_from_date: string;
  status: HabitStatus;
  completion_mode: HabitCompletionMode;
  ab_enabled: number;
  schedule_json: string;
  plans_json: string;
  created_at_ms: number;
};

type HabitDailyLogRow = {
  id: string;
  habit_id: string;
  date: string;
  completed: number;
  completed_at_ms: number | null;
  plan_id: string | null;
  checklist_snapshot_json: string | null;
  checklist_progress_json: string | null;
  note: string;
  created_at_ms: number;
  updated_at_ms: number;
};

type HabitNegativeEventRow = {
  id: string;
  habit_id: string;
  date: string;
  occurred_at_ms: number;
  note: string;
  created_at_ms: number;
};

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeTags(tags?: readonly string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim().replace(/^[@+]/, "");
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeProject(project?: string | null): string | undefined {
  if (typeof project !== "string") return undefined;
  const trimmed = project.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeMetric(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  if (!str) return undefined;
  return str.slice(0, 40);
}

function rowToHabit(row: HabitRow): Habit {
  const subtaskPlans = parseJson<Record<string, "A" | "B">>(
    row.subtask_plans_json,
    {},
  );
  return {
    id: row.id,
    ...(row.task_uuid ? { taskUuid: row.task_uuid } : {}),
    title: row.title,
    kind: row.kind,
    completionMode: row.completion_mode,
    description: row.description,
    ...(row.project ? { project: row.project } : {}),
    tags: parseJson<string[]>(row.tags_json, []),
    status: row.status,
    trackTime: row.kind === "positive" && Boolean(row.track_time),
    abEnabled: Boolean(row.ab_enabled),
    ...(Object.keys(subtaskPlans).length > 0 ? { subtaskPlans } : {}),
    schedule: parseJson<HabitSchedule>(row.schedule_json, { type: "daily" }),
    plans: parseJson<HabitPlan[]>(row.plans_json, []),
    sortOrder: row.sort_order,
    createdDate: row.created_date,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function rowToRevision(row: HabitRevisionRow): HabitRevision {
  return {
    id: row.id,
    habitId: row.habit_id,
    effectiveFromDate: row.effective_from_date,
    status: row.status,
    completionMode: row.completion_mode,
    abEnabled: Boolean(row.ab_enabled),
    schedule: parseJson<HabitSchedule>(row.schedule_json, { type: "daily" }),
    plans: parseJson<HabitPlan[]>(row.plans_json, []),
    createdAtMs: row.created_at_ms,
  };
}

function rowToDailyLog(row: HabitDailyLogRow): HabitDailyLog {
  return {
    id: row.id,
    habitId: row.habit_id,
    date: row.date,
    completed: Boolean(row.completed),
    ...(row.completed_at_ms !== null
      ? { completedAtMs: row.completed_at_ms }
      : {}),
    ...(row.plan_id ? { planId: row.plan_id } : {}),
    ...(row.checklist_snapshot_json
      ? {
          checklistSnapshot: parseJson<HabitChecklistItem[]>(
            row.checklist_snapshot_json,
            [],
          ),
        }
      : {}),
    ...(row.checklist_progress_json
      ? {
          checklistProgress: parseJson<
            Record<string, HabitChecklistEntryProgress>
          >(row.checklist_progress_json, {}),
        }
      : {}),
    note: row.note,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function rowToNegativeEvent(row: HabitNegativeEventRow): HabitNegativeEvent {
  return {
    id: row.id,
    habitId: row.habit_id,
    date: row.date,
    occurredAtMs: row.occurred_at_ms,
    note: row.note,
    createdAtMs: row.created_at_ms,
  };
}

export function createHabitStore(
  dbPath: string,
  options: {
    now?: () => number;
    getTimezone?: () => string;
  } = {},
) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const nowFn = options.now ?? (() => Date.now());
  const timezoneFn =
    options.getTimezone ??
    (() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai");

  initializeHabitDatabase(db, nowFn());

  function runTx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failure.
      }
      throw error;
    }
  }

  function currentTimezone(): string {
    return timezoneFn() || "Asia/Shanghai";
  }

  function currentTodayDate(): string {
    return localDateOf(nowFn(), currentTimezone());
  }

  function requireValidDate(date: string): string {
    try {
      parseLocalDate(date);
      return date;
    } catch {
      throw new HabitStoreError(400, "INVALID_DATE", `无效日期: ${date}`);
    }
  }

  function requireHabit(habitIdOrTaskUuid: string): Habit {
    const row = db
      .prepare("SELECT * FROM habits WHERE id = ? OR task_uuid = ?")
      .get(habitIdOrTaskUuid, habitIdOrTaskUuid) as HabitRow | undefined;
    if (!row) {
      throw new HabitStoreError(404, "HABIT_NOT_FOUND", "习惯不存在。");
    }
    return rowToHabit(row);
  }

  function loadHabitBundle(habitIdOrTaskUuid: string) {
    const habit = requireHabit(habitIdOrTaskUuid);
    const habitId = habit.id;
    const revisions = (
      db
        .prepare(
          "SELECT * FROM habit_revisions WHERE habit_id = ? ORDER BY effective_from_date ASC, created_at_ms ASC",
        )
        .all(habitId) as HabitRevisionRow[]
    ).map(rowToRevision);

    const logs = (
      db
        .prepare("SELECT * FROM habit_daily_logs WHERE habit_id = ?")
        .all(habitId) as HabitDailyLogRow[]
    ).map(rowToDailyLog);
    const logsByDate = new Map<string, HabitDailyLog>(
      logs.map((log) => [log.date, log]),
    );

    const events = (
      db
        .prepare(
          "SELECT * FROM habit_negative_events WHERE habit_id = ? ORDER BY occurred_at_ms ASC",
        )
        .all(habitId) as HabitNegativeEventRow[]
    ).map(rowToNegativeEvent);
    const eventsByDate = new Map<string, HabitNegativeEvent[]>();
    for (const ev of events) {
      const bucket = eventsByDate.get(ev.date) ?? [];
      bucket.push(ev);
      eventsByDate.set(ev.date, bucket);
    }

    return { habit, revisions, logsByDate, eventsByDate };
  }

  function loadAllBundles() {
    const habits = (
      db
        .prepare(
          "SELECT * FROM habits ORDER BY sort_order ASC, created_at_ms ASC",
        )
        .all() as HabitRow[]
    ).map(rowToHabit);

    const revRows = db
      .prepare(
        "SELECT * FROM habit_revisions ORDER BY effective_from_date ASC, created_at_ms ASC",
      )
      .all() as HabitRevisionRow[];
    const revMap = new Map<string, HabitRevision[]>();
    for (const row of revRows) {
      const list = revMap.get(row.habit_id) ?? [];
      list.push(rowToRevision(row));
      revMap.set(row.habit_id, list);
    }

    const logRows = db
      .prepare("SELECT * FROM habit_daily_logs")
      .all() as HabitDailyLogRow[];
    const logMap = new Map<string, Map<string, HabitDailyLog>>();
    for (const row of logRows) {
      const m = logMap.get(row.habit_id) ?? new Map<string, HabitDailyLog>();
      m.set(row.date, rowToDailyLog(row));
      logMap.set(row.habit_id, m);
    }

    const eventRows = db
      .prepare(
        "SELECT * FROM habit_negative_events ORDER BY occurred_at_ms ASC",
      )
      .all() as HabitNegativeEventRow[];
    const eventMap = new Map<string, Map<string, HabitNegativeEvent[]>>();
    for (const row of eventRows) {
      const m =
        eventMap.get(row.habit_id) ?? new Map<string, HabitNegativeEvent[]>();
      const list = m.get(row.date) ?? [];
      list.push(rowToNegativeEvent(row));
      m.set(row.date, list);
      eventMap.set(row.habit_id, m);
    }

    return habits.map((habit) => ({
      habit,
      revisions: revMap.get(habit.id) ?? [],
      logsByDate: logMap.get(habit.id) ?? new Map<string, HabitDailyLog>(),
      eventsByDate:
        eventMap.get(habit.id) ?? new Map<string, HabitNegativeEvent[]>(),
    }));
  }

  function buildListItem(
    bundle: ReturnType<typeof loadHabitBundle>,
    todayDate: string,
  ): HabitListItem {
    const streak = computeHabitStreak({ ...bundle, todayDate });
    const todayEvaluation = evaluateHabitOnDate({
      ...bundle,
      date: todayDate,
      todayDate,
    });
    return {
      ...bundle.habit,
      streak,
      todayEvaluation,
      hasLogToday: todayEvaluation.hasLog,
    };
  }

  function upsertRevisionTx(params: {
    habitId: string;
    effectiveFromDate: string;
    status: HabitStatus;
    completionMode: HabitCompletionMode;
    abEnabled: boolean;
    schedule: HabitSchedule;
    plans: HabitPlan[];
    nowMs: number;
  }): void {
    const existing = db
      .prepare(
        "SELECT id FROM habit_revisions WHERE habit_id = ? AND effective_from_date = ?",
      )
      .get(params.habitId, params.effectiveFromDate) as
      | { id: string }
      | undefined;

    if (existing) {
      db.prepare(
        `UPDATE habit_revisions
         SET status = ?, completion_mode = ?, ab_enabled = ?, schedule_json = ?, plans_json = ?, created_at_ms = ?
         WHERE id = ?`,
      ).run(
        params.status,
        params.completionMode,
        params.abEnabled ? 1 : 0,
        JSON.stringify(params.schedule),
        JSON.stringify(params.plans),
        params.nowMs,
        existing.id,
      );
      return;
    }

    db.prepare(
      `INSERT INTO habit_revisions
       (id, habit_id, effective_from_date, status, completion_mode, ab_enabled, schedule_json, plans_json, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      params.habitId,
      params.effectiveFromDate,
      params.status,
      params.completionMode,
      params.abEnabled ? 1 : 0,
      JSON.stringify(params.schedule),
      JSON.stringify(params.plans),
      params.nowMs,
    );
  }

  function listHabits(
    filters: {
      status?: HabitStatus | "all";
      project?: string;
      tag?: string;
    } = {},
  ): HabitListItem[] {
    const todayDate = currentTodayDate();
    const bundles = loadAllBundles();
    return bundles
      .filter((bundle) => {
        if (
          filters.status &&
          filters.status !== "all" &&
          bundle.habit.status !== filters.status
        ) {
          return false;
        }
        return habitMatchesFilter(bundle.habit, {
          project: filters.project,
          tag: filters.tag,
        });
      })
      .map((bundle) => buildListItem(bundle, todayDate));
  }

  function getTodayHabits(): TodayHabitsResponse {
    const timezone = currentTimezone();
    const todayDate = localDateOf(nowFn(), timezone);
    const bundles = loadAllBundles();

    const items: TodayHabitsResponse["items"] = [];
    let positiveTotal = 0;
    let positiveDone = 0;
    let negativeTotal = 0;
    let negativeClean = 0;

    for (const bundle of bundles) {
      if (bundle.habit.status !== "active") continue;
      const evaluation = evaluateHabitOnDate({
        ...bundle,
        date: todayDate,
        todayDate,
      });
      if (!evaluation.scheduled) continue;
      const revision = resolveRevisionForDate(bundle.revisions, todayDate);
      const streak = computeHabitStreak({ ...bundle, todayDate });
      items.push({
        habit: bundle.habit,
        streak,
        evaluation,
        availablePlans: revision?.plans ?? bundle.habit.plans,
      });
      if (bundle.habit.kind === "positive") {
        positiveTotal += 1;
        if (evaluation.achieved) positiveDone += 1;
      } else {
        negativeTotal += 1;
        if (evaluation.events.length === 0) negativeClean += 1;
      }
    }

    return {
      todayDate,
      timezone,
      items,
      summary: {
        total: items.length,
        positiveTotal,
        positiveDone,
        negativeTotal,
        negativeClean,
      },
    };
  }

  function createHabit(input: CreateHabitInput): HabitListItem {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title || title.length > 120) {
      throw new HabitStoreError(
        400,
        "INVALID_TITLE",
        "习惯名称需为 1 到 120 个字符。",
      );
    }
    if (input.kind !== "positive" && input.kind !== "negative") {
      throw new HabitStoreError(400, "INVALID_KIND", "习惯类型无效。");
    }

    const todayDate = currentTodayDate();
    const createdDate = input.createdDate
      ? requireValidDate(input.createdDate)
      : todayDate;
    const completionMode: HabitCompletionMode =
      input.kind === "negative"
        ? "simple"
        : input.completionMode === "checklist"
          ? "checklist"
          : "simple";
    const abEnabled =
      input.kind === "positive" &&
      completionMode === "checklist" &&
      Boolean(input.abEnabled);
    const trackTime = input.kind === "positive" && Boolean(input.trackTime);

    let schedule: HabitSchedule;
    try {
      schedule = normalizeSchedule(input.schedule, createdDate);
    } catch (error) {
      throw new HabitStoreError(
        400,
        "INVALID_SCHEDULE",
        (error as Error).message,
      );
    }

    const plans =
      completionMode === "checklist"
        ? normalizePlans(input.plans, abEnabled)
        : normalizePlans(undefined, false);

    if (
      completionMode === "checklist" &&
      plans.every((p) => p.items.length === 0)
    ) {
      throw new HabitStoreError(
        400,
        "EMPTY_CHECKLIST",
        "动作清单模式至少需要添加一个动作。",
      );
    }

    const description =
      typeof input.description === "string" ? input.description.trim() : "";
    const project = normalizeProject(input.project);
    const tags = normalizeTags(input.tags);
    const subtaskPlans =
      input.subtaskPlans && typeof input.subtaskPlans === "object"
        ? input.subtaskPlans
        : {};
    const nowMs = nowFn();
    const taskUuid =
      typeof input.taskUuid === "string" && input.taskUuid.trim()
        ? input.taskUuid.trim()
        : undefined;
    const id = taskUuid ?? randomUUID();

    runTx(() => {
      const maxOrderRow = db
        .prepare(
          "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM habits",
        )
        .get() as { max_order: number };
      const sortOrder = (maxOrderRow?.max_order ?? -1) + 1;

      db.prepare(
        `INSERT INTO habits
         (id, task_uuid, title, kind, completion_mode, description, project, tags_json, status, track_time, ab_enabled, subtask_plans_json, schedule_json, plans_json, sort_order, created_date, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        taskUuid ?? null,
        title,
        input.kind,
        completionMode,
        description,
        project ?? null,
        JSON.stringify(tags),
        trackTime ? 1 : 0,
        abEnabled ? 1 : 0,
        JSON.stringify(subtaskPlans),
        JSON.stringify(schedule),
        JSON.stringify(plans),
        sortOrder,
        createdDate,
        nowMs,
        nowMs,
      );

      upsertRevisionTx({
        habitId: id,
        effectiveFromDate: createdDate,
        status: "active",
        completionMode,
        abEnabled,
        schedule,
        plans,
        nowMs,
      });
    });

    return buildListItem(loadHabitBundle(id), todayDate);
  }

  function bindTaskHabit(
    input: BindTaskHabitInput,
    catalog?: HabitTaskCatalog,
  ): HabitListItem {
    const taskUuid =
      typeof input.taskUuid === "string" ? input.taskUuid.trim() : "";
    if (!taskUuid) {
      throw new HabitStoreError(400, "INVALID_INPUT", "缺少任务 UUID。");
    }
    if (input.kind !== "positive" && input.kind !== "negative") {
      throw new HabitStoreError(400, "INVALID_KIND", "习惯类型无效。");
    }
    const todayDate = currentTodayDate();
    const tomorrowDate = addLocalDays(todayDate, 1);

    const taskFromCatalog = catalog?.tasks.find(
      (t) => t.uuid === taskUuid && t.status !== "deleted",
    );
    const childrenFromCatalog = catalog
      ? catalog.tasks.filter(
          (t) =>
            t.status !== "deleted" && catalog.subtasks[t.uuid] === taskUuid,
        )
      : [];

    const existingRow = db
      .prepare("SELECT * FROM habits WHERE id = ? OR task_uuid = ?")
      .get(taskUuid, taskUuid) as HabitRow | undefined;

    let resolvedSchedule: HabitSchedule;
    try {
      resolvedSchedule = normalizeSchedule(input.schedule, todayDate);
    } catch (error) {
      throw new HabitStoreError(
        400,
        "INVALID_SCHEDULE",
        (error as Error).message,
      );
    }

    const nextTrackTime =
      input.kind === "positive"
        ? Boolean(
            input.trackTime ??
            (existingRow ? Boolean(existingRow.track_time) : false),
          )
        : false;
    const nextAbEnabled =
      input.kind === "positive"
        ? Boolean(
            input.abEnabled ??
            (existingRow ? Boolean(existingRow.ab_enabled) : false),
          )
        : false;
    const nextSubtaskPlans =
      input.subtaskPlans ??
      (existingRow
        ? parseJson<Record<string, "A" | "B">>(
            existingRow.subtask_plans_json,
            {},
          )
        : {});
    const derivedPlans =
      input.kind === "positive" && childrenFromCatalog.length > 0
        ? buildPlansFromSubtasks(
            childrenFromCatalog,
            nextAbEnabled,
            nextSubtaskPlans,
          )
        : {
            completionMode: "simple" as HabitCompletionMode,
            plans: normalizePlans(undefined, false),
          };

    const resolvedTitle = (
      taskFromCatalog?.description ??
      input.title ??
      existingRow?.title ??
      "未命名习惯"
    ).trim();
    const resolvedProject = normalizeProject(
      taskFromCatalog
        ? taskFromCatalog.project
        : input.project !== undefined
          ? input.project
          : existingRow?.project,
    );
    const resolvedTags = normalizeTags(
      taskFromCatalog
        ? taskFromCatalog.tags
        : (input.tags ??
            (existingRow
              ? parseJson<string[]>(existingRow.tags_json, [])
              : [])),
    );
    const resolvedDescription = (
      (taskFromCatalog ? catalog?.descriptions[taskUuid] : undefined) ??
      input.description ??
      existingRow?.description ??
      ""
    ).trim();

    const nowMs = nowFn();

    if (!existingRow) {
      const nextStatus: HabitStatus = input.status ?? "active";
      runTx(() => {
        const maxOrderRow = db
          .prepare(
            "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM habits",
          )
          .get() as { max_order: number };
        const sortOrder = (maxOrderRow?.max_order ?? -1) + 1;
        db.prepare(
          `INSERT INTO habits
           (id, task_uuid, title, kind, completion_mode, description, project, tags_json, status, track_time, ab_enabled, subtask_plans_json, schedule_json, plans_json, sort_order, created_date, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          taskUuid,
          taskUuid,
          resolvedTitle,
          input.kind,
          derivedPlans.completionMode,
          resolvedDescription,
          resolvedProject ?? null,
          JSON.stringify(resolvedTags),
          nextStatus,
          nextTrackTime ? 1 : 0,
          nextAbEnabled ? 1 : 0,
          JSON.stringify(nextSubtaskPlans),
          JSON.stringify(resolvedSchedule),
          JSON.stringify(derivedPlans.plans),
          sortOrder,
          todayDate,
          nowMs,
          nowMs,
        );
        upsertRevisionTx({
          habitId: taskUuid,
          effectiveFromDate: todayDate,
          status: nextStatus,
          completionMode: derivedPlans.completionMode,
          abEnabled: nextAbEnabled,
          schedule: resolvedSchedule,
          plans: derivedPlans.plans,
          nowMs,
        });
      });
      return buildListItem(loadHabitBundle(taskUuid), todayDate);
    }

    const habitId = existingRow.id;
    runTx(() => {
      const bundle = loadHabitBundle(habitId);
      const current = bundle.habit;
      const nextStatus: HabitStatus = input.status ?? current.status;
      const nextMode =
        input.kind === "negative"
          ? "simple"
          : childrenFromCatalog.length > 0
            ? derivedPlans.completionMode
            : current.completionMode === "checklist" && !catalog
              ? current.completionMode
              : "simple";
      const nextPlans =
        input.kind === "negative"
          ? normalizePlans(undefined, false)
          : childrenFromCatalog.length > 0
            ? derivedPlans.plans
            : current.completionMode === "checklist" && !catalog
              ? current.plans
              : normalizePlans(undefined, false);

      const ruleChanged =
        input.kind !== current.kind ||
        nextStatus !== current.status ||
        nextMode !== current.completionMode ||
        nextAbEnabled !== current.abEnabled ||
        JSON.stringify(resolvedSchedule) !== JSON.stringify(current.schedule) ||
        JSON.stringify(nextPlans) !== JSON.stringify(current.plans);

      db.prepare(
        `UPDATE habits
         SET task_uuid = ?, title = ?, kind = ?, completion_mode = ?, description = ?, project = ?, tags_json = ?,
             status = ?, track_time = ?, ab_enabled = ?, subtask_plans_json = ?, schedule_json = ?, plans_json = ?, updated_at_ms = ?
         WHERE id = ?`,
      ).run(
        taskUuid,
        resolvedTitle,
        input.kind,
        nextMode,
        resolvedDescription,
        resolvedProject ?? null,
        JSON.stringify(resolvedTags),
        nextStatus,
        nextTrackTime ? 1 : 0,
        nextAbEnabled ? 1 : 0,
        JSON.stringify(nextSubtaskPlans),
        JSON.stringify(resolvedSchedule),
        JSON.stringify(nextPlans),
        nowMs,
        habitId,
      );

      if (ruleChanged) {
        const hasTodayInteraction =
          bundle.logsByDate.has(todayDate) ||
          (bundle.eventsByDate.get(todayDate)?.length ?? 0) > 0;
        let effectiveFrom = input.effectiveFromDate
          ? requireValidDate(input.effectiveFromDate)
          : hasTodayInteraction && nextStatus === current.status
            ? tomorrowDate
            : todayDate;
        if (effectiveFrom < todayDate) effectiveFrom = todayDate;
        upsertRevisionTx({
          habitId,
          effectiveFromDate: effectiveFrom,
          status: nextStatus,
          completionMode: nextMode,
          abEnabled: nextAbEnabled,
          schedule: resolvedSchedule,
          plans: nextPlans,
          nowMs,
        });
      }
    });

    return buildListItem(loadHabitBundle(habitId), todayDate);
  }

  function unbindTaskHabit(taskUuid: string): { ok: true } {
    runTx(() => {
      db.prepare("DELETE FROM habits WHERE id = ? OR task_uuid = ?").run(
        taskUuid,
        taskUuid,
      );
    });
    return { ok: true };
  }

  function deleteHabitIfExists(idOrTaskUuid: string): void {
    db.prepare("DELETE FROM habits WHERE id = ? OR task_uuid = ?").run(
      idOrTaskUuid,
      idOrTaskUuid,
    );
  }

  function syncFromTaskCatalog(catalog: HabitTaskCatalog): void {
    const todayDate = currentTodayDate();
    const nowMs = nowFn();
    const taskByUuid = new Map<string, HabitTaskCatalog["tasks"][number]>();
    const childrenByParent = new Map<
      string,
      Array<{ uuid: string; description: string }>
    >();

    for (const task of catalog.tasks) {
      if (task.status === "deleted") continue;
      taskByUuid.set(task.uuid, task);
      const parentUuid = catalog.subtasks[task.uuid];
      if (parentUuid && parentUuid !== task.uuid) {
        const list = childrenByParent.get(parentUuid) ?? [];
        list.push({ uuid: task.uuid, description: task.description });
        childrenByParent.set(parentUuid, list);
      }
    }

    const rows = db.prepare("SELECT * FROM habits").all() as HabitRow[];

    runTx(() => {
      for (const row of rows) {
        const linkedUuid =
          row.task_uuid || (taskByUuid.has(row.id) ? row.id : undefined);
        if (!linkedUuid) continue;
        const task = taskByUuid.get(linkedUuid);
        if (!task) continue;

        const nextTitle = task.description.trim() || row.title;
        const nextProject = normalizeProject(task.project) ?? null;
        const nextTags = normalizeTags(task.tags);
        const nextTagsJson = JSON.stringify(nextTags);
        const nextDescription = (catalog.descriptions[linkedUuid] ?? "").trim();

        const children = childrenByParent.get(linkedUuid) ?? [];
        const subtaskPlans = parseJson<Record<string, "A" | "B">>(
          row.subtask_plans_json,
          {},
        );

        let nextMode: HabitCompletionMode = row.completion_mode;
        let nextPlansJson = row.plans_json;
        if (row.kind === "negative") {
          nextMode = "simple";
          nextPlansJson = JSON.stringify(normalizePlans(undefined, false));
        } else {
          const derived = buildPlansFromSubtasks(
            children,
            Boolean(row.ab_enabled),
            subtaskPlans,
          );
          nextMode = derived.completionMode;
          nextPlansJson = JSON.stringify(derived.plans);
        }

        const metaChanged =
          row.task_uuid !== linkedUuid ||
          nextTitle !== row.title ||
          nextProject !== row.project ||
          nextTagsJson !== row.tags_json ||
          nextDescription !== row.description;
        const checklistChanged =
          nextMode !== row.completion_mode || nextPlansJson !== row.plans_json;

        if (!metaChanged && !checklistChanged) continue;

        db.prepare(
          `UPDATE habits
           SET task_uuid = ?, title = ?, description = ?, project = ?, tags_json = ?,
               completion_mode = ?, plans_json = ?, updated_at_ms = ?
           WHERE id = ?`,
        ).run(
          linkedUuid,
          nextTitle,
          nextDescription,
          nextProject,
          nextTagsJson,
          nextMode,
          nextPlansJson,
          nowMs,
          row.id,
        );

        if (checklistChanged) {
          const revs = (
            db
              .prepare(
                "SELECT * FROM habit_revisions WHERE habit_id = ? ORDER BY effective_from_date ASC, created_at_ms ASC",
              )
              .all(row.id) as HabitRevisionRow[]
          ).map(rowToRevision);
          const activeRev = resolveRevisionForDate(revs, todayDate);
          if (activeRev) {
            upsertRevisionTx({
              habitId: row.id,
              effectiveFromDate: todayDate,
              status: activeRev.status,
              completionMode: nextMode,
              abEnabled: Boolean(row.ab_enabled),
              schedule: activeRev.schedule,
              plans: parseJson<HabitPlan[]>(nextPlansJson, []),
              nowMs,
            });
          }
        }
      }
    });
  }

  function updateHabit(
    habitId: string,
    patch: UpdateHabitInput,
  ): HabitListItem {
    const todayDate = currentTodayDate();
    const tomorrowDate = addLocalDays(todayDate, 1);

    runTx(() => {
      const bundle = loadHabitBundle(habitId);
      const current = bundle.habit;

      const nextTitle =
        patch.title !== undefined ? patch.title.trim() : current.title;
      if (!nextTitle || nextTitle.length > 120) {
        throw new HabitStoreError(
          400,
          "INVALID_TITLE",
          "习惯名称需为 1 到 120 个字符。",
        );
      }

      const nextDescription =
        patch.description !== undefined
          ? patch.description.trim()
          : current.description;
      const nextProject =
        patch.project === undefined
          ? current.project
          : normalizeProject(patch.project);
      const nextTags =
        patch.tags !== undefined ? normalizeTags(patch.tags) : current.tags;

      const nextCompletionMode: HabitCompletionMode =
        current.kind === "negative"
          ? "simple"
          : patch.completionMode !== undefined
            ? patch.completionMode
            : current.completionMode;

      const nextTrackTime =
        current.kind === "positive"
          ? patch.trackTime !== undefined
            ? Boolean(patch.trackTime)
            : Boolean(current.trackTime)
          : false;
      const nextAbEnabled =
        current.kind === "positive"
          ? patch.abEnabled !== undefined
            ? Boolean(patch.abEnabled)
            : current.abEnabled
          : false;
      const nextSubtaskPlans =
        patch.subtaskPlans !== undefined
          ? patch.subtaskPlans
          : (current.subtaskPlans ?? {});

      let nextSchedule = current.schedule;
      if (patch.schedule !== undefined) {
        try {
          nextSchedule = normalizeSchedule(patch.schedule, todayDate);
        } catch (error) {
          throw new HabitStoreError(
            400,
            "INVALID_SCHEDULE",
            (error as Error).message,
          );
        }
      }

      const nextPlans =
        nextCompletionMode === "checklist"
          ? normalizePlans(patch.plans ?? current.plans, nextAbEnabled)
          : normalizePlans(undefined, false);

      if (
        nextCompletionMode === "checklist" &&
        nextPlans.every((p) => p.items.length === 0)
      ) {
        throw new HabitStoreError(
          400,
          "EMPTY_CHECKLIST",
          "动作清单模式至少需要添加一个动作。",
        );
      }

      const scheduleOrPlanChanged =
        nextCompletionMode !== current.completionMode ||
        nextAbEnabled !== current.abEnabled ||
        JSON.stringify(nextSubtaskPlans) !==
          JSON.stringify(current.subtaskPlans ?? {}) ||
        JSON.stringify(nextSchedule) !== JSON.stringify(current.schedule) ||
        JSON.stringify(nextPlans) !== JSON.stringify(current.plans);

      const nowMs = nowFn();
      db.prepare(
        `UPDATE habits
         SET title = ?, description = ?, project = ?, tags_json = ?,
             completion_mode = ?, track_time = ?, ab_enabled = ?, subtask_plans_json = ?, schedule_json = ?, plans_json = ?,
             updated_at_ms = ?
         WHERE id = ?`,
      ).run(
        nextTitle,
        nextDescription,
        nextProject ?? null,
        JSON.stringify(nextTags),
        nextCompletionMode,
        nextTrackTime ? 1 : 0,
        nextAbEnabled ? 1 : 0,
        JSON.stringify(nextSubtaskPlans),
        JSON.stringify(nextSchedule),
        JSON.stringify(nextPlans),
        nowMs,
        current.id,
      );

      if (scheduleOrPlanChanged) {
        const hasTodayInteraction =
          bundle.logsByDate.has(todayDate) ||
          (bundle.eventsByDate.get(todayDate)?.length ?? 0) > 0;
        let effectiveFrom = patch.effectiveFromDate
          ? requireValidDate(patch.effectiveFromDate)
          : hasTodayInteraction
            ? tomorrowDate
            : todayDate;
        if (effectiveFrom < todayDate) {
          effectiveFrom = todayDate;
        }
        upsertRevisionTx({
          habitId: current.id,
          effectiveFromDate: effectiveFrom,
          status: current.status,
          completionMode: nextCompletionMode,
          abEnabled: nextAbEnabled,
          schedule: nextSchedule,
          plans: nextPlans,
          nowMs,
        });
      }
    });

    return buildListItem(loadHabitBundle(habitId), todayDate);
  }

  function setHabitStatus(habitId: string, status: HabitStatus): HabitListItem {
    if (status !== "active" && status !== "paused" && status !== "archived") {
      throw new HabitStoreError(400, "INVALID_STATUS", "无效的习惯状态。");
    }
    const todayDate = currentTodayDate();
    const nowMs = nowFn();

    runTx(() => {
      const habit = requireHabit(habitId);
      db.prepare(
        "UPDATE habits SET status = ?, updated_at_ms = ? WHERE id = ?",
      ).run(status, nowMs, habit.id);
      upsertRevisionTx({
        habitId: habit.id,
        effectiveFromDate: todayDate,
        status,
        completionMode: habit.completionMode,
        abEnabled: habit.abEnabled,
        schedule: habit.schedule,
        plans: habit.plans,
        nowMs,
      });
    });

    return buildListItem(loadHabitBundle(habitId), todayDate);
  }

  function deleteHabit(habitId: string): { ok: true } {
    runTx(() => {
      const habit = requireHabit(habitId);
      db.prepare("DELETE FROM habits WHERE id = ?").run(habit.id);
    });
    return { ok: true };
  }

  function ensureDateNotFuture(date: string, todayDate: string) {
    requireValidDate(date);
    if (date > todayDate) {
      throw new HabitStoreError(
        400,
        "FUTURE_DATE",
        "不能为未来日期记录习惯状态。",
      );
    }
  }

  function togglePositiveHabit(
    habitId: string,
    dateInput?: string,
    completedInput?: boolean,
  ) {
    const todayDate = currentTodayDate();
    const date = ensureDateNotFutureOrDefault(dateInput, todayDate);
    const nowMs = nowFn();

    runTx(() => {
      const bundle = loadHabitBundle(habitId);
      if (bundle.habit.kind !== "positive") {
        throw new HabitStoreError(
          400,
          "INVALID_HABIT_KIND",
          "反向习惯请使用「记一次」操作。",
        );
      }
      const revision =
        resolveRevisionForDate(bundle.revisions, date) ??
        resolveRevisionForDate(bundle.revisions, todayDate);
      const mode = revision?.completionMode ?? bundle.habit.completionMode;
      if (mode === "checklist") {
        throw new HabitStoreError(
          400,
          "CHECKLIST_HABIT_REQUIRES_ITEMS",
          "动作清单型习惯请逐项勾选动作完成。",
        );
      }

      const existing = bundle.logsByDate.get(date);
      const nextCompleted =
        completedInput !== undefined
          ? Boolean(completedInput)
          : !Boolean(existing?.completed);

      if (existing) {
        db.prepare(
          `UPDATE habit_daily_logs
           SET completed = ?, completed_at_ms = ?, updated_at_ms = ?
           WHERE id = ?`,
        ).run(
          nextCompleted ? 1 : 0,
          nextCompleted ? nowMs : null,
          nowMs,
          existing.id,
        );
      } else {
        db.prepare(
          `INSERT INTO habit_daily_logs
           (id, habit_id, date, completed, completed_at_ms, note, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
        ).run(
          randomUUID(),
          habitId,
          date,
          nextCompleted ? 1 : 0,
          nextCompleted ? nowMs : null,
          nowMs,
          nowMs,
        );
      }
    });

    const updated = loadHabitBundle(habitId);
    return evaluateHabitOnDate({ ...updated, date, todayDate });
  }

  function ensureDateNotFutureOrDefault(
    dateInput: string | undefined,
    todayDate: string,
  ): string {
    const date = dateInput || todayDate;
    ensureDateNotFuture(date, todayDate);
    return date;
  }

  function setChecklistItem(params: {
    habitId: string;
    date?: string;
    itemId: string;
    done?: boolean;
    sets?: string | null;
    reps?: string | null;
    weight?: string | null;
    planId?: string;
  }) {
    const todayDate = currentTodayDate();
    const date = ensureDateNotFutureOrDefault(params.date, todayDate);
    const nowMs = nowFn();

    runTx(() => {
      const bundle = loadHabitBundle(params.habitId);
      if (bundle.habit.kind !== "positive") {
        throw new HabitStoreError(
          400,
          "INVALID_HABIT_KIND",
          "只有正向习惯支持动作清单。",
        );
      }
      const revision = resolveRevisionForDate(bundle.revisions, date);
      if (!revision || revision.completionMode !== "checklist") {
        throw new HabitStoreError(
          400,
          "NOT_CHECKLIST_HABIT",
          "该习惯在选定日期不是动作清单模式。",
        );
      }

      const existing = bundle.logsByDate.get(date);
      const resolvedPlan =
        (params.planId
          ? revision.plans.find((p) => p.id === params.planId)
          : undefined) ?? resolvePlanForDate(revision, date, bundle.logsByDate);

      const snapshot = existing?.checklistSnapshot ?? resolvedPlan?.items ?? [];
      if (!snapshot.some((item) => item.id === params.itemId)) {
        throw new HabitStoreError(
          404,
          "CHECKLIST_ITEM_NOT_FOUND",
          "动作项不存在。",
        );
      }

      const progress: Record<string, HabitChecklistEntryProgress> = {
        ...(existing?.checklistProgress ?? {}),
      };
      const prevEntry = progress[params.itemId] ?? { done: false };
      const nextEntry: HabitChecklistEntryProgress = {
        ...prevEntry,
        done: params.done !== undefined ? Boolean(params.done) : prevEntry.done,
      };
      if (params.sets !== undefined) {
        const val = sanitizeMetric(params.sets);
        if (val) nextEntry.sets = val;
        else delete nextEntry.sets;
      }
      if (params.reps !== undefined) {
        const val = sanitizeMetric(params.reps);
        if (val) nextEntry.reps = val;
        else delete nextEntry.reps;
      }
      if (params.weight !== undefined) {
        const val = sanitizeMetric(params.weight);
        if (val) nextEntry.weight = val;
        else delete nextEntry.weight;
      }
      progress[params.itemId] = nextEntry;

      const check = isChecklistCompleted(snapshot, progress, false);
      const planId = existing?.planId ?? resolvedPlan?.id;

      if (existing) {
        db.prepare(
          `UPDATE habit_daily_logs
           SET completed = ?, completed_at_ms = ?, plan_id = ?,
               checklist_snapshot_json = ?, checklist_progress_json = ?, updated_at_ms = ?
           WHERE id = ?`,
        ).run(
          check.completed ? 1 : 0,
          check.completed ? (existing.completedAtMs ?? nowMs) : null,
          planId ?? null,
          JSON.stringify(snapshot),
          JSON.stringify(progress),
          nowMs,
          existing.id,
        );
      } else {
        db.prepare(
          `INSERT INTO habit_daily_logs
           (id, habit_id, date, completed, completed_at_ms, plan_id, checklist_snapshot_json, checklist_progress_json, note, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
        ).run(
          randomUUID(),
          params.habitId,
          date,
          check.completed ? 1 : 0,
          check.completed ? nowMs : null,
          planId ?? null,
          JSON.stringify(snapshot),
          JSON.stringify(progress),
          nowMs,
          nowMs,
        );
      }
    });

    const updated = loadHabitBundle(params.habitId);
    return evaluateHabitOnDate({ ...updated, date, todayDate });
  }

  function switchDayPlan(
    habitId: string,
    dateInput: string | undefined,
    planId: string,
  ) {
    const todayDate = currentTodayDate();
    const date = ensureDateNotFutureOrDefault(dateInput, todayDate);
    const nowMs = nowFn();

    runTx(() => {
      const bundle = loadHabitBundle(habitId);
      const revision = resolveRevisionForDate(bundle.revisions, date);
      if (!revision || revision.completionMode !== "checklist") {
        throw new HabitStoreError(
          400,
          "NOT_CHECKLIST_HABIT",
          "只有训练清单习惯支持切换方案。",
        );
      }
      const targetPlan = revision.plans.find((p) => p.id === planId);
      if (!targetPlan) {
        throw new HabitStoreError(404, "PLAN_NOT_FOUND", "训练方案不存在。");
      }

      const existing = bundle.logsByDate.get(date);
      if (existing) {
        db.prepare(
          `UPDATE habit_daily_logs
           SET completed = 0, completed_at_ms = NULL, plan_id = ?,
               checklist_snapshot_json = ?, checklist_progress_json = '{}', updated_at_ms = ?
           WHERE id = ?`,
        ).run(
          targetPlan.id,
          JSON.stringify(targetPlan.items),
          nowMs,
          existing.id,
        );
      } else {
        db.prepare(
          `INSERT INTO habit_daily_logs
           (id, habit_id, date, completed, completed_at_ms, plan_id, checklist_snapshot_json, checklist_progress_json, note, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, 0, NULL, ?, ?, '{}', '', ?, ?)`,
        ).run(
          randomUUID(),
          habitId,
          date,
          targetPlan.id,
          JSON.stringify(targetPlan.items),
          nowMs,
          nowMs,
        );
      }
    });

    const updated = loadHabitBundle(habitId);
    return evaluateHabitOnDate({ ...updated, date, todayDate });
  }

  function recordNegativeEvent(params: {
    habitId: string;
    date?: string;
    note?: string;
    occurredAtMs?: number;
  }) {
    const todayDate = currentTodayDate();
    const date = ensureDateNotFutureOrDefault(params.date, todayDate);
    const nowMs = nowFn();
    const occurredAtMs =
      typeof params.occurredAtMs === "number" &&
      Number.isFinite(params.occurredAtMs)
        ? params.occurredAtMs
        : nowMs;
    const note =
      typeof params.note === "string" ? params.note.trim().slice(0, 500) : "";

    let createdEventId = "";
    runTx(() => {
      const habit = requireHabit(params.habitId);
      if (habit.kind !== "negative") {
        throw new HabitStoreError(
          400,
          "INVALID_HABIT_KIND",
          "只有反向习惯支持「记一次」操作。",
        );
      }
      createdEventId = randomUUID();
      db.prepare(
        `INSERT INTO habit_negative_events
         (id, habit_id, date, occurred_at_ms, note, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(createdEventId, params.habitId, date, occurredAtMs, note, nowMs);
    });

    const updated = loadHabitBundle(params.habitId);
    return {
      eventId: createdEventId,
      evaluation: evaluateHabitOnDate({ ...updated, date, todayDate }),
    };
  }

  function undoNegativeEvent(
    habitId: string,
    dateInput?: string,
    eventId?: string,
  ) {
    const todayDate = currentTodayDate();
    const date = ensureDateNotFutureOrDefault(dateInput, todayDate);

    runTx(() => {
      const habit = requireHabit(habitId);
      if (habit.kind !== "negative") {
        throw new HabitStoreError(
          400,
          "INVALID_HABIT_KIND",
          "只有反向习惯支持撤销发生记录。",
        );
      }

      if (eventId) {
        const res = db
          .prepare(
            "DELETE FROM habit_negative_events WHERE id = ? AND habit_id = ? AND date = ?",
          )
          .run(eventId, habitId, date);
        if (res.changes === 0) {
          throw new HabitStoreError(
            404,
            "EVENT_NOT_FOUND",
            "未找到要撤销的发生记录。",
          );
        }
      } else {
        const latest = db
          .prepare(
            `SELECT id FROM habit_negative_events
             WHERE habit_id = ? AND date = ?
             ORDER BY occurred_at_ms DESC, created_at_ms DESC
             LIMIT 1`,
          )
          .get(habitId, date) as { id: string } | undefined;
        if (!latest) {
          throw new HabitStoreError(
            404,
            "EVENT_NOT_FOUND",
            "当日没有可撤销的发生记录。",
          );
        }
        db.prepare("DELETE FROM habit_negative_events WHERE id = ?").run(
          latest.id,
        );
      }
    });

    const updated = loadHabitBundle(habitId);
    return evaluateHabitOnDate({ ...updated, date, todayDate });
  }

  function updateNegativeEventNote(
    habitId: string,
    eventId: string,
    noteInput: string,
  ) {
    const todayDate = currentTodayDate();
    const note = noteInput.trim().slice(0, 500);
    let eventDate = todayDate;

    runTx(() => {
      requireHabit(habitId);
      const row = db
        .prepare(
          "SELECT date FROM habit_negative_events WHERE id = ? AND habit_id = ?",
        )
        .get(eventId, habitId) as { date: string } | undefined;
      if (!row) {
        throw new HabitStoreError(404, "EVENT_NOT_FOUND", "发生记录不存在。");
      }
      eventDate = row.date;
      db.prepare("UPDATE habit_negative_events SET note = ? WHERE id = ?").run(
        note,
        eventId,
      );
    });

    const updated = loadHabitBundle(habitId);
    return evaluateHabitOnDate({ ...updated, date: eventDate, todayDate });
  }

  function setDailyNote(
    habitId: string,
    dateInput: string | undefined,
    noteInput: string,
  ) {
    const todayDate = currentTodayDate();
    const date = ensureDateNotFutureOrDefault(dateInput, todayDate);
    const note = noteInput.trim().slice(0, 2000);
    const nowMs = nowFn();

    runTx(() => {
      requireHabit(habitId);
      const existing = db
        .prepare(
          "SELECT id FROM habit_daily_logs WHERE habit_id = ? AND date = ?",
        )
        .get(habitId, date) as { id: string } | undefined;
      if (existing) {
        db.prepare(
          "UPDATE habit_daily_logs SET note = ?, updated_at_ms = ? WHERE id = ?",
        ).run(note, nowMs, existing.id);
      } else {
        db.prepare(
          `INSERT INTO habit_daily_logs
           (id, habit_id, date, completed, completed_at_ms, note, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, 0, NULL, ?, ?, ?)`,
        ).run(randomUUID(), habitId, date, note, nowMs, nowMs);
      }
    });

    const updated = loadHabitBundle(habitId);
    return evaluateHabitOnDate({ ...updated, date, todayDate });
  }

  function getHeatmap(
    options: {
      startDate?: string;
      endDate?: string;
      days?: number;
      project?: string;
      tag?: string;
      habitId?: string;
    } = {},
  ): HeatmapResponse {
    const todayDate = currentTodayDate();
    const endDate = options.endDate
      ? requireValidDate(options.endDate)
      : todayDate;
    const days =
      typeof options.days === "number" &&
      options.days > 0 &&
      options.days <= 370
        ? Math.floor(options.days)
        : 365;
    const startDate = options.startDate
      ? requireValidDate(options.startDate)
      : addLocalDays(endDate, -(days - 1));

    const bundles = loadAllBundles();
    return computeHeatmap({
      habits: bundles,
      startDate,
      endDate,
      todayDate,
      filters: {
        project: options.project,
        tag: options.tag,
        habitId: options.habitId,
      },
    });
  }

  function getDayDetail(
    dateInput?: string,
    filters: { project?: string; tag?: string; habitId?: string } = {},
  ): DayDetailResponse {
    const todayDate = currentTodayDate();
    const date = dateInput ? requireValidDate(dateInput) : todayDate;
    const bundles = loadAllBundles();
    const matching = bundles.filter((b) =>
      habitMatchesFilter(b.habit, filters),
    );

    const items: DayDetailItem[] = [];
    let scheduledCount = 0;
    let achievedCount = 0;

    for (const bundle of matching) {
      const evaluation = evaluateHabitOnDate({
        ...bundle,
        date,
        todayDate,
      });
      if (!evaluation.scheduled && !evaluation.hasLog) continue;
      if (evaluation.scheduled) {
        scheduledCount += 1;
        if (evaluation.achieved) achievedCount += 1;
      }
      const revision = resolveRevisionForDate(bundle.revisions, date);
      items.push({
        habit: bundle.habit,
        evaluation,
        availablePlans: revision?.plans ?? bundle.habit.plans,
      });
    }

    return {
      date,
      todayDate,
      isToday: date === todayDate,
      isFuture: date > todayDate,
      scheduledCount,
      achievedCount,
      items,
    };
  }

  function getHabitDetail(
    habitId: string,
    rangeDays = 365,
  ): HabitDetailResponse {
    const todayDate = currentTodayDate();
    const bundle = loadHabitBundle(habitId);
    const streak = computeHabitStreak({ ...bundle, todayDate });
    const startDate = addLocalDays(
      todayDate,
      -(Math.min(365, Math.max(30, rangeDays)) - 1),
    );
    const heatmap = computeHeatmap({
      habits: [bundle],
      startDate,
      endDate: todayDate,
      todayDate,
      filters: { habitId },
    });

    const recentDays: DayDetailItem[] = [];
    const recentStart = addLocalDays(todayDate, -29);
    for (let d = todayDate; d >= recentStart; d = addLocalDays(d, -1)) {
      const evaluation = evaluateHabitOnDate({
        ...bundle,
        date: d,
        todayDate,
      });
      if (!evaluation.scheduled && !evaluation.hasLog) continue;
      const revision = resolveRevisionForDate(bundle.revisions, d);
      recentDays.push({
        habit: bundle.habit,
        evaluation,
        availablePlans: revision?.plans ?? bundle.habit.plans,
      });
    }

    return {
      habit: bundle.habit,
      streak,
      heatmap,
      recentDays,
      revisions: bundle.revisions,
    };
  }

  function exportBackup(): HabitBackupPayload {
    const habits = (
      db
        .prepare(
          "SELECT * FROM habits ORDER BY sort_order ASC, created_at_ms ASC",
        )
        .all() as HabitRow[]
    ).map(rowToHabit);
    const revisions = (
      db
        .prepare(
          "SELECT * FROM habit_revisions ORDER BY effective_from_date ASC, created_at_ms ASC",
        )
        .all() as HabitRevisionRow[]
    ).map(rowToRevision);
    const dailyLogs = (
      db.prepare("SELECT * FROM habit_daily_logs").all() as HabitDailyLogRow[]
    ).map(rowToDailyLog);
    const negativeEvents = (
      db
        .prepare(
          "SELECT * FROM habit_negative_events ORDER BY occurred_at_ms ASC",
        )
        .all() as HabitNegativeEventRow[]
    ).map(rowToNegativeEvent);

    return {
      version: 1,
      habits,
      revisions,
      dailyLogs,
      negativeEvents,
    };
  }

  function restoreBackup(payload: HabitBackupPayload): void {
    runTx(() => {
      db.exec(`
        DELETE FROM habit_negative_events;
        DELETE FROM habit_daily_logs;
        DELETE FROM habit_revisions;
        DELETE FROM habits;
      `);

      const insertHabit = db.prepare(
        `INSERT INTO habits
         (id, task_uuid, title, kind, completion_mode, description, project, tags_json, status, track_time, ab_enabled, subtask_plans_json, schedule_json, plans_json, sort_order, created_date, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const h of payload.habits) {
        insertHabit.run(
          h.id,
          h.taskUuid ?? null,
          h.title,
          h.kind,
          h.completionMode,
          h.description,
          h.project ?? null,
          JSON.stringify(h.tags ?? []),
          h.status,
          h.kind === "positive" && h.trackTime ? 1 : 0,
          h.abEnabled ? 1 : 0,
          JSON.stringify(h.subtaskPlans ?? {}),
          JSON.stringify(h.schedule),
          JSON.stringify(h.plans ?? []),
          h.sortOrder ?? 0,
          h.createdDate,
          h.createdAtMs,
          h.updatedAtMs,
        );
      }

      const insertRev = db.prepare(
        `INSERT INTO habit_revisions
         (id, habit_id, effective_from_date, status, completion_mode, ab_enabled, schedule_json, plans_json, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of payload.revisions) {
        insertRev.run(
          r.id,
          r.habitId,
          r.effectiveFromDate,
          r.status,
          r.completionMode,
          r.abEnabled ? 1 : 0,
          JSON.stringify(r.schedule),
          JSON.stringify(r.plans ?? []),
          r.createdAtMs,
        );
      }

      const insertLog = db.prepare(
        `INSERT INTO habit_daily_logs
         (id, habit_id, date, completed, completed_at_ms, plan_id, checklist_snapshot_json, checklist_progress_json, note, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const l of payload.dailyLogs) {
        insertLog.run(
          l.id,
          l.habitId,
          l.date,
          l.completed ? 1 : 0,
          l.completedAtMs ?? null,
          l.planId ?? null,
          l.checklistSnapshot ? JSON.stringify(l.checklistSnapshot) : null,
          l.checklistProgress ? JSON.stringify(l.checklistProgress) : null,
          l.note ?? "",
          l.createdAtMs,
          l.updatedAtMs,
        );
      }

      const insertEvent = db.prepare(
        `INSERT INTO habit_negative_events
         (id, habit_id, date, occurred_at_ms, note, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const ev of payload.negativeEvents) {
        insertEvent.run(
          ev.id,
          ev.habitId,
          ev.date,
          ev.occurredAtMs,
          ev.note ?? "",
          ev.createdAtMs,
        );
      }
    });
  }

  function getHabitTaskUuids(): Set<string> {
    const rows = db
      .prepare("SELECT task_uuid FROM habits WHERE task_uuid IS NOT NULL")
      .all() as Array<{ task_uuid: string }>;
    return new Set(rows.map((r) => r.task_uuid));
  }

  function close(): void {
    db.close();
  }

  return {
    dbPath,
    todayDate: currentTodayDate,
    getTimezone: currentTimezone,
    getHabitTaskUuids,
    listHabits,
    getTodayHabits,
    getHabitDetail,
    createHabit,
    bindTaskHabit,
    unbindTaskHabit,
    deleteHabitIfExists,
    syncFromTaskCatalog,
    updateHabit,
    setHabitStatus,
    deleteHabit,
    togglePositiveHabit,
    setChecklistItem,
    switchDayPlan,
    recordNegativeEvent,
    undoNegativeEvent,
    updateNegativeEventNote,
    setDailyNote,
    getHeatmap,
    getDayDetail,
    exportBackup,
    restoreBackup,
    close,
  };
}

export type HabitStore = ReturnType<typeof createHabitStore>;
