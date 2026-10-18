import assert from "node:assert/strict";
import test from "node:test";
import { formatTaskDate } from "../src/core/tasks/date.ts";
import { parseTaskwarriorDate } from "../src/core/tasks/model.ts";

test("editing another field preserves an existing due time on the selected day", () => {
  const existing = new Date(2026, 9, 5, 16, 30);
  assert.equal(parseTaskwarriorDate(formatTaskDate(new Date(2026, 9, 5), existing))?.getTime(), existing.getTime());
  assert.equal(parseTaskwarriorDate(formatTaskDate(new Date(2026, 9, 6), existing))?.getHours(), 0);
});

test("selected calendar dates round-trip across VPS timezones and DST", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["Asia/Shanghai", "America/New_York", "UTC"]) {
      process.env.TZ = timezone;
      for (const day of [new Date(2026, 2, 8, 23, 30), new Date(2026, 10, 1, 17)]) {
        const encoded = formatTaskDate(day);
        const decoded = parseTaskwarriorDate(encoded)!;
        assert.equal(decoded.getFullYear(), day.getFullYear());
        assert.equal(decoded.getMonth(), day.getMonth());
        assert.equal(decoded.getDate(), day.getDate());
        assert.equal(decoded.getHours(), 0);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
