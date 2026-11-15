import type { DatabaseSync } from "node:sqlite";
import {
  computeDurationCostCents,
  normalizeHourlyRateCents,
} from "../../../core/time/cost.ts";
import {
  createDefaultTimePolicy,
  type TimePolicy,
} from "../../../core/time/model.ts";
import type { TimeBarrierState } from "./time-barrier.ts";

export const CURRENT_TIME_SCHEMA_VERSION = 2;

export function initializeTimeDatabase(
  db: DatabaseSync,
  barrier: TimeBarrierState,
  options: { enabled?: boolean; cutoverAtMs?: number; nowMs?: number } = {},
): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS time_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      initialized INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      time_epoch INTEGER NOT NULL DEFAULT 1,
      task_data_epoch INTEGER NOT NULL DEFAULT 1,
      restore_barrier_at INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      active_activity_id TEXT NULL,
      cutover_at_ms INTEGER NULL,
      policy_version INTEGER NOT NULL DEFAULT 1,
      policy_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL CHECK (kind IN ('located', 'unlocated_estimate')),
      title TEXT NOT NULL,
      category_id TEXT NOT NULL,
      rule_version INTEGER NOT NULL,
      rule_source TEXT NOT NULL,
      task_uuid TEXT NULL,
      project_snapshot TEXT NULL,
      start_ms INTEGER NULL,
      end_ms INTEGER NULL,
      suspend_ms INTEGER NULL,
      confirmed_through_ms INTEGER NULL,
      review_due_at_ms INTEGER NULL,
      review_reason TEXT NULL,
      timing_plan_id TEXT NULL,
      auto_stop_at_ms INTEGER NULL,
      auto_stop_basis TEXT NULL,
      limit_version INTEGER NULL,
      timer_stopped_at_ms INTEGER NULL,
      stop_reason TEXT NULL,
      processed_at_ms INTEGER NULL,
      window_start_ms INTEGER NULL,
      window_end_ms INTEGER NULL,
      target_date TEXT NULL,
      estimated_seconds INTEGER NULL,
      precision TEXT NOT NULL,
      source TEXT NOT NULL,
      review_state TEXT NOT NULL,
      raw_input TEXT NULL,
      note TEXT NULL,
      timezone TEXT NOT NULL,
      import_batch_id TEXT NULL,
      source_record_id TEXT NULL,
      candidate_key TEXT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activities_located_range
      ON activities (kind, review_state, start_ms, end_ms);
    CREATE INDEX IF NOT EXISTS idx_activities_target_date
      ON activities (target_date);
    CREATE INDEX IF NOT EXISTS idx_activities_task_uuid
      ON activities (task_uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_candidate_active
      ON activities (candidate_key)
      WHERE candidate_key IS NOT NULL AND review_state != 'voided';

    CREATE TABLE IF NOT EXISTS operations (
      idempotency_key TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      time_epoch INTEGER NOT NULL,
      task_data_epoch INTEGER NOT NULL,
      received_at_ms INTEGER NOT NULL,
      state TEXT NOT NULL,
      target_activity_id TEXT NULL,
      target_task_uuid TEXT NULL,
      pre_state_json TEXT NULL,
      dependencies_json TEXT NULL,
      effective_at_ms INTEGER NULL,
      external_disposition TEXT NULL,
      undone_by_operation_id TEXT NULL,
      receipt_json TEXT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_operations_state
      ON operations (state);
    CREATE INDEX IF NOT EXISTS idx_operations_target_task
      ON operations (target_task_uuid);

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      snapshot_hash TEXT NOT NULL UNIQUE,
      cutover_ms INTEGER NOT NULL,
      range_start_ms INTEGER NULL,
      range_end_ms INTEGER NULL,
      imported_count INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_records (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
      batch_index INTEGER NOT NULL,
      raw_json TEXT NOT NULL,
      activity_id TEXT NULL,
      status TEXT NOT NULL CHECK (status IN ('imported', 'conflict_candidate', 'skipped')),
      reason TEXT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_source_records_batch
      ON source_records (batch_id, batch_index);

    CREATE TABLE IF NOT EXISTS sleep_decisions (
      candidate_key TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      template_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('confirmed', 'dismissed')),
      activity_id TEXT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_restore_markers (
      restore_id TEXT PRIMARY KEY,
      phase TEXT NOT NULL CHECK (phase IN ('prepared', 'finalized')),
      suspend_ms INTEGER NOT NULL,
      task_data_epoch INTEGER NOT NULL,
      summary_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timing_plans (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      category_id TEXT NULL,
      task_uuid TEXT NULL,
      project_snapshot TEXT NULL,
      tags_json TEXT NULL,
      note TEXT NULL,
      timezone TEXT NOT NULL,
      allowance_seconds INTEGER NULL,
      planned_start_at_ms INTEGER NULL,
      hard_stop_at_ms INTEGER NULL,
      archived_at_ms INTEGER NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_timing_plans_updated
      ON timing_plans (updated_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_timing_plans_task
      ON timing_plans (task_uuid);

    CREATE TABLE IF NOT EXISTS time_events (
      id TEXT PRIMARY KEY,
      dedup_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('auto_stopped', 'checkpoint_due', 'plan_reminder')),
      activity_id TEXT NULL,
      plan_id TEXT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      occurred_at_ms INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      acknowledged_at_ms INTEGER NULL,
      created_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_time_events_ack
      ON time_events (acknowledged_at_ms, occurred_at_ms DESC);

    CREATE TABLE IF NOT EXISTS task_budgets (
      task_uuid TEXT PRIMARY KEY,
      hourly_rate_cents INTEGER NOT NULL,
      initial_allowance_seconds INTEGER NULL,
      initial_budget_cents INTEGER NULL,
      current_allowance_seconds INTEGER NULL,
      current_budget_cents INTEGER NULL,
      planned_start_at_ms INTEGER NULL,
      hard_stop_at_ms INTEGER NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bill_links (
      id TEXT PRIMARY KEY,
      tx_key TEXT NOT NULL,
      task_uuid TEXT NULL,
      activity_id TEXT NULL,
      source TEXT NOT NULL,
      tx_id TEXT NOT NULL,
      pay_time TEXT NOT NULL,
      payee TEXT NOT NULL,
      narration TEXT NOT NULL,
      account TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      cny_amount_cents INTEGER NOT NULL,
      note TEXT NULL,
      created_at_ms INTEGER NOT NULL,
      UNIQUE(tx_key, task_uuid, activity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bill_links_task ON bill_links (task_uuid);
    CREATE INDEX IF NOT EXISTS idx_bill_links_activity ON bill_links (activity_id);
  `);

  const activityCols = new Set(
    (
      db.prepare("PRAGMA table_info(activities)").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name),
  );
  const additiveActivityCols: ReadonlyArray<[string, string]> = [
    ["tags_json", "TEXT NULL"],
    ["hourly_rate_cents", "INTEGER NULL"],
    ["confirmed_through_ms", "INTEGER NULL"],
    ["review_due_at_ms", "INTEGER NULL"],
    ["review_reason", "TEXT NULL"],
    ["timing_plan_id", "TEXT NULL"],
    ["auto_stop_at_ms", "INTEGER NULL"],
    ["auto_stop_basis", "TEXT NULL"],
    ["limit_version", "INTEGER NULL"],
    ["timer_stopped_at_ms", "INTEGER NULL"],
    ["stop_reason", "TEXT NULL"],
    ["processed_at_ms", "INTEGER NULL"],
  ];
  for (const [col, def] of additiveActivityCols) {
    if (!activityCols.has(col)) {
      db.exec(`ALTER TABLE activities ADD COLUMN ${col} ${def};`);
    }
  }

  const timingPlanCols = new Set(
    (
      db.prepare("PRAGMA table_info(timing_plans)").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name),
  );
  const additivePlanCols: ReadonlyArray<[string, string]> = [
    ["hourly_rate_cents", "INTEGER NULL"],
    ["initial_allowance_seconds", "INTEGER NULL"],
    ["initial_budget_cents", "INTEGER NULL"],
    ["current_budget_cents", "INTEGER NULL"],
  ];
  for (const [col, def] of additivePlanCols) {
    if (!timingPlanCols.has(col)) {
      db.exec(`ALTER TABLE timing_plans ADD COLUMN ${col} ${def};`);
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_activities_timing_plan
      ON activities (timing_plan_id);
  `);

  const nowMs = options.nowMs ?? Date.now();
  const defaultPolicy: TimePolicy = createDefaultTimePolicy();
  const existing = db
    .prepare(
      "SELECT schema_version, time_epoch, task_data_epoch, restore_barrier_at, policy_json FROM time_meta WHERE id = 1",
    )
    .get() as
    | {
        schema_version: number;
        time_epoch: number;
        task_data_epoch: number;
        restore_barrier_at: number;
        policy_json: string;
      }
    | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO time_meta (
        id, schema_version, initialized, enabled,
        time_epoch, task_data_epoch, restore_barrier_at,
        session_version, active_activity_id, cutover_at_ms,
        policy_version, policy_json, updated_at_ms
      ) VALUES (1, ?, 1, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`,
    ).run(
      CURRENT_TIME_SCHEMA_VERSION,
      options.enabled === false ? 0 : 1,
      Math.max(1, barrier.timeEpoch),
      Math.max(1, barrier.taskDataEpoch),
      Math.max(0, barrier.restoreBarrierAt),
      options.cutoverAtMs ?? null,
      defaultPolicy.policyVersion,
      JSON.stringify(defaultPolicy),
      nowMs,
    );
    return;
  }

  if (existing.schema_version > CURRENT_TIME_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported time.sqlite schema version ${existing.schema_version} (max supported ${CURRENT_TIME_SCHEMA_VERSION}).`,
    );
  }

  let storedPolicyRate = defaultPolicy.hourlyRateCents ?? 10_000;
  try {
    const parsedPolicy = JSON.parse(existing.policy_json) as Partial<TimePolicy>;
    storedPolicyRate = normalizeHourlyRateCents(
      parsedPolicy.hourlyRateCents,
      storedPolicyRate,
    );
  } catch {
    // Keep default fallback rate on corrupt policy JSON
  }

  if (existing.schema_version < CURRENT_TIME_SCHEMA_VERSION) {
    db.prepare(
      "UPDATE activities SET hourly_rate_cents = ? WHERE hourly_rate_cents IS NULL",
    ).run(storedPolicyRate);

    const legacyPlans = db
      .prepare(
        "SELECT id, task_uuid, allowance_seconds, planned_start_at_ms, hard_stop_at_ms, hourly_rate_cents, initial_allowance_seconds, initial_budget_cents, current_budget_cents, created_at_ms, updated_at_ms FROM timing_plans WHERE allowance_seconds IS NOT NULL",
      )
      .all() as Array<{
      id: string;
      task_uuid: string | null;
      allowance_seconds: number;
      planned_start_at_ms: number | null;
      hard_stop_at_ms: number | null;
      hourly_rate_cents: number | null;
      initial_allowance_seconds: number | null;
      initial_budget_cents: number | null;
      current_budget_cents: number | null;
      created_at_ms: number;
      updated_at_ms: number;
    }>;
    for (const plan of legacyPlans) {
      const rate = normalizeHourlyRateCents(plan.hourly_rate_cents, storedPolicyRate);
      const initSec = plan.initial_allowance_seconds ?? plan.allowance_seconds;
      const initBudget =
        plan.initial_budget_cents ?? computeDurationCostCents(initSec, rate);
      const currBudget =
        plan.current_budget_cents ??
        computeDurationCostCents(plan.allowance_seconds, rate);
      db.prepare(
        `UPDATE timing_plans
         SET hourly_rate_cents = ?,
             initial_allowance_seconds = ?,
             initial_budget_cents = ?,
             current_budget_cents = ?
         WHERE id = ?`,
      ).run(rate, initSec, initBudget, currBudget, plan.id);
      if (plan.task_uuid) {
        const key = plan.task_uuid.toLowerCase();
        db.prepare(
          `INSERT OR IGNORE INTO task_budgets (
             task_uuid, hourly_rate_cents, initial_allowance_seconds, initial_budget_cents,
             current_allowance_seconds, current_budget_cents, planned_start_at_ms, hard_stop_at_ms,
             created_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          key,
          rate,
          initSec,
          initBudget,
          plan.allowance_seconds,
          currBudget,
          plan.planned_start_at_ms,
          plan.hard_stop_at_ms,
          plan.created_at_ms,
          plan.updated_at_ms,
        );
      }
    }

    db.prepare(
      "UPDATE time_meta SET schema_version = ?, updated_at_ms = ? WHERE id = 1",
    ).run(CURRENT_TIME_SCHEMA_VERSION, nowMs);
  }

  // Enforce monotonic epoch & restore barrier from external sidecar on every open.
  const nextTimeEpoch = Math.max(existing.time_epoch, barrier.timeEpoch);
  const nextTaskEpoch = Math.max(
    existing.task_data_epoch,
    barrier.taskDataEpoch,
  );
  const nextBarrierAt = Math.max(
    existing.restore_barrier_at,
    barrier.restoreBarrierAt,
  );
  if (
    nextTimeEpoch !== existing.time_epoch ||
    nextTaskEpoch !== existing.task_data_epoch ||
    nextBarrierAt !== existing.restore_barrier_at
  ) {
    db.prepare(
      `UPDATE time_meta
       SET time_epoch = ?, task_data_epoch = ?, restore_barrier_at = ?, updated_at_ms = ?
       WHERE id = 1`,
    ).run(nextTimeEpoch, nextTaskEpoch, nextBarrierAt, nowMs);
  }
}
