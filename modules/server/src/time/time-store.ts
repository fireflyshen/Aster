import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  resolveActivityCategory,
  type ClassificationInput,
} from "../../../core/time/classification.ts";
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
  createDefaultTimePolicy,
  DEFAULT_TIMER_LIVE_WINDOW_MS,
  type Activity,
  type ActivityPrecision,
  type ActivityReviewState,
  type ActivitySource,
  type DailyLedgerSummary,
  type OperationState,
  type RuleSource,
  type SleepCandidate,
  type TimePolicy,
  type TimerSnapshot,
  type TimeWarning,
  type WeeklyDistributionSummary,
} from "../../../core/time/model.ts";
import {
  isValidTimezone,
  localDateOf,
  mondayOfWeek,
  parseLocalDate,
  parseLocalTime,
} from "../../../core/time/zone.ts";
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

export class TimeStoreError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TimeStoreError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type TimeOperationRecord = {
  idempotencyKey: string;
  operationId: string;
  kind: string;
  inputHash: string;
  timeEpoch: number;
  taskDataEpoch: number;
  receivedAtMs: number;
  state: OperationState;
  targetActivityId?: string;
  targetTaskUuid?: string;
  preState?: Record<string, unknown>;
  dependencies?: OperationDependencies;
  effectiveAtMs?: number;
  externalDisposition?: string;
  undoneByOperationId?: string;
  receipt?: Record<string, unknown>;
  createdAtMs: number;
  updatedAtMs: number;
};

export type OperationDependencies = {
  taskUuids: string[];
  activityIds: string[];
  holdsTimerSlot: boolean;
};

export type ActivityMutationReceipt = {
  operationId: string;
  idempotencyKey: string;
  changed: boolean;
  activity: Activity;
  closedActivity?: Activity;
  warnings: TimeWarning[];
  sessionVersion: number;
  timeEpoch: number;
  taskDataEpoch: number;
  undo?: UndoMetadata;
};

type ActivitySnapshotFields = {
  kind: Activity["kind"];
  title: string;
  categoryId: string;
  ruleVersion: number;
  ruleSource: RuleSource;
  taskUuid: string | null;
  projectSnapshot: string | null;
  startMs: number | null;
  endMs: number | null;
  suspendMs: number | null;
  windowStartMs: number | null;
  windowEndMs: number | null;
  targetDate: string | null;
  estimatedSeconds: number | null;
  precision: ActivityPrecision;
  source: ActivitySource;
  reviewState: ActivityReviewState;
  note: string | null;
  candidateKey: string | null;
};

type UndoMetadata = {
  createdActivityId?: string;
  createdPostVersion?: number;
  modifiedActivities: Array<{
    id: string;
    expectedPostVersion: number;
    restore: ActivitySnapshotFields;
  }>;
  touchedTimer: boolean;
  expectedPostActiveActivityId: string | null;
  restoreActiveActivityId: string | null;
  sleepDecisionKey?: string;
};

type MetaRow = {
  schema_version: number;
  initialized: number;
  enabled: number;
  time_epoch: number;
  task_data_epoch: number;
  restore_barrier_at: number;
  session_version: number;
  active_activity_id: string | null;
  cutover_at_ms: number | null;
  policy_version: number;
  policy_json: string;
  updated_at_ms: number;
};

