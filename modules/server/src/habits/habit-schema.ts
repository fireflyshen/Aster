import type { DatabaseSync } from "node:sqlite";

export const CURRENT_HABIT_SCHEMA_VERSION = 1;

export function initializeHabitDatabase(
  db: DatabaseSync,
  nowMs: number = Date.now(),
): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS habit_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      task_uuid TEXT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('positive', 'negative')),
      completion_mode TEXT NOT NULL CHECK (completion_mode IN ('simple', 'checklist')),
      description TEXT NOT NULL DEFAULT '',
      project TEXT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
      track_time INTEGER NOT NULL DEFAULT 0,
      ab_enabled INTEGER NOT NULL DEFAULT 0,
      subtask_plans_json TEXT NOT NULL DEFAULT '{}',
      schedule_json TEXT NOT NULL,
      plans_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_date TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_habits_status_sort
      ON habits (status, sort_order, created_at_ms);

    CREATE TABLE IF NOT EXISTS habit_revisions (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      effective_from_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
      completion_mode TEXT NOT NULL CHECK (completion_mode IN ('simple', 'checklist')),
      ab_enabled INTEGER NOT NULL DEFAULT 0,
      schedule_json TEXT NOT NULL,
      plans_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_habit_revisions_lookup
      ON habit_revisions (habit_id, effective_from_date, created_at_ms);

    CREATE TABLE IF NOT EXISTS habit_daily_logs (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at_ms INTEGER NULL,
      plan_id TEXT NULL,
      checklist_snapshot_json TEXT NULL,
      checklist_progress_json TEXT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      UNIQUE (habit_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_habit_daily_logs_date
      ON habit_daily_logs (date, habit_id);

    CREATE TABLE IF NOT EXISTS habit_negative_events (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      occurred_at_ms INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_habit_negative_events_lookup
      ON habit_negative_events (habit_id, date, occurred_at_ms);
  `);

  const habitColumns = db.prepare("PRAGMA table_info(habits)").all() as Array<{
    name: string;
  }>;
  const colNames = new Set(habitColumns.map((c) => c.name));
  if (!colNames.has("task_uuid")) {
    db.exec("ALTER TABLE habits ADD COLUMN task_uuid TEXT NULL");
  }
  if (!colNames.has("subtask_plans_json")) {
    db.exec(
      "ALTER TABLE habits ADD COLUMN subtask_plans_json TEXT NOT NULL DEFAULT '{}'",
    );
  }
  if (!colNames.has("track_time")) {
    db.exec(
      "ALTER TABLE habits ADD COLUMN track_time INTEGER NOT NULL DEFAULT 0",
    );
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_habits_task_uuid ON habits (task_uuid)",
  );

  const meta = db
    .prepare("SELECT schema_version FROM habit_meta WHERE id = 1")
    .get() as { schema_version: number } | undefined;

  if (!meta) {
    db.prepare(
      "INSERT INTO habit_meta (id, schema_version, updated_at_ms) VALUES (1, ?, ?)",
    ).run(CURRENT_HABIT_SCHEMA_VERSION, nowMs);
  }
}
