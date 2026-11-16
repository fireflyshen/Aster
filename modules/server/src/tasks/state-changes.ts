import {
  dependsArguments,
  requireUuid,
  stateArguments,
  type StateModifyInput,
  type TaskInput,
} from "../../../core/tasks/arguments.ts";
import {
  compareTasksByUrgency,
  parseTaskwarriorDate,
  type TaskwarriorTask,
} from "../../../core/tasks/model.ts";
import { formatTaskwarriorTimestamp } from "../../../core/tasks/service-runner.ts";
import type { TaskService } from "../../../core/tasks/service.ts";
import {
  allowedStateTargets,
  canTransition,
  DOING_LIMIT,
  isHabitTask,
  isValidTaskState,
  PARK_DAYS,
  TaskStateError,
  type EffectiveTaskState,
  type TaskState,
} from "../../../core/tasks/state.ts";
import {
  addLocalDays,
  localDateOf,
  zonedDateTimeToUtcMs,
} from "../../../core/time/zone.ts";
import type { Organization } from "../../../core/workspace/organization.ts";
import type { HabitStore } from "../habits/habit-store.ts";
import type { createOrganizationService } from "../organization/organization-service.ts";
import type {
  StateHistoryEntry,
  StateHistorySource,
  StateHistoryStore,
} from "./state-history.ts";

export interface StateActionMeta {
  source?: StateHistorySource;
  actor?: string;
}

export interface SetStateInput {
  uuid: string;
  state: unknown;
  waitReason?: unknown;
  checkDate?: unknown;
  scheduled?: unknown;
  replaceUuid?: unknown;
  idempotencyKey?: string;
  reason?: string;
}

export interface StateSummaryTaskItem {
  uuid: string;
  description: string;
  project?: string;
  due?: string;
  scheduled?: string;
  wait?: string;
  waitReason?: string;
  priority?: string;
  urgency: number;
  start?: string;
  depends: string[];
  blocked: boolean;
}

export interface StateAnomalyItem {
  uuid: string;
  description: string;
  project?: string;
  type: "missing_state" | "doing_over_limit";
  detail: string;
}

export interface StateSummaryResponse {
  limit: number;
  doing: StateSummaryTaskItem[];
  counts: Record<TaskState, number>;
  upcoming: Array<{ uuid: string; description: string; scheduled: string }>;
  waitingDue: StateSummaryTaskItem[];
  parkedReviewDue: StateSummaryTaskItem[];
  promotionBlocked: StateSummaryTaskItem[];
  anomalies: StateAnomalyItem[];
}

function defaultTimezone(getTimezone?: () => string): string {
  return (
    getTimezone?.() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "Asia/Shanghai"
  );
}

/** Normalizes ISO-8601, compact UTC, or YYYY-MM-DD into Taskwarrior compact UTC. */
export function normalizeTaskStateDate(
  raw: unknown,
  timeZone: string,
): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    throw new TaskStateError(400, "STATE_INVALID_DATE", "Choose a valid date.");
  }
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    try {
      const utcMs = zonedDateTimeToUtcMs(trimmed, "00:00:00", timeZone);
      return formatTaskwarriorTimestamp(new Date(utcMs));
    } catch {
      throw new TaskStateError(
        400,
        "STATE_INVALID_DATE",
        "Choose a valid date.",
      );
    }
  }
  const parsed = parseTaskwarriorDate(trimmed);
  if (!parsed) {
    throw new TaskStateError(400, "STATE_INVALID_DATE", "Choose a valid date.");
  }
  return formatTaskwarriorTimestamp(parsed);
}

/** Computes default parked review date (+30 days in server timezone). */
export function defaultParkedWaitDate(nowMs: number, timeZone: string): string {
  const todayStr = localDateOf(nowMs, timeZone);
  const reviewDay = addLocalDays(todayStr, PARK_DAYS);
  const utcMs = zonedDateTimeToUtcMs(reviewDay, "00:00:00", timeZone);
  return formatTaskwarriorTimestamp(new Date(utcMs));
}

function validateWaitReason(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new TaskStateError(
      400,
      "STATE_WAIT_REASON_REQUIRED",
      "等待中必须填写原因（1–200 字）。",
    );
  }
  if (/[\0\r\n]/.test(raw)) {
    throw new TaskStateError(
      400,
      "STATE_WAIT_REASON_REQUIRED",
      "等待原因不能包含换行。",
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new TaskStateError(
      400,
      "STATE_WAIT_REASON_REQUIRED",
      "等待中必须填写原因（1–200 字）。",
    );
  }
  if (trimmed.length > 200) {
    throw new TaskStateError(
      400,
      "STATE_WAIT_REASON_REQUIRED",
      "等待原因不能超过 200 个字符。",
    );
  }
  return trimmed;
}

