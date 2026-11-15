import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { effectiveActivityEndMs } from "../../../core/time/ledger.ts";
import {
  createDefaultTimePolicy,
  type Activity,
  type TimeEvent,
  type TimeEventKind,
  type TimePolicy,
  type TimingPlan,
  type TimingPlanStatus,
  type TimingPlanStopBasis,
} from "../../../core/time/model.ts";
import { isValidTimezone, parseLocalTime } from "../../../core/time/zone.ts";
import {
  TimeStoreError,
  type ActivityRow,
  type ActivitySnapshotFields,
  type MetaRow,
  type OperationRow,
  type TimeEventRow,
  type TimeOperationRecord,
  type TimingPlanRow,
} from "./time-store-types.ts";

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

export function rowToActivity(row: ActivityRow): Activity {
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
    ...(row.confirmed_through_ms !== null
      ? { confirmedThroughMs: row.confirmed_through_ms }
      : {}),
    ...(row.review_due_at_ms !== null
      ? { reviewDueAtMs: row.review_due_at_ms }
      : {}),
    ...(row.review_reason ? { reviewReason: row.review_reason } : {}),
    ...(row.timing_plan_id ? { timingPlanId: row.timing_plan_id } : {}),
    ...(row.auto_stop_at_ms !== null
      ? { autoStopAtMs: row.auto_stop_at_ms }
      : {}),
    ...(row.auto_stop_basis ? { autoStopBasis: row.auto_stop_basis } : {}),
    ...(row.limit_version !== null ? { limitVersion: row.limit_version } : {}),
    ...(row.timer_stopped_at_ms !== null
      ? { timerStoppedAtMs: row.timer_stopped_at_ms }
      : {}),
    ...(row.stop_reason ? { stopReason: row.stop_reason } : {}),
    ...(row.processed_at_ms !== null
      ? { processedAtMs: row.processed_at_ms }
      : {}),
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

export function captureSnapshotFields(
  row: ActivityRow,
): ActivitySnapshotFields {
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
    confirmedThroughMs: row.confirmed_through_ms,
    reviewDueAtMs: row.review_due_at_ms,
    reviewReason: row.review_reason,
    timingPlanId: row.timing_plan_id,
    autoStopAtMs: row.auto_stop_at_ms,
    autoStopBasis: row.auto_stop_basis,
    limitVersion: row.limit_version,
    timerStoppedAtMs: row.timer_stopped_at_ms,
    stopReason: row.stop_reason,
    processedAtMs: row.processed_at_ms,
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

export function rowToTimeEvent(row: TimeEventRow): TimeEvent {
  return {
    id: row.id,
    dedupKey: row.dedup_key,
    kind: row.kind,
    ...(row.activity_id ? { activityId: row.activity_id } : {}),
    ...(row.plan_id ? { planId: row.plan_id } : {}),
    title: row.title,
    message: row.message,
    occurredAtMs: row.occurred_at_ms,
    payload: JSON.parse(row.payload_json || "{}") as Record<string, unknown>,
    ...(row.acknowledged_at_ms !== null
      ? { acknowledgedAtMs: row.acknowledged_at_ms }
      : {}),
    createdAtMs: row.created_at_ms,
  };
}

export function rowToOperation(row: OperationRow): TimeOperationRecord {
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

export function readMeta(conn: DatabaseSync): MetaRow {
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

export function parsePolicy(meta: MetaRow): TimePolicy {
  try {
    return JSON.parse(meta.policy_json) as TimePolicy;
  } catch {
    return createDefaultTimePolicy();
  }
}

export function computeStopLimit(params: {
  startMs: number;
  remainingAllowanceSeconds?: number;
  hardStopAtMs?: number;
}): {
  autoStopAtMs?: number;
  autoStopBasis?: TimingPlanStopBasis;
} {
  const durationStopMs =
    params.remainingAllowanceSeconds !== undefined
      ? params.startMs + params.remainingAllowanceSeconds * 1000
      : undefined;
  const hardStopMs = params.hardStopAtMs;
  if (durationStopMs !== undefined && hardStopMs !== undefined) {
    if (durationStopMs < hardStopMs) {
      return {
        autoStopAtMs: durationStopMs,
        autoStopBasis: "duration_limit",
      };
    }
    if (hardStopMs < durationStopMs) {
      return { autoStopAtMs: hardStopMs, autoStopBasis: "hard_deadline" };
    }
    return { autoStopAtMs: durationStopMs, autoStopBasis: "both_limits" };
  }
  if (durationStopMs !== undefined) {
    return {
      autoStopAtMs: durationStopMs,
      autoStopBasis: "duration_limit",
    };
  }
  if (hardStopMs !== undefined) {
    return { autoStopAtMs: hardStopMs, autoStopBasis: "hard_deadline" };
  }
  return {};
}

export function emitTimeEventTx(
  conn: DatabaseSync,
  event: {
    dedupKey: string;
    kind: TimeEventKind;
    activityId?: string;
    planId?: string;
    title: string;
    message: string;
    occurredAtMs: number;
    payload: Record<string, unknown>;
    createdAtMs: number;
  },
): TimeEvent {
  conn
    .prepare(
      `INSERT OR IGNORE INTO time_events (
        id, dedup_key, kind, activity_id, plan_id, title, message,
        occurred_at_ms, payload_json, acknowledged_at_ms, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      randomUUID(),
      event.dedupKey,
      event.kind,
      event.activityId ?? null,
      event.planId ?? null,
      event.title,
      event.message,
      event.occurredAtMs,
      JSON.stringify(event.payload),
      event.createdAtMs,
    );
  const row = conn
    .prepare("SELECT * FROM time_events WHERE dedup_key = ?")
    .get(event.dedupKey) as TimeEventRow;
  return rowToTimeEvent(row);
}

export function buildTimingPlanTx(
  conn: DatabaseSync,
  planRow: TimingPlanRow,
  refNowMs: number,
): TimingPlan {
  const segmentRows = conn
    .prepare(
      `SELECT * FROM activities
       WHERE timing_plan_id = ?
         AND kind = 'located'
         AND review_state != 'voided'
       ORDER BY COALESCE(start_ms, created_at_ms) ASC`,
    )
    .all(planRow.id) as ActivityRow[];

  let consumedSeconds = 0;
  let activeSegment: Activity | undefined;
  let lastClosedSegment: Activity | undefined;

  for (const segRow of segmentRows) {
    const seg = rowToActivity(segRow);
    if (seg.startMs === undefined) continue;
    const segEnd = effectiveActivityEndMs(seg, refNowMs) ?? seg.startMs;
    const segSeconds = Math.max(0, Math.floor((segEnd - seg.startMs) / 1000));
    consumedSeconds += segSeconds;
    if (seg.endMs === undefined && seg.suspendMs === undefined) {
      activeSegment = seg;
    } else if (seg.endMs !== undefined) {
      lastClosedSegment = seg;
    }
  }

  const allowanceSeconds =
    planRow.allowance_seconds !== null ? planRow.allowance_seconds : undefined;
  const remainingSeconds =
    allowanceSeconds !== undefined
      ? Math.max(0, allowanceSeconds - consumedSeconds)
      : undefined;

  const tags = planRow.tags_json
    ? (JSON.parse(planRow.tags_json) as string[])
    : undefined;

  const isActivelyRunning = Boolean(
    activeSegment &&
    (activeSegment.autoStopAtMs === undefined ||
      refNowMs < activeSegment.autoStopAtMs),
  );

  let effectiveAutoStopAtMs: number | undefined;
  let effectiveAutoStopBasis: TimingPlanStopBasis | undefined;
  if (isActivelyRunning && activeSegment) {
    effectiveAutoStopAtMs = activeSegment.autoStopAtMs;
    effectiveAutoStopBasis = activeSegment.autoStopBasis;
  } else if (
    planRow.archived_at_ms === null &&
    (remainingSeconds === undefined || remainingSeconds > 0) &&
    (planRow.hard_stop_at_ms === null || refNowMs < planRow.hard_stop_at_ms)
  ) {
    const preview = computeStopLimit({
      startMs: refNowMs,
      remainingAllowanceSeconds: remainingSeconds,
      hardStopAtMs:
        planRow.hard_stop_at_ms !== null ? planRow.hard_stop_at_ms : undefined,
    });
    effectiveAutoStopAtMs = preview.autoStopAtMs;
    effectiveAutoStopBasis = preview.autoStopBasis;
  }

  let status: TimingPlanStatus;
  if (planRow.archived_at_ms !== null) {
    status = "archived";
  } else if (isActivelyRunning) {
    status = "active";
  } else if (allowanceSeconds !== undefined && remainingSeconds === 0) {
    status = "stopped";
  } else if (
    planRow.hard_stop_at_ms !== null &&
    refNowMs >= planRow.hard_stop_at_ms
  ) {
    status = "expired";
  } else if (segmentRows.length > 0) {
    status = "paused";
  } else {
    status = "scheduled";
  }

  return {
    id: planRow.id,
    version: planRow.version,
    title: planRow.title,
    ...(planRow.category_id ? { categoryId: planRow.category_id } : {}),
    ...(planRow.task_uuid ? { taskUuid: planRow.task_uuid } : {}),
    ...(planRow.project_snapshot
      ? { projectSnapshot: planRow.project_snapshot }
      : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(planRow.note ? { note: planRow.note } : {}),
    timezone: planRow.timezone,
    ...(allowanceSeconds !== undefined ? { allowanceSeconds } : {}),
    ...(planRow.planned_start_at_ms !== null
      ? { plannedStartAtMs: planRow.planned_start_at_ms }
      : {}),
    ...(planRow.hard_stop_at_ms !== null
      ? { hardStopAtMs: planRow.hard_stop_at_ms }
      : {}),
    consumedSeconds,
    ...(remainingSeconds !== undefined ? { remainingSeconds } : {}),
    ...(effectiveAutoStopAtMs !== undefined ? { effectiveAutoStopAtMs } : {}),
    ...(effectiveAutoStopBasis ? { effectiveAutoStopBasis } : {}),
    status,
    ...(lastClosedSegment?.stopReason
      ? { lastStopReason: lastClosedSegment.stopReason }
      : {}),
    ...(lastClosedSegment?.endMs !== undefined
      ? { lastStoppedAtMs: lastClosedSegment.endMs }
      : {}),
    ...(isActivelyRunning && activeSegment
      ? { activeActivityId: activeSegment.id }
      : {}),
    createdAtMs: planRow.created_at_ms,
    updatedAtMs: planRow.updated_at_ms,
    ...(planRow.archived_at_ms !== null
      ? { archivedAtMs: planRow.archived_at_ms }
      : {}),
  };
}

export function loadAllActivities(conn: DatabaseSync): Activity[] {
  return (
    conn
      .prepare(
        "SELECT * FROM activities ORDER BY COALESCE(start_ms, created_at_ms) ASC",
      )
      .all() as ActivityRow[]
  ).map(rowToActivity);
}

export function loadSleepDecisions(
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
