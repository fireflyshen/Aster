import { randomUUID } from "node:crypto";
import type { TaskService } from "../../../core/tasks/service.ts";
import type { RawTask } from "../../../core/tasks/raw.ts";
import { TaskExecutionError } from "../../../core/connection/errors.ts";
import {
  hashNormalizedInput,
  TimeStoreError,
  type TimeStore,
} from "./time-store.ts";

export type CoordinatedActionResult = {
  ok: true;
  timeEffect: "started" | "switched" | "stopped" | "none";
  operationId?: string;
  skippedExternal?: boolean;
  activity?: unknown;
  closedActivity?: unknown;
  warnings?: unknown[];
};

const TIMER_SLOT_KEY = "__TIMER_SLOT__";

function isExternalDefinitelyFailed(error: unknown): boolean {
  if (error instanceof TaskExecutionError) {
    return error.outcome === "failed";
  }
  const obj = error as { outcome?: unknown } | null | undefined;
  return obj?.outcome === "failed";
}

function toTaskMeta(raw: RawTask): {
  title: string;
  projectSnapshot?: string;
  tags?: string[];
} {
  return {
    title: raw.description || "Task",
    ...(typeof raw.project === "string" && raw.project
      ? { projectSnapshot: raw.project }
      : {}),
    ...(Array.isArray(raw.tags)
      ? { tags: raw.tags.filter((t): t is string => typeof t === "string") }
      : {}),
  };
}

