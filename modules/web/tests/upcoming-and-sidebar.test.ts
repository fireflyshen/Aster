import test from "node:test";
import assert from "node:assert/strict";
import { upcomingWeek } from "../src/features/tasks/upcoming-model.ts";
import { readSidebarPreferences } from "../src/app/sidebar-preferences.ts";

test("upcoming weeks retain seven local calendar dates across year, leap day and DST boundaries", () => {
  assert.deepEqual(upcomingWeek("2027-01-01"), [
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
  assert.ok(upcomingWeek("2028-02-29").includes("2028-02-29"));
  assert.equal(upcomingWeek("2026-03-08").at(-1), "2026-03-08");
  assert.equal(upcomingWeek("2026-11-01").length, 7);
});

test("sidebar preferences validate stored values and keep every view recoverable after malformed storage", () => {
  assert.deepEqual(readSidebarPreferences("null"), {
    hidden: [],
    showCounts: true,
  });
  assert.deepEqual(readSidebarPreferences("broken"), {
    hidden: [],
    showCounts: true,
  });
  assert.deepEqual(
    readSidebarPreferences(
      '{"hidden":["upcoming","time","unknown",3],"showCounts":false}',
    ),
    { hidden: ["upcoming", "time"], showCounts: false },
  );
});
