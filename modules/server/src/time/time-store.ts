import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  resolveActivityCategory,
  type ClassificationInput,
} from "../../../core/time/classification.ts";
import {
  computeCostReport,
  computeDurationCostCents,
  computeTaskCostSummary,
  hourlyRateForTags,
  normalizeActivityTags,
  normalizeHourlyRateCents,
  resolveActivityHourlyRateCents,
  type CostReportTaskMeta,
} from "../../../core/time/cost.ts";
import {
  computeDailyLedger,
  computeSleepCandidateRange,
  computeTaskTotalsSeconds,
  computeWeeklyDistribution,
  effectiveActivityEndMs,
  intervalsOverlap,
  sleepCandidateKey,
} from "../../../core/time/ledger.ts";
import {
  DEFAULT_CHECKPOINT_INTERVAL_SECONDS,
  DEFAULT_TIMER_LIVE_WINDOW_MS,
  type Activity,
  type ActivityPrecision,
  type ActivityReviewReason,
  type ActivityReviewState,
  type ActivitySource,
  type ActivityStopReason,
  type BillLink,
  type CostReportGranularity,
  type CostReportSortBy,
  type CostReportSummary,
  type DailyLedgerSummary,
  type LocatedSegment,
  type OperationState,
  type RuleSource,
  type SleepCandidate,
  type TaskCostSummary,
  type TimeEvent,
  type TimePolicy,
  type TimerSnapshot,
  type TimeWarning,
  type TimingPlan,
  type TimingPlanStopBasis,
  type WeeklyDistributionSummary,
} from "../../../core/time/model.ts";
import {
  localDateOf,
  mondayOfWeek,
  parseLocalDate,
} from "../../../core/time/zone.ts";
import { listBillExpenses } from "./bills-reader.ts";
import {
  defaultBarrierPath,
  readBarrierState,
  writeBarrierState,
  type TimeBarrierState,
} from "./time-barrier.ts";
import {
  CURRENT_TIME_SCHEMA_VERSION,
  initializeTimeDatabase,
} from "./time-schema.ts";
import {
  buildTimingPlanTx,
  canonicalJson,
  captureSnapshotFields,
  computeStopLimit,
  emitTimeEventTx,
  hashNormalizedInput,
  loadAllActivities,
  loadAllBillLinks,
  loadAllTaskBudgets,
  loadSleepDecisions,
  parsePolicy,
  readMeta,
  rowToActivity,
  rowToBillLink,
  rowToOperation,
  rowToTimeEvent,
  syncTaskBudgetFromEstimateTx,
  validatePolicy,
} from "./time-store-helpers.ts";
import {
  TimeStoreError,
  type ActivityMutationReceipt,
  type ActivityRow,
  type ActivitySnapshotFields,
  type BillLinkRow,
  type CreateTimeStoreOptions,
  type MetaRow,
  type OperationDependencies,
  type OperationRow,
  type TaskBudgetRow,
  type TimeEventRow,
  type TimeOperationRecord,
  type TimingPlanRow,
  type UndoMetadata,
} from "./time-store-types.ts";

export {
  canonicalJson,
  hashNormalizedInput,
  TimeStoreError,
  validatePolicy,
  type ActivityMutationReceipt,
  type CreateTimeStoreOptions,
  type OperationDependencies,
  type TimeOperationRecord,
};