function defaultIdempotencyKey(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

export function createTimeCoordinator(deps: {
  service: TaskService;
  store: TimeStore;
  now?: () => number;
}) {
  const { service, store } = deps;
  const nowFn = deps.now ?? (() => Date.now());
  const keyQueues = new Map<string, Promise<unknown>>();

  /**
   * Acquires in-memory async locks in canonical sorted order (`__TIMER_SLOT__`
   * always precedes UUID keys) and releases them strictly in reverse/finally.
   */
  async function withDependencyLocks<T>(
    rawKeys: readonly string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    const ordered = [...new Set(rawKeys)].sort((a, b) => {
      if (a === TIMER_SLOT_KEY && b !== TIMER_SLOT_KEY) return -1;
      if (b === TIMER_SLOT_KEY && a !== TIMER_SLOT_KEY) return 1;
      return a.localeCompare(b);
    });

    const acquireAt = async (index: number): Promise<T> => {
      if (index >= ordered.length) return fn();
      const key = ordered[index];
      const prev = keyQueues.get(key) ?? Promise.resolve();
      let release!: () => void;
      const tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      const chained = prev.catch(() => undefined).then(() => tail);
      keyQueues.set(key, chained);
      try {
        await prev.catch(() => undefined);
        return await acquireAt(index + 1);
      } finally {
        release();
        if (keyQueues.get(key) === chained) {
          keyQueues.delete(key);
        }
      }
    };

    return acquireAt(0);
  }

  async function tryReadRawTask(uuid: string): Promise<RawTask | null> {
    try {
      return await service.rawTask(uuid);
    } catch {
      return null;
    }
  }

  async function runCoordinatedStart(
    uuid: string,
    options: { idempotencyKey?: string } = {},
  ): Promise<CoordinatedActionResult> {
    const normalizedUuid = uuid.toLowerCase();
    const idempotencyKey =
      options.idempotencyKey ||
      defaultIdempotencyKey(`task_start:${normalizedUuid}`);

    // Lock the timer slot + target task + any currently active task in canonical order.
    const statusBefore = store.getStatus();
    const lockKeys = [TIMER_SLOT_KEY, normalizedUuid];
    if (statusBefore.activeActivity?.taskUuid) {
      lockKeys.push(statusBefore.activeActivity.taskUuid.toLowerCase());
    }

    return withDependencyLocks(lockKeys, async () => {
      const receivedAtMs = nowFn();
      const effectiveAtMs = nowFn();
      const raw = await tryReadRawTask(uuid);
      if (!raw || raw.status === "completed" || raw.status === "deleted") {
        throw new TimeStoreError(
          409,
          "TASK_NOT_ACTIVE",
          "Task is completed, deleted, or missing. Refresh before starting.",
        );
      }

      const currentStatus = store.getStatus();
      const inputHash = hashNormalizedInput("task_start", {
        uuid: normalizedUuid,
      });

      const prep = store.beginCoordinatedOperation({
        idempotencyKey,
        kind: "task_start",
        inputHash,
        receivedAtMs,
        targetTaskUuid: uuid,
        preState: {
          status: raw.status,
          start: raw.start ?? null,
          modified: raw.modified ?? null,
          title: raw.description,
          projectSnapshot: raw.project ?? undefined,
          tags: raw.tags ?? undefined,
          preSessionVersion: currentStatus.sessionVersion,
          preActiveActivityId: currentStatus.activeActivity?.id ?? null,
        },
        extraDependentTaskUuids: currentStatus.activeActivity?.taskUuid
          ? [currentStatus.activeActivity.taskUuid]
          : undefined,
        effectiveAtMs,
      });

      if (prep.replay) {
        const r = (prep.record.receipt ??
          {}) as Partial<CoordinatedActionResult>;
        return {
          ok: true,
          timeEffect: r.timeEffect ?? "none",
          operationId: prep.record.operationId,
          skippedExternal: prep.record.state === "skipped_already_satisfied",
          ...(r.activity ? { activity: r.activity } : {}),
          ...(r.closedActivity ? { closedActivity: r.closedActivity } : {}),
          ...(r.warnings ? { warnings: r.warnings } : {}),
        };
      }

      const op = prep.record;
      const taskMeta = toTaskMeta(raw);

      // COORD-01: If pending/waiting task already has `start`, skip external command.
      if (raw.start) {
        store.updateCoordinatedState(op.operationId, {
          state: "skipped_already_satisfied",
          externalDisposition: "SKIPPED_ALREADY_STARTED",
        });
        const applied = store.applyCoordinatedOperationResult({
          operationId: op.operationId,
          taskMeta,
          effectiveAtMs,
          finalState: "skipped_already_satisfied",
          externalDisposition: "SKIPPED_ALREADY_STARTED",
        });
        return {
          ok: true,
          timeEffect: applied.timeEffect,
          operationId: op.operationId,
          skippedExternal: true,
          ...(applied.activity ? { activity: applied.activity } : {}),
          ...(applied.closedActivity
            ? { closedActivity: applied.closedActivity }
            : {}),
          ...(applied.warnings ? { warnings: applied.warnings } : {}),
        };
      }

      // External command has not started yet: execute Taskwarrior start once.
      try {
        await service.startTask(uuid);
      } catch (error) {
        if (isExternalDefinitelyFailed(error)) {
          store.updateCoordinatedState(op.operationId, {
            state: "failed",
            externalDisposition: "EXTERNAL_FAILED",
          });
          throw error;
        }
        store.updateCoordinatedState(op.operationId, {
          state: "pending_reconcile",
          externalDisposition: "EXTERNAL_UNKNOWN",
        });
        throw Object.assign(
          new TimeStoreError(
            409,
            "OPERATION_PENDING_RECONCILE",
            "Task start result is unknown. Check and reconcile before retrying timers.",
            { operationId: op.operationId },
          ),
          { outcome: "unknown", operationId: op.operationId },
        );
      }

      // Persist explicit external acknowledgment before mutating Time ledger.
      try {
        store.updateCoordinatedState(op.operationId, {
          state: "external_acknowledged",
          externalDisposition: "EXTERNAL_OK",
        });
      } catch (error) {
        throw Object.assign(
          new Error(
            "Task started remotely, but confirmation persistence failed.",
            { cause: error },
          ),
          { outcome: "unknown", status: 500, operationId: op.operationId },
        );
      }

      try {
        const applied = store.applyCoordinatedOperationResult({
          operationId: op.operationId,
          taskMeta,
          effectiveAtMs,
          finalState: "applied",
          externalDisposition: "EXTERNAL_OK",
        });
        return {
          ok: true,
          timeEffect: applied.timeEffect,
          operationId: op.operationId,
          skippedExternal: false,
          ...(applied.activity ? { activity: applied.activity } : {}),
          ...(applied.closedActivity
            ? { closedActivity: applied.closedActivity }
            : {}),
          ...(applied.warnings ? { warnings: applied.warnings } : {}),
        };
      } catch (error) {
        try {
          store.updateCoordinatedState(op.operationId, {
            state: "pending_reconcile",
            externalDisposition: "LOCAL_APPLY_FAILED",
          });
        } catch {
          // Operation remains external_acknowledged and will reconcile on startup.
        }
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { outcome: "unknown", operationId: op.operationId },
        );
      }
    });
  }

  /**
   * Executes task stop/complete/delete:
   * - Unrelated tasks (!isTaskAffectedByTimerOrPending) run directly without acquiring
   *   the timer slot, succeeding even when another task's timer op is pending_reconcile.
   * - Affected tasks go through the full coordinator with timer slot protection.
   */
  async function runCoordinatedTaskAction(input: {
    uuid: string;
    kind: "task_stop" | "task_complete" | "task_delete";
    idempotencyKey?: string;
    executeDirect: () => Promise<void>;
  }): Promise<CoordinatedActionResult> {
    const normalizedUuid = input.uuid.toLowerCase();
    const idempotencyKey =
      input.idempotencyKey ||
      defaultIdempotencyKey(`${input.kind}:${normalizedUuid}`);

    // Fast path under per-task lock only when unrelated to active timer & pending ops.
    const fastCheck = await withDependencyLocks([normalizedUuid], async () => {
      const affected = store.isTaskAffectedByTimerOrPending(input.uuid);
      if (!affected.affected) {
        await input.executeDirect();
        return { direct: true as const };
      }
      return { direct: false as const, affected };
    });

    if (fastCheck.direct) {
      return { ok: true, timeEffect: "none" };
    }

    // Acquire timer slot BEFORE task lock (canonical lock order) and re-verify.
    return withDependencyLocks([TIMER_SLOT_KEY, normalizedUuid], async () => {
      const affected = store.isTaskAffectedByTimerOrPending(input.uuid);
      if (!affected.affected) {
        await input.executeDirect();
        return { ok: true, timeEffect: "none" };
      }
      if (affected.reason === "pending_reconcile") {
        throw new TimeStoreError(
          409,
          "OPERATION_PENDING_RECONCILE",
          "A pending timer reconciliation involves this task. Reconcile before modifying it.",
          {
            operationIds: affected.pendingOperationIds,
            taskUuid: input.uuid,
          },
        );
      }

      const receivedAtMs = nowFn();
      const effectiveAtMs = nowFn();
      const raw = await tryReadRawTask(input.uuid);
      const currentStatus = store.getStatus();
      const inputHash = hashNormalizedInput(input.kind, {
        uuid: normalizedUuid,
      });

      const prep = store.beginCoordinatedOperation({
        idempotencyKey,
        kind: input.kind,
        inputHash,
        receivedAtMs,
        targetTaskUuid: input.uuid,
        preState: {
          status: raw?.status ?? null,
          start: raw?.start ?? null,
          modified: raw?.modified ?? null,
          preSessionVersion: currentStatus.sessionVersion,
          preActiveActivityId: currentStatus.activeActivity?.id ?? null,
        },
        extraDependentTaskUuids: currentStatus.activeActivity?.taskUuid
          ? [currentStatus.activeActivity.taskUuid]
          : undefined,
        effectiveAtMs,
      });

      if (prep.replay) {
        const r = (prep.record.receipt ??
          {}) as Partial<CoordinatedActionResult>;
        return {
          ok: true,
          timeEffect: r.timeEffect ?? "none",
          operationId: prep.record.operationId,
          skippedExternal: prep.record.state === "skipped_already_satisfied",
          ...(r.activity ? { activity: r.activity } : {}),
          ...(r.warnings ? { warnings: r.warnings } : {}),
        };
      }

      const op = prep.record;
      let externalDisposition = "EXTERNAL_OK";
      let skipped = false;

      if (input.kind === "task_stop" && raw && !raw.start) {
        skipped = true;
        externalDisposition = "SKIPPED_ALREADY_STOPPED";
        store.updateCoordinatedState(op.operationId, {
          state: "skipped_already_satisfied",
          externalDisposition,
        });
      } else {
        try {
          await input.executeDirect();
        } catch (error) {
          if (isExternalDefinitelyFailed(error)) {
            store.updateCoordinatedState(op.operationId, {
              state: "failed",
              externalDisposition: "EXTERNAL_FAILED",
            });
            throw error;
          }
          store.updateCoordinatedState(op.operationId, {
            state: "pending_reconcile",
            externalDisposition: "EXTERNAL_UNKNOWN",
          });
          throw Object.assign(
            new TimeStoreError(
              409,
              "OPERATION_PENDING_RECONCILE",
              "Task action outcome is unknown. Check and reconcile before retrying.",
              { operationId: op.operationId },
            ),
            { outcome: "unknown", operationId: op.operationId },
          );
        }

        try {
          store.updateCoordinatedState(op.operationId, {
            state: "external_acknowledged",
            externalDisposition,
          });
        } catch (error) {
          throw Object.assign(
            new Error(
              "Task action completed remotely, but confirmation persistence failed.",
              { cause: error },
            ),
            { outcome: "unknown", status: 500, operationId: op.operationId },
          );
        }
      }

      try {
        const applied = store.applyCoordinatedOperationResult({
          operationId: op.operationId,
          effectiveAtMs,
          finalState: skipped ? "skipped_already_satisfied" : "applied",
          externalDisposition,
        });
        return {
          ok: true,
          timeEffect: applied.timeEffect,
          operationId: op.operationId,
          skippedExternal: skipped,
          ...(applied.activity ? { activity: applied.activity } : {}),
          ...(applied.warnings ? { warnings: applied.warnings } : {}),
        };
      } catch (error) {
        try {
          store.updateCoordinatedState(op.operationId, {
            state: "pending_reconcile",
            externalDisposition: "LOCAL_APPLY_FAILED",
          });
        } catch {
          // Leaves op in external_acknowledged for startup reconcile.
        }
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { outcome: "unknown", operationId: op.operationId },
        );
      }
    });
  }

  /**
   * Reconciles incomplete operations after startup without ever re-running
   * external Taskwarrior write commands or guessing from `start`/`modified`.
   */
  async function reconcileStartup(): Promise<{
    markedPendingFromPrepared: number;
    appliedFromAcknowledged: number;
    leftPending: number;
  }> {
    const fromPrepared = store.markPreparedOperationsPendingOnStartup();
    const unresolved = store.listUnresolvedOperations();
    let appliedFromAcknowledged = 0;

    for (const op of unresolved) {
      if (
        op.state !== "external_acknowledged" &&
        op.state !== "skipped_already_satisfied"
      ) {
        continue;
      }

      let taskMeta:
        | { title: string; projectSnapshot?: string; tags?: string[] }
        | undefined;
      if (op.kind === "task_start" && op.targetTaskUuid) {
        const raw = await tryReadRawTask(op.targetTaskUuid);
        if (!raw || raw.status === "completed" || raw.status === "deleted") {
          store.updateCoordinatedState(op.operationId, {
            state: "pending_reconcile",
            externalDisposition: "TASK_NOT_ACTIVE_ON_RECOVERY",
          });
          continue;
        }
        taskMeta = toTaskMeta(raw);
      }

      const res = store.applyCoordinatedOperationResult({
        operationId: op.operationId,
        taskMeta,
        finalState:
          op.state === "skipped_already_satisfied"
            ? "skipped_already_satisfied"
            : "applied",
        onConflictMarkPending: true,
      });
      if (res.applied) {
        appliedFromAcknowledged += 1;
      }
    }

    const leftPending = store.listUnresolvedOperations().length;
    return {
      markedPendingFromPrepared: fromPrepared.length,
      appliedFromAcknowledged,
      leftPending,
    };
  }

  async function inspectPendingOperation(operationId: string) {
    const op = store.getOperation(operationId);
    if (!op) {
      throw new TimeStoreError(
        404,
        "OPERATION_NOT_FOUND",
        "Operation not found.",
      );
    }
    const raw = op.targetTaskUuid
      ? await tryReadRawTask(op.targetTaskUuid)
      : null;
    const preStarted = Boolean(
      (op.preState as { start?: unknown } | undefined)?.start,
    );
    const taskNowStarted = Boolean(raw?.start);
    const hint =
      op.kind === "task_start" && !preStarted && taskNowStarted
        ? "任务现在已开始，是否接纳这笔计时"
        : raw && (raw.status === "completed" || raw.status === "deleted")
          ? `任务当前状态为 ${raw.status}，请确认是否停止或放弃关联计时`
          : undefined;

    return {
      operation: op,
      taskCurrent: raw
        ? {
            uuid: raw.uuid,
            status: raw.status,
            description: raw.description,
            start: raw.start ?? null,
            modified: raw.modified ?? null,
          }
        : null,
      ...(hint ? { suggestionHint: hint } : {}),
    };
  }

  async function resolvePending(input: {
    operationId: string;
    action: "dismiss" | "accept_started" | "stop_active";
    effectiveAtMs?: number;
  }) {
    const op = store.getOperation(input.operationId);
    if (!op) {
      throw new TimeStoreError(
        404,
        "OPERATION_NOT_FOUND",
        "Operation not found.",
      );
    }
    const raw =
      input.action === "accept_started" && op.targetTaskUuid
        ? await tryReadRawTask(op.targetTaskUuid)
        : null;
    return withDependencyLocks(
      [
        TIMER_SLOT_KEY,
        ...(op.targetTaskUuid ? [op.targetTaskUuid.toLowerCase()] : []),
      ],
      async () =>
        store.resolvePendingOperation({
          operationId: input.operationId,
          action: input.action,
          effectiveAtMs: input.effectiveAtMs,
          ...(raw ? { taskMeta: toTaskMeta(raw) } : {}),
        }),
    );
  }

  return {
    startTask: runCoordinatedStart,
    stopTask: (uuid: string, opts?: { idempotencyKey?: string }) =>
      runCoordinatedTaskAction({
        uuid,
        kind: "task_stop",
        idempotencyKey: opts?.idempotencyKey,
        executeDirect: async () => {
          await service.stopTask(uuid);
        },
      }),
    completeTask: (uuid: string, opts?: { idempotencyKey?: string }) =>
      runCoordinatedTaskAction({
        uuid,
        kind: "task_complete",
        idempotencyKey: opts?.idempotencyKey,
        executeDirect: async () => {
          await service.completeTask(uuid);
        },
      }),
    deleteTask: (
      uuid: string,
      executeDelete: () => Promise<void>,
      opts?: { idempotencyKey?: string },
    ) =>
      runCoordinatedTaskAction({
        uuid,
        kind: "task_delete",
        idempotencyKey: opts?.idempotencyKey,
        executeDirect: executeDelete,
      }),
    reconcileStartup,
    inspectPendingOperation,
    resolvePending,
  };
}

export type TimeCoordinator = ReturnType<typeof createTimeCoordinator>;