type ActivityRow = {
  id: string;
  version: number;
  kind: Activity["kind"];
  title: string;
  category_id: string;
  rule_version: number;
  rule_source: RuleSource;
  task_uuid: string | null;
  project_snapshot: string | null;
  start_ms: number | null;
  end_ms: number | null;
  suspend_ms: number | null;
  window_start_ms: number | null;
  window_end_ms: number | null;
  target_date: string | null;
  estimated_seconds: number | null;
  precision: ActivityPrecision;
  source: ActivitySource;
  review_state: ActivityReviewState;
  raw_input: string | null;
  note: string | null;
  timezone: string;
  import_batch_id: string | null;
  source_record_id: string | null;
  candidate_key: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

type OperationRow = {
  idempotency_key: string;
  operation_id: string;
  kind: string;
  input_hash: string;
  time_epoch: number;
  task_data_epoch: number;
  received_at_ms: number;
  state: OperationState;
  target_activity_id: string | null;
  target_task_uuid: string | null;
  pre_state_json: string | null;
  dependencies_json: string | null;
  effective_at_ms: number | null;
  external_disposition: string | null;
  undone_by_operation_id: string | null;
  receipt_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashNormalizedInput(kind: string, input: unknown): string {
  return createHash("sha256")
    .update(`${kind}:${canonicalJson(input)}`)
    .digest("hex");
}

function rowToActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    version: row.version,
    kind: row.kind,
    title: row.title,
    categoryId: row.category_id,
    ruleVersion: row.rule_version,
    ruleSource: row.rule_source,
    ...(row.task_uuid ? { taskUuid: row.task_uuid } : {}),
    ...(row.project_snapshot ? { projectSnapshot: row.project_snapshot } : {}),
    ...(row.start_ms !== null ? { startMs: row.start_ms } : {}),
    ...(row.end_ms !== null ? { endMs: row.end_ms } : {}),
    ...(row.suspend_ms !== null ? { suspendMs: row.suspend_ms } : {}),
    ...(row.window_start_ms !== null
      ? { windowStartMs: row.window_start_ms }
      : {}),
    ...(row.window_end_ms !== null ? { windowEndMs: row.window_end_ms } : {}),
    ...(row.target_date ? { targetDate: row.target_date } : {}),
    ...(row.estimated_seconds !== null
      ? { estimatedSeconds: row.estimated_seconds }
      : {}),
    precision: row.precision,
    source: row.source,
    reviewState: row.review_state,
    ...(row.raw_input ? { rawInput: row.raw_input } : {}),
    ...(row.note ? { note: row.note } : {}),
    timezone: row.timezone,
    ...(row.import_batch_id ? { importBatchId: row.import_batch_id } : {}),
    ...(row.source_record_id ? { sourceRecordId: row.source_record_id } : {}),
    ...(row.candidate_key ? { candidateKey: row.candidate_key } : {}),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function captureSnapshotFields(row: ActivityRow): ActivitySnapshotFields {
  return {
    kind: row.kind,
    title: row.title,
    categoryId: row.category_id,
    ruleVersion: row.rule_version,
    ruleSource: row.rule_source,
    taskUuid: row.task_uuid,
    projectSnapshot: row.project_snapshot,
    startMs: row.start_ms,
    endMs: row.end_ms,
    suspendMs: row.suspend_ms,
    windowStartMs: row.window_start_ms,
    windowEndMs: row.window_end_ms,
    targetDate: row.target_date,
    estimatedSeconds: row.estimated_seconds,
    precision: row.precision,
    source: row.source,
    reviewState: row.review_state,
    note: row.note,
    candidateKey: row.candidate_key,
  };
}

function rowToOperation(row: OperationRow): TimeOperationRecord {
  return {
    idempotencyKey: row.idempotency_key,
    operationId: row.operation_id,
    kind: row.kind,
    inputHash: row.input_hash,
    timeEpoch: row.time_epoch,
    taskDataEpoch: row.task_data_epoch,
    receivedAtMs: row.received_at_ms,
    state: row.state,
    ...(row.target_activity_id
      ? { targetActivityId: row.target_activity_id }
      : {}),
    ...(row.target_task_uuid ? { targetTaskUuid: row.target_task_uuid } : {}),
    ...(row.pre_state_json ? { preState: JSON.parse(row.pre_state_json) } : {}),
    ...(row.dependencies_json
      ? { dependencies: JSON.parse(row.dependencies_json) }
      : {}),
    ...(row.effective_at_ms !== null
      ? { effectiveAtMs: row.effective_at_ms }
      : {}),
    ...(row.external_disposition
      ? { externalDisposition: row.external_disposition }
      : {}),
    ...(row.undone_by_operation_id
      ? { undoneByOperationId: row.undone_by_operation_id }
      : {}),
    ...(row.receipt_json ? { receipt: JSON.parse(row.receipt_json) } : {}),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export function validatePolicy(policy: TimePolicy): TimePolicy {
  if (!isValidTimezone(policy.timezone)) {
    throw new TimeStoreError(
      400,
      "INVALID_TIMEZONE",
      `Unsupported timezone: ${policy.timezone}`,
    );
  }
  parseLocalTime(policy.sleepTemplate.startTime);
  parseLocalTime(policy.sleepTemplate.endTime);
  if (!Array.isArray(policy.categories) || policy.categories.length === 0) {
    throw new TimeStoreError(
      400,
      "INVALID_POLICY",
      "At least one category must be configured.",
    );
  }
  if (
    typeof policy.longActivityThresholdSeconds !== "number" ||
    policy.longActivityThresholdSeconds < 0
  ) {
    throw new TimeStoreError(
      400,
      "INVALID_POLICY",
      "Invalid long activity threshold.",
    );
  }
  return policy;
}

export type CreateTimeStoreOptions = {
  barrierPath?: string;
  enabled?: boolean;
  cutoverAtMs?: number;
  now?: () => number;
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

  function inImmediateTx<T>(fn: (conn: DatabaseSync) => T): T {
    return inImmediateTxOn(assertOpen(), fn);
  }

  function readMeta(conn: DatabaseSync): MetaRow {
    const row = conn.prepare("SELECT * FROM time_meta WHERE id = 1").get() as
      | MetaRow
      | undefined;
    if (!row) {
      throw new TimeStoreError(
        500,
        "TIME_META_MISSING",
        "Time metadata row is missing.",
      );
    }
    return row;
  }

  function parsePolicy(meta: MetaRow): TimePolicy {
    try {
      return JSON.parse(meta.policy_json) as TimePolicy;
    } catch {
      return createDefaultTimePolicy();
    }
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
         WHERE state IN ('prepared', 'external_acknowledged', 'skipped_already_satisfied', 'pending_reconcile')
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

  function insertActivityRow(conn: DatabaseSync, activity: Activity): void {
    conn
      .prepare(
        `INSERT INTO activities (
          id, version, kind, title, category_id, rule_version, rule_source,
          task_uuid, project_snapshot, start_ms, end_ms, suspend_ms,
          window_start_ms, window_end_ms, target_date, estimated_seconds,
          precision, source, review_state, raw_input, note, timezone,
          import_batch_id, source_record_id, candidate_key,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        activity.startMs ?? null,
        activity.endMs ?? null,
        activity.suspendMs ?? null,
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
          "SELECT COUNT(*) as cnt FROM operations WHERE state IN ('prepared', 'external_acknowledged', 'skipped_already_satisfied', 'pending_reconcile')",
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
          input.patch.sleepTemplate.enabled !== current.sleepTemplate.enabled);

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
    const closeEndMs =
      activeRow.suspend_ms !== null
        ? Math.min(effectiveAtMs, activeRow.suspend_ms)
        : effectiveAtMs;
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
    const nextVersion = activeRow.version + 1;
    const modifiedEntry: UndoMetadata["modifiedActivities"][number] = {
      id: activeRow.id,
      expectedPostVersion: nextVersion,
      restore: captureSnapshotFields(activeRow),
    };
    conn
      .prepare(
        `UPDATE activities
         SET end_ms = ?, review_state = ?, version = ?, updated_at_ms = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        closeEndMs,
        reviewState,
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
      startMs: input.effectiveAtMs,
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
    title: string;
    explicitCategoryId?: string;
    taskUuid?: string;
    projectSnapshot?: string;
    tags?: string[];
    source?: ActivitySource;
    note?: string;
    rawInput?: string;
    sameTaskNoop?: boolean;
    expectedSessionVersion?: number;
  }): ActivityMutationReceipt {
    const title = input.title.trim();
    if (!title || title.length > 500) {
      throw new TimeStoreError(
        400,
        "INVALID_TITLE",
        "Activity title must be 1 to 500 characters.",
      );
    }
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const effectiveAtMs = input.effectiveAtMs ?? nowFn();
    const normalized = {
      title,
      explicitCategoryId: input.explicitCategoryId,
      taskUuid: input.taskUuid,
      projectSnapshot: input.projectSnapshot,
      tags: input.tags,
      source: input.source ?? "timer",
      note: input.note,
      rawInput: input.rawInput,
      sameTaskNoop: Boolean(input.sameTaskNoop),
      expectedSessionVersion: input.expectedSessionVersion,
    };
    const inputHash = hashNormalizedInput("start", normalized);

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

      assertTimerSlotAvailable(conn);

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
      const ts = nowFn();
      const warnings: TimeWarning[] = [];
      const modifiedActivities: UndoMetadata["modifiedActivities"] = [];

      const activeRow = meta.active_activity_id
        ? (conn
            .prepare("SELECT * FROM activities WHERE id = ?")
            .get(meta.active_activity_id) as ActivityRow | undefined)
        : undefined;

      if (
        activeRow &&
        input.sameTaskNoop &&
        input.taskUuid &&
        activeRow.task_uuid?.toLowerCase() === input.taskUuid.toLowerCase() &&
        activeRow.end_ms === null &&
        activeRow.suspend_ms === null
      ) {
        const operationId = randomUUID();
        const receipt: ActivityMutationReceipt = {
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
          receipt,
          nowMs: ts,
        });
        return receipt;
      }

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

      const { newActivity, nextSessionVersion } = openNewActiveRowTx(
        conn,
        meta,
        {
          title,
          explicitCategoryId: input.explicitCategoryId,
          taskUuid: input.taskUuid,
          projectSnapshot: input.projectSnapshot,
          tags: input.tags,
          source: input.source,
          note: input.note,
          rawInput: input.rawInput,
          effectiveAtMs,
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
      const receipt: ActivityMutationReceipt = {
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
        targetTaskUuid: input.taskUuid,
        effectiveAtMs,
        receipt,
        nowMs: ts,
      });
      return receipt;
    });
  }

  function stopActivity(input: {
    idempotencyKey: string;
    receivedAtMs?: number;
    effectiveAtMs?: number;
    expectedActivityId?: string;
    expectedVersion?: number;
    expectedSessionVersion?: number;
  }): ActivityMutationReceipt {
    const receivedAtMs = input.receivedAtMs ?? nowFn();
    const effectiveAtMs = input.effectiveAtMs ?? nowFn();
    const normalized = {
      expectedActivityId: input.expectedActivityId,
      expectedVersion: input.expectedVersion,
      expectedSessionVersion: input.expectedSessionVersion,
    };
    const inputHash = hashNormalizedInput("stop", normalized);

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

      assertTimerSlotAvailable(conn);

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
      const ts = nowFn();
      const {
        closedActivity: closed,
        modifiedEntry,
        warning,
      } = closeActiveRowTx(conn, activeRow, effectiveAtMs, ts, policy);
      const warnings = warning ? [warning] : [];

      const nextSessionVersion = meta.session_version + 1;
      conn
        .prepare(
          "UPDATE time_meta SET active_activity_id = NULL, session_version = ?, updated_at_ms = ? WHERE id = 1",
        )
        .run(nextSessionVersion, ts);

      const operationId = randomUUID();
      const receipt: ActivityMutationReceipt = {
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
        receipt,
        nowMs: ts,
      });
      return receipt;
    });
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

      const policy = parsePolicy(meta);
      const classified = resolveActivityCategory(policy, {
        explicitCategoryId: input.explicitCategoryId,
        taskUuid: input.taskUuid,
        project: input.projectSnapshot,
        tags: input.tags,
      });

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
        startMs: input.startMs,
        endMs: input.endMs,
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
               precision = ?,
               review_state = 'ok',
               version = ?,
               updated_at_ms = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          input.startMs,
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
      const ts = nowFn();
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
      const nextPrecision = patch.precision ?? row.precision;

      let nextStartMs = row.start_ms;
      let nextEndMs = row.end_ms;
      let nextSuspendMs = row.suspend_ms;
      let nextWindowStartMs = row.window_start_ms;
      let nextWindowEndMs = row.window_end_ms;
      let nextTargetDate = row.target_date;
      let nextEstimatedSeconds = row.estimated_seconds;
      let nextReviewState = row.review_state;

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

        if (
          patch.confirmReview ||
          (patch.endMs !== undefined && row.review_state === "review_required")
        ) {
          nextReviewState = "ok";
          if (nextEndMs !== null) nextSuspendMs = null;
        }
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
               task_uuid = ?, start_ms = ?, end_ms = ?, suspend_ms = ?,
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
          nextTaskUuid,
          nextStartMs,
          nextEndMs,
          nextSuspendMs,
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
      const receipt: ActivityMutationReceipt = {
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
        receipt,
        nowMs: ts,
      });
      return receipt;
    });
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

    return inImmediateTx((conn) => {
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
                 task_uuid = ?, project_snapshot = ?, start_ms = ?, end_ms = ?, suspend_ms = ?,
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
            r.startMs,
            r.endMs,
            r.suspendMs,
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
      if (!policy.sleepTemplate.enabled) {
        throw new TimeStoreError(
          409,
          "SLEEP_TEMPLATE_DISABLED",
          "Sleep template is disabled.",
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
        categoryId: sleepCategory,
        ruleVersion: policy.policyVersion,
        ruleSource: "explicit",
        startMs,
        endMs,
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

  function loadAllActivities(conn: DatabaseSync): Activity[] {
    return (
      conn
        .prepare(
          "SELECT * FROM activities ORDER BY COALESCE(start_ms, created_at_ms) ASC",
        )
        .all() as ActivityRow[]
    ).map(rowToActivity);
  }

  function loadSleepDecisions(
    conn: DatabaseSync,
  ): Map<string, { status: "confirmed" | "dismissed"; activityId?: string }> {
    const rows = conn
      .prepare("SELECT candidate_key, status, activity_id FROM sleep_decisions")
      .all() as Array<{
      candidate_key: string;
      status: "confirmed" | "dismissed";
      activity_id: string | null;
    }>;
    const map = new Map<
      string,
      { status: "confirmed" | "dismissed"; activityId?: string }
    >();
    for (const row of rows) {
      map.set(row.candidate_key, {
        status: row.status,
        ...(row.activity_id ? { activityId: row.activity_id } : {}),
      });
    }
    return map;
  }

  function queryActivities(filter?: {
    startMs?: number;
    endMs?: number;
    includeVoided?: boolean;
  }): Activity[] {
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
    const conn = assertOpen();
    const meta = readMeta(conn);
    const policy = parsePolicy(meta);
    const summary = getDailySummary(date, atMs);
    const unresolved = getUnresolvedTimerHolders(conn).map(rowToOperation);
    const reviewItems = summary.locatedSegments.filter(
      (s) => s.reviewState === "review_required",
    );
    return {
      date: summary.date,
      timezone: policy.timezone,
      asOfMs: summary.asOfMs,
      policyVersion: policy.policyVersion,
      sessionVersion: meta.session_version,
      timeEpoch: meta.time_epoch,
      coveredSeconds: summary.coveredSeconds,
      unrecordedSeconds: summary.unrecordedSeconds,
      sleepCandidates: summary.sleepCandidates.filter(
        (c) => c.status === "pending",
      ),
      gaps: summary.gaps,
      unlocatedEstimates: summary.unlocatedEstimates,
      reviewItems,
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
      active && active.endMs === undefined && active.suspendMs === undefined,
    );
    const liveUntilMs =
      state === "ready" && isRunning ? ts + DEFAULT_TIMER_LIVE_WINDOW_MS : ts;

    const earliest = activities
      .filter(
        (a) =>
          a.kind === "located" &&
          a.startMs !== undefined &&
          a.reviewState !== "voided",
      )
      .reduce<
        number | undefined
      >((min, a) => (min === undefined || a.startMs! < min ? a.startMs! : min), undefined);

    return {
      backend: "time",
      contractVersion: 1,
      timeEpoch: meta.time_epoch,
      taskDataEpoch: meta.task_data_epoch,
      state,
      sessionVersion: meta.session_version,
      snapshotAt: new Date(ts).toISOString(),
      liveUntil: new Date(liveUntilMs).toISOString(),
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
              ? { suspendAt: new Date(active.suspendMs).toISOString() }
              : {}),
          }
        : null,
      taskTotalsSeconds: computeTaskTotalsSeconds(
        activities,
        input?.taskUuids ?? [],
        ts,
      ),
      totalsComplete: true,
      ...(earliest !== undefined
        ? { coverageFrom: new Date(earliest).toISOString() }
        : meta.cutover_at_ms !== null
          ? { coverageFrom: new Date(meta.cutover_at_ms).toISOString() }
          : {}),
      historyComplete: meta.cutover_at_ms === null || earliest !== undefined,
    };
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
          { operationId: existing.operation_id, state: existing.state },
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
        importedRanges: Array<{ rangeStartMs?: number; rangeEndMs?: number }>;
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
      if (op.state === "applied" || op.state === "skipped_already_satisfied") {
        if (op.receipt_json) {
          const parsed = JSON.parse(op.receipt_json) as Record<string, unknown>;
          return {
            applied: true,
            state: op.state,
            timeEffect:
              (parsed.timeEffect as
                | "started"
                | "switched"
                | "stopped"
                | "none") ?? "none",
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
          { operationId: op.operation_id, state: "pending_reconcile" },
        );
      }

      const policy = parsePolicy(meta);
      const effectiveAtMs = input.effectiveAtMs ?? op.effective_at_ms ?? ts;
      const finalState: OperationState =
        input.finalState ??
        (op.state === "skipped_already_satisfied"
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
          const { closedActivity, modifiedEntry, warning } = closeActiveRowTx(
            conn,
            activeRow,
            effectiveAtMs,
            ts,
            policy,
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
    }

    // action === "accept_started"
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
          | "switched"
          | "started",
        receipt,
        activity: newActivity,
        closedActivity,
        warnings,
      };
    });
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
    const result = inImmediateTx((conn) => {
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
          const appliedSuspendMs = active.suspend_ms ?? suspendMs;
          conn
            .prepare(
              `UPDATE activities
               SET suspend_ms = ?, review_state = 'review_required', version = ?, updated_at_ms = ?
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
           WHERE state IN ('prepared', 'external_acknowledged', 'skipped_already_satisfied', 'pending_reconcile')`,
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
    });

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
    return inImmediateTx((conn) => {
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
    });
  }

  function setRestoring(value: boolean): void {
    restoring = value;
  }

  function close(): void {
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
            conn
              .prepare(
                `UPDATE activities
                 SET suspend_ms = COALESCE(suspend_ms, ?), review_state = 'review_required', version = ?, updated_at_ms = ?
                 WHERE id = ?`,
              )
              .run(freezeMs, active.version + 1, ts, active.id);
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
             WHERE state IN ('prepared', 'external_acknowledged', 'skipped_already_satisfied')`,
          )
          .run(ts);
      });
    }

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