export async function createTimeStore(
  dbPath: string,
  options: CreateTimeStoreOptions = {},
) {
  const barrierPath = options.barrierPath ?? defaultBarrierPath(dbPath);
  const nowFn = options.now ?? (() => Date.now());
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });

  let initialBarrier = await readBarrierState(barrierPath);
  let db = new DatabaseSync(dbPath);
  initializeTimeDatabase(db, initialBarrier, {
    enabled: options.enabled,
    cutoverAtMs: options.cutoverAtMs,
    nowMs: nowFn(),
  });
  let restoring = false;
  const scheduleListeners = new Set<() => void>();

  function notifyScheduleListeners(): void {
    for (const listener of scheduleListeners) {
      try {
        listener();
      } catch {
        // Listener errors must never abort committed store transitions.
      }
    }
  }

  async function syncBarrierFromDb(meta: MetaRow): Promise<TimeBarrierState> {
    initialBarrier = await writeBarrierState(barrierPath, {
      timeEpoch: meta.time_epoch,
      taskDataEpoch: meta.task_data_epoch,
      restoreBarrierAt: meta.restore_barrier_at,
      updatedAtMs: nowFn(),
    });
    return initialBarrier;
  }

  function assertOpen(): DatabaseSync {
    if (restoring) {
      throw new TimeStoreError(
        423,
        "TIME_RESTORING",
        "Time store is restoring. Retry after restore completes.",
      );
    }
    return db;
  }

  function inImmediateTxOn<T>(
    conn: DatabaseSync,
    fn: (conn: DatabaseSync) => T,
  ): T {
    conn.exec("BEGIN IMMEDIATE");
    try {
      const result = fn(conn);
      conn.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        conn.exec("ROLLBACK");
      } catch {
        // Ignore rollback errors if connection already aborted transaction.
      }
      throw error;
    }
  }

  function inImmediateTx<T>(
    fn: (conn: DatabaseSync) => T,
    options?: { allowWhileRestoring?: boolean },
  ): T {
    return inImmediateTxOn(
      options?.allowWhileRestoring ? db : assertOpen(),
      fn,
    );
  }

  function assertNotBlockedByBarrier(
    meta: MetaRow,
    receivedAtMs: number | undefined,
  ): void {
    if (
      receivedAtMs !== undefined &&
      meta.restore_barrier_at > 0 &&
      receivedAtMs < meta.restore_barrier_at
    ) {
      throw new TimeStoreError(
        409,
        "RESTORE_BARRIER_REJECTED",
        "Request predates the restore barrier and was isolated to avoid replaying stale history.",
      );
    }
  }

  function checkExistingOperation<T>(
    conn: DatabaseSync,
    meta: MetaRow,
    idempotencyKey: string,
    inputHash: string,
    receivedAtMs?: number,
  ): { hit: true; receipt: T } | { hit: false } {
    const existing = conn
      .prepare("SELECT * FROM operations WHERE idempotency_key = ?")
      .get(idempotencyKey) as OperationRow | undefined;

    if (!existing) {
      assertNotBlockedByBarrier(meta, receivedAtMs);
      return { hit: false };
    }

    if (existing.input_hash !== inputHash) {
      throw new TimeStoreError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key already used with different input.",
        { operationId: existing.operation_id },
      );
    }

    if (
      existing.state === "applied" ||
      existing.state === "skipped_already_satisfied"
    ) {
      return {
        hit: true,
        receipt: JSON.parse(existing.receipt_json || "{}") as T,
      };
    }

    if (
      existing.state === "pending_reconcile" ||
      existing.state === "prepared" ||
      existing.state === "external_acknowledged"
    ) {
      throw new TimeStoreError(
        409,
        "OPERATION_PENDING_RECONCILE",
        "Operation status is pending reconciliation. Query operation_get before retrying.",
        { operationId: existing.operation_id, state: existing.state },
      );
    }

    if (existing.state === "failed") {
      throw new TimeStoreError(
        409,
        "OPERATION_ALREADY_FAILED",
        "Operation previously failed with this idempotency key. Use a new key to retry.",
        { operationId: existing.operation_id },
      );
    }

    return { hit: false };
  }

  function getUnresolvedTimerHolders(conn: DatabaseSync): OperationRow[] {
    return conn
      .prepare(
        `SELECT * FROM operations
         WHERE state IN ('prepared', 'external_acknowledged', 'pending_reconcile')
         ORDER BY created_at_ms ASC`,
      )
      .all() as OperationRow[];
  }

  function assertTimerSlotAvailable(conn: DatabaseSync): void {
    const unresolved = getUnresolvedTimerHolders(conn).filter((op) => {
      if (!op.dependencies_json) return true;
      try {
        const deps = JSON.parse(op.dependencies_json) as OperationDependencies;
        return deps.holdsTimerSlot !== false;
      } catch {
        return true;
      }
    });
    if (unresolved.length > 0) {
      throw new TimeStoreError(
        409,
        "TIMER_PENDING_RECONCILE",
        "A pending cross-system timer operation must be reconciled before switching timers.",
        {
          operationIds: unresolved.map((u) => u.operation_id),
        },
      );
    }
  }

  function findLocatedOverlaps(
    conn: DatabaseSync,
    startMs: number,
    endMs: number,
    nowMs: number,
    excludeActivityId?: string,
  ): Activity[] {
    const rows = conn
      .prepare(
        `SELECT * FROM activities
         WHERE kind = 'located'
           AND review_state NOT IN ('voided', 'conflict')
           AND start_ms IS NOT NULL`,
      )
      .all() as ActivityRow[];

    const conflicts: Activity[] = [];
    for (const row of rows) {
      if (excludeActivityId && row.id === excludeActivityId) continue;
      const activity = rowToActivity(row);
      const effectiveEnd = effectiveActivityEndMs(activity, nowMs);
      if (effectiveEnd === undefined || effectiveEnd <= activity.startMs!) {
        continue;
      }
      if (intervalsOverlap(startMs, endMs, activity.startMs!, effectiveEnd)) {
        conflicts.push(activity);
      }
    }
    return conflicts;
  }

  function maybeLongActivityWarning(
    closedRow: ActivityRow,
    endMs: number,
    policy: TimePolicy,
  ): { reviewState: ActivityReviewState; warning?: TimeWarning } {
    if (closedRow.start_ms === null) {
      return { reviewState: closedRow.review_state };
    }
    const category = policy.categories.find(
      (c) => c.id === closedRow.category_id,
    );
    if (category?.isSleep || policy.longActivityThresholdSeconds <= 0) {
      return { reviewState: closedRow.review_state };
    }
    const durationSeconds = Math.max(
      0,
      Math.floor((endMs - closedRow.start_ms) / 1000),
    );
    if (durationSeconds >= policy.longActivityThresholdSeconds) {
      return {
        reviewState: "review_required",
        warning: {
          code: "LONG_ACTIVITY_CLOSED",
          activityId: closedRow.id,
          activityVersion: closedRow.version + 1,
          durationSeconds,
          suggestedAction: "edit_end",
        },
      };
    }
    return { reviewState: closedRow.review_state };
  }

  function isSleepCategory(policy: TimePolicy, categoryId: string): boolean {
    const matched = policy.categories.find((c) => c.id === categoryId);
    return Boolean(matched?.isSleep || categoryId === "sleep");
  }

  function insertActivityRow(conn: DatabaseSync, activity: Activity): void {
    const normalizedTags = normalizeActivityTags(activity.tags);
    conn
      .prepare(
        `INSERT INTO activities (
          id, version, kind, title, category_id, rule_version, rule_source,
          task_uuid, project_snapshot, tags_json, hourly_rate_cents,
          start_ms, end_ms, suspend_ms,
          confirmed_through_ms, review_due_at_ms, review_reason,
          timing_plan_id, auto_stop_at_ms, auto_stop_basis, limit_version,
          timer_stopped_at_ms, stop_reason, processed_at_ms,
          window_start_ms, window_end_ms, target_date, estimated_seconds,
          precision, source, review_state, raw_input, note, timezone,
          import_batch_id, source_record_id, candidate_key,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        activity.id,
        activity.version,
        activity.kind,
        activity.title,
        activity.categoryId,
        activity.ruleVersion,
        activity.ruleSource,
        activity.taskUuid ?? null,
        activity.projectSnapshot ?? null,
        normalizedTags.length > 0 ? JSON.stringify(normalizedTags) : null,
        activity.hourlyRateCents ?? null,
        activity.startMs ?? null,
        activity.endMs ?? null,
        activity.suspendMs ?? null,
        activity.confirmedThroughMs ?? null,
        activity.reviewDueAtMs ?? null,
        activity.reviewReason ?? null,
        activity.timingPlanId ?? null,
        activity.autoStopAtMs ?? null,
        activity.autoStopBasis ?? null,
        activity.limitVersion ?? null,
        activity.timerStoppedAtMs ?? null,
        activity.stopReason ?? null,
        activity.processedAtMs ?? null,
        activity.windowStartMs ?? null,
        activity.windowEndMs ?? null,
        activity.targetDate ?? null,
        activity.estimatedSeconds ?? null,
        activity.precision,
        activity.source,
        activity.reviewState,
        activity.rawInput ?? null,
        activity.note ?? null,
        activity.timezone,
        activity.importBatchId ?? null,
        activity.sourceRecordId ?? null,
        activity.candidateKey ?? null,
        activity.createdAtMs,
        activity.updatedAtMs,
      );
  }

  function settleDueTimersTx(
    conn: DatabaseSync,
    nowMs: number,
  ): {
    settledActivity?: Activity;
    checkpointEvent?: TimeEvent;
    autoStopEvent?: TimeEvent;
  } {
    const meta = readMeta(conn);
    if (!meta.active_activity_id) {
      return {};
    }
    const activeRow = conn
      .prepare("SELECT * FROM activities WHERE id = ?")
      .get(meta.active_activity_id) as ActivityRow | undefined;
    if (!activeRow || activeRow.end_ms !== null) {
      return {};
    }

    // 1) Overdue auto-stop takes priority and stops strictly at autoStopAtMs.
    if (
      activeRow.auto_stop_at_ms !== null &&
      nowMs >= activeRow.auto_stop_at_ms
    ) {
      const boundedStopMs =
        activeRow.suspend_ms !== null
          ? Math.min(activeRow.auto_stop_at_ms, activeRow.suspend_ms)
          : activeRow.auto_stop_at_ms;
      const stopAtMs = Math.max(
        activeRow.start_ms ?? boundedStopMs,
        boundedStopMs,
      );
      const stopReason: ActivityStopReason =
        activeRow.auto_stop_basis ?? "duration_limit";
      const unresolved = getUnresolvedTimerHolders(conn);

      // STOP-11: If pending_reconcile exists across deadline, cap/freeze at stopAtMs
      // without replaying/clearing pending Taskwarrior actions.
      if (unresolved.length > 0) {
        if (
          activeRow.suspend_ms === null ||
          activeRow.suspend_ms > stopAtMs ||
          activeRow.timer_stopped_at_ms === null
        ) {
          conn
            .prepare(
              `UPDATE activities
               SET suspend_ms = ?, review_state = 'review_required',
                   review_reason = COALESCE(review_reason, 'auto_stopped'),
                   timer_stopped_at_ms = COALESCE(timer_stopped_at_ms, ?),
                   stop_reason = COALESCE(stop_reason, ?),
                   processed_at_ms = COALESCE(processed_at_ms, ?),
                   version = ?, updated_at_ms = ?
               WHERE id = ? AND version = ?`,
            )
            .run(
              stopAtMs,
              stopAtMs,
              stopReason,
              nowMs,
              activeRow.version + 1,
              nowMs,
              activeRow.id,
              activeRow.version,
            );
          conn
            .prepare(
              "UPDATE time_meta SET session_version = ?, updated_at_ms = ? WHERE id = 1",
            )
            .run(meta.session_version + 1, nowMs);
        }
        return {};
      }

      const nextVersion = activeRow.version + 1;
      const preservedConfirmed =
        activeRow.confirmed_through_ms ?? activeRow.start_ms ?? null;
      conn
        .prepare(
          `UPDATE activities
           SET end_ms = ?,
               confirmed_through_ms = ?,
               review_state = 'review_required',
               review_reason = 'auto_stopped',
               timer_stopped_at_ms = ?,
               stop_reason = ?,
               processed_at_ms = ?,
               version = ?,
               updated_at_ms = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          stopAtMs,
          preservedConfirmed,
          stopAtMs,
          stopReason,
          nowMs,
          nextVersion,
          nowMs,
          activeRow.id,
          activeRow.version,
        );
      conn
        .prepare(
          "UPDATE time_meta SET active_activity_id = NULL, session_version = ?, updated_at_ms = ? WHERE id = 1",
        )
        .run(meta.session_version + 1, nowMs);

      const settledActivity = rowToActivity(
        conn
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(activeRow.id) as ActivityRow,
      );
      const durationSeconds =
        settledActivity.startMs !== undefined
          ? Math.max(0, Math.floor((stopAtMs - settledActivity.startMs) / 1000))
          : 0;
      const autoStopEvent = emitTimeEventTx(conn, {
        dedupKey: `auto_stop:${settledActivity.id}:v${settledActivity.limitVersion ?? 1}`,
        kind: "auto_stopped",
        activityId: settledActivity.id,
        planId: settledActivity.timingPlanId,
        title: settledActivity.title,
        message: `已自动停止 · 本次暂计 ${Math.round(durationSeconds / 60)} 分钟`,
        occurredAtMs: stopAtMs,
        payload: {
          stopAtMs,
          processedAtMs: nowMs,
          durationSeconds,
          stopReason,
          limitVersion: settledActivity.limitVersion ?? 1,
        },
        createdAtMs: nowMs,
      });
      return { settledActivity, autoStopEvent };
    }

    // 2) Uncapped running activity hourly checkpoint reminder (never auto-stops!).
    if (
      activeRow.auto_stop_at_ms === null &&
      activeRow.suspend_ms === null &&
      activeRow.review_due_at_ms !== null &&
      nowMs >= activeRow.review_due_at_ms
    ) {
      const checkpointEvent = emitTimeEventTx(conn, {
        dedupKey: `checkpoint:${activeRow.id}:${activeRow.review_due_at_ms}`,
        kind: "checkpoint_due",
        activityId: activeRow.id,
        title: activeRow.title,
        message: `${activeRow.title} 已连续计时，请确认是否仍在进行`,
        occurredAtMs: activeRow.review_due_at_ms,
        payload: {
          reviewDueAtMs: activeRow.review_due_at_ms,
          confirmedThroughMs:
            activeRow.confirmed_through_ms ?? activeRow.start_ms,
        },
        createdAtMs: nowMs,
      });
      return { checkpointEvent };
    }

    return {};
  }

  function needsDueSettlement(conn: DatabaseSync, nowMs: number): boolean {
    if (restoring) return false;
    const meta = readMeta(conn);
    if (!meta.active_activity_id) return false;
    const activeRow = conn
      .prepare(
        "SELECT id, end_ms, suspend_ms, auto_stop_at_ms, review_due_at_ms, timer_stopped_at_ms FROM activities WHERE id = ?",
      )
      .get(meta.active_activity_id) as
      | Pick<
          ActivityRow,
          | "id"
          | "end_ms"
          | "suspend_ms"
          | "auto_stop_at_ms"
          | "review_due_at_ms"
          | "timer_stopped_at_ms"
        >
      | undefined;
    if (!activeRow || activeRow.end_ms !== null) return false;
    if (
      activeRow.auto_stop_at_ms !== null &&
      nowMs >= activeRow.auto_stop_at_ms
    ) {
      // Avoid redundant write transactions when already frozen under pending_reconcile.
      if (
        activeRow.suspend_ms !== null &&
        activeRow.suspend_ms <= activeRow.auto_stop_at_ms &&
        activeRow.timer_stopped_at_ms !== null &&
        getUnresolvedTimerHolders(conn).length > 0
      ) {
        return false;
      }
      return true;
    }
    if (
      activeRow.auto_stop_at_ms === null &&
      activeRow.suspend_ms === null &&
      activeRow.review_due_at_ms !== null &&
      nowMs >= activeRow.review_due_at_ms
    ) {
      const existingEvent = conn
        .prepare("SELECT 1 FROM time_events WHERE dedup_key = ?")
        .get(`checkpoint:${activeRow.id}:${activeRow.review_due_at_ms}`);
      return !existingEvent;
    }
    return false;
  }

  function settleDueTimers(atMs?: number): {
    settled: boolean;
    activity?: Activity;
    event?: TimeEvent;
  } {
    if (restoring) return { settled: false };
    const conn = assertOpen();
    const ts = atMs ?? nowFn();
    if (!needsDueSettlement(conn, ts)) {
      return { settled: false };
    }
    const res = inImmediateTx((txConn) => settleDueTimersTx(txConn, ts));
    if (res.settledActivity) {
      notifyScheduleListeners();
    }
    return {
      settled: Boolean(res.settledActivity),
      ...(res.settledActivity ? { activity: res.settledActivity } : {}),
      ...(res.autoStopEvent
        ? { event: res.autoStopEvent }
        : res.checkpointEvent
          ? { event: res.checkpointEvent }
          : {}),
    };
  }

  function getNextAutoStopDeadline(): number | null {
    if (restoring) return null;
    try {
      const conn = assertOpen();
      const meta = readMeta(conn);
      if (!meta.active_activity_id) return null;
      const active = conn
        .prepare(
          "SELECT end_ms, auto_stop_at_ms, review_due_at_ms FROM activities WHERE id = ?",
        )
        .get(meta.active_activity_id) as
        | {
            end_ms: number | null;
            auto_stop_at_ms: number | null;
            review_due_at_ms: number | null;
          }
        | undefined;
      if (!active || active.end_ms !== null) return null;
      if (active.auto_stop_at_ms !== null) return active.auto_stop_at_ms;
      if (active.review_due_at_ms !== null) return active.review_due_at_ms;
      return null;
    } catch {
      return null;
    }
  }

  function subscribeScheduleChanges(listener: () => void): () => void {
    scheduleListeners.add(listener);
    return () => {
      scheduleListeners.delete(listener);
    };
  }

  function saveOperationReceipt(
    conn: DatabaseSync,
    params: {
      idempotencyKey: string;
      operationId: string;
      kind: string;
      inputHash: string;
      meta: MetaRow;
      receivedAtMs: number;
      state: OperationState;
      targetActivityId?: string;
      targetTaskUuid?: string;
      effectiveAtMs?: number;
      receipt: Record<string, unknown>;
      nowMs: number;
    },
  ): void {
    conn
      .prepare(
        `INSERT INTO operations (
          idempotency_key, operation_id, kind, input_hash,
          time_epoch, task_data_epoch, received_at_ms, state,
          target_activity_id, target_task_uuid, pre_state_json, dependencies_json,
          effective_at_ms, external_disposition, undone_by_operation_id,
          receipt_json, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?)`,
      )
      .run(
        params.idempotencyKey,
        params.operationId,
        params.kind,
        params.inputHash,
        params.meta.time_epoch,
        params.meta.task_data_epoch,
        params.receivedAtMs,
        params.state,
        params.targetActivityId ?? null,
        params.targetTaskUuid ?? null,
        params.effectiveAtMs ?? null,
        JSON.stringify(params.receipt),
        params.nowMs,
        params.nowMs,
      );
  }

  function getStatus() {
    settleDueTimers();
    const conn = assertOpen();
    const meta = readMeta(conn);
    const activeRow = meta.active_activity_id
      ? (conn
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(meta.active_activity_id) as ActivityRow | undefined)
      : undefined;
    const pendingCount = (
      conn
        .prepare(
          "SELECT COUNT(*) as cnt FROM operations WHERE state IN ('prepared', 'external_acknowledged', 'pending_reconcile')",
        )
        .get() as { cnt: number }
    ).cnt;
    return {
      initialized: meta.initialized === 1,
      enabled: meta.enabled === 1,
      schemaVersion: meta.schema_version,
      timeEpoch: meta.time_epoch,
      taskDataEpoch: meta.task_data_epoch,
      restoreBarrierAt: meta.restore_barrier_at,
      sessionVersion: meta.session_version,
      cutoverAtMs: meta.cutover_at_ms ?? undefined,
      activeActivity: activeRow ? rowToActivity(activeRow) : null,
      pendingOperationsCount: pendingCount,
      policy: parsePolicy(meta),
    };
  }

  function getPolicy(): TimePolicy {
    const conn = assertOpen();
    return parsePolicy(readMeta(conn));
  }

  function updatePolicy(input: {
    idempotencyKey?: string;
    expectedPolicyVersion: number;
    patch: Partial<Omit<TimePolicy, "policyVersion">>;
    receivedAtMs?: number;
  }): TimePolicy {
    const key = input.idempotencyKey ?? `policy:${randomUUID()}`;
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const normalized = {
      expectedPolicyVersion: input.expectedPolicyVersion,
      patch: input.patch,
    };
    const inputHash = hashNormalizedInput("policy_update", normalized);

    return inImmediateTx((conn) => {
      const meta = readMeta(conn);
      const hit = checkExistingOperation<{ policy: TimePolicy }>(
        conn,
        meta,
        key,
        inputHash,
        receivedAtMs,
      );
      if (hit.hit) return hit.receipt.policy;

      const current = parsePolicy(meta);
      if (current.policyVersion !== input.expectedPolicyVersion) {
        throw new TimeStoreError(
          409,
          "POLICY_VERSION_CONFLICT",
          "Time policy changed in another session. Reload before saving.",
          { currentVersion: current.policyVersion },
        );
      }

      const sleepChanged =
        input.patch.sleepTemplate &&
        (input.patch.sleepTemplate.startTime !==
          current.sleepTemplate.startTime ||
          input.patch.sleepTemplate.endTime !== current.sleepTemplate.endTime ||
          input.patch.sleepTemplate.enabled !== current.sleepTemplate.enabled ||
          (input.patch.sleepTemplate.tag?.trim() || undefined) !== current.sleepTemplate.tag);

      const nextPolicy = validatePolicy({
        ...current,
        ...input.patch,
        sleepTemplate: input.patch.sleepTemplate
          ? {
              ...current.sleepTemplate,
              ...input.patch.sleepTemplate,
              version: sleepChanged
                ? current.sleepTemplate.version + 1
                : current.sleepTemplate.version,
            }
          : current.sleepTemplate,
        policyVersion: current.policyVersion + 1,
      });

      const ts = nowFn();
      conn
        .prepare(
          "UPDATE time_meta SET policy_version = ?, policy_json = ?, updated_at_ms = ? WHERE id = 1",
        )
        .run(nextPolicy.policyVersion, JSON.stringify(nextPolicy), ts);

      const operationId = randomUUID();
      saveOperationReceipt(conn, {
        idempotencyKey: key,
        operationId,
        kind: "policy_update",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        receipt: { operationId, policy: nextPolicy },
        nowMs: ts,
      });

      return nextPolicy;
    });
  }

  function closeActiveRowTx(
    conn: DatabaseSync,
    activeRow: ActivityRow,
    effectiveAtMs: number,
    ts: number,
    policy: TimePolicy,
    options: { stopReason?: ActivityStopReason } = {},
  ): {
    closedActivity: Activity;
    modifiedEntry: UndoMetadata["modifiedActivities"][number];
    warning?: TimeWarning;
  } {
    if (activeRow.start_ms !== null && effectiveAtMs < activeRow.start_ms) {
      throw new TimeStoreError(
        409,
        "INVALID_TIMER_BOUNDARY",
        "Stop timestamp cannot be earlier than start time.",
      );
    }
    let closeEndMs = effectiveAtMs;
    if (activeRow.suspend_ms !== null) {
      closeEndMs = Math.min(closeEndMs, activeRow.suspend_ms);
    }
    if (activeRow.auto_stop_at_ms !== null) {
      closeEndMs = Math.min(closeEndMs, activeRow.auto_stop_at_ms);
    }
    if (activeRow.start_ms !== null && closeEndMs > activeRow.start_ms) {
      const closingOverlaps = findLocatedOverlaps(
        conn,
        activeRow.start_ms,
        closeEndMs,
        closeEndMs,
        activeRow.id,
      );
      if (closingOverlaps.length > 0) {
        throw new TimeStoreError(
          409,
          "INTERVAL_CONFLICT",
          "Closing active interval overlaps with another recorded activity.",
          { conflicts: closingOverlaps },
        );
      }
    }
    const { reviewState, warning } = maybeLongActivityWarning(
      activeRow,
      closeEndMs,
      policy,
    );
    const stopReason: ActivityStopReason = options.stopReason ?? "manual_stop";
    const keepUnconfirmed =
      Boolean(warning) || activeRow.review_state === "review_required";
    const nextConfirmedThrough = keepUnconfirmed
      ? (activeRow.confirmed_through_ms ?? activeRow.start_ms ?? null)
      : closeEndMs;
    const nextReviewReason: ActivityReviewReason | null = warning
      ? "long_activity"
      : activeRow.review_state === "review_required"
        ? activeRow.review_reason
        : null;
    const nextVersion = activeRow.version + 1;
    const modifiedEntry: UndoMetadata["modifiedActivities"][number] = {
      id: activeRow.id,
      expectedPostVersion: nextVersion,
      restore: captureSnapshotFields(activeRow),
    };
    conn
      .prepare(
        `UPDATE activities
         SET end_ms = ?,
             confirmed_through_ms = ?,
             review_due_at_ms = NULL,
             review_reason = ?,
             review_state = ?,
             timer_stopped_at_ms = ?,
             stop_reason = ?,
             processed_at_ms = ?,
             version = ?,
             updated_at_ms = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        closeEndMs,
        nextConfirmedThrough,
        nextReviewReason,
        reviewState,
        closeEndMs,
        stopReason,
        ts,
        nextVersion,
        ts,
        activeRow.id,
        activeRow.version,
      );
    const closedActivity = rowToActivity(
      conn
        .prepare("SELECT * FROM activities WHERE id = ?")
        .get(activeRow.id) as ActivityRow,
    );
    return { closedActivity, modifiedEntry, warning };
  }

  function openNewActiveRowTx(
    conn: DatabaseSync,
    meta: MetaRow,
    input: {
      title: string;
      explicitCategoryId?: string;
      taskUuid?: string;
      projectSnapshot?: string;
      tags?: string[];
      source?: ActivitySource;
      note?: string;
      rawInput?: string;
      effectiveAtMs: number;
      timingPlanId?: string;
      autoStopAtMs?: number;
      autoStopBasis?: TimingPlanStopBasis;
      limitVersion?: number;
    },
    ts: number,
    policy: TimePolicy,
  ): { newActivity: Activity; nextSessionVersion: number } {
    const overlaps = findLocatedOverlaps(
      conn,
      input.effectiveAtMs,
      input.effectiveAtMs + 1,
      input.effectiveAtMs + 1,
    );
    if (overlaps.length > 0) {
      throw new TimeStoreError(
        409,
        "INTERVAL_CONFLICT",
        "Start timestamp falls inside an existing logged interval.",
        { conflicts: overlaps },
      );
    }
    const classificationInput: ClassificationInput = {
      explicitCategoryId: input.explicitCategoryId,
      taskUuid: input.taskUuid,
      project: input.projectSnapshot,
      tags: input.tags,
    };
    const classified = resolveActivityCategory(policy, classificationInput);
    const reviewDueAtMs =
      input.autoStopAtMs === undefined
        ? input.effectiveAtMs + DEFAULT_CHECKPOINT_INTERVAL_SECONDS * 1000
        : undefined;
    const tags = normalizeActivityTags(input.tags);
    const hourlyRateCents = isSleepCategory(policy, classified.categoryId)
      ? 0
      : hourlyRateForTags(policy, tags);
    const newActivity: Activity = {
      id: randomUUID(),
      version: 1,
      kind: "located",
      title: input.title,
      categoryId: classified.categoryId,
      ruleVersion: classified.ruleVersion,
      ruleSource: classified.ruleSource,
      ...(input.taskUuid ? { taskUuid: input.taskUuid } : {}),
      ...(input.projectSnapshot
        ? { projectSnapshot: input.projectSnapshot }
        : {}),
      ...(tags.length > 0 ? { tags } : {}),
      hourlyRateCents,
      startMs: input.effectiveAtMs,
      confirmedThroughMs: input.effectiveAtMs,
      ...(reviewDueAtMs !== undefined ? { reviewDueAtMs } : {}),
      ...(input.timingPlanId ? { timingPlanId: input.timingPlanId } : {}),
      ...(input.autoStopAtMs !== undefined
        ? { autoStopAtMs: input.autoStopAtMs }
        : {}),
      ...(input.autoStopBasis ? { autoStopBasis: input.autoStopBasis } : {}),
      ...(input.limitVersion !== undefined
        ? { limitVersion: input.limitVersion }
        : {}),
      precision: "exact",
      source: input.source ?? "timer",
      reviewState: "ok",
      ...(input.rawInput ? { rawInput: input.rawInput } : {}),
      ...(input.note ? { note: input.note } : {}),
      timezone: policy.timezone,
      createdAtMs: ts,
      updatedAtMs: ts,
    };
    insertActivityRow(conn, newActivity);
    const nextSessionVersion = meta.session_version + 1;
    conn
      .prepare(
        "UPDATE time_meta SET active_activity_id = ?, session_version = ?, updated_at_ms = ? WHERE id = 1",
      )
      .run(newActivity.id, nextSessionVersion, ts);
    return { newActivity, nextSessionVersion };
  }

  function startActivity(input: {
    idempotencyKey: string;
    receivedAtMs?: number;
    effectiveAtMs?: number;
    title?: string;
    explicitCategoryId?: string;
    taskUuid?: string;
    projectSnapshot?: string;
    tags?: string[];
    source?: ActivitySource;
    note?: string;
    rawInput?: string;
    timingPlanId?: string;
    sameTaskNoop?: boolean;
    expectedSessionVersion?: number;
  }): ActivityMutationReceipt {
    const rawTitle = input.title?.trim() ?? "";
    if (!input.timingPlanId && (!rawTitle || rawTitle.length > 500)) {
      throw new TimeStoreError(
        400,
        "INVALID_TITLE",
        "Activity title must be 1 to 500 characters.",
      );
    }
    if (rawTitle.length > 500) {
      throw new TimeStoreError(
        400,
        "INVALID_TITLE",
        "Activity title must be 1 to 500 characters.",
      );
    }
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const effectiveAtMs = input.effectiveAtMs ?? nowFn();
    const normalized = {
      title: rawTitle,
      explicitCategoryId: input.explicitCategoryId,
      taskUuid: input.taskUuid,
      projectSnapshot: input.projectSnapshot,
      tags: input.tags,
      source: input.source ?? "timer",
      note: input.note,
      rawInput: input.rawInput,
      timingPlanId: input.timingPlanId,
      sameTaskNoop: Boolean(input.sameTaskNoop),
      expectedSessionVersion: input.expectedSessionVersion,
    };
    const inputHash = hashNormalizedInput("start", normalized);

    const receipt = inImmediateTx((conn) => {
      const initialMeta = readMeta(conn);
      const hit = checkExistingOperation<ActivityMutationReceipt>(
        conn,
        initialMeta,
        input.idempotencyKey,
        inputHash,
        receivedAtMs,
      );
      if (hit.hit) return { receipt: hit.receipt, mutated: false };

      assertTimerSlotAvailable(conn);

      const ts = nowFn();
      const settlement = settleDueTimersTx(conn, ts);
      const meta = readMeta(conn);

      if (
        input.expectedSessionVersion !== undefined &&
        input.expectedSessionVersion !== meta.session_version
      ) {
        throw new TimeStoreError(
          409,
          "SESSION_VERSION_CONFLICT",
          "Timer state changed in another window. Refresh before continuing.",
          { sessionVersion: meta.session_version },
        );
      }

      const policy = parsePolicy(meta);
      const warnings: TimeWarning[] = [];
      const modifiedActivities: UndoMetadata["modifiedActivities"] = [];

      const activeRow = meta.active_activity_id
        ? (conn
            .prepare("SELECT * FROM activities WHERE id = ?")
            .get(meta.active_activity_id) as ActivityRow | undefined)
        : undefined;

      let resolvedTitle = rawTitle;
      let resolvedCategoryId = input.explicitCategoryId;
      let resolvedTaskUuid = input.taskUuid;
      let resolvedProjectSnapshot = input.projectSnapshot;
      let resolvedTags = input.tags;
      let resolvedNote = input.note;
      let autoStopAtMs: number | undefined;
      let autoStopBasis: TimingPlanStopBasis | undefined;
      let limitVersion: number | undefined;

      if (input.timingPlanId) {
        const planRow = conn
          .prepare("SELECT * FROM timing_plans WHERE id = ?")
          .get(input.timingPlanId) as TimingPlanRow | undefined;
        if (!planRow || planRow.archived_at_ms !== null) {
          throw new TimeStoreError(
            404,
            "TIMING_PLAN_NOT_FOUND",
            "Timing plan not found or archived.",
          );
        }
        if (
          activeRow &&
          activeRow.end_ms === null &&
          activeRow.suspend_ms === null &&
          activeRow.timing_plan_id === planRow.id
        ) {
          throw new TimeStoreError(
            409,
            "PLAN_ALREADY_ACTIVE",
            "This timing plan already has an active running timer.",
            { activeActivityId: activeRow.id, planId: planRow.id },
          );
        }
        if (
          planRow.hard_stop_at_ms !== null &&
          effectiveAtMs >= planRow.hard_stop_at_ms
        ) {
          throw new TimeStoreError(
            409,
            "TIMING_PLAN_EXPIRED",
            "原安排最晚停止时间已过，请重新安排或调整时间后再开始。",
            {
              planId: planRow.id,
              hardStopAtMs: planRow.hard_stop_at_ms,
            },
          );
        }
        const planState = buildTimingPlanTx(conn, planRow, effectiveAtMs);
        if (
          planState.remainingSeconds !== undefined &&
          planState.remainingSeconds <= 0
        ) {
          throw new TimeStoreError(
            409,
            "TIME_ALLOWANCE_EXHAUSTED",
            "本次安排的计时额度已用完，请增加时长或新建安排。",
            {
              planId: planRow.id,
              consumedSeconds: planState.consumedSeconds,
            },
          );
        }
        const stopLimit = computeStopLimit({
          startMs: effectiveAtMs,
          remainingAllowanceSeconds: planState.remainingSeconds,
          hardStopAtMs: planState.hardStopAtMs,
        });
        if (
          stopLimit.autoStopAtMs !== undefined &&
          stopLimit.autoStopAtMs <= effectiveAtMs
        ) {
          throw new TimeStoreError(
            409,
            "TIMING_PLAN_EXPIRED",
            "已无可用剩余时长，无法开始。",
            { planId: planRow.id },
          );
        }
        autoStopAtMs = stopLimit.autoStopAtMs;
        autoStopBasis = stopLimit.autoStopBasis;
        limitVersion = planRow.version;
        resolvedTitle = resolvedTitle || planState.title;
        resolvedCategoryId = resolvedCategoryId ?? planState.categoryId;
        resolvedTaskUuid = resolvedTaskUuid ?? planState.taskUuid;
        resolvedProjectSnapshot =
          resolvedProjectSnapshot ?? planState.projectSnapshot;
        resolvedTags = resolvedTags ?? planState.tags;
        resolvedNote = resolvedNote ?? planState.note;
      }

      if (!resolvedTitle || resolvedTitle.length > 500) {
        throw new TimeStoreError(
          400,
          "INVALID_TITLE",
          "Activity title must be 1 to 500 characters.",
        );
      }

      if (
        !input.timingPlanId &&
        activeRow &&
        input.sameTaskNoop &&
        input.taskUuid &&
        activeRow.task_uuid?.toLowerCase() === input.taskUuid.toLowerCase() &&
        activeRow.end_ms === null &&
        activeRow.suspend_ms === null
      ) {
        const operationId = randomUUID();
        const sameReceipt: ActivityMutationReceipt = {
          operationId,
          idempotencyKey: input.idempotencyKey,
          changed: false,
          activity: rowToActivity(activeRow),
          warnings: [],
          sessionVersion: meta.session_version,
          timeEpoch: meta.time_epoch,
          taskDataEpoch: meta.task_data_epoch,
        };
        saveOperationReceipt(conn, {
          idempotencyKey: input.idempotencyKey,
          operationId,
          kind: "start",
          inputHash,
          meta,
          receivedAtMs,
          state: "skipped_already_satisfied",
          targetActivityId: activeRow.id,
          targetTaskUuid: input.taskUuid,
          effectiveAtMs,
          receipt: sameReceipt,
          nowMs: ts,
        });
        return {
          receipt: sameReceipt,
          mutated: Boolean(settlement.settledActivity),
        };
      }

      let closedActivity: Activity | undefined;
      if (activeRow && activeRow.end_ms === null) {
        const closedRes = closeActiveRowTx(
          conn,
          activeRow,
          effectiveAtMs,
          ts,
          policy,
          { stopReason: "manual_switch" },
        );
        closedActivity = closedRes.closedActivity;
        modifiedActivities.push(closedRes.modifiedEntry);
        if (closedRes.warning) warnings.push(closedRes.warning);
      }

      const { newActivity, nextSessionVersion } = openNewActiveRowTx(
        conn,
        meta,
        {
          title: resolvedTitle,
          explicitCategoryId: resolvedCategoryId,
          taskUuid: resolvedTaskUuid,
          projectSnapshot: resolvedProjectSnapshot,
          tags: resolvedTags,
          source: input.source,
          note: resolvedNote,
          rawInput: input.rawInput,
          effectiveAtMs,
          timingPlanId: input.timingPlanId,
          autoStopAtMs,
          autoStopBasis,
          limitVersion,
        },
        ts,
        policy,
      );

      const operationId = randomUUID();
      const undo: UndoMetadata = {
        createdActivityId: newActivity.id,
        createdPostVersion: 1,
        modifiedActivities,
        touchedTimer: true,
        expectedPostActiveActivityId: newActivity.id,
        restoreActiveActivityId: activeRow?.id ?? null,
      };
      const appliedReceipt: ActivityMutationReceipt = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        changed: true,
        activity: newActivity,
        ...(closedActivity ? { closedActivity } : {}),
        warnings,
        sessionVersion: nextSessionVersion,
        timeEpoch: meta.time_epoch,
        taskDataEpoch: meta.task_data_epoch,
        undo,
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId,
        kind: "start",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: newActivity.id,
        targetTaskUuid: resolvedTaskUuid,
        effectiveAtMs,
        receipt: appliedReceipt,
        nowMs: ts,
      });
      return { receipt: appliedReceipt, mutated: true };
    });

    if (receipt.mutated) notifyScheduleListeners();
    return receipt.receipt;
  }

  function stopActivity(input: {
    idempotencyKey: string;
    receivedAtMs?: number;
    effectiveAtMs?: number;
    expectedActivityId?: string;
    expectedVersion?: number;
    expectedSessionVersion?: number;
    pause?: boolean;
  }): ActivityMutationReceipt {
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const effectiveAtMs = input.effectiveAtMs ?? nowFn();
    const normalized = {
      expectedActivityId: input.expectedActivityId,
      expectedVersion: input.expectedVersion,
      expectedSessionVersion: input.expectedSessionVersion,
      pause: Boolean(input.pause),
    };
    const inputHash = hashNormalizedInput("stop", normalized);

    const outcome = inImmediateTx((conn) => {
      const initialMeta = readMeta(conn);
      const hit = checkExistingOperation<ActivityMutationReceipt>(
        conn,
        initialMeta,
        input.idempotencyKey,
        inputHash,
        receivedAtMs,
      );
      if (hit.hit) return { receipt: hit.receipt, mutated: false };

      assertTimerSlotAvailable(conn);

      const ts = nowFn();
      settleDueTimersTx(conn, ts);
      const meta = readMeta(conn);

      if (
        input.expectedSessionVersion !== undefined &&
        input.expectedSessionVersion !== meta.session_version
      ) {
        throw new TimeStoreError(
          409,
          "SESSION_VERSION_CONFLICT",
          "Timer session changed in another window. Refresh before stopping.",
          { sessionVersion: meta.session_version },
        );
      }

      if (!meta.active_activity_id) {
        throw new TimeStoreError(
          409,
          "NO_ACTIVE_ACTIVITY",
          "No active activity is currently running.",
        );
      }

      const activeRow = conn
        .prepare("SELECT * FROM activities WHERE id = ?")
        .get(meta.active_activity_id) as ActivityRow | undefined;
      if (!activeRow || activeRow.end_ms !== null) {
        throw new TimeStoreError(
          409,
          "NO_ACTIVE_ACTIVITY",
          "No active activity is currently running.",
        );
      }

      if (
        input.expectedActivityId !== undefined &&
        activeRow.id !== input.expectedActivityId
      ) {
        throw new TimeStoreError(
          409,
          "ACTIVE_ACTIVITY_MISMATCH",
          "Active activity changed before stop was applied.",
          { activeActivityId: activeRow.id },
        );
      }
      if (
        input.expectedVersion !== undefined &&
        activeRow.version !== input.expectedVersion
      ) {
        throw new TimeStoreError(
          409,
          "ACTIVITY_VERSION_CONFLICT",
          "Active activity was modified concurrently.",
          { currentVersion: activeRow.version },
        );
      }
      const policy = parsePolicy(meta);
      const {
        closedActivity: closed,
        modifiedEntry,
        warning,
      } = closeActiveRowTx(conn, activeRow, effectiveAtMs, ts, policy, {
        stopReason: input.pause ? "manual_pause" : "manual_stop",
      });
      const warnings = warning ? [warning] : [];

      const nextSessionVersion = meta.session_version + 1;
      conn
        .prepare(
          "UPDATE time_meta SET active_activity_id = NULL, session_version = ?, updated_at_ms = ? WHERE id = 1",
        )
        .run(nextSessionVersion, ts);

      const operationId = randomUUID();
      const appliedReceipt: ActivityMutationReceipt = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        changed: true,
        activity: closed,
        warnings,
        sessionVersion: nextSessionVersion,
        timeEpoch: meta.time_epoch,
        taskDataEpoch: meta.task_data_epoch,
        undo: {
          modifiedActivities: [modifiedEntry],
          touchedTimer: true,
          expectedPostActiveActivityId: null,
          restoreActiveActivityId: activeRow.id,
        },
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId,
        kind: "stop",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: closed.id,
        targetTaskUuid: closed.taskUuid,
        effectiveAtMs,
        receipt: appliedReceipt,
        nowMs: ts,
      });
      return { receipt: appliedReceipt, mutated: true };
    });

    if (outcome.mutated) notifyScheduleListeners();
    return outcome.receipt;
  }

  function logLocatedActivity(input: {
    idempotencyKey: string;
    receivedAtMs?: number;
    title: string;
    startMs: number;
    endMs: number;
    explicitCategoryId?: string;
    taskUuid?: string;
    projectSnapshot?: string;
    tags?: string[];
    precision?: "exact" | "estimated_bounds";
    source?: ActivitySource;
    note?: string;
    rawInput?: string;
  }): ActivityMutationReceipt {
    const title = input.title.trim();
    if (!title || title.length > 500) {
      throw new TimeStoreError(
        400,
        "INVALID_TITLE",
        "Activity title must be 1 to 500 characters.",
      );
    }
    if (
      !Number.isFinite(input.startMs) ||
      !Number.isFinite(input.endMs) ||
      input.endMs <= input.startMs
    ) {
      throw new TimeStoreError(
        400,
        "INVALID_INTERVAL",
        "End time must be strictly after start time.",
      );
    }

    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const normalized = {
      title,
      startMs: input.startMs,
      endMs: input.endMs,
      explicitCategoryId: input.explicitCategoryId,
      taskUuid: input.taskUuid,
      projectSnapshot: input.projectSnapshot,
      tags: input.tags,
      precision: input.precision ?? "exact",
      source: input.source ?? "manual",
      note: input.note,
      rawInput: input.rawInput,
    };
    const inputHash = hashNormalizedInput("log_located", normalized);

    return inImmediateTx((conn) => {
      const meta = readMeta(conn);
      const hit = checkExistingOperation<ActivityMutationReceipt>(
        conn,
        meta,
        input.idempotencyKey,
        inputHash,
        receivedAtMs,
      );
      if (hit.hit) return hit.receipt;

      const ts = nowFn();
      const settlement = settleDueTimersTx(conn, ts);
      const settledMeta = settlement.settledActivity ? readMeta(conn) : meta;
      const overlaps = findLocatedOverlaps(
        conn,
        input.startMs,
        input.endMs,
        ts,
      );
      if (overlaps.length > 0) {
        throw new TimeStoreError(
          409,
          "INTERVAL_CONFLICT",
          "Activity overlaps with existing recorded time.",
          { conflicts: overlaps },
        );
      }

      const policy = parsePolicy(settledMeta);
      const classified = resolveActivityCategory(policy, {
        explicitCategoryId: input.explicitCategoryId,
        taskUuid: input.taskUuid,
        project: input.projectSnapshot,
        tags: input.tags,
      });
      const tags = normalizeActivityTags(input.tags);
      const hourlyRateCents = isSleepCategory(policy, classified.categoryId)
        ? 0
        : hourlyRateForTags(policy, tags);

      const activity: Activity = {
        id: randomUUID(),
        version: 1,
        kind: "located",
        title,
        categoryId: classified.categoryId,
        ruleVersion: classified.ruleVersion,
        ruleSource: classified.ruleSource,
        ...(input.taskUuid ? { taskUuid: input.taskUuid } : {}),
        ...(input.projectSnapshot
          ? { projectSnapshot: input.projectSnapshot }
          : {}),
        ...(tags.length > 0 ? { tags } : {}),
        hourlyRateCents,
        startMs: input.startMs,
        endMs: input.endMs,
        confirmedThroughMs: input.endMs,
        precision: input.precision ?? "exact",
        source: input.source ?? "manual",
        reviewState: "ok",
        ...(input.rawInput ? { rawInput: input.rawInput } : {}),
        ...(input.note ? { note: input.note } : {}),
        timezone: policy.timezone,
        createdAtMs: ts,
        updatedAtMs: ts,
      };

      insertActivityRow(conn, activity);

      const operationId = randomUUID();
      const receipt: ActivityMutationReceipt = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        changed: true,
        activity,
        warnings: [],
        sessionVersion: meta.session_version,
        timeEpoch: meta.time_epoch,
        taskDataEpoch: meta.task_data_epoch,
        undo: {
          createdActivityId: activity.id,
          createdPostVersion: 1,
          modifiedActivities: [],
          touchedTimer: false,
          expectedPostActiveActivityId: meta.active_activity_id,
          restoreActiveActivityId: meta.active_activity_id,
        },
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId,
        kind: "log_located",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: activity.id,
        targetTaskUuid: input.taskUuid,
        receipt,
        nowMs: ts,
      });
      return receipt;
    });
  }

  function logUnlocatedEstimate(input: {
    idempotencyKey: string;
    receivedAtMs?: number;
    title: string;
    estimatedSeconds: number;
    targetDate?: string;
    windowStartMs?: number;
    windowEndMs?: number;
    explicitCategoryId?: string;
    taskUuid?: string;
    projectSnapshot?: string;
    tags?: string[];
    source?: ActivitySource;
    note?: string;
    rawInput?: string;
  }): ActivityMutationReceipt {
    const title = input.title.trim();
    if (!title || title.length > 500) {
      throw new TimeStoreError(
        400,
        "INVALID_TITLE",
        "Activity title must be 1 to 500 characters.",
      );
    }
    if (
      !Number.isFinite(input.estimatedSeconds) ||
      input.estimatedSeconds <= 0
    ) {
      throw new TimeStoreError(
        400,
        "INVALID_ESTIMATE",
        "Estimated duration must be positive.",
      );
    }
    const hasStart = input.windowStartMs !== undefined;
    const hasEnd = input.windowEndMs !== undefined;
    if (hasStart !== hasEnd) {
      throw new TimeStoreError(
        400,
        "INVALID_WINDOW",
        "Both windowStartMs and windowEndMs are required when specifying a window.",
      );
    }
    if (hasStart && hasEnd && input.windowEndMs! <= input.windowStartMs!) {
      throw new TimeStoreError(
        400,
        "INVALID_WINDOW",
        "Window end time must be after window start time.",
      );
    }
    if (input.targetDate) parseLocalDate(input.targetDate);

    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const normalized = {
      title,
      estimatedSeconds: Math.round(input.estimatedSeconds),
      targetDate: input.targetDate,
      windowStartMs: input.windowStartMs,
      windowEndMs: input.windowEndMs,
      explicitCategoryId: input.explicitCategoryId,
      taskUuid: input.taskUuid,
      projectSnapshot: input.projectSnapshot,
      tags: input.tags,
      source: input.source ?? "bot",
      note: input.note,
      rawInput: input.rawInput,
    };
    const inputHash = hashNormalizedInput("log_estimate", normalized);

    return inImmediateTx((conn) => {
      const meta = readMeta(conn);
      const hit = checkExistingOperation<ActivityMutationReceipt>(
        conn,
        meta,
        input.idempotencyKey,
        inputHash,
        receivedAtMs,
      );
      if (hit.hit) return hit.receipt;

      const policy = parsePolicy(meta);
      const ts = nowFn();
      const targetDate =
        input.targetDate ??
        (input.windowStartMs !== undefined
          ? localDateOf(input.windowStartMs, policy.timezone)
          : localDateOf(receivedAtMs, policy.timezone));

      const classified = resolveActivityCategory(policy, {
        explicitCategoryId: input.explicitCategoryId,
        taskUuid: input.taskUuid,
        project: input.projectSnapshot,
        tags: input.tags,
      });
      const tags = normalizeActivityTags(input.tags);
      const hourlyRateCents = isSleepCategory(policy, classified.categoryId)
        ? 0
        : hourlyRateForTags(policy, tags);

      const activity: Activity = {
        id: randomUUID(),
        version: 1,
        kind: "unlocated_estimate",
        title,
        categoryId: classified.categoryId,
        ruleVersion: classified.ruleVersion,
        ruleSource: classified.ruleSource,
        ...(input.taskUuid ? { taskUuid: input.taskUuid } : {}),
        ...(input.projectSnapshot
          ? { projectSnapshot: input.projectSnapshot }
          : {}),
        ...(tags.length > 0 ? { tags } : {}),
        hourlyRateCents,
        ...(input.windowStartMs !== undefined
          ? { windowStartMs: input.windowStartMs }
          : {}),
        ...(input.windowEndMs !== undefined
          ? { windowEndMs: input.windowEndMs }
          : {}),
        targetDate,
        estimatedSeconds: Math.round(input.estimatedSeconds),
        precision: "estimated_duration",
        source: input.source ?? "bot",
        reviewState: "ok",
        ...(input.rawInput ? { rawInput: input.rawInput } : {}),
        ...(input.note ? { note: input.note } : {}),
        timezone: policy.timezone,
        createdAtMs: ts,
        updatedAtMs: ts,
      };

      insertActivityRow(conn, activity);

      const operationId = randomUUID();
      const receipt: ActivityMutationReceipt = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        changed: true,
        activity,
        warnings: [],
        sessionVersion: meta.session_version,
        timeEpoch: meta.time_epoch,
        taskDataEpoch: meta.task_data_epoch,
        undo: {
          createdActivityId: activity.id,
          createdPostVersion: 1,
          modifiedActivities: [],
          touchedTimer: false,
          expectedPostActiveActivityId: meta.active_activity_id,
          restoreActiveActivityId: meta.active_activity_id,
        },
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId,
        kind: "log_estimate",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: activity.id,
        targetTaskUuid: input.taskUuid,
        receipt,
        nowMs: ts,
      });
      return receipt;
    });
  }

  function locateEstimate(input: {
    idempotencyKey: string;
    receivedAtMs?: number;
    activityId: string;
    expectedVersion: number;
    startMs: number;
    endMs: number;
    precision?: "exact" | "estimated_bounds";
  }): ActivityMutationReceipt {
    if (
      !Number.isFinite(input.startMs) ||
      !Number.isFinite(input.endMs) ||
      input.endMs <= input.startMs
    ) {
      throw new TimeStoreError(
        400,
        "INVALID_INTERVAL",
        "End time must be strictly after start time.",
      );
    }

    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const normalized = {
      activityId: input.activityId,
      expectedVersion: input.expectedVersion,
      startMs: input.startMs,
      endMs: input.endMs,
      precision: input.precision ?? "estimated_bounds",
    };
    const inputHash = hashNormalizedInput("locate_estimate", normalized);

    return inImmediateTx((conn) => {
      const meta = readMeta(conn);
      const hit = checkExistingOperation<ActivityMutationReceipt>(
        conn,
        meta,
        input.idempotencyKey,
        inputHash,
        receivedAtMs,
      );
      if (hit.hit) return hit.receipt;

      const row = conn
        .prepare("SELECT * FROM activities WHERE id = ?")
        .get(input.activityId) as ActivityRow | undefined;
      if (!row || row.review_state === "voided") {
        throw new TimeStoreError(
          404,
          "ACTIVITY_NOT_FOUND",
          "Estimate activity was not found.",
        );
      }
      if (row.version !== input.expectedVersion) {
        throw new TimeStoreError(
          409,
          "ACTIVITY_VERSION_CONFLICT",
          "Estimate was modified concurrently. Refresh before locating.",
          { currentVersion: row.version },
        );
      }
      if (row.kind !== "unlocated_estimate") {
        throw new TimeStoreError(
          409,
          "ALREADY_LOCATED",
          "Activity is already located on the timeline.",
        );
      }

      const ts = nowFn();
      const overlaps = findLocatedOverlaps(
        conn,
        input.startMs,
        input.endMs,
        ts,
        row.id,
      );
      if (overlaps.length > 0) {
        throw new TimeStoreError(
          409,
          "INTERVAL_CONFLICT",
          "Chosen interval overlaps with existing recorded time.",
          { conflicts: overlaps },
        );
      }

      const nextVersion = row.version + 1;
      const nextPrecision = input.precision ?? "estimated_bounds";
      conn
        .prepare(
          `UPDATE activities
           SET kind = 'located',
               start_ms = ?,
               end_ms = ?,
               confirmed_through_ms = ?,
               precision = ?,
               review_state = 'ok',
               version = ?,
               updated_at_ms = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          input.startMs,
          input.endMs,
          input.endMs,
          nextPrecision,
          nextVersion,
          ts,
          row.id,
          row.version,
        );

      const updated = rowToActivity(
        conn
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(row.id) as ActivityRow,
      );
      const operationId = randomUUID();
      const receipt: ActivityMutationReceipt = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        changed: true,
        activity: updated,
        warnings: [],
        sessionVersion: meta.session_version,
        timeEpoch: meta.time_epoch,
        taskDataEpoch: meta.task_data_epoch,
        undo: {
          modifiedActivities: [
            {
              id: row.id,
              expectedPostVersion: nextVersion,
              restore: captureSnapshotFields(row),
            },
          ],
          touchedTimer: false,
          expectedPostActiveActivityId: meta.active_activity_id,
          restoreActiveActivityId: meta.active_activity_id,
        },
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId,
        kind: "locate_estimate",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: updated.id,
        targetTaskUuid: updated.taskUuid,
        receipt,
        nowMs: ts,
      });
      return receipt;
    });
  }

  function updateActivity(input: {
    idempotencyKey: string;
    receivedAtMs?: number;
    activityId: string;
    expectedVersion: number;
    patch: {
      title?: string;
      categoryId?: string;
      projectSnapshot?: string | null;
      tags?: string[] | null;
      startMs?: number;
      endMs?: number;
      targetDate?: string;
      windowStartMs?: number | null;
      windowEndMs?: number | null;
      estimatedSeconds?: number;
      precision?: ActivityPrecision;
      note?: string | null;
      confirmReview?: boolean;
      clearTaskLink?: boolean;
    };
  }): ActivityMutationReceipt {
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const normalized = {
      activityId: input.activityId,
      expectedVersion: input.expectedVersion,
      patch: input.patch,
    };
    const inputHash = hashNormalizedInput("update_activity", normalized);

    const outcome = inImmediateTx((conn) => {
      const initialMeta = readMeta(conn);
      const hit = checkExistingOperation<ActivityMutationReceipt>(
        conn,
        initialMeta,
        input.idempotencyKey,
        inputHash,
        receivedAtMs,
      );
      if (hit.hit) return { receipt: hit.receipt, notify: false };

      const ts = nowFn();
      const settlement = settleDueTimersTx(conn, ts);
      const meta = settlement.settledActivity ? readMeta(conn) : initialMeta;

      const row = conn
        .prepare("SELECT * FROM activities WHERE id = ?")
        .get(input.activityId) as ActivityRow | undefined;
      if (!row || row.review_state === "voided") {
        throw new TimeStoreError(
          404,
          "ACTIVITY_NOT_FOUND",
          "Activity not found.",
        );
      }
      if (row.version !== input.expectedVersion) {
        throw new TimeStoreError(
          409,
          "ACTIVITY_VERSION_CONFLICT",
          "Activity was modified concurrently. Refresh before editing.",
          { currentVersion: row.version },
        );
      }

      const policy = parsePolicy(meta);
      const patch = input.patch;

      const nextTitle =
        patch.title !== undefined ? patch.title.trim() : row.title;
      if (!nextTitle || nextTitle.length > 500) {
        throw new TimeStoreError(
          400,
          "INVALID_TITLE",
          "Activity title must be 1 to 500 characters.",
        );
      }

      let nextCategoryId = row.category_id;
      let nextRuleSource = row.rule_source;
      let nextRuleVersion = row.rule_version;
      if (patch.categoryId !== undefined) {
        const valid = new Set(policy.categories.map((c) => c.id));
        valid.add("uncategorized");
        if (!valid.has(patch.categoryId)) {
          throw new TimeStoreError(
            400,
            "INVALID_CATEGORY",
            `Unknown category: ${patch.categoryId}`,
          );
        }
        nextCategoryId = patch.categoryId;
        nextRuleSource = "explicit";
        nextRuleVersion = policy.policyVersion;
      }

      const nextNote = patch.note === undefined ? row.note : patch.note || null;
      const nextTaskUuid = patch.clearTaskLink ? null : row.task_uuid;
      const nextProjectSnapshot =
        patch.projectSnapshot === undefined
          ? row.project_snapshot
          : patch.projectSnapshot;
      const nextTagsJson =
        patch.tags === undefined
          ? row.tags_json
          : patch.tags && patch.tags.length > 0
            ? JSON.stringify(normalizeActivityTags(patch.tags))
            : null;
      const nextPrecision = patch.precision ?? row.precision;

      let nextStartMs = row.start_ms;
      let nextEndMs = row.end_ms;
      let nextSuspendMs = row.suspend_ms;
      let nextWindowStartMs = row.window_start_ms;
      let nextWindowEndMs = row.window_end_ms;
      let nextTargetDate = row.target_date;
      let nextEstimatedSeconds = row.estimated_seconds;
      let nextReviewState = row.review_state;
      let updatedConfirmedThroughMs = row.confirmed_through_ms;
      let updatedReviewDueAtMs = row.review_due_at_ms;
      let updatedReviewReason = row.review_reason;

      if (row.kind === "located") {
        if (patch.startMs !== undefined) nextStartMs = patch.startMs;
        if (patch.endMs !== undefined) nextEndMs = patch.endMs;
        if (nextStartMs === null || !Number.isFinite(nextStartMs)) {
          throw new TimeStoreError(
            400,
            "INVALID_INTERVAL",
            "Located activity requires a valid start time.",
          );
        }
        if (nextEndMs !== null && nextEndMs <= nextStartMs) {
          throw new TimeStoreError(
            400,
            "INVALID_INTERVAL",
            "End time must be strictly after start time.",
          );
        }
        if (nextEndMs === null && nextStartMs > ts) {
          throw new TimeStoreError(
            400,
            "INVALID_INTERVAL",
            "Running activity start time cannot be in the future.",
          );
        }

        const effectiveEnd = nextEndMs ?? nextSuspendMs ?? ts;
        const overlaps = findLocatedOverlaps(
          conn,
          nextStartMs,
          effectiveEnd,
          ts,
          row.id,
        );
        if (overlaps.length > 0) {
          throw new TimeStoreError(
            409,
            "INTERVAL_CONFLICT",
            "Updated time range overlaps with another recorded activity.",
            { conflicts: overlaps },
          );
        }

        let nextConfirmedThroughMs = row.confirmed_through_ms;
        let nextReviewDueAtMs = row.review_due_at_ms;
        let nextReviewReason = row.review_reason;

        if (
          patch.confirmReview ||
          (patch.endMs !== undefined && row.review_state === "review_required")
        ) {
          nextReviewState = "ok";
          nextReviewReason = null;
          nextReviewDueAtMs = null;
          if (nextEndMs !== null) {
            nextSuspendMs = null;
            nextConfirmedThroughMs = nextEndMs;
          } else if (patch.confirmReview) {
            nextConfirmedThroughMs = Math.min(
              ts,
              row.auto_stop_at_ms ?? ts,
              nextSuspendMs ?? ts,
            );
          }
        } else if (patch.endMs !== undefined && nextEndMs !== null) {
          if (
            nextConfirmedThroughMs !== null &&
            nextEndMs < nextConfirmedThroughMs
          ) {
            nextConfirmedThroughMs = nextEndMs;
          } else if (row.review_state === "ok") {
            nextConfirmedThroughMs = nextEndMs;
          }
        }
        if (
          nextConfirmedThroughMs !== null &&
          nextConfirmedThroughMs < nextStartMs
        ) {
          nextConfirmedThroughMs = nextStartMs;
        }
        updatedConfirmedThroughMs = nextConfirmedThroughMs;
        updatedReviewDueAtMs = nextReviewDueAtMs;
        updatedReviewReason = nextReviewReason;
      } else {
        if (patch.estimatedSeconds !== undefined) {
          if (
            !Number.isFinite(patch.estimatedSeconds) ||
            patch.estimatedSeconds <= 0
          ) {
            throw new TimeStoreError(
              400,
              "INVALID_ESTIMATE",
              "Estimated duration must be positive.",
            );
          }
          nextEstimatedSeconds = Math.round(patch.estimatedSeconds);
        }
        if (patch.targetDate !== undefined) {
          parseLocalDate(patch.targetDate);
          nextTargetDate = patch.targetDate;
        }
        if (patch.windowStartMs !== undefined) {
          nextWindowStartMs = patch.windowStartMs;
        }
        if (patch.windowEndMs !== undefined) {
          nextWindowEndMs = patch.windowEndMs;
        }
        if ((nextWindowStartMs === null) !== (nextWindowEndMs === null)) {
          throw new TimeStoreError(
            400,
            "INVALID_WINDOW",
            "Window start and end must both be set or both cleared.",
          );
        }
        if (
          nextWindowStartMs !== null &&
          nextWindowEndMs !== null &&
          nextWindowEndMs <= nextWindowStartMs
        ) {
          throw new TimeStoreError(
            400,
            "INVALID_WINDOW",
            "Window end must be after window start.",
          );
        }
      }

      const clearedActive =
        meta.active_activity_id === row.id &&
        row.end_ms === null &&
        nextEndMs !== null;
      const nextSessionVersion = clearedActive
        ? meta.session_version + 1
        : meta.session_version;
      const nextActiveId = clearedActive ? null : meta.active_activity_id;

      const nextVersion = row.version + 1;
      conn
        .prepare(
          `UPDATE activities
           SET title = ?, category_id = ?, rule_version = ?, rule_source = ?,
               hourly_rate_cents = ?, task_uuid = ?, project_snapshot = ?, tags_json = ?,
               start_ms = ?, end_ms = ?, suspend_ms = ?,
               confirmed_through_ms = ?, review_due_at_ms = ?, review_reason = ?,
               window_start_ms = ?, window_end_ms = ?, target_date = ?,
               estimated_seconds = ?, precision = ?, review_state = ?,
               note = ?, version = ?, updated_at_ms = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          nextTitle,
          nextCategoryId,
          nextRuleVersion,
          nextRuleSource,
          isSleepCategory(policy, nextCategoryId)
            ? 0
            : isSleepCategory(policy, row.category_id) &&
                nextCategoryId !== row.category_id
              ? normalizeHourlyRateCents(policy.hourlyRateCents)
              : row.hourly_rate_cents,
          nextTaskUuid,
          nextProjectSnapshot,
          nextTagsJson,
          nextStartMs,
          nextEndMs,
          nextSuspendMs,
          updatedConfirmedThroughMs,
          updatedReviewDueAtMs,
          updatedReviewReason,
          nextWindowStartMs,
          nextWindowEndMs,
          nextTargetDate,
          nextEstimatedSeconds,
          nextPrecision,
          nextReviewState,
          nextNote,
          nextVersion,
          ts,
          row.id,
          row.version,
        );

      if (clearedActive) {
        conn
          .prepare(
            "UPDATE time_meta SET active_activity_id = NULL, session_version = ?, updated_at_ms = ? WHERE id = 1",
          )
          .run(nextSessionVersion, ts);
      }

      const updated = rowToActivity(
        conn
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(row.id) as ActivityRow,
      );
      const operationId = randomUUID();
      const appliedReceipt: ActivityMutationReceipt = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        changed: true,
        activity: updated,
        warnings: [],
        sessionVersion: nextSessionVersion,
        timeEpoch: meta.time_epoch,
        taskDataEpoch: meta.task_data_epoch,
        undo: {
          modifiedActivities: [
            {
              id: row.id,
              expectedPostVersion: nextVersion,
              restore: captureSnapshotFields(row),
            },
          ],
          touchedTimer: clearedActive,
          expectedPostActiveActivityId: nextActiveId,
          restoreActiveActivityId: meta.active_activity_id,
        },
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId,
        kind: "update_activity",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: updated.id,
        targetTaskUuid: updated.taskUuid,
        receipt: appliedReceipt,
        nowMs: ts,
      });
      return {
        receipt: appliedReceipt,
        notify: Boolean(clearedActive || settlement.settledActivity),
      };
    });
    if (outcome.notify) notifyScheduleListeners();
    return outcome.receipt;
  }

  function undoOperation(input: {
    idempotencyKey: string;
    targetOperationId: string;
    receivedAtMs?: number;
  }): {
    operationId: string;
    undoneOperationId: string;
    sessionVersion: number;
  } {
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const inputHash = hashNormalizedInput("undo", {
      targetOperationId: input.targetOperationId,
    });

    let shouldNotify = false;
    const outcome = inImmediateTx((conn) => {
      const meta = readMeta(conn);
      const hit = checkExistingOperation<{
        operationId: string;
        undoneOperationId: string;
        sessionVersion: number;
      }>(conn, meta, input.idempotencyKey, inputHash, receivedAtMs);
      if (hit.hit) return hit.receipt;

      const target = conn
        .prepare("SELECT * FROM operations WHERE operation_id = ?")
        .get(input.targetOperationId) as OperationRow | undefined;
      if (!target) {
        throw new TimeStoreError(
          404,
          "OPERATION_NOT_FOUND",
          "Target operation not found.",
        );
      }
      if (target.undone_by_operation_id) {
        throw new TimeStoreError(
          409,
          "OPERATION_ALREADY_UNDONE",
          "Operation has already been undone.",
        );
      }
      if (target.state !== "applied") {
        throw new TimeStoreError(
          409,
          "OPERATION_NOT_UNDOABLE",
          `Operation in state ${target.state} cannot be undone.`,
        );
      }

      const receipt = JSON.parse(
        target.receipt_json || "{}",
      ) as ActivityMutationReceipt;
      const undo = receipt.undo;
      if (!undo) {
        throw new TimeStoreError(
          409,
          "OPERATION_NOT_UNDOABLE",
          "Operation has no undo metadata.",
        );
      }

      if (
        undo.touchedTimer &&
        meta.active_activity_id !== undo.expectedPostActiveActivityId
      ) {
        throw new TimeStoreError(
          409,
          "UNDO_TIMER_CONFLICT",
          "Active timer changed after the target operation; cannot safely undo.",
        );
      }

      const ts = nowFn();

      if (undo.createdActivityId) {
        const created = conn
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(undo.createdActivityId) as ActivityRow | undefined;
        if (!created || created.version !== undo.createdPostVersion) {
          throw new TimeStoreError(
            409,
            "UNDO_VERSION_CONFLICT",
            "Activity was modified after the target operation and cannot be undone.",
          );
        }
        conn
          .prepare(
            "UPDATE activities SET review_state = 'voided', version = ?, updated_at_ms = ? WHERE id = ? AND version = ?",
          )
          .run(created.version + 1, ts, created.id, created.version);
      }

      for (const mod of undo.modifiedActivities) {
        const current = conn
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(mod.id) as ActivityRow | undefined;
        if (!current || current.version !== mod.expectedPostVersion) {
          throw new TimeStoreError(
            409,
            "UNDO_VERSION_CONFLICT",
            "Activity was modified after the target operation and cannot be undone.",
          );
        }
        const r = mod.restore;
        if (r.kind === "located" && r.startMs !== null) {
          const effectiveEnd = r.endMs ?? r.suspendMs ?? ts;
          const overlaps = findLocatedOverlaps(
            conn,
            r.startMs,
            effectiveEnd,
            ts,
            mod.id,
          ).filter((c) => c.id !== undo.createdActivityId);
          if (overlaps.length > 0) {
            throw new TimeStoreError(
              409,
              "INTERVAL_CONFLICT",
              "Undoing this edit would overlap with another interval.",
              { conflicts: overlaps },
            );
          }
        }
        conn
          .prepare(
            `UPDATE activities
             SET kind = ?, title = ?, category_id = ?, rule_version = ?, rule_source = ?,
                 task_uuid = ?, project_snapshot = ?, tags_json = ?, hourly_rate_cents = ?,
                 start_ms = ?, end_ms = ?, suspend_ms = ?,
                 confirmed_through_ms = ?, review_due_at_ms = ?, review_reason = ?,
                 timing_plan_id = ?, auto_stop_at_ms = ?, auto_stop_basis = ?, limit_version = ?,
                 timer_stopped_at_ms = ?, stop_reason = ?, processed_at_ms = ?,
                 window_start_ms = ?, window_end_ms = ?, target_date = ?, estimated_seconds = ?,
                 precision = ?, source = ?, review_state = ?, note = ?, candidate_key = ?,
                 version = ?, updated_at_ms = ?
             WHERE id = ? AND version = ?`,
          )
          .run(
            r.kind,
            r.title,
            r.categoryId,
            r.ruleVersion,
            r.ruleSource,
            r.taskUuid,
            r.projectSnapshot,
            r.tags && r.tags.length > 0 ? JSON.stringify(r.tags) : null,
            r.hourlyRateCents ?? null,
            r.startMs,
            r.endMs,
            r.suspendMs,
            r.confirmedThroughMs ?? null,
            r.reviewDueAtMs ?? null,
            r.reviewReason ?? null,
            r.timingPlanId ?? null,
            r.autoStopAtMs ?? null,
            r.autoStopBasis ?? null,
            r.limitVersion ?? null,
            r.timerStoppedAtMs ?? null,
            r.stopReason ?? null,
            r.processedAtMs ?? null,
            r.windowStartMs,
            r.windowEndMs,
            r.targetDate,
            r.estimatedSeconds,
            r.precision,
            r.source,
            r.reviewState,
            r.note,
            r.candidateKey,
            current.version + 1,
            ts,
            mod.id,
            current.version,
          );
      }

      if (undo.sleepDecisionKey) {
        conn
          .prepare("DELETE FROM sleep_decisions WHERE candidate_key = ?")
          .run(undo.sleepDecisionKey);
      }

      const nextSessionVersion = undo.touchedTimer
        ? meta.session_version + 1
        : meta.session_version;
      if (undo.touchedTimer) {
        shouldNotify = true;
        conn
          .prepare(
            "UPDATE time_meta SET active_activity_id = ?, session_version = ?, updated_at_ms = ? WHERE id = 1",
          )
          .run(undo.restoreActiveActivityId, nextSessionVersion, ts);
      }

      const undoOpId = randomUUID();
      conn
        .prepare(
          "UPDATE operations SET undone_by_operation_id = ?, updated_at_ms = ? WHERE operation_id = ?",
        )
        .run(undoOpId, ts, target.operation_id);

      const undoReceipt = {
        operationId: undoOpId,
        undoneOperationId: target.operation_id,
        sessionVersion: nextSessionVersion,
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId: undoOpId,
        kind: "undo",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: target.target_activity_id ?? undefined,
        receipt: undoReceipt,
        nowMs: ts,
      });
      return undoReceipt;
    });
    if (shouldNotify) notifyScheduleListeners();
    return outcome;
  }

  function confirmSleepCandidate(input: {
    idempotencyKey: string;
    date: string;
    receivedAtMs?: number;
  }): ActivityMutationReceipt {
    parseLocalDate(input.date);
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const inputHash = hashNormalizedInput("confirm_sleep", {
      date: input.date,
    });

    return inImmediateTx((conn) => {
      const meta = readMeta(conn);
      const hit = checkExistingOperation<ActivityMutationReceipt>(
        conn,
        meta,
        input.idempotencyKey,
        inputHash,
        receivedAtMs,
      );
      if (hit.hit) return hit.receipt;

      const policy = parsePolicy(meta);
      if (!policy.sleepTemplate.enabled || !policy.sleepTemplate.tag) {
        throw new TimeStoreError(
          409,
          "SLEEP_TEMPLATE_DISABLED",
          "睡眠模板未启用或未选择标签。",
        );
      }

      const key = sleepCandidateKey(input.date, policy.sleepTemplate.version);
      const existingRow = conn
        .prepare(
          "SELECT * FROM activities WHERE candidate_key = ? AND review_state != 'voided'",
        )
        .get(key) as ActivityRow | undefined;

      const ts = nowFn();
      if (existingRow) {
        const existingActivity = rowToActivity(existingRow);
        const operationId = randomUUID();
        const receipt: ActivityMutationReceipt = {
          operationId,
          idempotencyKey: input.idempotencyKey,
          changed: false,
          activity: existingActivity,
          warnings: [],
          sessionVersion: meta.session_version,
          timeEpoch: meta.time_epoch,
          taskDataEpoch: meta.task_data_epoch,
        };
        saveOperationReceipt(conn, {
          idempotencyKey: input.idempotencyKey,
          operationId,
          kind: "confirm_sleep",
          inputHash,
          meta,
          receivedAtMs,
          state: "skipped_already_satisfied",
          targetActivityId: existingActivity.id,
          receipt,
          nowMs: ts,
        });
        return receipt;
      }

      const { startMs, endMs } = computeSleepCandidateRange(
        input.date,
        policy.sleepTemplate.startTime,
        policy.sleepTemplate.endTime,
        policy.timezone,
      );
      if (endMs <= startMs) {
        throw new TimeStoreError(
          400,
          "INVALID_SLEEP_TEMPLATE",
          "Sleep template produces an empty interval.",
        );
      }

      const overlaps = findLocatedOverlaps(conn, startMs, endMs, ts);
      if (overlaps.length > 0) {
        throw new TimeStoreError(
          409,
          "INTERVAL_CONFLICT",
          "Sleep candidate overlaps with existing recorded activity (for example an unstopped timer).",
          { conflicts: overlaps },
        );
      }

      const sleepCategory =
        policy.categories.find((c) => c.isSleep)?.id ?? "sleep";
      const activity: Activity = {
        id: randomUUID(),
        version: 1,
        kind: "located",
        title: "睡眠",
        tags: [policy.sleepTemplate.tag],
        categoryId: sleepCategory,
        ruleVersion: policy.policyVersion,
        ruleSource: "explicit",
        hourlyRateCents: 0,
        startMs,
        endMs,
        confirmedThroughMs: endMs,
        precision: "estimated_bounds",
        source: "sleep_candidate",
        reviewState: "ok",
        timezone: policy.timezone,
        candidateKey: key,
        createdAtMs: ts,
        updatedAtMs: ts,
      };
      insertActivityRow(conn, activity);
      conn
        .prepare(
          `INSERT INTO sleep_decisions (candidate_key, date, template_version, status, activity_id, updated_at_ms)
           VALUES (?, ?, ?, 'confirmed', ?, ?)
           ON CONFLICT(candidate_key) DO UPDATE SET status = 'confirmed', activity_id = excluded.activity_id, updated_at_ms = excluded.updated_at_ms`,
        )
        .run(key, input.date, policy.sleepTemplate.version, activity.id, ts);

      const operationId = randomUUID();
      const receipt: ActivityMutationReceipt = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        changed: true,
        activity,
        warnings: [],
        sessionVersion: meta.session_version,
        timeEpoch: meta.time_epoch,
        taskDataEpoch: meta.task_data_epoch,
        undo: {
          createdActivityId: activity.id,
          createdPostVersion: 1,
          modifiedActivities: [],
          touchedTimer: false,
          expectedPostActiveActivityId: meta.active_activity_id,
          restoreActiveActivityId: meta.active_activity_id,
          sleepDecisionKey: key,
        },
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId,
        kind: "confirm_sleep",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: activity.id,
        receipt,
        nowMs: ts,
      });
      return receipt;
    });
  }

  function dismissSleepCandidate(input: {
    idempotencyKey: string;
    date: string;
    receivedAtMs?: number;
  }): { operationId: string; candidateKey: string; status: "dismissed" } {
    parseLocalDate(input.date);
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const inputHash = hashNormalizedInput("dismiss_sleep", {
      date: input.date,
    });

    return inImmediateTx((conn) => {
      const meta = readMeta(conn);
      const hit = checkExistingOperation<{
        operationId: string;
        candidateKey: string;
        status: "dismissed";
      }>(conn, meta, input.idempotencyKey, inputHash, receivedAtMs);
      if (hit.hit) return hit.receipt;

      const policy = parsePolicy(meta);
      const key = sleepCandidateKey(input.date, policy.sleepTemplate.version);
      const ts = nowFn();
      conn
        .prepare(
          `INSERT INTO sleep_decisions (candidate_key, date, template_version, status, activity_id, updated_at_ms)
           VALUES (?, ?, ?, 'dismissed', NULL, ?)
           ON CONFLICT(candidate_key) DO UPDATE SET status = CASE WHEN status = 'confirmed' THEN status ELSE 'dismissed' END, updated_at_ms = excluded.updated_at_ms`,
        )
        .run(key, input.date, policy.sleepTemplate.version, ts);

      const operationId = randomUUID();
      const receipt = {
        operationId,
        candidateKey: key,
        status: "dismissed" as const,
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId,
        kind: "dismiss_sleep",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        receipt,
        nowMs: ts,
      });
      return receipt;
    });
  }

  function confirmActivity(input: {
    idempotencyKey: string;
    receivedAtMs?: number;
    activityId: string;
    expectedVersion: number;
    throughMs?: number;
    nextCheckpointSeconds?: number;
  }): ActivityMutationReceipt {
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const inputHash = hashNormalizedInput("confirm_activity", {
      activityId: input.activityId,
      expectedVersion: input.expectedVersion,
      throughMs: input.throughMs,
      nextCheckpointSeconds: input.nextCheckpointSeconds,
    });

    const outcome = inImmediateTx((conn) => {
      const initialMeta = readMeta(conn);
      const hit = checkExistingOperation<ActivityMutationReceipt>(
        conn,
        initialMeta,
        input.idempotencyKey,
        inputHash,
        receivedAtMs,
      );
      if (hit.hit) return { receipt: hit.receipt, notify: false };

      const ts = nowFn();
      const settlement = settleDueTimersTx(conn, ts);
      const meta = settlement.settledActivity ? readMeta(conn) : initialMeta;

      const row = conn
        .prepare("SELECT * FROM activities WHERE id = ?")
        .get(input.activityId) as ActivityRow | undefined;
      if (!row || row.review_state === "voided") {
        throw new TimeStoreError(
          404,
          "ACTIVITY_NOT_FOUND",
          "Activity not found.",
        );
      }
      if (row.kind !== "located" || row.start_ms === null) {
        throw new TimeStoreError(
          400,
          "INVALID_ACTIVITY",
          "Only located activities can be checkpoint-confirmed.",
        );
      }
      if (row.version !== input.expectedVersion) {
        throw new TimeStoreError(
          409,
          "ACTIVITY_VERSION_CONFLICT",
          "Activity was modified concurrently. Refresh before confirming.",
          { currentVersion: row.version },
        );
      }

      const maxUpperMs =
        row.end_ms ??
        Math.min(ts, row.suspend_ms ?? ts, row.auto_stop_at_ms ?? ts);
      const requestedThrough =
        input.throughMs !== undefined
          ? Math.min(maxUpperMs, Math.max(row.start_ms, input.throughMs))
          : maxUpperMs;
      const existingConfirmed = row.confirmed_through_ms ?? row.start_ms;
      const nextConfirmedThroughMs = Math.max(
        existingConfirmed,
        requestedThrough,
      );

      let nextReviewState: ActivityReviewState = row.review_state;
      let nextReviewReason: ActivityReviewReason | null = row.review_reason;
      let nextReviewDueAtMs: number | null = row.review_due_at_ms;
      let nextSuspendMs: number | null = row.suspend_ms;

      if (row.end_ms !== null) {
        if (nextConfirmedThroughMs >= row.end_ms) {
          nextReviewState = "ok";
          nextReviewReason = null;
          nextReviewDueAtMs = null;
          nextSuspendMs = null;
        }
      } else {
        // Active running activity checkpoint confirmation advances confirmed prefix
        // and schedules next checkpoint ONLY when uncapped.
        const checkpointSec =
          input.nextCheckpointSeconds ?? DEFAULT_CHECKPOINT_INTERVAL_SECONDS;
        if (row.auto_stop_at_ms === null) {
          nextReviewDueAtMs =
            nextConfirmedThroughMs + Math.max(60, checkpointSec) * 1000;
        } else {
          nextReviewDueAtMs = null;
        }
        if (row.suspend_ms === null) {
          nextReviewState = "ok";
          nextReviewReason = null;
        }
      }

      const nextVersion = row.version + 1;
      conn
        .prepare(
          `UPDATE activities
           SET confirmed_through_ms = ?,
               review_due_at_ms = ?,
               review_reason = ?,
               review_state = ?,
               suspend_ms = ?,
               version = ?,
               updated_at_ms = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          nextConfirmedThroughMs,
          nextReviewDueAtMs,
          nextReviewReason,
          nextReviewState,
          nextSuspendMs,
          nextVersion,
          ts,
          row.id,
          row.version,
        );

      const updated = rowToActivity(
        conn
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(row.id) as ActivityRow,
      );
      const operationId = randomUUID();
      const appliedReceipt: ActivityMutationReceipt = {
        operationId,
        idempotencyKey: input.idempotencyKey,
        changed: true,
        activity: updated,
        warnings: [],
        sessionVersion: meta.session_version,
        timeEpoch: meta.time_epoch,
        taskDataEpoch: meta.task_data_epoch,
        undo: {
          modifiedActivities: [
            {
              id: row.id,
              expectedPostVersion: nextVersion,
              restore: captureSnapshotFields(row),
            },
          ],
          touchedTimer: false,
          expectedPostActiveActivityId: meta.active_activity_id,
          restoreActiveActivityId: meta.active_activity_id,
        },
      };
      saveOperationReceipt(conn, {
        idempotencyKey: input.idempotencyKey,
        operationId,
        kind: "confirm_activity",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: updated.id,
        targetTaskUuid: updated.taskUuid,
        receipt: appliedReceipt,
        nowMs: ts,
      });
      return {
        receipt: appliedReceipt,
        notify: updated.endMs === undefined,
      };
    });
    if (outcome.notify) notifyScheduleListeners();
    return outcome.receipt;
  }

  function createTimingPlan(input: {
    idempotencyKey?: string;
    receivedAtMs?: number;
    title: string;
    categoryId?: string;
    taskUuid?: string;
    projectSnapshot?: string;
    tags?: string[];
    note?: string;
    allowanceSeconds?: number;
    plannedStartAtMs?: number;
    hardStopAtMs?: number;
  }): {
    operationId: string;
    plan: TimingPlan;
  } {
    const idempotencyKey =
      input.idempotencyKey ?? `plan_create:${randomUUID()}`;
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const title = input.title.trim();
    if (!title || title.length > 500) {
      throw new TimeStoreError(
        400,
        "INVALID_TITLE",
        "Plan title must be 1 to 500 characters.",
      );
    }
    if (
      input.allowanceSeconds !== undefined &&
      (!Number.isFinite(input.allowanceSeconds) || input.allowanceSeconds <= 0)
    ) {
      throw new TimeStoreError(
        400,
        "INVALID_TIMING_PLAN",
        "Planned duration must be positive.",
      );
    }
    if (
      input.plannedStartAtMs !== undefined &&
      !Number.isFinite(input.plannedStartAtMs)
    ) {
      throw new TimeStoreError(
        400,
        "INVALID_TIMING_PLAN",
        "Planned start time is invalid.",
      );
    }
    if (
      input.hardStopAtMs !== undefined &&
      !Number.isFinite(input.hardStopAtMs)
    ) {
      throw new TimeStoreError(
        400,
        "INVALID_TIMING_PLAN",
        "Latest stop time is invalid.",
      );
    }
    if (
      input.allowanceSeconds === undefined &&
      input.plannedStartAtMs === undefined &&
      input.hardStopAtMs === undefined
    ) {
      throw new TimeStoreError(
        400,
        "INVALID_TIMING_PLAN",
        "Timing plan requires at least one of duration, planned start, or latest stop.",
      );
    }
    if (
      input.plannedStartAtMs !== undefined &&
      input.hardStopAtMs !== undefined &&
      input.plannedStartAtMs >= input.hardStopAtMs
    ) {
      throw new TimeStoreError(
        400,
        "INVALID_TIMING_PLAN",
        "最晚停止时间必须晚于计划开始时间。",
      );
    }

    const allowanceSeconds =
      input.allowanceSeconds !== undefined
        ? Math.round(input.allowanceSeconds)
        : undefined;
    const inputHash = hashNormalizedInput("create_timing_plan", {
      title,
      categoryId: input.categoryId,
      taskUuid: input.taskUuid,
      projectSnapshot: input.projectSnapshot,
      tags: input.tags,
      note: input.note,
      allowanceSeconds,
      plannedStartAtMs: input.plannedStartAtMs,
      hardStopAtMs: input.hardStopAtMs,
    });

    return inImmediateTx((conn) => {
      const initialMeta = readMeta(conn);
      const hit = checkExistingOperation<{
        operationId: string;
        plan: TimingPlan;
      }>(conn, initialMeta, idempotencyKey, inputHash, receivedAtMs);
      if (hit.hit) return hit.receipt;

      const ts = nowFn();
      const settlement = settleDueTimersTx(conn, ts);
      const meta = settlement.settledActivity ? readMeta(conn) : initialMeta;
      const policy = parsePolicy(meta);

      if (input.hardStopAtMs !== undefined && input.hardStopAtMs <= ts) {
        throw new TimeStoreError(
          400,
          "INVALID_TIMING_PLAN",
          "最晚停止时间必须晚于当前时间。",
        );
      }

      if (input.categoryId !== undefined) {
        const valid = new Set(policy.categories.map((c) => c.id));
        valid.add("uncategorized");
        if (!valid.has(input.categoryId)) {
          throw new TimeStoreError(
            400,
            "INVALID_CATEGORY",
            `Unknown category: ${input.categoryId}`,
          );
        }
      }

      const id = randomUUID();
      const rateCents = normalizeHourlyRateCents(policy.hourlyRateCents);
      const initialAllowance = allowanceSeconds ?? null;
      const initialBudgetCents =
        initialAllowance !== null
          ? computeDurationCostCents(initialAllowance, rateCents)
          : null;
      conn
        .prepare(
          `INSERT INTO timing_plans (
            id, version, title, category_id, task_uuid, project_snapshot,
            tags_json, note, timezone, allowance_seconds,
            hourly_rate_cents, initial_allowance_seconds, initial_budget_cents,
            current_budget_cents, planned_start_at_ms, hard_stop_at_ms, archived_at_ms,
            created_at_ms, updated_at_ms
          ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          id,
          title,
          input.categoryId ?? null,
          input.taskUuid ?? null,
          input.projectSnapshot ?? null,
          input.tags && input.tags.length > 0
            ? JSON.stringify(input.tags)
            : null,
          input.note ?? null,
          policy.timezone,
          initialAllowance,
          rateCents,
          initialAllowance,
          initialBudgetCents,
          initialBudgetCents,
          input.plannedStartAtMs ?? null,
          input.hardStopAtMs ?? null,
          ts,
          ts,
        );

      if (input.taskUuid) {
        const taskKey = input.taskUuid.toLowerCase();
        const existingBudget = conn
          .prepare("SELECT * FROM task_budgets WHERE task_uuid = ?")
          .get(taskKey) as TaskBudgetRow | undefined;
        if (!existingBudget) {
          syncTaskBudgetFromEstimateTx(conn, {
            taskUuid: taskKey,
            allowanceSeconds: initialAllowance,
            plannedStartAtMs: input.plannedStartAtMs,
            hardStopAtMs: input.hardStopAtMs,
            policyRateCents: rateCents,
            nowMs: ts,
          });
        } else if (initialAllowance !== null) {
          // If cumulative task time + this new plan allowance exceeds current budget, grow current budget without altering initial estimate.
          const allTaskActs = loadAllActivities(conn).filter(
            (a) =>
              a.taskUuid?.toLowerCase() === taskKey &&
              a.kind === "located" &&
              a.reviewState !== "voided" &&
              a.reviewState !== "conflict",
          );
          let loggedSeconds = 0;
          for (const a of allTaskActs) {
            if (a.startMs === undefined) continue;
            const end = effectiveActivityEndMs(a, ts);
            if (end && end > a.startMs) {
              loggedSeconds += Math.floor((end - a.startMs) / 1000);
            }
          }
          const neededTotal = loggedSeconds + initialAllowance;
          const prevBudgetSec = existingBudget.current_allowance_seconds ?? 0;
          if (neededTotal > prevBudgetSec) {
            syncTaskBudgetFromEstimateTx(conn, {
              taskUuid: taskKey,
              addAllowanceSeconds: neededTotal - prevBudgetSec,
              plannedStartAtMs: input.plannedStartAtMs,
              hardStopAtMs: input.hardStopAtMs,
              policyRateCents: rateCents,
              nowMs: ts,
            });
          } else if (
            input.plannedStartAtMs !== undefined ||
            input.hardStopAtMs !== undefined
          ) {
            syncTaskBudgetFromEstimateTx(conn, {
              taskUuid: taskKey,
              plannedStartAtMs: input.plannedStartAtMs,
              hardStopAtMs: input.hardStopAtMs,
              policyRateCents: rateCents,
              nowMs: ts,
            });
          }
        }
      }

      const planRow = conn
        .prepare("SELECT * FROM timing_plans WHERE id = ?")
        .get(id) as TimingPlanRow;
      const plan = buildTimingPlanTx(conn, planRow, ts);
      const operationId = randomUUID();
      const receipt = { operationId, plan };
      saveOperationReceipt(conn, {
        idempotencyKey,
        operationId,
        kind: "create_timing_plan",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetTaskUuid: input.taskUuid,
        receipt,
        nowMs: ts,
      });
      return receipt;
    });
  }

  function updateTimingPlan(input: {
    idempotencyKey?: string;
    receivedAtMs?: number;
    planId: string;
    expectedVersion: number;
    expectedSessionVersion?: number;
    expectedActivityId?: string;
    expectedActivityVersion?: number;
    patch: {
      title?: string;
      categoryId?: string | null;
      taskUuid?: string | null;
      projectSnapshot?: string | null;
      tags?: string[] | null;
      note?: string | null;
      allowanceSeconds?: number | null;
      addAllowanceSeconds?: number;
      plannedStartAtMs?: number | null;
      hardStopAtMs?: number | null;
      archived?: boolean;
    };
  }): {
    operationId: string;
    plan: TimingPlan;
    updatedActivity?: Activity;
    sessionVersion: number;
  } {
    const idempotencyKey =
      input.idempotencyKey ?? `plan_update:${randomUUID()}`;
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const inputHash = hashNormalizedInput("update_timing_plan", {
      planId: input.planId,
      expectedVersion: input.expectedVersion,
      expectedSessionVersion: input.expectedSessionVersion,
      expectedActivityId: input.expectedActivityId,
      expectedActivityVersion: input.expectedActivityVersion,
      patch: input.patch,
    });

    const outcome = inImmediateTx((conn) => {
      const initialMeta = readMeta(conn);
      const hit = checkExistingOperation<{
        operationId: string;
        plan: TimingPlan;
        updatedActivity?: Activity;
        sessionVersion: number;
      }>(conn, initialMeta, idempotencyKey, inputHash, receivedAtMs);
      if (hit.hit) return { receipt: hit.receipt, notify: false };

      assertTimerSlotAvailable(conn);

      const ts = nowFn();
      const settlement = settleDueTimersTx(conn, ts);
      const meta = readMeta(conn);

      if (
        input.expectedSessionVersion !== undefined &&
        input.expectedSessionVersion !== meta.session_version
      ) {
        throw new TimeStoreError(
          409,
          "SESSION_VERSION_CONFLICT",
          "Timer session changed before plan update could be applied.",
          { sessionVersion: meta.session_version },
        );
      }

      const planRow = conn
        .prepare("SELECT * FROM timing_plans WHERE id = ?")
        .get(input.planId) as TimingPlanRow | undefined;
      if (!planRow) {
        throw new TimeStoreError(
          404,
          "TIMING_PLAN_NOT_FOUND",
          "Timing plan not found.",
        );
      }
      if (planRow.version !== input.expectedVersion) {
        throw new TimeStoreError(
          409,
          "TIMING_PLAN_VERSION_CONFLICT",
          "Timing plan was modified concurrently. Refresh before updating.",
          { currentVersion: planRow.version },
        );
      }

      const policy = parsePolicy(meta);
      const patch = input.patch;
      const nextTitle =
        patch.title !== undefined ? patch.title.trim() : planRow.title;
      if (!nextTitle || nextTitle.length > 500) {
        throw new TimeStoreError(
          400,
          "INVALID_TITLE",
          "Plan title must be 1 to 500 characters.",
        );
      }

      let nextCategoryId = planRow.category_id;
      if (patch.categoryId !== undefined) {
        if (patch.categoryId !== null) {
          const valid = new Set(policy.categories.map((c) => c.id));
          valid.add("uncategorized");
          if (!valid.has(patch.categoryId)) {
            throw new TimeStoreError(
              400,
              "INVALID_CATEGORY",
              `Unknown category: ${patch.categoryId}`,
            );
          }
        }
        nextCategoryId = patch.categoryId;
      }

      const nextTaskUuid =
        patch.taskUuid === undefined ? planRow.task_uuid : patch.taskUuid;
      const nextProject =
        patch.projectSnapshot === undefined
          ? planRow.project_snapshot
          : patch.projectSnapshot;
      const nextTagsJson =
        patch.tags === undefined
          ? planRow.tags_json
          : patch.tags && patch.tags.length > 0
            ? JSON.stringify(patch.tags)
            : null;
      const nextNote = patch.note === undefined ? planRow.note : patch.note;
      const nextPlannedStart =
        patch.plannedStartAtMs === undefined
          ? planRow.planned_start_at_ms
          : patch.plannedStartAtMs;
      const nextHardStop =
        patch.hardStopAtMs === undefined
          ? planRow.hard_stop_at_ms
          : patch.hardStopAtMs;
      const nextArchivedAt =
        patch.archived === undefined
          ? planRow.archived_at_ms
          : patch.archived
            ? (planRow.archived_at_ms ?? ts)
            : null;

      if (
        patch.addAllowanceSeconds !== undefined &&
        (!Number.isFinite(patch.addAllowanceSeconds) ||
          patch.addAllowanceSeconds <= 0)
      ) {
        throw new TimeStoreError(
          400,
          "INVALID_TIMING_PLAN",
          "Added duration must be positive.",
        );
      }
      if (
        patch.allowanceSeconds !== undefined &&
        patch.allowanceSeconds !== null &&
        (!Number.isFinite(patch.allowanceSeconds) ||
          patch.allowanceSeconds <= 0)
      ) {
        throw new TimeStoreError(
          400,
          "INVALID_TIMING_PLAN",
          "Allowance duration must be positive.",
        );
      }

      // Compute prior closed consumption vs active running segment consumption.
      const linkedRows = conn
        .prepare(
          `SELECT * FROM activities
           WHERE timing_plan_id = ?
             AND kind = 'located'
             AND review_state != 'voided'
           ORDER BY COALESCE(start_ms, created_at_ms) ASC`,
        )
        .all(planRow.id) as ActivityRow[];

      let priorClosedSeconds = 0;
      let totalConsumedSeconds = 0;
      let activeRow: ActivityRow | undefined;
      for (const segRow of linkedRows) {
        const seg = rowToActivity(segRow);
        if (seg.startMs === undefined) continue;
        const segEnd = effectiveActivityEndMs(seg, ts) ?? seg.startMs;
        const secs = Math.max(0, Math.floor((segEnd - seg.startMs) / 1000));
        totalConsumedSeconds += secs;
        if (segRow.id === meta.active_activity_id && segRow.end_ms === null) {
          activeRow = segRow;
        } else {
          priorClosedSeconds += secs;
        }
      }

      if (
        input.expectedActivityId !== undefined &&
        activeRow?.id !== input.expectedActivityId
      ) {
        throw new TimeStoreError(
          409,
          "ACTIVE_ACTIVITY_MISMATCH",
          "The active segment for this timing plan has already ended.",
          { activeActivityId: activeRow?.id ?? null },
        );
      }
      if (
        input.expectedActivityVersion !== undefined &&
        activeRow?.version !== input.expectedActivityVersion
      ) {
        throw new TimeStoreError(
          409,
          "ACTIVITY_VERSION_CONFLICT",
          "Active segment changed before extending.",
          { currentVersion: activeRow?.version ?? null },
        );
      }

      let nextAllowance: number | null = planRow.allowance_seconds;
      if (patch.allowanceSeconds !== undefined) {
        nextAllowance =
          patch.allowanceSeconds !== null
            ? Math.round(patch.allowanceSeconds)
            : null;
      } else if (patch.addAllowanceSeconds !== undefined) {
        const baseAllowance = planRow.allowance_seconds ?? totalConsumedSeconds;
        nextAllowance = baseAllowance + Math.round(patch.addAllowanceSeconds);
      }

      if (
        nextAllowance === null &&
        nextPlannedStart === null &&
        nextHardStop === null
      ) {
        throw new TimeStoreError(
          400,
          "INVALID_TIMING_PLAN",
          "Timing plan must keep at least one of duration, planned start, or latest stop.",
        );
      }
      if (
        nextPlannedStart !== null &&
        nextHardStop !== null &&
        nextPlannedStart >= nextHardStop
      ) {
        throw new TimeStoreError(
          400,
          "INVALID_TIMING_PLAN",
          "最晚停止时间必须晚于计划开始时间。",
        );
      }

      const modifyingLimits =
        patch.allowanceSeconds !== undefined ||
        patch.addAllowanceSeconds !== undefined ||
        patch.hardStopAtMs !== undefined;

      if (modifyingLimits && nextHardStop !== null && nextHardStop <= ts) {
        throw new TimeStoreError(
          409,
          "TIMING_PLAN_EXPIRED",
          "最晚停止时间已过，若需延长时间请同时延后最晚停止时刻。",
          { hardStopAtMs: nextHardStop },
        );
      }
      if (
        modifyingLimits &&
        nextAllowance !== null &&
        nextAllowance <= totalConsumedSeconds
      ) {
        throw new TimeStoreError(
          409,
          "NO_REMAINING_TIME",
          "修改后的总时长已小于或等于已消耗时长，无可用剩余额度。",
          {
            allowanceSeconds: nextAllowance,
            consumedSeconds: totalConsumedSeconds,
          },
        );
      }

      let updatedActivity: Activity | undefined;
      let nextSessionVersion = meta.session_version;
      if (activeRow && modifyingLimits && activeRow.start_ms !== null) {
        const remainingForActiveSeg =
          nextAllowance !== null
            ? Math.max(0, nextAllowance - priorClosedSeconds)
            : undefined;
        const newStopLimit = computeStopLimit({
          startMs: activeRow.start_ms,
          remainingAllowanceSeconds: remainingForActiveSeg,
          hardStopAtMs: nextHardStop ?? undefined,
        });
        if (
          newStopLimit.autoStopAtMs !== undefined &&
          newStopLimit.autoStopAtMs <= ts
        ) {
          throw new TimeStoreError(
            409,
            "NO_REMAINING_TIME",
            "修改后的自动停止时间已过或无剩余时间。",
            { autoStopAtMs: newStopLimit.autoStopAtMs },
          );
        }
        const nextLimitVer = (activeRow.limit_version ?? 1) + 1;
        const nextReviewDue =
          newStopLimit.autoStopAtMs === undefined
            ? (activeRow.review_due_at_ms ??
              (activeRow.confirmed_through_ms ?? activeRow.start_ms) +
                DEFAULT_CHECKPOINT_INTERVAL_SECONDS * 1000)
            : null;
        conn
          .prepare(
            `UPDATE activities
             SET auto_stop_at_ms = ?,
                 auto_stop_basis = ?,
                 limit_version = ?,
                 review_due_at_ms = ?,
                 version = ?,
                 updated_at_ms = ?
             WHERE id = ? AND version = ?`,
          )
          .run(
            newStopLimit.autoStopAtMs ?? null,
            newStopLimit.autoStopBasis ?? null,
            nextLimitVer,
            nextReviewDue,
            activeRow.version + 1,
            ts,
            activeRow.id,
            activeRow.version,
          );
        nextSessionVersion += 1;
        conn
          .prepare(
            "UPDATE time_meta SET session_version = ?, updated_at_ms = ? WHERE id = 1",
          )
          .run(nextSessionVersion, ts);
        updatedActivity = rowToActivity(
          conn
            .prepare("SELECT * FROM activities WHERE id = ?")
            .get(activeRow.id) as ActivityRow,
        );
      }

      const policyRate = normalizeHourlyRateCents(policy.hourlyRateCents);
      const prevPlanRate = normalizeHourlyRateCents(
        planRow.hourly_rate_cents,
        policyRate,
      );
      const prevInitAllowance =
        planRow.initial_allowance_seconds ?? planRow.allowance_seconds;
      const prevInitBudget =
        planRow.initial_budget_cents ??
        (prevInitAllowance !== null
          ? computeDurationCostCents(prevInitAllowance, prevPlanRate)
          : null);
      const prevCurrBudget =
        planRow.current_budget_cents ??
        (planRow.allowance_seconds !== null
          ? computeDurationCostCents(planRow.allowance_seconds, prevPlanRate)
          : null);

      let nextCurrentBudget: number | null = prevCurrBudget;
      let allowanceDeltaForTask = 0;
      if (patch.addAllowanceSeconds !== undefined && nextAllowance !== null) {
        const addedSec = Math.round(patch.addAllowanceSeconds);
        allowanceDeltaForTask = addedSec;
        nextCurrentBudget =
          (prevCurrBudget ?? 0) +
          computeDurationCostCents(addedSec, policyRate);
      } else if (patch.allowanceSeconds !== undefined) {
        if (nextAllowance === null) {
          nextCurrentBudget = null;
        } else {
          const prevSec = planRow.allowance_seconds ?? 0;
          const delta = nextAllowance - prevSec;
          allowanceDeltaForTask = delta;
          if (prevInitAllowance === null) {
            nextCurrentBudget = computeDurationCostCents(
              nextAllowance,
              policyRate,
            );
          } else if (delta >= 0) {
            nextCurrentBudget =
              (prevCurrBudget ?? 0) +
              computeDurationCostCents(delta, policyRate);
          } else {
            nextCurrentBudget = computeDurationCostCents(
              nextAllowance,
              prevPlanRate,
            );
          }
        }
      }

      const nextInitAllowance =
        prevInitAllowance !== null ? prevInitAllowance : nextAllowance;
      const nextInitBudget =
        prevInitBudget !== null
          ? prevInitBudget
          : nextInitAllowance !== null
            ? computeDurationCostCents(nextInitAllowance, policyRate)
            : null;

      conn
        .prepare(
          `UPDATE timing_plans
           SET title = ?, category_id = ?, task_uuid = ?, project_snapshot = ?,
               tags_json = ?, note = ?, allowance_seconds = ?,
               hourly_rate_cents = COALESCE(hourly_rate_cents, ?),
               initial_allowance_seconds = ?, initial_budget_cents = ?,
               current_budget_cents = ?,
               planned_start_at_ms = ?, hard_stop_at_ms = ?, archived_at_ms = ?,
               version = ?, updated_at_ms = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          nextTitle,
          nextCategoryId,
          nextTaskUuid,
          nextProject,
          nextTagsJson,
          nextNote,
          nextAllowance,
          prevPlanRate,
          nextInitAllowance,
          nextInitBudget,
          nextCurrentBudget,
          nextPlannedStart,
          nextHardStop,
          nextArchivedAt,
          planRow.version + 1,
          ts,
          planRow.id,
          planRow.version,
        );

      if (nextTaskUuid) {
        if (allowanceDeltaForTask > 0) {
          syncTaskBudgetFromEstimateTx(conn, {
            taskUuid: nextTaskUuid,
            addAllowanceSeconds: allowanceDeltaForTask,
            plannedStartAtMs: nextPlannedStart,
            hardStopAtMs: nextHardStop,
            policyRateCents: policyRate,
            nowMs: ts,
          });
        } else if (
          allowanceDeltaForTask < 0 ||
          patch.plannedStartAtMs !== undefined ||
          patch.hardStopAtMs !== undefined
        ) {
          const existingTaskBudget = conn
            .prepare("SELECT * FROM task_budgets WHERE task_uuid = ?")
            .get(nextTaskUuid.toLowerCase()) as TaskBudgetRow | undefined;
          const nextTaskSec =
            existingTaskBudget?.current_allowance_seconds !== null &&
            existingTaskBudget?.current_allowance_seconds !== undefined
              ? Math.max(
                  0,
                  existingTaskBudget.current_allowance_seconds +
                    allowanceDeltaForTask,
                )
              : (nextAllowance ?? undefined);
          syncTaskBudgetFromEstimateTx(conn, {
            taskUuid: nextTaskUuid,
            ...(nextTaskSec !== undefined
              ? { allowanceSeconds: nextTaskSec }
              : {}),
            plannedStartAtMs: nextPlannedStart,
            hardStopAtMs: nextHardStop,
            policyRateCents: policyRate,
            nowMs: ts,
          });
        }
      }

      const updatedPlanRow = conn
        .prepare("SELECT * FROM timing_plans WHERE id = ?")
        .get(planRow.id) as TimingPlanRow;
      const plan = buildTimingPlanTx(conn, updatedPlanRow, ts);
      const operationId = randomUUID();
      const receipt = {
        operationId,
        plan,
        ...(updatedActivity ? { updatedActivity } : {}),
        sessionVersion: nextSessionVersion,
      };
      saveOperationReceipt(conn, {
        idempotencyKey,
        operationId,
        kind: "update_timing_plan",
        inputHash,
        meta,
        receivedAtMs,
        state: "applied",
        targetActivityId: updatedActivity?.id,
        targetTaskUuid: plan.taskUuid,
        receipt,
        nowMs: ts,
      });
      return {
        receipt,
        notify: Boolean(updatedActivity || settlement.settledActivity),
      };
    });
    if (outcome.notify) notifyScheduleListeners();
    return outcome.receipt;
  }

  function getTimingPlan(planId: string, atMs?: number): TimingPlan | null {
    if (atMs === undefined) settleDueTimers();
    const conn = assertOpen();
    const row = conn
      .prepare("SELECT * FROM timing_plans WHERE id = ?")
      .get(planId) as TimingPlanRow | undefined;
    if (!row) return null;
    return buildTimingPlanTx(conn, row, atMs ?? nowFn());
  }

  function listTimingPlans(filter?: {
    includeArchived?: boolean;
    taskUuid?: string;
    atMs?: number;
  }): TimingPlan[] {
    if (filter?.atMs === undefined) settleDueTimers();
    const conn = assertOpen();
    const refNow = filter?.atMs ?? nowFn();
    const rows = conn
      .prepare("SELECT * FROM timing_plans ORDER BY created_at_ms DESC")
      .all() as TimingPlanRow[];
    return rows
      .filter((r) => {
        if (!filter?.includeArchived && r.archived_at_ms !== null) return false;
        if (
          filter?.taskUuid &&
          r.task_uuid?.toLowerCase() !== filter.taskUuid.toLowerCase()
        ) {
          return false;
        }
        return true;
      })
      .map((r) => buildTimingPlanTx(conn, r, refNow));
  }

  function listTimeEvents(filter?: {
    includeAcknowledged?: boolean;
    limit?: number;
  }): TimeEvent[] {
    settleDueTimers();
    const conn = assertOpen();
    const limit = Math.max(1, Math.min(200, filter?.limit ?? 50));
    const rows = filter?.includeAcknowledged
      ? (conn
          .prepare(
            "SELECT * FROM time_events ORDER BY occurred_at_ms DESC LIMIT ?",
          )
          .all(limit) as TimeEventRow[])
      : (conn
          .prepare(
            "SELECT * FROM time_events WHERE acknowledged_at_ms IS NULL ORDER BY occurred_at_ms DESC LIMIT ?",
          )
          .all(limit) as TimeEventRow[]);
    return rows.map(rowToTimeEvent);
  }

  function ackTimeEvents(eventIds: string[]): { acknowledgedCount: number } {
    if (eventIds.length === 0) return { acknowledgedCount: 0 };
    const ts = nowFn();
    return inImmediateTx((conn) => {
      let count = 0;
      const stmt = conn.prepare(
        "UPDATE time_events SET acknowledged_at_ms = COALESCE(acknowledged_at_ms, ?) WHERE id = ?",
      );
      for (const id of eventIds) {
        const res = stmt.run(ts, id);
        if (Number(res.changes ?? 0) > 0) count += 1;
      }
      return { acknowledgedCount: count };
    });
  }

  function queryActivities(filter?: {
    startMs?: number;
    endMs?: number;
    includeVoided?: boolean;
  }): Activity[] {
    settleDueTimers();
    const conn = assertOpen();
    const activities = loadAllActivities(conn);
    const refNow = nowFn();
    return activities.filter((a) => {
      if (!filter?.includeVoided && a.reviewState === "voided") return false;
      if (filter?.startMs === undefined || filter?.endMs === undefined) {
        return true;
      }
      if (a.kind === "located" && a.startMs !== undefined) {
        const end = effectiveActivityEndMs(a, refNow) ?? a.startMs;
        return intervalsOverlap(
          a.startMs,
          Math.max(a.startMs + 1, end),
          filter.startMs,
          filter.endMs,
        );
      }
      if (a.windowStartMs !== undefined && a.windowEndMs !== undefined) {
        return intervalsOverlap(
          a.windowStartMs,
          a.windowEndMs,
          filter.startMs,
          filter.endMs,
        );
      }
      return true;
    });
  }

  function getDailySummary(date: string, atMs?: number): DailyLedgerSummary {
    settleDueTimers();
    const conn = assertOpen();
    const meta = readMeta(conn);
    const policy = parsePolicy(meta);
    const activities = loadAllActivities(conn);
    const decisions = loadSleepDecisions(conn);
    return computeDailyLedger(
      date,
      activities,
      policy,
      atMs ?? nowFn(),
      decisions,
    );
  }

  function getWeeklySummary(
    dateOrWeekStart: string,
    atMs?: number,
  ): WeeklyDistributionSummary {
    settleDueTimers();
    const conn = assertOpen();
    const meta = readMeta(conn);
    const policy = parsePolicy(meta);
    const weekStart = mondayOfWeek(dateOrWeekStart);
    const activities = loadAllActivities(conn);
    const decisions = loadSleepDecisions(conn);
    return computeWeeklyDistribution(
      weekStart,
      activities,
      policy,
      atMs ?? nowFn(),
      decisions,
    );
  }

  function getReconcileDigest(date: string, atMs?: number) {
    settleDueTimers();
    const conn = assertOpen();
    const meta = readMeta(conn);
    const policy = parsePolicy(meta);
    const refNow = atMs ?? nowFn();
    const summary = computeDailyLedger(
      date,
      loadAllActivities(conn),
      policy,
      refNow,
      loadSleepDecisions(conn),
    );
    const unresolved = getUnresolvedTimerHolders(conn).map(rowToOperation);
    const reviewItems = summary.locatedSegments.filter(
      (s) =>
        s.reviewState === "review_required" ||
        (s.running &&
          s.autoStopAtMs === undefined &&
          s.reviewDueAtMs !== undefined &&
          refNow >= s.reviewDueAtMs &&
          s.provisionalSeconds > 0),
    );
    const dueCheckpoints = summary.locatedSegments.filter(
      (s) =>
        s.running &&
        s.autoStopAtMs === undefined &&
        s.reviewDueAtMs !== undefined &&
        refNow >= s.reviewDueAtMs &&
        s.provisionalSeconds > 0,
    );
    const plans = (
      conn
        .prepare(
          "SELECT * FROM timing_plans WHERE archived_at_ms IS NULL ORDER BY created_at_ms DESC",
        )
        .all() as TimingPlanRow[]
    ).map((r) => buildTimingPlanTx(conn, r, refNow));
    const unacknowledgedEvents = (
      conn
        .prepare(
          "SELECT * FROM time_events WHERE acknowledged_at_ms IS NULL ORDER BY occurred_at_ms DESC LIMIT 20",
        )
        .all() as TimeEventRow[]
    ).map(rowToTimeEvent);

    return {
      date: summary.date,
      timezone: policy.timezone,
      asOfMs: summary.asOfMs,
      policyVersion: policy.policyVersion,
      sessionVersion: meta.session_version,
      timeEpoch: meta.time_epoch,
      coveredSeconds: summary.coveredSeconds,
      provisionalSeconds: summary.provisionalSeconds,
      reviewRequiredSeconds: summary.reviewRequiredSeconds,
      unrecordedSeconds: summary.unrecordedSeconds,
      sleepCandidates: summary.sleepCandidates.filter(
        (c) => c.status === "pending",
      ),
      gaps: summary.gaps,
      unlocatedEstimates: summary.unlocatedEstimates,
      reviewItems,
      dueCheckpoints,
      unacknowledgedEvents,
      plans,
      pendingOperations: unresolved,
    };
  }

  function getTimerSnapshot(input?: {
    taskUuids?: string[];
    nowMs?: number;
  }): TimerSnapshot {
    if (restoring) {
      const ts = input?.nowMs ?? nowFn();
      return {
        backend: "time",
        contractVersion: 1,
        timeEpoch: initialBarrier.timeEpoch,
        taskDataEpoch: initialBarrier.taskDataEpoch,
        state: "restoring",
        sessionVersion: 0,
        snapshotAt: new Date(ts).toISOString(),
        liveUntil: new Date(ts).toISOString(),
        activeActivity: null,
        taskTotalsSeconds: {},
        totalsComplete: false,
        historyComplete: false,
      };
    }

    settleDueTimers();
    const conn = db;
    const meta = readMeta(conn);
    const ts = input?.nowMs ?? nowFn();
    const activities = loadAllActivities(conn);
    const activeRow = meta.active_activity_id
      ? (conn
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(meta.active_activity_id) as ActivityRow | undefined)
      : undefined;
    const active = activeRow ? rowToActivity(activeRow) : null;
    const unresolved = getUnresolvedTimerHolders(conn);

    const state: TimerSnapshot["state"] =
      unresolved.length > 0 ? "pending_reconcile" : "ready";
    const isRunning = Boolean(
      active &&
      active.endMs === undefined &&
      active.suspendMs === undefined &&
      (active.autoStopAtMs === undefined || ts < active.autoStopAtMs),
    );
    const rawLiveUntilMs =
      state === "ready" && isRunning
        ? Math.min(
            ts + DEFAULT_TIMER_LIVE_WINDOW_MS,
            active?.autoStopAtMs ?? Number.POSITIVE_INFINITY,
          )
        : ts;
    const liveUntilMs = Math.max(ts, rawLiveUntilMs);

    const earliest = activities
      .filter(
        (a) =>
          a.kind === "located" &&
          a.startMs !== undefined &&
          a.reviewState !== "voided",
      )
      .reduce<number | undefined>(
        (min, a) => (min === undefined || a.startMs! < min ? a.startMs! : min),
        undefined,
      );

    const policy = parsePolicy(meta);
    const policyRate = normalizeHourlyRateCents(policy.hourlyRateCents);
    const budgets = loadAllTaskBudgets(conn);
    const billLinks = loadAllBillLinks(conn);
    const taskPlans = (
      conn
        .prepare("SELECT * FROM timing_plans WHERE task_uuid IS NOT NULL")
        .all() as TimingPlanRow[]
    ).map((r) => buildTimingPlanTx(conn, r, ts));

    const actsByTask = new Map<string, Activity[]>();
    for (const a of activities) {
      if (!a.taskUuid) continue;
      const key = a.taskUuid.toLowerCase();
      const arr = actsByTask.get(key) ?? [];
      arr.push(a);
      actsByTask.set(key, arr);
    }
    const plansByTask = new Map<string, TimingPlan[]>();
    for (const p of taskPlans) {
      if (!p.taskUuid) continue;
      const key = p.taskUuid.toLowerCase();
      const arr = plansByTask.get(key) ?? [];
      arr.push(p);
      plansByTask.set(key, arr);
    }
    const targetTaskKeys = new Set<string>(
      (input?.taskUuids ?? []).map((u) => u.toLowerCase()),
    );
    if (targetTaskKeys.size === 0) {
      for (const k of actsByTask.keys()) targetTaskKeys.add(k);
      for (const k of budgets.keys()) targetTaskKeys.add(k);
      for (const k of plansByTask.keys()) targetTaskKeys.add(k);
      for (const link of billLinks) {
        if (link.taskUuid) targetTaskKeys.add(link.taskUuid.toLowerCase());
      }
    }
    const taskCosts: Record<string, TaskCostSummary> = Object.create(null);
    for (const key of targetTaskKeys) {
      taskCosts[key] = computeTaskCostSummary({
        taskUuid: key,
        activities: actsByTask.get(key) ?? [],
        budget: budgets.get(key),
        plans: plansByTask.get(key) ?? [],
        billLinks,
        policy,
        asOfMs: ts,
      });
    }

    return {
      backend: "time",
      contractVersion: 1,
      timeEpoch: meta.time_epoch,
      taskDataEpoch: meta.task_data_epoch,
      state,
      sessionVersion: meta.session_version,
      snapshotAt: new Date(ts).toISOString(),
      liveUntil: new Date(liveUntilMs).toISOString(),
      hourlyRateCents: policyRate,
      taskListHighlightCost: policy.taskListHighlightCost ?? true,
      activeActivity: active
        ? {
            id: active.id,
            version: active.version,
            ...(active.taskUuid ? { taskUuid: active.taskUuid } : {}),
            title: active.title,
            categoryId: active.categoryId,
            startedAt: new Date(active.startMs ?? ts).toISOString(),
            state:
              active.reviewState === "review_required" ||
              active.suspendMs !== undefined
                ? "review_required"
                : "running",
            ...(active.suspendMs !== undefined
              ? {
                  suspendAt: new Date(active.suspendMs).toISOString(),
                }
              : {}),
            ...(active.timingPlanId
              ? { timingPlanId: active.timingPlanId }
              : {}),
            ...(active.autoStopAtMs !== undefined
              ? {
                  autoStopAt: new Date(active.autoStopAtMs).toISOString(),
                }
              : {}),
            ...(active.limitVersion !== undefined
              ? { limitVersion: active.limitVersion }
              : {}),
            ...(active.reviewDueAtMs !== undefined
              ? {
                  reviewDueAt: new Date(active.reviewDueAtMs).toISOString(),
                }
              : {}),
            ...(active.confirmedThroughMs !== undefined
              ? {
                  confirmedThrough: new Date(
                    active.confirmedThroughMs,
                  ).toISOString(),
                }
              : {}),
            hourlyRateCents: resolveActivityHourlyRateCents(active, policy),
          }
        : null,
      taskTotalsSeconds: computeTaskTotalsSeconds(
        activities,
        input?.taskUuids ?? [],
        ts,
      ),
      taskCosts,
      totalsComplete: true,
      ...(earliest !== undefined
        ? { coverageFrom: new Date(earliest).toISOString() }
        : meta.cutover_at_ms !== null
          ? { coverageFrom: new Date(meta.cutover_at_ms).toISOString() }
          : {}),
      historyComplete: meta.cutover_at_ms === null || earliest !== undefined,
    };
  }

  function setTaskBudget(input: {
    taskUuid: string;
    mode?: "set" | "add" | "clear";
    allowanceSeconds?: number | null;
    addAllowanceSeconds?: number;
    plannedStartAtMs?: number | null;
    hardStopAtMs?: number | null;
  }): TaskCostSummary {
    const taskKey = input.taskUuid.trim().toLowerCase();
    if (!taskKey) {
      throw new TimeStoreError(400, "INVALID_FIELD", "Missing taskUuid.");
    }
    return inImmediateTx((conn) => {
      const ts = nowFn();
      settleDueTimersTx(conn, ts);
      const meta = readMeta(conn);
      const policy = parsePolicy(meta);
      const policyRate = normalizeHourlyRateCents(policy.hourlyRateCents);

      if (input.mode === "clear") {
        conn
          .prepare("DELETE FROM task_budgets WHERE task_uuid = ?")
          .run(taskKey);
      } else if (input.mode === "add") {
        if (
          input.addAllowanceSeconds === undefined ||
          !Number.isFinite(input.addAllowanceSeconds) ||
          input.addAllowanceSeconds <= 0
        ) {
          throw new TimeStoreError(
            400,
            "INVALID_BUDGET",
            "Added estimate seconds must be positive.",
          );
        }
        syncTaskBudgetFromEstimateTx(conn, {
          taskUuid: taskKey,
          addAllowanceSeconds: input.addAllowanceSeconds,
          plannedStartAtMs: input.plannedStartAtMs,
          hardStopAtMs: input.hardStopAtMs,
          policyRateCents: policyRate,
          nowMs: ts,
        });
      } else {
        if (
          input.allowanceSeconds !== undefined &&
          input.allowanceSeconds !== null &&
          (!Number.isFinite(input.allowanceSeconds) ||
            input.allowanceSeconds <= 0)
        ) {
          throw new TimeStoreError(
            400,
            "INVALID_BUDGET",
            "Estimate duration must be positive.",
          );
        }
        if (
          input.plannedStartAtMs !== undefined &&
          input.plannedStartAtMs !== null &&
          input.hardStopAtMs !== undefined &&
          input.hardStopAtMs !== null &&
          input.plannedStartAtMs >= input.hardStopAtMs
        ) {
          throw new TimeStoreError(
            400,
            "INVALID_TIMING_PLAN",
            "最晚停止时间必须晚于计划开始时间。",
          );
        }
        syncTaskBudgetFromEstimateTx(conn, {
          taskUuid: taskKey,
          allowanceSeconds: input.allowanceSeconds,
          plannedStartAtMs: input.plannedStartAtMs,
          hardStopAtMs: input.hardStopAtMs,
          policyRateCents: policyRate,
          nowMs: ts,
        });
      }

      const budgets = loadAllTaskBudgets(conn);
      const billLinks = loadAllBillLinks(conn);
      const activities = loadAllActivities(conn);
      const plans = (
        conn
          .prepare("SELECT * FROM timing_plans WHERE LOWER(task_uuid) = ?")
          .all(taskKey) as TimingPlanRow[]
      ).map((r) => buildTimingPlanTx(conn, r, ts));
      return computeTaskCostSummary({
        taskUuid: taskKey,
        activities,
        budget: budgets.get(taskKey),
        plans,
        billLinks,
        policy,
        asOfMs: ts,
      });
    });
  }

  function getTaskCostDetail(input: { taskUuid: string }): {
    summary: TaskCostSummary;
    segments: LocatedSegment[];
    plans: TimingPlan[];
    billLinks: BillLink[];
  } {
    settleDueTimers();
    const conn = assertOpen();
    const ts = nowFn();
    const meta = readMeta(conn);
    const policy = parsePolicy(meta);
    const taskKey = input.taskUuid.trim().toLowerCase();
    const activities = loadAllActivities(conn);
    const budgets = loadAllTaskBudgets(conn);
    const billLinks = loadAllBillLinks(conn).filter(
      (link) => link.taskUuid?.toLowerCase() === taskKey,
    );
    const plans = (
      conn
        .prepare(
          "SELECT * FROM timing_plans WHERE LOWER(task_uuid) = ? ORDER BY updated_at_ms DESC",
        )
        .all(taskKey) as TimingPlanRow[]
    ).map((r) => buildTimingPlanTx(conn, r, ts));

    const summary = computeTaskCostSummary({
      taskUuid: taskKey,
      activities,
      budget: budgets.get(taskKey),
      plans,
      billLinks,
      policy,
      asOfMs: ts,
    });

    const policyRate = normalizeHourlyRateCents(policy.hourlyRateCents);
    const segments: LocatedSegment[] = [];
    for (const act of activities) {
      if (
        act.kind !== "located" ||
        act.reviewState === "voided" ||
        act.reviewState === "conflict" ||
        act.taskUuid?.toLowerCase() !== taskKey ||
        act.startMs === undefined
      ) {
        continue;
      }
      const rawEnd = effectiveActivityEndMs(act, ts);
      if (rawEnd === undefined || rawEnd <= act.startMs) continue;
      const endMs = Math.min(rawEnd, ts);
      const durationSeconds = Math.max(
        0,
        Math.floor(endMs / 1000) - Math.floor(act.startMs / 1000),
      );
      const confirmedEndMs =
        act.confirmedThroughMs !== undefined
          ? Math.max(act.startMs, Math.min(endMs, act.confirmedThroughMs))
          : act.reviewState === "ok"
            ? endMs
            : act.startMs;
      const confirmedSeconds = Math.max(
        0,
        Math.floor(confirmedEndMs / 1000) - Math.floor(act.startMs / 1000),
      );
      const provisionalSeconds = Math.max(
        0,
        durationSeconds - confirmedSeconds,
      );
      const rate = resolveActivityHourlyRateCents(act, policy);
      segments.push({
        activityId: act.id,
        version: act.version,
        title: act.title,
        categoryId: act.categoryId,
        ...(act.taskUuid ? { taskUuid: act.taskUuid } : {}),
        ...(act.projectSnapshot
          ? { projectSnapshot: act.projectSnapshot }
          : {}),
        ...(act.tags && act.tags.length > 0 ? { tags: act.tags } : {}),
        hourlyRateCents: rate,
        startMs: act.startMs,
        endMs,
        durationSeconds,
        confirmedSeconds,
        provisionalSeconds,
        confirmedCostCents: computeDurationCostCents(confirmedSeconds, rate),
        provisionalCostCents: computeDurationCostCents(
          provisionalSeconds,
          rate,
        ),
        running:
          act.endMs === undefined &&
          act.suspendMs === undefined &&
          (act.autoStopAtMs === undefined || ts < act.autoStopAtMs),
        precision: act.precision,
        source: act.source,
        reviewState: act.reviewState,
        ...(act.suspendMs !== undefined ? { suspendMs: act.suspendMs } : {}),
        ...(act.confirmedThroughMs !== undefined
          ? { confirmedThroughMs: act.confirmedThroughMs }
          : {}),
        ...(act.reviewDueAtMs !== undefined
          ? { reviewDueAtMs: act.reviewDueAtMs }
          : {}),
        ...(act.reviewReason ? { reviewReason: act.reviewReason } : {}),
        ...(act.timingPlanId ? { timingPlanId: act.timingPlanId } : {}),
        ...(act.autoStopAtMs !== undefined
          ? { autoStopAtMs: act.autoStopAtMs }
          : {}),
        ...(act.timerStoppedAtMs !== undefined
          ? { timerStoppedAtMs: act.timerStoppedAtMs }
          : {}),
        ...(act.stopReason ? { stopReason: act.stopReason } : {}),
      });
    }
    segments.sort((a, b) => b.startMs - a.startMs);

    return { summary, segments, plans, billLinks };
  }

  function getCostReport(input?: {
    granularity?: CostReportGranularity;
    date?: string;
    sortBy?: CostReportSortBy;
    taskMetaByUuid?: ReadonlyMap<string, CostReportTaskMeta>;
  }): CostReportSummary {
    settleDueTimers();
    const conn = assertOpen();
    const ts = nowFn();
    const meta = readMeta(conn);
    const policy = parsePolicy(meta);
    const granularity = input?.granularity ?? "week";
    const anchorDate = input?.date ?? localDateOf(ts, policy.timezone);
    parseLocalDate(anchorDate);
    const sortBy = input?.sortBy ?? "highest_cost";
    const activities = loadAllActivities(conn);
    const budgets = loadAllTaskBudgets(conn);
    const plans = (
      conn.prepare("SELECT * FROM timing_plans").all() as TimingPlanRow[]
    ).map((r) => buildTimingPlanTx(conn, r, ts));
    const billLinks = loadAllBillLinks(conn);
    return computeCostReport({
      granularity,
      anchorDate,
      sortBy,
      activities,
      budgetsByTaskUuid: budgets,
      plans,
      taskMetaByUuid: input?.taskMetaByUuid,
      billLinks,
      policy,
      nowMs: ts,
    });
  }

  function listBills(input?: {
    q?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }) {
    return listBillExpenses({
      billsDir: options.billsDir,
      ...input,
    });
  }

  function linkBillExpense(input: {
    txKey: string;
    taskUuid?: string;
    activityId?: string;
    source: string;
    txId: string;
    payTime: string;
    payee: string;
    narration: string;
    account: string;
    currency: string;
    amount: number;
    cnyAmountCents: number;
    note?: string;
  }): BillLink {
    const conn = assertOpen();
    const taskUuid = input.taskUuid?.trim().toLowerCase() || null;
    const activityId = input.activityId?.trim() || null;
    if (!taskUuid && !activityId) {
      throw new TimeStoreError(
        400,
        "INVALID_FIELD",
        "Must provide taskUuid or activityId to link a Bill expense.",
      );
    }
    const existing = conn
      .prepare(
        `SELECT * FROM bill_links
         WHERE tx_key = ?
           AND COALESCE(task_uuid, '') = COALESCE(?, '')
           AND COALESCE(activity_id, '') = COALESCE(?, '')`,
      )
      .get(input.txKey, taskUuid, activityId) as BillLinkRow | undefined;
    if (existing) {
      return rowToBillLink(existing);
    }
    const id = randomUUID();
    const ts = nowFn();
    conn
      .prepare(
        `INSERT INTO bill_links (
          id, tx_key, task_uuid, activity_id, source, tx_id, pay_time,
          payee, narration, account, currency, amount, cny_amount_cents,
          note, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.txKey,
        taskUuid,
        activityId,
        input.source,
        input.txId,
        input.payTime,
        input.payee,
        input.narration,
        input.account,
        input.currency,
        input.amount,
        Math.round(input.cnyAmountCents),
        input.note ?? null,
        ts,
      );
    const created = conn
      .prepare("SELECT * FROM bill_links WHERE id = ?")
      .get(id) as BillLinkRow;
    return rowToBillLink(created);
  }

  function unlinkBillLink(linkId: string): { deleted: boolean } {
    const conn = assertOpen();
    const res = conn.prepare("DELETE FROM bill_links WHERE id = ?").run(linkId);
    return { deleted: res.changes > 0 };
  }

  function getOperation(idOrKey: string): TimeOperationRecord | null {
    const conn = assertOpen();
    const row = conn
      .prepare(
        "SELECT * FROM operations WHERE operation_id = ? OR idempotency_key = ?",
      )
      .get(idOrKey, idOrKey) as OperationRow | undefined;
    return row ? rowToOperation(row) : null;
  }

  function getActivity(activityId: string): Activity | null {
    const conn = assertOpen();
    const row = conn
      .prepare("SELECT * FROM activities WHERE id = ?")
      .get(activityId) as ActivityRow | undefined;
    return row ? rowToActivity(row) : null;
  }

  // --- Cross-system Task Coordinator & Restore Lifecycle Helpers ---

  function listUnresolvedOperations(): TimeOperationRecord[] {
    const conn = assertOpen();
    return getUnresolvedTimerHolders(conn).map(rowToOperation);
  }

  function isTaskAffectedByTimerOrPending(taskUuid: string): {
    affected: boolean;
    reason?: string;
    activeActivityId?: string;
    pendingOperationIds?: string[];
  } {
    settleDueTimers();
    const conn = assertOpen();
    const normalized = taskUuid.toLowerCase();
    const meta = readMeta(conn);
    const activeRow = meta.active_activity_id
      ? (conn
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(meta.active_activity_id) as ActivityRow | undefined)
      : undefined;

    const unresolved = getUnresolvedTimerHolders(conn);
    const blockingPending: string[] = [];
    for (const op of unresolved) {
      if (op.target_task_uuid?.toLowerCase() === normalized) {
        blockingPending.push(op.operation_id);
        continue;
      }
      if (op.dependencies_json) {
        try {
          const deps = JSON.parse(
            op.dependencies_json,
          ) as OperationDependencies;
          if (
            deps.taskUuids.some((u) => u.toLowerCase() === normalized) ||
            (activeRow?.task_uuid?.toLowerCase() === normalized &&
              deps.activityIds.includes(activeRow.id))
          ) {
            blockingPending.push(op.operation_id);
          }
        } catch {
          blockingPending.push(op.operation_id);
        }
      }
    }

    if (blockingPending.length > 0) {
      return {
        affected: true,
        reason: "pending_reconcile",
        pendingOperationIds: blockingPending,
      };
    }

    if (activeRow?.task_uuid?.toLowerCase() === normalized) {
      return {
        affected: true,
        reason: "active_activity",
        activeActivityId: activeRow.id,
      };
    }

    return { affected: false };
  }

  function beginCoordinatedOperation(input: {
    idempotencyKey: string;
    kind: string;
    inputHash: string;
    receivedAtMs: number;
    targetTaskUuid: string;
    preState: Record<string, unknown>;
    extraDependentTaskUuids?: string[];
    effectiveAtMs: number;
  }):
    | { replay: true; record: TimeOperationRecord }
    | { replay: false; record: TimeOperationRecord } {
    return inImmediateTx((conn) => {
      const meta = readMeta(conn);
      const existing = conn
        .prepare("SELECT * FROM operations WHERE idempotency_key = ?")
        .get(input.idempotencyKey) as OperationRow | undefined;

      if (existing) {
        if (existing.input_hash !== input.inputHash) {
          throw new TimeStoreError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key already used with different input.",
          );
        }
        if (
          existing.state === "applied" ||
          existing.state === "skipped_already_satisfied"
        ) {
          return { replay: true, record: rowToOperation(existing) };
        }
        throw new TimeStoreError(
          409,
          "OPERATION_PENDING_RECONCILE",
          "Operation requires reconciliation before retrying.",
          {
            operationId: existing.operation_id,
            state: existing.state,
          },
        );
      }

      assertNotBlockedByBarrier(meta, input.receivedAtMs);
      assertTimerSlotAvailable(conn);

      const activeRow = meta.active_activity_id
        ? (conn
            .prepare("SELECT * FROM activities WHERE id = ?")
            .get(meta.active_activity_id) as ActivityRow | undefined)
        : undefined;

      const deps: OperationDependencies = {
        taskUuids: [
          ...new Set(
            [
              input.targetTaskUuid,
              ...(activeRow?.task_uuid ? [activeRow.task_uuid] : []),
              ...(input.extraDependentTaskUuids ?? []),
            ].map((u) => u.toLowerCase()),
          ),
        ],
        activityIds: activeRow ? [activeRow.id] : [],
        holdsTimerSlot: true,
      };

      const ts = nowFn();
      const operationId = randomUUID();
      conn
        .prepare(
          `INSERT INTO operations (
            idempotency_key, operation_id, kind, input_hash,
            time_epoch, task_data_epoch, received_at_ms, state,
            target_activity_id, target_task_uuid, pre_state_json, dependencies_json,
            effective_at_ms, external_disposition, undone_by_operation_id,
            receipt_json, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          input.idempotencyKey,
          operationId,
          input.kind,
          input.inputHash,
          meta.time_epoch,
          meta.task_data_epoch,
          input.receivedAtMs,
          activeRow?.id ?? null,
          input.targetTaskUuid,
          JSON.stringify(input.preState),
          JSON.stringify(deps),
          input.effectiveAtMs,
          ts,
          ts,
        );

      const created = conn
        .prepare("SELECT * FROM operations WHERE operation_id = ?")
        .get(operationId) as OperationRow;
      return { replay: false, record: rowToOperation(created) };
    });
  }

  function updateCoordinatedState(
    operationId: string,
    next: {
      state: OperationState;
      externalDisposition?: string;
      receipt?: Record<string, unknown>;
    },
  ): TimeOperationRecord {
    return inImmediateTx((conn) => {
      const ts = nowFn();
      conn
        .prepare(
          `UPDATE operations
           SET state = ?,
               external_disposition = COALESCE(?, external_disposition),
               receipt_json = COALESCE(?, receipt_json),
               updated_at_ms = ?
           WHERE operation_id = ?`,
        )
        .run(
          next.state,
          next.externalDisposition ?? null,
          next.receipt ? JSON.stringify(next.receipt) : null,
          ts,
          operationId,
        );
      const row = conn
        .prepare("SELECT * FROM operations WHERE operation_id = ?")
        .get(operationId) as OperationRow | undefined;
      if (!row) {
        throw new TimeStoreError(
          404,
          "OPERATION_NOT_FOUND",
          "Operation not found.",
        );
      }
      return rowToOperation(row);
    });
  }

  function getEnergyInputs():
    | {
        available: false;
        restoring: true;
        timeEpoch: number;
        taskDataEpoch: number;
      }
    | {
        available: true;
        enabled: boolean;
        timezone: string;
        cutoverAtMs?: number;
        activeActivityId: string | null;
        activities: Activity[];
        importedRanges: Array<{
          rangeStartMs?: number;
          rangeEndMs?: number;
        }>;
        timeEpoch: number;
        taskDataEpoch: number;
      } {
    if (restoring) {
      return {
        available: false,
        restoring: true,
        timeEpoch: initialBarrier.timeEpoch,
        taskDataEpoch: initialBarrier.taskDataEpoch,
      };
    }
    const conn = db;
    const meta = readMeta(conn);
    const policy = parsePolicy(meta);
    const activities = loadAllActivities(conn);
    const batches = conn
      .prepare("SELECT range_start_ms, range_end_ms FROM import_batches")
      .all() as Array<{
      range_start_ms: number | null;
      range_end_ms: number | null;
    }>;
    return {
      available: true,
      enabled: meta.enabled === 1,
      timezone: policy.timezone,
      cutoverAtMs: meta.cutover_at_ms ?? undefined,
      activeActivityId: meta.active_activity_id,
      activities,
      importedRanges: batches.map((b) => ({
        rangeStartMs: b.range_start_ms ?? undefined,
        rangeEndMs: b.range_end_ms ?? undefined,
      })),
      timeEpoch: meta.time_epoch,
      taskDataEpoch: meta.task_data_epoch,
    };
  }

  function finalizeOperationRowTx(
    conn: DatabaseSync,
    operationId: string,
    params: {
      state: OperationState;
      targetActivityId?: string | null;
      externalDisposition?: string | null;
      receipt: Record<string, unknown>;
      ts: number;
    },
  ): void {
    conn
      .prepare(
        `UPDATE operations
         SET state = ?,
             target_activity_id = COALESCE(?, target_activity_id),
             external_disposition = COALESCE(?, external_disposition),
             receipt_json = ?,
             updated_at_ms = ?
         WHERE operation_id = ?`,
      )
      .run(
        params.state,
        params.targetActivityId ?? null,
        params.externalDisposition ?? null,
        JSON.stringify(params.receipt),
        params.ts,
        operationId,
      );
  }

  function applyCoordinatedOperationResult(input: {
    operationId: string;
    taskMeta?: {
      title: string;
      projectSnapshot?: string;
      tags?: string[];
    };
    effectiveAtMs?: number;
    finalState?: "applied" | "skipped_already_satisfied";
    externalDisposition?: string;
    onConflictMarkPending?: boolean;
  }): {
    applied: boolean;
    state: OperationState;
    timeEffect: "started" | "switched" | "stopped" | "none";
    receipt?: Record<string, unknown>;
    activity?: Activity;
    closedActivity?: Activity;
    warnings?: TimeWarning[];
  } {
    const outcome = inImmediateTx<{
      applied: boolean;
      state: OperationState;
      timeEffect: "started" | "switched" | "stopped" | "none";
      receipt?: Record<string, unknown>;
      activity?: Activity;
      closedActivity?: Activity;
      warnings?: TimeWarning[];
    }>((conn) => {
      const op = conn
        .prepare("SELECT * FROM operations WHERE operation_id = ?")
        .get(input.operationId) as OperationRow | undefined;
      if (!op) {
        throw new TimeStoreError(
          404,
          "OPERATION_NOT_FOUND",
          "Operation not found.",
        );
      }
      if (op.state === "applied" || op.state === "skipped_already_satisfied") {
        if (op.receipt_json) {
          const parsed = JSON.parse(op.receipt_json) as Record<string, unknown>;
          return {
            applied: true,
            state: op.state,
            timeEffect:
              (parsed.timeEffect as
                "started" | "switched" | "stopped" | "none") ?? "none",
            receipt: parsed,
          };
        }
      }

      const meta = readMeta(conn);
      const ts = nowFn();
      const preState = op.pre_state_json
        ? (JSON.parse(op.pre_state_json) as Record<string, unknown>)
        : {};
      const expectedSession =
        typeof preState.preSessionVersion === "number"
          ? preState.preSessionVersion
          : undefined;
      const preconditionFailed =
        op.time_epoch !== meta.time_epoch ||
        op.task_data_epoch !== meta.task_data_epoch ||
        (expectedSession !== undefined &&
          expectedSession !== meta.session_version);

      if (preconditionFailed) {
        conn
          .prepare(
            `UPDATE operations
             SET state = 'pending_reconcile',
                 external_disposition = COALESCE(external_disposition, 'PRECONDITION_MISMATCH'),
                 updated_at_ms = ?
             WHERE operation_id = ?`,
          )
          .run(ts, op.operation_id);
        if (input.onConflictMarkPending) {
          return {
            applied: false,
            state: "pending_reconcile",
            timeEffect: "none",
          };
        }
        throw new TimeStoreError(
          409,
          "OPERATION_PENDING_RECONCILE",
          "Timer epoch or session changed before local Time changes applied.",
          {
            operationId: op.operation_id,
            state: "pending_reconcile",
          },
        );
      }

      const policy = parsePolicy(meta);
      const effectiveAtMs = input.effectiveAtMs ?? op.effective_at_ms ?? ts;
      const finalState: OperationState =
        input.finalState ??
        (op.state === "skipped_already_satisfied" ||
        op.external_disposition?.startsWith("SKIPPED_")
          ? "skipped_already_satisfied"
          : "applied");
      const activeRow = meta.active_activity_id
        ? (conn
            .prepare("SELECT * FROM activities WHERE id = ?")
            .get(meta.active_activity_id) as ActivityRow | undefined)
        : undefined;
      const targetUuid = op.target_task_uuid?.toLowerCase();

      if (op.kind === "task_start") {
        if (
          activeRow &&
          activeRow.end_ms === null &&
          activeRow.suspend_ms === null &&
          targetUuid &&
          activeRow.task_uuid?.toLowerCase() === targetUuid
        ) {
          const active = rowToActivity(activeRow);
          const receipt: Record<string, unknown> = {
            operationId: op.operation_id,
            idempotencyKey: op.idempotency_key,
            ok: true,
            changed: false,
            timeEffect: "none",
            activity: active,
            warnings: [],
            sessionVersion: meta.session_version,
            timeEpoch: meta.time_epoch,
            taskDataEpoch: meta.task_data_epoch,
          };
          finalizeOperationRowTx(conn, op.operation_id, {
            state: finalState,
            targetActivityId: active.id,
            externalDisposition: input.externalDisposition,
            receipt,
            ts,
          });
          return {
            applied: true,
            state: finalState,
            timeEffect: "none",
            receipt,
            activity: active,
            warnings: [],
          };
        }

        const warnings: TimeWarning[] = [];
        const modifiedActivities: UndoMetadata["modifiedActivities"] = [];
        let closedActivity: Activity | undefined;
        if (activeRow && activeRow.end_ms === null) {
          const closedRes = closeActiveRowTx(
            conn,
            activeRow,
            effectiveAtMs,
            ts,
            policy,
          );
          closedActivity = closedRes.closedActivity;
          modifiedActivities.push(closedRes.modifiedEntry);
          if (closedRes.warning) warnings.push(closedRes.warning);
        }

        const title =
          input.taskMeta?.title?.trim() ||
          (typeof preState.title === "string" && preState.title.trim()) ||
          "Task";
        const { newActivity, nextSessionVersion } = openNewActiveRowTx(
          conn,
          meta,
          {
            title,
            taskUuid: op.target_task_uuid ?? undefined,
            projectSnapshot: input.taskMeta?.projectSnapshot,
            tags: input.taskMeta?.tags,
            source: "task_bridge",
            effectiveAtMs,
          },
          ts,
          policy,
        );
        const timeEffect = closedActivity ? "switched" : "started";
        const undo: UndoMetadata = {
          createdActivityId: newActivity.id,
          createdPostVersion: 1,
          modifiedActivities,
          touchedTimer: true,
          expectedPostActiveActivityId: newActivity.id,
          restoreActiveActivityId: activeRow?.id ?? null,
        };
        const receipt: Record<string, unknown> = {
          operationId: op.operation_id,
          idempotencyKey: op.idempotency_key,
          ok: true,
          changed: true,
          timeEffect,
          activity: newActivity,
          ...(closedActivity ? { closedActivity } : {}),
          warnings,
          sessionVersion: nextSessionVersion,
          timeEpoch: meta.time_epoch,
          taskDataEpoch: meta.task_data_epoch,
          undo,
        };
        finalizeOperationRowTx(conn, op.operation_id, {
          state: finalState,
          targetActivityId: newActivity.id,
          externalDisposition: input.externalDisposition,
          receipt,
          ts,
        });
        return {
          applied: true,
          state: finalState,
          timeEffect,
          receipt,
          activity: newActivity,
          closedActivity,
          warnings,
        };
      }

      if (
        op.kind === "task_stop" ||
        op.kind === "task_complete" ||
        op.kind === "task_delete"
      ) {
        if (
          activeRow &&
          activeRow.end_ms === null &&
          targetUuid &&
          activeRow.task_uuid?.toLowerCase() === targetUuid
        ) {
          const stopReason: ActivityStopReason =
            op.kind === "task_complete"
              ? "task_complete"
              : op.kind === "task_delete"
                ? "task_delete"
                : "task_stop";
          const { closedActivity, modifiedEntry, warning } = closeActiveRowTx(
            conn,
            activeRow,
            effectiveAtMs,
            ts,
            policy,
            { stopReason },
          );
          const warnings = warning ? [warning] : [];
          const nextSessionVersion = meta.session_version + 1;
          conn
            .prepare(
              "UPDATE time_meta SET active_activity_id = NULL, session_version = ?, updated_at_ms = ? WHERE id = 1",
            )
            .run(nextSessionVersion, ts);
          const undo: UndoMetadata = {
            modifiedActivities: [modifiedEntry],
            touchedTimer: true,
            expectedPostActiveActivityId: null,
            restoreActiveActivityId: activeRow.id,
          };
          const receipt: Record<string, unknown> = {
            operationId: op.operation_id,
            idempotencyKey: op.idempotency_key,
            ok: true,
            changed: true,
            timeEffect: "stopped",
            activity: closedActivity,
            warnings,
            sessionVersion: nextSessionVersion,
            timeEpoch: meta.time_epoch,
            taskDataEpoch: meta.task_data_epoch,
            undo,
          };
          finalizeOperationRowTx(conn, op.operation_id, {
            state: finalState,
            targetActivityId: closedActivity.id,
            externalDisposition: input.externalDisposition,
            receipt,
            ts,
          });
          return {
            applied: true,
            state: finalState,
            timeEffect: "stopped",
            receipt,
            activity: closedActivity,
            warnings,
          };
        }

        // Other task (e.g. task B) or idle remains untouched!
        const receipt: Record<string, unknown> = {
          operationId: op.operation_id,
          idempotencyKey: op.idempotency_key,
          ok: true,
          changed: false,
          timeEffect: "none",
          warnings: [],
          sessionVersion: meta.session_version,
          timeEpoch: meta.time_epoch,
          taskDataEpoch: meta.task_data_epoch,
        };
        finalizeOperationRowTx(conn, op.operation_id, {
          state: finalState,
          externalDisposition: input.externalDisposition,
          receipt,
          ts,
        });
        return {
          applied: true,
          state: finalState,
          timeEffect: "none",
          receipt,
          warnings: [],
        };
      }

      throw new TimeStoreError(
        400,
        "UNSUPPORTED_COORDINATED_KIND",
        `Unsupported coordinated operation kind: ${op.kind}`,
      );
    });
    if (outcome.applied && outcome.timeEffect !== "none") {
      notifyScheduleListeners();
    }
    return outcome;
  }

  function markPreparedOperationsPendingOnStartup(): TimeOperationRecord[] {
    return inImmediateTx((conn) => {
      const rows = conn
        .prepare("SELECT * FROM operations WHERE state = 'prepared'")
        .all() as OperationRow[];
      if (rows.length === 0) return [];
      const ts = nowFn();
      conn
        .prepare(
          `UPDATE operations
           SET state = 'pending_reconcile',
               external_disposition = COALESCE(external_disposition, 'PREPARED_INTERRUPTED'),
               updated_at_ms = ?
           WHERE state = 'prepared'`,
        )
        .run(ts);
      return rows.map((r) =>
        rowToOperation({
          ...r,
          state: "pending_reconcile",
          external_disposition:
            r.external_disposition ?? "PREPARED_INTERRUPTED",
          updated_at_ms: ts,
        }),
      );
    });
  }

  function resolvePendingOperation(input: {
    operationId: string;
    action: "dismiss" | "accept_started" | "stop_active";
    effectiveAtMs?: number;
    taskMeta?: {
      title: string;
      projectSnapshot?: string;
      tags?: string[];
    };
  }) {
    if (input.action === "dismiss") {
      return inImmediateTx((conn) => {
        const op = conn
          .prepare("SELECT * FROM operations WHERE operation_id = ?")
          .get(input.operationId) as OperationRow | undefined;
        if (!op) {
          throw new TimeStoreError(
            404,
            "OPERATION_NOT_FOUND",
            "Operation not found.",
          );
        }
        const ts = nowFn();
        const receipt = {
          operationId: op.operation_id,
          idempotencyKey: op.idempotency_key,
          ok: true,
          changed: false,
          timeEffect: "none",
          resolvedBy: "user",
          action: "dismiss",
        };
        finalizeOperationRowTx(conn, op.operation_id, {
          state: "failed",
          externalDisposition: "RESOLVED_DISMISSED",
          receipt,
          ts,
        });
        return {
          applied: true,
          state: "failed" as OperationState,
          timeEffect: "none" as const,
          receipt,
        };
      });
    }

    if (input.action === "stop_active") {
      const outcome = inImmediateTx((conn) => {
        const op = conn
          .prepare("SELECT * FROM operations WHERE operation_id = ?")
          .get(input.operationId) as OperationRow | undefined;
        if (!op) {
          throw new TimeStoreError(
            404,
            "OPERATION_NOT_FOUND",
            "Operation not found.",
          );
        }
        const meta = readMeta(conn);
        const ts = nowFn();
        const policy = parsePolicy(meta);
        const effectiveAtMs = input.effectiveAtMs ?? op.effective_at_ms ?? ts;
        const activeRow = meta.active_activity_id
          ? (conn
              .prepare("SELECT * FROM activities WHERE id = ?")
              .get(meta.active_activity_id) as ActivityRow | undefined)
          : undefined;
        if (!activeRow || activeRow.end_ms !== null) {
          const receipt = {
            operationId: op.operation_id,
            ok: true,
            changed: false,
            timeEffect: "none",
            resolvedBy: "user",
            action: "stop_active",
          };
          finalizeOperationRowTx(conn, op.operation_id, {
            state: "applied",
            externalDisposition: "RESOLVED_NO_ACTIVE",
            receipt,
            ts,
          });
          return {
            applied: true,
            state: "applied" as OperationState,
            timeEffect: "none" as const,
            receipt,
          };
        }
        const { closedActivity, modifiedEntry, warning } = closeActiveRowTx(
          conn,
          activeRow,
          effectiveAtMs,
          ts,
          policy,
        );
        const nextSessionVersion = meta.session_version + 1;
        conn
          .prepare(
            "UPDATE time_meta SET active_activity_id = NULL, session_version = ?, updated_at_ms = ? WHERE id = 1",
          )
          .run(nextSessionVersion, ts);
        const receipt = {
          operationId: op.operation_id,
          idempotencyKey: op.idempotency_key,
          ok: true,
          changed: true,
          timeEffect: "stopped",
          activity: closedActivity,
          warnings: warning ? [warning] : [],
          sessionVersion: nextSessionVersion,
          timeEpoch: meta.time_epoch,
          taskDataEpoch: meta.task_data_epoch,
          undo: {
            modifiedActivities: [modifiedEntry],
            touchedTimer: true,
            expectedPostActiveActivityId: null,
            restoreActiveActivityId: activeRow.id,
          },
          resolvedBy: "user",
          action: "stop_active",
        };
        finalizeOperationRowTx(conn, op.operation_id, {
          state: "applied",
          targetActivityId: closedActivity.id,
          externalDisposition: "RESOLVED_STOPPED",
          receipt,
          ts,
        });
        return {
          applied: true,
          state: "applied" as OperationState,
          timeEffect: "stopped" as const,
          receipt,
          activity: closedActivity,
          warnings: warning ? [warning] : [],
        };
      });
      if (outcome.timeEffect !== "none") notifyScheduleListeners();
      return outcome;
    }

    // action === "accept_started"
    const outcome = inImmediateTx((conn) => {
      const op = conn
        .prepare("SELECT * FROM operations WHERE operation_id = ?")
        .get(input.operationId) as OperationRow | undefined;
      if (!op) {
        throw new TimeStoreError(
          404,
          "OPERATION_NOT_FOUND",
          "Operation not found.",
        );
      }
      const meta = readMeta(conn);
      const ts = nowFn();
      const policy = parsePolicy(meta);
      const effectiveAtMs = input.effectiveAtMs ?? op.effective_at_ms ?? ts;
      const activeRow = meta.active_activity_id
        ? (conn
            .prepare("SELECT * FROM activities WHERE id = ?")
            .get(meta.active_activity_id) as ActivityRow | undefined)
        : undefined;
      const warnings: TimeWarning[] = [];
      const modifiedActivities: UndoMetadata["modifiedActivities"] = [];
      let closedActivity: Activity | undefined;
      if (activeRow && activeRow.end_ms === null) {
        const closedRes = closeActiveRowTx(
          conn,
          activeRow,
          effectiveAtMs,
          ts,
          policy,
        );
        closedActivity = closedRes.closedActivity;
        modifiedActivities.push(closedRes.modifiedEntry);
        if (closedRes.warning) warnings.push(closedRes.warning);
      }
      const preState = op.pre_state_json
        ? (JSON.parse(op.pre_state_json) as Record<string, unknown>)
        : {};
      const title =
        input.taskMeta?.title?.trim() ||
        (typeof preState.title === "string" && preState.title.trim()) ||
        "Task";
      const { newActivity, nextSessionVersion } = openNewActiveRowTx(
        conn,
        meta,
        {
          title,
          taskUuid: op.target_task_uuid ?? undefined,
          projectSnapshot: input.taskMeta?.projectSnapshot,
          tags: input.taskMeta?.tags,
          source: "task_bridge",
          effectiveAtMs,
        },
        ts,
        policy,
      );
      const receipt = {
        operationId: op.operation_id,
        idempotencyKey: op.idempotency_key,
        ok: true,
        changed: true,
        timeEffect: closedActivity ? "switched" : "started",
        activity: newActivity,
        ...(closedActivity ? { closedActivity } : {}),
        warnings,
        sessionVersion: nextSessionVersion,
        timeEpoch: meta.time_epoch,
        taskDataEpoch: meta.task_data_epoch,
        undo: {
          createdActivityId: newActivity.id,
          createdPostVersion: 1,
          modifiedActivities,
          touchedTimer: true,
          expectedPostActiveActivityId: newActivity.id,
          restoreActiveActivityId: activeRow?.id ?? null,
        },
        resolvedBy: "user",
        action: "accept_started",
      };
      finalizeOperationRowTx(conn, op.operation_id, {
        state: "applied",
        targetActivityId: newActivity.id,
        externalDisposition: "RESOLVED_ACCEPTED",
        receipt,
        ts,
      });
      return {
        applied: true,
        state: "applied" as OperationState,
        timeEffect: (closedActivity ? "switched" : "started") as
          "switched" | "started",
        receipt,
        activity: newActivity,
        closedActivity,
        warnings,
      };
    });
    if (outcome.applied) {
      notifyScheduleListeners();
    }
    return outcome;
  }

  async function prepareTaskRestore(
    restoreId: string,
    atMs?: number,
  ): Promise<{
    alreadyPrepared: boolean;
    taskDataEpoch: number;
    frozenActivityId?: string;
    suspendedAtMs: number;
  }> {
    const suspendMs = atMs ?? nowFn();
    const result = inImmediateTx(
      (conn) => {
        const existing = conn
          .prepare("SELECT * FROM task_restore_markers WHERE restore_id = ?")
          .get(restoreId) as
          | {
              restore_id: string;
              phase: "prepared" | "finalized";
              suspend_ms: number;
              task_data_epoch: number;
              summary_json: string;
            }
          | undefined;
        if (existing) {
          const parsed = JSON.parse(existing.summary_json) as {
            frozenActivityId?: string;
          };
          return {
            alreadyPrepared: true,
            taskDataEpoch: existing.task_data_epoch,
            frozenActivityId: parsed.frozenActivityId,
            suspendedAtMs: existing.suspend_ms,
            meta: readMeta(conn),
          };
        }

        const meta = readMeta(conn);
        const nextTaskEpoch = meta.task_data_epoch + 1;
        const ts = nowFn();
        let frozenActivityId: string | undefined;

        if (meta.active_activity_id) {
          const active = conn
            .prepare("SELECT * FROM activities WHERE id = ?")
            .get(meta.active_activity_id) as ActivityRow | undefined;
          if (active && active.task_uuid && active.end_ms === null) {
            const boundedSuspendMs =
              active.auto_stop_at_ms !== null
                ? Math.min(suspendMs, active.auto_stop_at_ms)
                : suspendMs;
            const appliedSuspendMs =
              active.suspend_ms !== null
                ? Math.min(active.suspend_ms, boundedSuspendMs)
                : boundedSuspendMs;
            conn
              .prepare(
                `UPDATE activities
               SET suspend_ms = ?, confirmed_through_ms = COALESCE(confirmed_through_ms, start_ms), review_state = 'review_required', review_reason = COALESCE(review_reason, 'restore_freeze'), version = ?, updated_at_ms = ?
               WHERE id = ?`,
              )
              .run(appliedSuspendMs, active.version + 1, ts, active.id);
            frozenActivityId = active.id;
          }
        }

        conn
          .prepare(
            `UPDATE operations
           SET state = 'pending_reconcile',
               external_disposition = COALESCE(external_disposition, 'TASK_DATA_EPOCH_CHANGED'),
               updated_at_ms = ?
           WHERE state IN ('prepared', 'external_acknowledged', 'pending_reconcile')`,
          )
          .run(ts);

        const nextSessionVersion = frozenActivityId
          ? meta.session_version + 1
          : meta.session_version;
        conn
          .prepare(
            "UPDATE time_meta SET task_data_epoch = ?, session_version = ?, updated_at_ms = ? WHERE id = 1",
          )
          .run(nextTaskEpoch, nextSessionVersion, ts);

        conn
          .prepare(
            `INSERT INTO task_restore_markers (restore_id, phase, suspend_ms, task_data_epoch, summary_json, updated_at_ms)
           VALUES (?, 'prepared', ?, ?, ?, ?)`,
          )
          .run(
            restoreId,
            suspendMs,
            nextTaskEpoch,
            JSON.stringify({ frozenActivityId }),
            ts,
          );

        return {
          alreadyPrepared: false,
          taskDataEpoch: nextTaskEpoch,
          frozenActivityId,
          suspendedAtMs: suspendMs,
          meta: readMeta(conn),
        };
      },
      { allowWhileRestoring: true },
    );

    await syncBarrierFromDb(result.meta);
    return {
      alreadyPrepared: result.alreadyPrepared,
      taskDataEpoch: result.taskDataEpoch,
      ...(result.frozenActivityId
        ? { frozenActivityId: result.frozenActivityId }
        : {}),
      suspendedAtMs: result.suspendedAtMs,
    };
  }

  function finalizeTaskRestore(
    restoreId: string,
    outcome: "committed" | "rolled_back",
    inspectTask?: (
      taskUuid: string,
    ) => { exists: boolean; status?: string; start?: string } | null,
  ): {
    alreadyFinalized: boolean;
    taskDataEpoch: number;
    outcome: "committed" | "rolled_back";
    frozenActivityStatus?: string;
  } {
    return inImmediateTx(
      (conn) => {
        const marker = conn
          .prepare("SELECT * FROM task_restore_markers WHERE restore_id = ?")
          .get(restoreId) as
          | {
              restore_id: string;
              phase: "prepared" | "finalized";
              suspend_ms: number;
              task_data_epoch: number;
              summary_json: string;
            }
          | undefined;
        if (marker?.phase === "finalized") {
          const parsed = JSON.parse(marker.summary_json) as {
            outcome?: "committed" | "rolled_back";
            frozenActivityStatus?: string;
          };
          return {
            alreadyFinalized: true,
            taskDataEpoch: marker.task_data_epoch,
            outcome: parsed.outcome ?? outcome,
            frozenActivityStatus: parsed.frozenActivityStatus,
          };
        }

        const meta = readMeta(conn);
        const ts = nowFn();
        let frozenActivityStatus: string | undefined;

        if (meta.active_activity_id) {
          const active = conn
            .prepare("SELECT * FROM activities WHERE id = ?")
            .get(meta.active_activity_id) as ActivityRow | undefined;
          if (active && active.task_uuid) {
            const taskState = inspectTask?.(active.task_uuid) ?? null;
            frozenActivityStatus = !taskState?.exists
              ? "missing"
              : taskState.status || "unknown";
          }
        }

        const summary = {
          ...(marker ? JSON.parse(marker.summary_json) : {}),
          outcome,
          frozenActivityStatus,
        };
        if (marker) {
          conn
            .prepare(
              "UPDATE task_restore_markers SET phase = 'finalized', summary_json = ?, updated_at_ms = ? WHERE restore_id = ?",
            )
            .run(JSON.stringify(summary), ts, restoreId);
        } else {
          conn
            .prepare(
              `INSERT INTO task_restore_markers (restore_id, phase, suspend_ms, task_data_epoch, summary_json, updated_at_ms)
             VALUES (?, 'finalized', ?, ?, ?, ?)`,
            )
            .run(
              restoreId,
              ts,
              meta.task_data_epoch,
              JSON.stringify(summary),
              ts,
            );
        }

        return {
          alreadyFinalized: false,
          taskDataEpoch: meta.task_data_epoch,
          outcome,
          ...(frozenActivityStatus ? { frozenActivityStatus } : {}),
        };
      },
      { allowWhileRestoring: true },
    );
  }

  function setRestoring(value: boolean): void {
    restoring = value;
    if (!value) {
      notifyScheduleListeners();
    }
  }

  function close(): void {
    scheduleListeners.clear();
    db.close();
  }

  async function reopenAfterExternalSwap(optionsAfter: {
    bumpTimeEpoch?: boolean;
    setRestoreBarrierAt?: number;
    freezeActiveAtMs?: number;
  }): Promise<TimeBarrierState> {
    const currentBarrier = await readBarrierState(barrierPath);
    const ts = optionsAfter.setRestoreBarrierAt ?? nowFn();
    const nextBarrier = await writeBarrierState(barrierPath, {
      timeEpoch: optionsAfter.bumpTimeEpoch
        ? currentBarrier.timeEpoch + 1
        : currentBarrier.timeEpoch,
      taskDataEpoch: currentBarrier.taskDataEpoch,
      restoreBarrierAt: ts,
      updatedAtMs: ts,
    });
    initialBarrier = nextBarrier;

    db = new DatabaseSync(dbPath);
    initializeTimeDatabase(db, nextBarrier, { nowMs: ts });

    if (optionsAfter.freezeActiveAtMs !== undefined) {
      const freezeMs = optionsAfter.freezeActiveAtMs;
      inImmediateTxOn(db, (conn) => {
        const meta = readMeta(conn);
        if (meta.active_activity_id) {
          const active = conn
            .prepare("SELECT * FROM activities WHERE id = ?")
            .get(meta.active_activity_id) as ActivityRow | undefined;
          if (active && active.end_ms === null) {
            const boundedFreezeMs =
              active.auto_stop_at_ms !== null
                ? Math.min(freezeMs, active.auto_stop_at_ms)
                : freezeMs;
            const appliedFreezeMs =
              active.suspend_ms !== null
                ? Math.min(active.suspend_ms, boundedFreezeMs)
                : boundedFreezeMs;
            conn
              .prepare(
                `UPDATE activities
                 SET suspend_ms = ?, confirmed_through_ms = COALESCE(confirmed_through_ms, start_ms), review_state = 'review_required', review_reason = COALESCE(review_reason, 'restore_freeze'), version = ?, updated_at_ms = ?
                 WHERE id = ?`,
              )
              .run(appliedFreezeMs, active.version + 1, ts, active.id);
            conn
              .prepare(
                "UPDATE time_meta SET session_version = ?, updated_at_ms = ? WHERE id = 1",
              )
              .run(meta.session_version + 1, ts);
          }
        }
        conn
          .prepare(
            `UPDATE operations
             SET state = 'pending_reconcile',
                 external_disposition = COALESCE(external_disposition, 'TIME_RESTORE_BARRIER'),
                 updated_at_ms = ?
             WHERE state IN ('prepared', 'external_acknowledged')`,
          )
          .run(ts);
      });
    }

    notifyScheduleListeners();
    return nextBarrier;
  }

  return {
    dbPath,
    barrierPath,
    getStatus,
    getPolicy,
    updatePolicy,
    startActivity,
    stopActivity,
    confirmActivity,
    createTimingPlan,
    updateTimingPlan,
    getTimingPlan,
    listTimingPlans,
    listTimeEvents,
    ackTimeEvents,
    settleDueTimers,
    getNextAutoStopDeadline,
    subscribeScheduleChanges,
    logLocatedActivity,
    logUnlocatedEstimate,
    locateEstimate,
    updateActivity,
    undoOperation,
    confirmSleepCandidate,
    dismissSleepCandidate,
    queryActivities,
    getDailySummary,
    getWeeklySummary,
    getReconcileDigest,
    getTimerSnapshot,
    setTaskBudget,
    getTaskCostDetail,
    getCostReport,
    listBills,
    linkBillExpense,
    unlinkBillLink,
    getOperation,
    getActivity,
    listUnresolvedOperations,
    isTaskAffectedByTimerOrPending,
    beginCoordinatedOperation,
    updateCoordinatedState,
    getEnergyInputs,
    applyCoordinatedOperationResult,
    markPreparedOperationsPendingOnStartup,
    resolvePendingOperation,
    prepareTaskRestore,
    finalizeTaskRestore,
    setRestoring,
    reopenAfterExternalSwap,
    withConnection: <T>(fn: (conn: DatabaseSync) => T): T => inImmediateTx(fn),
    readBarrier: () => readBarrierState(barrierPath),
    close,
  };
}

export type TimeStore = Awaited<ReturnType<typeof createTimeStore>>;
