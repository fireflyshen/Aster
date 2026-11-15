import type { DatabaseSync } from "node:sqlite";
import {
  createDefaultTimePolicy,
  type TimePolicy,
} from "../../../core/time/model.ts";
import type { TimeBarrierState } from "./time-barrier.ts";

export const CURRENT_TIME_SCHEMA_VERSION = 1;

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
  `);

  const nowMs = options.nowMs ?? Date.now();
  const defaultPolicy: TimePolicy = createDefaultTimePolicy();
  const existing = db
    .prepare(
      "SELECT schema_version, time_epoch, task_data_epoch, restore_barrier_at FROM time_meta WHERE id = 1",
    )
    .get() as
    | {
        schema_version: number;
        time_epoch: number;
        task_data_epoch: number;
        restore_barrier_at: number;
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
