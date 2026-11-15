import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const [file, directory] = process.argv.slice(2);
if (!file || !directory)
  throw new Error(
    "Usage: node repair-sleep-costs.mjs TIME_DB BACKUP_DIRECTORY",
  );
const db = new DatabaseSync(resolve(file));
db.exec("PRAGMA busy_timeout=5000");
try {
  const policy = JSON.parse(
    db.prepare("SELECT policy_json FROM time_meta WHERE id=1").get()
      .policy_json,
  );
  const categories = [
    ...new Set([
      "sleep",
      ...policy.categories.filter((c) => c.isSleep).map((c) => c.id),
    ]),
  ];
  const placeholders = categories.map(() => "?").join(",");
  const candidates = db
    .prepare(
      `SELECT * FROM activities WHERE category_id IN (${placeholders}) AND (hourly_rate_cents IS NULL OR hourly_rate_cents != 0)`,
    )
    .all(...categories);
  if (!candidates.length) {
    console.log(JSON.stringify({ changed: 0 }));
  } else {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const backupFile = join(resolve(directory), "time.sqlite");
    await backup(db, backupFile);
    const before = db
      .prepare(
        "SELECT session_version,active_activity_id FROM time_meta WHERE id=1",
      )
      .get();
    const audit = { backupFile, before, activities: candidates };
    await writeFile(
      join(directory, "sleep-cost-repair.json"),
      JSON.stringify(audit, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      const update = db.prepare(
        "UPDATE activities SET hourly_rate_cents=0,version=version+1,updated_at_ms=? WHERE id=? AND version=? AND category_id=?",
      );
      for (const row of candidates) {
        if (
          Number(
            update.run(Date.now(), row.id, row.version, row.category_id)
              .changes,
          ) !== 1
        )
          throw new Error(
            "Activity changed during backup; no writes applied. Refresh and retry with a new backup directory.",
          );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const after = db
      .prepare(
        `SELECT id,version,title,category_id,hourly_rate_cents,start_ms,end_ms FROM activities WHERE category_id IN (${placeholders})`,
      )
      .all(...categories);
    const integrity = db.prepare("PRAGMA quick_check").get();
    console.log(
      JSON.stringify({
        changed: candidates.length,
        backupFile,
        after,
        integrity,
      }),
    );
  }
} finally {
  db.close();
}
