import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const compiled = buildSync({
  entryPoints: [path.join(webRoot, "src/features/tasks/task-date.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  alias: { "@core": path.resolve(webRoot, "../core") },
});
const { rescheduledTaskDue, isoDue, toDueDay, taskDateTone } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

test("rescheduling preserves local clock times across timezone/DST boundaries and UTC serialization", () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ["Asia/Shanghai", "America/New_York"]) {
      process.env.TZ = timezone;
      const original = new Date("2026-03-07T09:30:45");
      for (const raw of [
        original.toISOString(),
        original
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d+Z$/, "Z"),
      ]) {
        const result = rescheduledTaskDue(raw, "2026-03-09");
        const parsed = new Date(isoDue(result));
        assert.equal(toDueDay(result), "2026-03-09");
        assert.equal(parsed.getHours(), 9);
        assert.equal(parsed.getMinutes(), 30);
        assert.equal(parsed.getSeconds(), 45);
      }
      const dateOnly = new Date(
        isoDue(rescheduledTaskDue("2026-03-07", "2026-03-09")),
      );
      assert.equal(dateOnly.getHours(), 0);
      assert.equal(toDueDay(dateOnly.toISOString()), "2026-03-09");
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("invalid calendar dates cannot produce task edits", () => {
  for (const invalid of ["", "tomorrow", "2026-02-30", "2026-13-01"])
    assert.throws(() => rescheduledTaskDue("2026-11-15", invalid), /有效日期/);
});

test("date emphasis is reserved for overdue, today, tomorrow and the next seven days", () => {
  const now = new Date(2026, 10, 16, 12);
  assert.equal(taskDateTone("2026-11-15", now), "overdue");
  assert.equal(taskDateTone("2026-11-16", now), "today");
  assert.equal(taskDateTone("2026-11-17", now), "tomorrow");
  assert.equal(taskDateTone("2026-11-23", now), "upcoming");
  assert.equal(taskDateTone("2026-11-24", now), "neutral");
  assert.equal(taskDateTone("", now), "neutral");
});