function collectDescendantUuids(
  rootUuid: string,
  subtasks: Record<string, string> | undefined,
): string[] {
  if (!subtasks) return [];
  const childrenByParent = new Map<string, string[]>();
  for (const [child, parent] of Object.entries(subtasks)) {
    const list = childrenByParent.get(parent) ?? [];
    list.push(child);
    childrenByParent.set(parent, list);
  }
  const result: string[] = [];
  const visited = new Set<string>([rootUuid]);
  const stack = [...(childrenByParent.get(rootUuid) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    for (const child of childrenByParent.get(current) ?? []) {
      stack.push(child);
    }
  }
  return result;
}

function findRootAncestorUuid(
  uuid: string,
  subtasks: Record<string, string> | undefined,
): string {
  if (!subtasks) return uuid;
  let current = uuid;
  const visited = new Set<string>([uuid]);
  while (subtasks[current] && !visited.has(subtasks[current])) {
    current = subtasks[current];
    visited.add(current);
  }
  return current;
}

function isTaskOpen(task: TaskwarriorTask): boolean {
  return task.status === "pending" || task.status === "waiting";
}

function hasUnresolvedDepends(
  task: TaskwarriorTask,
  openTaskUuids: ReadonlySet<string>,
): boolean {
  return task.depends.some((dep) => openTaskUuids.has(dep));
}

function toSummaryItem(
  task: TaskwarriorTask,
  openTaskUuids: ReadonlySet<string>,
): StateSummaryTaskItem {
  return {
    uuid: task.uuid,
    description: task.description,
    ...(task.project ? { project: task.project } : {}),
    ...(task.due ? { due: task.due.toISOString() } : {}),
    ...(task.scheduled ? { scheduled: task.scheduled.toISOString() } : {}),
    ...(task.wait ? { wait: task.wait.toISOString() } : {}),
    ...(task.waitReason ? { waitReason: task.waitReason } : {}),
    ...(task.priority ? { priority: task.priority } : {}),
    urgency: task.urgency,
    ...(task.start ? { start: task.start.toISOString() } : {}),
    depends: [...task.depends],
    blocked: hasUnresolvedDepends(task, openTaskUuids),
  };
}

function wouldCreateCycle(
  startUuid: string,
  candidateDepends: string[],
  taskByUuid: ReadonlyMap<string, TaskwarriorTask>,
): boolean {
  const visited = new Set<string>();
  const stack = [...candidateDepends];
  while (stack.length > 0) {
    const dep = stack.pop()!;
    if (dep === startUuid) return true;
    if (visited.has(dep)) continue;
    visited.add(dep);
    const depTask = taskByUuid.get(dep);
    if (depTask) {
      for (const next of depTask.depends) stack.push(next);
    }
  }
  return false;
}

/** Coordinates Taskwarrior state machine mutations, limit enforcement, subtask cascade, and history. */
export function createTaskStateManager(deps: {
  service: TaskService;
  organization: ReturnType<typeof createOrganizationService>;
  history: StateHistoryStore;
  habitStore?: HabitStore;
  getTimezone?: () => string;
  now?: () => number;
}) {
  const { service, organization, history, habitStore, getTimezone } = deps;
  const nowFn = deps.now ?? (() => Date.now());
  const idempotencyCache = new Map<string, { ok: true; state: TaskState }>();
  const dailyAutoPromoted = new Set<string>();
  let dailyPromoDay = "";

  function cacheResult(
    key: string | undefined,
    value: { ok: true; state: TaskState },
  ) {
    if (!key) return;
    if (idempotencyCache.size >= 200) {
      const oldest = idempotencyCache.keys().next().value;
      if (oldest) idempotencyCache.delete(oldest);
    }
    idempotencyCache.set(key, value);
  }

  function habitUuidsSet(): Set<string> {
    return habitStore?.getHabitTaskUuids() ?? new Set<string>();
  }

  async function writeWithCascadeUnlocked(
    uuid: string,
    values: StateModifyInput,
    org: Organization,
    taskMap: ReadonlyMap<string, TaskwarriorTask>,
  ): Promise<void> {
    await service.writeUnlocked(stateArguments(uuid, values));
    const descendants = collectDescendantUuids(uuid, org.subtasks);
    for (const childUuid of descendants) {
      const child = taskMap.get(childUuid);
      if (child && isTaskOpen(child)) {
        await service.writeUnlocked(
          stateArguments(childUuid, {
            ...(values.state !== undefined ? { state: values.state } : {}),
            ...(values.scheduled !== undefined
              ? { scheduled: values.scheduled }
              : {}),
            ...(values.wait !== undefined ? { wait: values.wait } : {}),
            ...(values.waitreason !== undefined
              ? { waitreason: values.waitreason }
              : {}),
          }),
        );
      }
    }
  }

  function buildTargetModifyArgs(
    targetState: TaskState,
    input: {
      waitReason?: unknown;
      checkDate?: unknown;
      scheduled?: unknown;
    },
    timeZone: string,
  ): {
    args: StateModifyInput;
    waitReason?: string;
    checkDate?: string;
  } {
    if (targetState === "doing") {
      return {
        args: {
          state: "doing",
          wait: "",
          waitreason: "",
        },
      };
    }
    if (targetState === "planned") {
      const scheduled = normalizeTaskStateDate(input.scheduled, timeZone);
      return {
        args: {
          state: "planned",
          wait: "",
          waitreason: "",
          ...(scheduled !== undefined ? { scheduled } : {}),
        },
      };
    }
    if (targetState === "waiting") {
      const waitReason = validateWaitReason(input.waitReason);
      const checkDate = normalizeTaskStateDate(input.checkDate, timeZone);
      if (!checkDate) {
        throw new TaskStateError(
          400,
          "STATE_CHECK_DATE_REQUIRED",
          "等待中必须填写核对日。",
        );
      }
      return {
        args: {
          state: "waiting",
          wait: checkDate,
          waitreason: waitReason,
        },
        waitReason,
        checkDate,
      };
    }
    const checkDate =
      normalizeTaskStateDate(input.checkDate, timeZone) ||
      defaultParkedWaitDate(nowFn(), timeZone);
    return {
      args: {
        state: "parked",
        wait: checkDate,
        waitreason: "",
      },
      checkDate,
    };
  }

  async function ensureTaskLoadedForError(uuid: string): Promise<never> {
    let existing: { status?: string } | undefined;
    try {
      existing = await service.rawTask(uuid);
    } catch {
      existing = undefined;
    }
    if (!existing) {
      throw new TaskStateError(404, "STATE_TASK_NOT_FOUND", "Task not found.");
    }
    throw new TaskStateError(
      409,
      "STATE_TASK_NOT_PENDING",
      `Task is ${existing.status}; only open tasks can change state.`,
    );
  }

  function topLevelDoingTasks(
    tasks: TaskwarriorTask[],
    org: Organization,
    habitUuids: ReadonlySet<string>,
    excludeUuid?: string,
  ): TaskwarriorTask[] {
    return tasks.filter(
      (task) =>
        isTaskOpen(task) &&
        task.uuid !== excludeUuid &&
        !org.subtasks?.[task.uuid] &&
        !isHabitTask(task, org, habitUuids) &&
        task.state === "doing",
    );
  }

  async function replaceDoingTaskUnlocked(
    replaceUuidRaw: unknown,
    tasks: TaskwarriorTask[],
    org: Organization,
    habitUuids: ReadonlySet<string>,
    taskMap: ReadonlyMap<string, TaskwarriorTask>,
    targetUuid: string,
    meta: StateActionMeta,
  ): Promise<void> {
    if (typeof replaceUuidRaw !== "string" || !replaceUuidRaw.trim()) {
      const doing = topLevelDoingTasks(tasks, org, habitUuids, targetUuid);
      throw new TaskStateError(
        409,
        "STATE_DOING_LIMIT",
        "处理中已满 5 条，请先放回一条",
        {
          limit: DOING_LIMIT,
          doing: doing.map((item) => ({
            uuid: item.uuid,
            description: item.description,
          })),
        },
      );
    }
    const replaceUuid = requireUuid(replaceUuidRaw.trim());
    const candidate = taskMap.get(replaceUuid);
    if (
      !candidate ||
      !isTaskOpen(candidate) ||
      replaceUuid === targetUuid ||
      org.subtasks?.[replaceUuid] ||
      isHabitTask(candidate, org, habitUuids) ||
      candidate.state !== "doing"
    ) {
      throw new TaskStateError(
        409,
        "STATE_REPLACE_INVALID",
        "所选替换任务已不在处理中，请刷新后重试。",
      );
    }
    await writeWithCascadeUnlocked(
      replaceUuid,
      { state: "planned", wait: "", waitreason: "" },
      org,
      taskMap,
    );
    await history.append({
      uuid: replaceUuid,
      from: "doing",
      to: "planned",
      source: meta.source || "web",
      actor: meta.actor,
      reason: `replaced by ${targetUuid}`,
    });
  }

  /** Executes a validated state transition (`state.set`). */
  async function setState(
    input: SetStateInput,
    meta: StateActionMeta = {},
  ): Promise<{ ok: true; state: TaskState }> {
    const uuid = requireUuid(input.uuid);
    if (input.idempotencyKey && idempotencyCache.has(input.idempotencyKey)) {
      return idempotencyCache.get(input.idempotencyKey)!;
    }
    if (!isValidTaskState(input.state)) {
      throw new TaskStateError(400, "STATE_INVALID", "请选择有效的任务状态。");
    }
    const to = input.state;
    const tz = defaultTimezone(getTimezone);

    const result = await service.withWriteLock(async () => {
      const [tasks, org] = await Promise.all([
        service.loadTasks("pending"),
        organization.snapshot(),
      ]);
      const habitUuids = habitUuidsSet();
      const taskMap = new Map(tasks.map((t) => [t.uuid, t]));
      const task = taskMap.get(uuid);
      if (!task || !isTaskOpen(task)) {
        await ensureTaskLoadedForError(uuid);
      }
      if (isHabitTask(task!, org, habitUuids)) {
        throw new TaskStateError(
          409,
          "STATE_HABIT_EXCLUDED",
          "习惯任务不参与状态机流转。",
        );
      }
      if (org.subtasks?.[uuid]) {
        throw new TaskStateError(
          409,
          "STATE_SUBTASK_FOLLOWS_PARENT",
          "子任务跟随父任务状态，请直接修改父任务状态。",
        );
      }
      const from: TaskState | null = task!.state ?? null;
      if (from === to) {
        return { ok: true as const, state: to };
      }
      if (from !== null && !canTransition(from, to)) {
        throw new TaskStateError(
          409,
          "STATE_TRANSITION_FORBIDDEN",
          `不能从「${from}」直接流转到「${to}」。`,
          { from, to, allowed: allowedStateTargets(from) },
        );
      }

      const built = buildTargetModifyArgs(to, input, tz);

      if (to === "doing") {
        const doing = topLevelDoingTasks(tasks, org, habitUuids, uuid);
        if (doing.length >= DOING_LIMIT) {
          await replaceDoingTaskUnlocked(
            input.replaceUuid,
            tasks,
            org,
            habitUuids,
            taskMap,
            uuid,
            meta,
          );
        }
      }

      await writeWithCascadeUnlocked(uuid, built.args, org, taskMap);
      await history.append({
        uuid,
        from,
        to,
        source: meta.source || "web",
        actor: meta.actor,
        reason: input.reason,
        waitReason: built.waitReason,
        checkDate: built.checkDate,
      });
      return { ok: true as const, state: to };
    });

    cacheResult(input.idempotencyKey, result);
    return result;
  }

  /** Updates only `scheduled` date on a planned top-level non-habit task and cascades to children. */
  async function scheduleTask(
    input: { uuid: string; scheduled: unknown },
    _meta: StateActionMeta = {},
  ): Promise<{ ok: true }> {
    const uuid = requireUuid(input.uuid);
    const tz = defaultTimezone(getTimezone);
    const scheduled = normalizeTaskStateDate(input.scheduled ?? "", tz) ?? "";

    await service.withWriteLock(async () => {
      const [tasks, org] = await Promise.all([
        service.loadTasks("pending"),
        organization.snapshot(),
      ]);
      const habitUuids = habitUuidsSet();
      const taskMap = new Map(tasks.map((t) => [t.uuid, t]));
      const task = taskMap.get(uuid);
      if (!task || !isTaskOpen(task)) {
        await ensureTaskLoadedForError(uuid);
      }
      if (isHabitTask(task!, org, habitUuids)) {
        throw new TaskStateError(
          409,
          "STATE_HABIT_EXCLUDED",
          "习惯任务不参与状态排期。",
        );
      }
      if (org.subtasks?.[uuid]) {
        throw new TaskStateError(
          409,
          "STATE_SUBTASK_FOLLOWS_PARENT",
          "子任务跟随父任务排期，请修改父任务。",
        );
      }
      if (task!.state && task!.state !== "planned") {
        throw new TaskStateError(
          409,
          "STATE_TRANSITION_FORBIDDEN",
          "仅「计划中」任务可以设置轮到日期。",
          { from: task!.state, to: "planned", allowed: ["planned"] },
        );
      }
      await writeWithCascadeUnlocked(uuid, { scheduled }, org, taskMap);
    });
    return { ok: true };
  }

  /** Adds and/or removes Taskwarrior UUID dependencies while rejecting cycles. */
  async function updateDepends(input: {
    uuid: string;
    add?: unknown;
    remove?: unknown;
  }): Promise<{ ok: true; depends: string[] }> {
    const uuid = requireUuid(input.uuid);
    const addList = Array.isArray(input.add)
      ? input.add.map((item) => requireUuid(String(item)))
      : [];
    const removeSet = new Set(
      Array.isArray(input.remove)
        ? input.remove.map((item) => requireUuid(String(item)))
        : [],
    );

    return service.withWriteLock(async () => {
      const tasks = await service.loadTasks("pending");
      const taskMap = new Map(tasks.map((t) => [t.uuid, t]));
      const task = taskMap.get(uuid);
      if (!task || !isTaskOpen(task)) {
        await ensureTaskLoadedForError(uuid);
      }
      for (const depUuid of addList) {
        if (depUuid === uuid) {
          throw new TaskStateError(
            400,
            "STATE_SELF_DEPENDENCY",
            "任务不能依赖自身。",
          );
        }
        if (!taskMap.has(depUuid)) {
          throw new TaskStateError(
            404,
            "STATE_DEPENDENCY_NOT_FOUND",
            "依赖的目标任务不存在或已完成。",
          );
        }
      }
      const next = [
        ...new Set([
          ...task!.depends.filter((dep) => !removeSet.has(dep)),
          ...addList,
        ]),
      ];
      if (wouldCreateCycle(uuid, next, taskMap)) {
        throw new TaskStateError(
          409,
          "STATE_DEPENDENCY_CYCLE",
          "检测到循环依赖，无法保存。",
        );
      }
      await service.writeUnlocked(dependsArguments(uuid, next));
      return { ok: true as const, depends: next };
    });
  }

  /** Prepares initial state fields before creating a task and enforces doing limit / habit exclusion. */
  async function prepareCreateFields(
    input: Record<string, unknown>,
    baseInput: TaskInput,
    meta: StateActionMeta = {},
  ): Promise<{
    taskInput: TaskInput;
    createdState: TaskState | null;
    waitReason?: string;
    checkDate?: string;
  }> {
    const org = await organization.snapshot();
    const tz = defaultTimezone(getTimezone);
    const parentUuid =
      typeof input.parentUuid === "string" && input.parentUuid
        ? requireUuid(input.parentUuid)
        : undefined;
    const isHabit =
      Boolean(baseInput.project) &&
      org.projects &&
      isHabitTask({ uuid: "", project: baseInput.project }, org, undefined);

    if (parentUuid) {
      const pending = await service.loadTasks("pending");
      const parent = pending.find((t) => t.uuid === parentUuid);
      if (input.state !== undefined) {
        throw new TaskStateError(
          409,
          "STATE_SUBTASK_FOLLOWS_PARENT",
          "子任务自动继承父任务状态，不能单独指定 state。",
        );
      }
      if (!parent || isHabit || isHabitTask(parent, org, habitUuidsSet())) {
        return { taskInput: baseInput, createdState: null };
      }
      const inheritedState = parent.state ?? "planned";
      return {
        taskInput: {
          ...baseInput,
          state: inheritedState,
          ...(parent.scheduled
            ? { scheduled: formatTaskwarriorTimestamp(parent.scheduled) }
            : {}),
          ...(parent.wait
            ? { wait: formatTaskwarriorTimestamp(parent.wait) }
            : {}),
          ...(parent.waitReason ? { waitreason: parent.waitReason } : {}),
          statechanged: "now",
        },
        createdState: null,
      };
    }

    if (isHabit) {
      if (input.state !== undefined && input.state !== "") {
        throw new TaskStateError(
          409,
          "STATE_HABIT_EXCLUDED",
          "习惯任务不进入状态机。",
        );
      }
      return { taskInput: baseInput, createdState: null };
    }

    const rawState = input.state === undefined ? "planned" : input.state;
    if (!isValidTaskState(rawState)) {
      throw new TaskStateError(400, "STATE_INVALID", "请选择有效的任务状态。");
    }
    const built = buildTargetModifyArgs(
      rawState,
      {
        waitReason: input.waitReason,
        checkDate: input.checkDate ?? input.wait,
        scheduled: input.scheduled,
      },
      tz,
    );

    if (rawState === "doing") {
      await service.withWriteLock(async () => {
        const tasks = await service.loadTasks("pending");
        const habitUuids = habitUuidsSet();
        const taskMap = new Map(tasks.map((t) => [t.uuid, t]));
        const doing = topLevelDoingTasks(tasks, org, habitUuids);
        if (doing.length >= DOING_LIMIT) {
          await replaceDoingTaskUnlocked(
            input.replaceUuid,
            tasks,
            org,
            habitUuids,
            taskMap,
            "new-task",
            meta,
          );
        }
      });
    }

    return {
      taskInput: {
        ...baseInput,
        ...built.args,
        statechanged: "now",
      },
      createdState: rawState,
      waitReason: built.waitReason,
      checkDate: built.checkDate,
    };
  }

  /** Logs initial history after `addTask` creates a state-managed top-level task. */
  async function recordTaskCreated(
    uuid: string,
    createdState: TaskState | null,
    meta: StateActionMeta = {},
    extra?: { waitReason?: string; checkDate?: string },
  ): Promise<void> {
    if (!createdState) return;
    await history.append({
      uuid,
      from: null,
      to: createdState,
      source: meta.source || "web",
      actor: meta.actor,
      reason: "created",
      waitReason: extra?.waitReason,
      checkDate: extra?.checkDate,
    });
  }

  /** Validates `complete` against state transitions and returns history logger to run after TW `done`. */
  async function prepareComplete(
    uuid: string,
    meta: StateActionMeta = {},
  ): Promise<() => Promise<void>> {
    const [tasks, org] = await Promise.all([
      service.loadTasks("pending"),
      organization.snapshot(),
    ]);
    const habitUuids = habitUuidsSet();
    const taskMap = new Map(tasks.map((t) => [t.uuid, t]));
    const task = taskMap.get(uuid);
    if (!task) {
      return async () => undefined;
    }
    const rootUuid = findRootAncestorUuid(uuid, org.subtasks);
    const rootTask = taskMap.get(rootUuid) ?? task;
    if (
      isHabitTask(task, org, habitUuids) ||
      isHabitTask(rootTask, org, habitUuids)
    ) {
      return async () => undefined;
    }
    const isChild = Boolean(org.subtasks?.[uuid]);
    const from: EffectiveTaskState | null =
      (isChild ? rootTask.state : task.state) ?? null;

    if (from && !canTransition(from, "completed")) {
      throw new TaskStateError(
        409,
        "STATE_TRANSITION_FORBIDDEN",
        from === "waiting" || from === "parked"
          ? "「等待中」或「长期搁置」的任务不能直接完成，请先移回「处理中」。"
          : `当前状态「${from}」不允许直接完成。`,
        { from, to: "completed", allowed: allowedStateTargets(from) },
      );
    }

    if (isChild) {
      return async () => undefined;
    }

    return async () => {
      if (from === "planned") {
        await history.append({
          uuid,
          from: "planned",
          to: "doing",
          source: meta.source || "web",
          actor: meta.actor,
          reason: "completed from planned",
        });
        await history.append({
          uuid,
          from: "doing",
          to: "completed",
          source: meta.source || "web",
          actor: meta.actor,
          reason: "completed",
        });
      } else {
        await history.append({
          uuid,
          from,
          to: "completed",
          source: meta.source || "web",
          actor: meta.actor,
          reason: "completed",
        });
      }
    };
  }

  /** Ensures `start` promotes `planned` -> `doing` (subject to 5-limit) and rejects `waiting`/`parked`. */
  async function ensureStartReady(
    uuid: string,
    meta: StateActionMeta = {},
  ): Promise<void> {
    const [tasks, org] = await Promise.all([
      service.loadTasks("pending"),
      organization.snapshot(),
    ]);
    const habitUuids = habitUuidsSet();
    const taskMap = new Map(tasks.map((t) => [t.uuid, t]));
    const task = taskMap.get(uuid);
    if (!task) return;
    const rootUuid = findRootAncestorUuid(uuid, org.subtasks);
    const rootTask = taskMap.get(rootUuid) ?? task;
    if (
      isHabitTask(task, org, habitUuids) ||
      isHabitTask(rootTask, org, habitUuids)
    ) {
      return;
    }
    const effective = rootTask.state ?? null;
    if (effective === "waiting" || effective === "parked") {
      throw new TaskStateError(
        409,
        "STATE_TRANSITION_FORBIDDEN",
        "「等待中」或「长期搁置」的任务不能直接开始计时，请先恢复或转入「处理中」。",
        {
          from: effective,
          to: "doing",
          allowed: allowedStateTargets(effective),
        },
      );
    }
    if (effective === "planned") {
      await setState(
        {
          uuid: rootTask.uuid,
          state: "doing",
          reason: "timer started",
        },
        meta,
      );
    }
  }

  /** After reopening a completed task, sets state back to `planned` for state-managed top-level tasks. */
  async function finalizeReopen(
    uuid: string,
    meta: StateActionMeta = {},
  ): Promise<void> {
    const [tasks, org] = await Promise.all([
      service.loadTasks("pending"),
      organization.snapshot(),
    ]);
    const habitUuids = habitUuidsSet();
    const taskMap = new Map(tasks.map((t) => [t.uuid, t]));
    const task = taskMap.get(uuid);
    if (!task || org.subtasks?.[uuid] || isHabitTask(task, org, habitUuids)) {
      return;
    }
    await service.withWriteLock(async () => {
      await writeWithCascadeUnlocked(
        uuid,
        { state: "planned", wait: "", waitreason: "" },
        org,
        taskMap,
      );
    });
    await history.append({
      uuid,
      from: "completed",
      to: "planned",
      source: meta.source || "web",
      actor: meta.actor,
      reason: "reopened",
    });
  }

  /** Captures state before deletion and logs history after soft-delete succeeds. */
  async function prepareDelete(
    uuid: string,
    meta: StateActionMeta = {},
  ): Promise<() => Promise<void>> {
    const [tasks, org] = await Promise.all([
      service.loadTasks("pending"),
      organization.snapshot(),
    ]);
    const habitUuids = habitUuidsSet();
    const task = tasks.find((t) => t.uuid === uuid);
    if (!task || org.subtasks?.[uuid] || isHabitTask(task, org, habitUuids)) {
      return async () => undefined;
    }
    const from = task.state ?? null;
    return async () => {
      await history.append({
        uuid,
        from,
        to: "deleted",
        source: meta.source || "web",
        actor: meta.actor,
        reason: "deleted",
      });
    };
  }

  /** Sets restored open top-level non-habit task to `planned` and records history. */
  async function finalizeRestore(
    uuid: string,
    meta: StateActionMeta = {},
  ): Promise<void> {
    const [tasks, org] = await Promise.all([
      service.loadTasks("pending"),
      organization.snapshot(),
    ]);
    const habitUuids = habitUuidsSet();
    const taskMap = new Map(tasks.map((t) => [t.uuid, t]));
    const task = taskMap.get(uuid);
    if (!task || org.subtasks?.[uuid] || isHabitTask(task, org, habitUuids)) {
      return;
    }
    await service.withWriteLock(async () => {
      await writeWithCascadeUnlocked(
        uuid,
        { state: "planned", wait: "", waitreason: "" },
        org,
        taskMap,
      );
    });
    await history.append({
      uuid,
      from: "deleted",
      to: "planned",
      source: meta.source || "web",
      actor: meta.actor,
      reason: "restored",
    });
  }

  /** Evaluates state machine summary, due lists, blocked promotions, and anomalies. */
  async function getSummary(): Promise<StateSummaryResponse> {
    const [tasks, org] = await Promise.all([
      service.loadTasks("pending"),
      organization.snapshot(),
    ]);
    const habitUuids = habitUuidsSet();
    const nowMs = nowFn();
    const openUuids = new Set(tasks.filter(isTaskOpen).map((t) => t.uuid));
    const counts: Record<TaskState, number> = {
      planned: 0,
      doing: 0,
      waiting: 0,
      parked: 0,
    };
    const doingTasks: TaskwarriorTask[] = [];
    const upcoming: Array<{
      uuid: string;
      description: string;
      scheduled: string;
    }> = [];
    const waitingDue: StateSummaryTaskItem[] = [];
    const parkedReviewDue: StateSummaryTaskItem[] = [];
    const promotionCandidates: TaskwarriorTask[] = [];
    const anomalies: StateAnomalyItem[] = [];

    for (const task of tasks) {
      if (!isTaskOpen(task)) continue;
      if (org.subtasks?.[task.uuid]) continue;
      if (isHabitTask(task, org, habitUuids)) continue;

      if (!task.state) {
        anomalies.push({
          uuid: task.uuid,
          description: task.description,
          ...(task.project ? { project: task.project } : {}),
          type: "missing_state",
          detail: "非习惯任务缺少 state 字段",
        });
        continue;
      }

      counts[task.state]++;
      if (task.state === "doing") {
        doingTasks.push(task);
      } else if (task.state === "waiting") {
        if (!task.wait || task.wait.getTime() <= nowMs) {
          waitingDue.push(toSummaryItem(task, openUuids));
          promotionCandidates.push(task);
        }
      } else if (task.state === "parked") {
        if (!task.wait || task.wait.getTime() <= nowMs) {
          parkedReviewDue.push(toSummaryItem(task, openUuids));
        }
      } else if (task.state === "planned" && task.scheduled) {
        if (task.scheduled.getTime() <= nowMs) {
          if (!hasUnresolvedDepends(task, openUuids)) {
            promotionCandidates.push(task);
          }
        } else {
          upcoming.push({
            uuid: task.uuid,
            description: task.description,
            scheduled: task.scheduled.toISOString(),
          });
        }
      }
    }

    doingTasks.sort(compareTasksByUrgency);
    if (doingTasks.length > DOING_LIMIT) {
      anomalies.push({
        uuid: doingTasks[0].uuid,
        description: `当前处理中共有 ${doingTasks.length} 条（上限 ${DOING_LIMIT} 条）`,
        type: "doing_over_limit",
        detail: "可能通过 CLI 直接写入，请手动放回多余任务到计划中",
      });
    }

    upcoming.sort((a, b) => a.scheduled.localeCompare(b.scheduled));

    const remainingSlots = Math.max(0, DOING_LIMIT - doingTasks.length);
    const waitingDueTasks = tasks
      .filter(
        (t) =>
          isTaskOpen(t) &&
          !org.subtasks?.[t.uuid] &&
          !isHabitTask(t, org, habitUuids) &&
          t.state === "waiting" &&
          (!t.wait || t.wait.getTime() <= nowMs),
      )
      .sort(
        (a, b) =>
          (a.wait?.getTime() ?? 0) - (b.wait?.getTime() ?? 0) ||
          compareTasksByUrgency(a, b),
      );
    const plannedDueTasks = tasks
      .filter(
        (t) =>
          isTaskOpen(t) &&
          !org.subtasks?.[t.uuid] &&
          !isHabitTask(t, org, habitUuids) &&
          t.state === "planned" &&
          t.scheduled &&
          t.scheduled.getTime() <= nowMs &&
          !hasUnresolvedDepends(t, openUuids),
      )
      .sort(
        (a, b) =>
          (a.scheduled?.getTime() ?? 0) - (b.scheduled?.getTime() ?? 0) ||
          compareTasksByUrgency(a, b),
      );
    const orderedDue = [...waitingDueTasks, ...plannedDueTasks];
    const blockedSlice = orderedDue.slice(remainingSlots);

    return {
      limit: DOING_LIMIT,
      doing: doingTasks.map((t) => toSummaryItem(t, openUuids)),
      counts,
      upcoming,
      waitingDue,
      parkedReviewDue,
      promotionBlocked: blockedSlice.map((t) => toSummaryItem(t, openUuids)),
      anomalies,
    };
  }

  /** Automatically promotes due `waiting` then due `planned` tasks up to `DOING_LIMIT`, once per task per day. */
  async function runAutoPromotions(): Promise<{ promoted: string[] }> {
    const tz = defaultTimezone(getTimezone);
    const today = localDateOf(nowFn(), tz);
    if (dailyPromoDay !== today) {
      dailyAutoPromoted.clear();
      dailyPromoDay = today;
    }

    return service.withWriteLock(async () => {
      const [tasks, org] = await Promise.all([
        service.loadTasks("pending"),
        organization.snapshot(),
      ]);
      const habitUuids = habitUuidsSet();
      const nowMs = nowFn();
      const taskMap = new Map(tasks.map((t) => [t.uuid, t]));
      const openUuids = new Set(tasks.filter(isTaskOpen).map((t) => t.uuid));

      let doingCount = topLevelDoingTasks(tasks, org, habitUuids).length;
      if (doingCount >= DOING_LIMIT) {
        return { promoted: [] };
      }

      const dueWaiting = tasks
        .filter(
          (t) =>
            isTaskOpen(t) &&
            !org.subtasks?.[t.uuid] &&
            !isHabitTask(t, org, habitUuids) &&
            t.state === "waiting" &&
            t.wait &&
            t.wait.getTime() <= nowMs,
        )
        .sort(
          (a, b) =>
            (a.wait?.getTime() ?? 0) - (b.wait?.getTime() ?? 0) ||
            compareTasksByUrgency(a, b),
        );

      const duePlanned = tasks
        .filter(
          (t) =>
            isTaskOpen(t) &&
            !org.subtasks?.[t.uuid] &&
            !isHabitTask(t, org, habitUuids) &&
            t.state === "planned" &&
            t.scheduled &&
            t.scheduled.getTime() <= nowMs &&
            !hasUnresolvedDepends(t, openUuids),
        )
        .sort(
          (a, b) =>
            (a.scheduled?.getTime() ?? 0) - (b.scheduled?.getTime() ?? 0) ||
            compareTasksByUrgency(a, b),
        );

      const promoted: string[] = [];
      const promoteList: Array<{
        task: TaskwarriorTask;
        reason: string;
        from: TaskState;
      }> = [
        ...dueWaiting.map((task) => ({
          task,
          from: "waiting" as const,
          reason: "check date reached",
        })),
        ...duePlanned.map((task) => ({
          task,
          from: "planned" as const,
          reason: "scheduled reached",
        })),
      ];

      for (const item of promoteList) {
        if (doingCount >= DOING_LIMIT) break;
        const dedupKey = `${item.task.uuid}:${today}`;
        if (dailyAutoPromoted.has(dedupKey)) continue;

        await writeWithCascadeUnlocked(
          item.task.uuid,
          { state: "doing", wait: "", waitreason: "" },
          org,
          taskMap,
        );
        await history.append({
          uuid: item.task.uuid,
          from: item.from,
          to: "doing",
          source: "auto",
          actor: "state-scheduler",
          reason: item.reason,
        });
        dailyAutoPromoted.add(dedupKey);
        doingCount++;
        promoted.push(item.task.uuid);
      }

      return { promoted };
    });
  }

  return {
    setState,
    scheduleTask,
    updateDepends,
    prepareCreateFields,
    recordTaskCreated,
    prepareComplete,
    ensureStartReady,
    finalizeReopen,
    prepareDelete,
    finalizeRestore,
    getSummary,
    runAutoPromotions,
    readHistory: (options?: { uuid?: string; limit?: number }) =>
      history.read(options),
  };
}

export type TaskStateManager = ReturnType<typeof createTaskStateManager>;
