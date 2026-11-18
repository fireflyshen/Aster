import assert from "node:assert/strict";
import test from "node:test";
import { resolveActivityCategory } from "../time/classification.ts";
import {
  computeDailyLedger,
  computeTaskTotalsSeconds,
  computeWeeklyDistribution,
  intervalsOverlap,
} from "../time/ledger.ts";
import {
  createDefaultTimePolicy,
  type Activity,
  type TimePolicy,
} from "../time/model.ts";
import {
  dayBoundsMs,
  localDateOf,
  splitIntervalByDay,
  zonedDateTimeToUtcMs,
} from "../time/zone.ts";

test("zone calculations handle Asia/Shanghai, cross-midnight, and DST non-24h days accurately", () => {
  // Normal 24h day in Asia/Shanghai
  const shBounds = dayBoundsMs("2026-11-15", "Asia/Shanghai");
  assert.equal((shBounds.dayEndMs - shBounds.dayStartMs) / 3600_000, 24);
  assert.equal(localDateOf(shBounds.dayStartMs, "Asia/Shanghai"), "2026-11-15");
  assert.equal(
    localDateOf(shBounds.dayStartMs - 1, "Asia/Shanghai"),
    "2026-11-14",
  );

  // America/New_York spring-forward (23h day: 2026-03-08) & fall-back (25h day: 2026-11-01)
  const spring = dayBoundsMs("2026-03-08", "America/New_York");
  assert.equal((spring.dayEndMs - spring.dayStartMs) / 3600_000, 23);
  const fall = dayBoundsMs("2026-11-01", "America/New_York");
  assert.equal((fall.dayEndMs - fall.dayStartMs) / 3600_000, 25);

  // Cross-month + cross-midnight split preserves exact duration
  const startMs = zonedDateTimeToUtcMs("2026-10-31", "22:30", "Asia/Shanghai");
  const endMs = zonedDateTimeToUtcMs("2026-11-01", "01:15", "Asia/Shanghai");
  const slices = splitIntervalByDay(startMs, endMs, "Asia/Shanghai");
  assert.equal(slices.length, 2);
  assert.equal(slices[0].date, "2026-10-31");
  assert.equal(slices[0].sliceEndMs - slices[0].sliceStartMs, 90 * 60_000);
  assert.equal(slices[1].date, "2026-11-01");
  assert.equal(slices[1].sliceEndMs - slices[1].sliceStartMs, 75 * 60_000);
});

test("half-open interval adjacency and classification precedence follow path boundaries", () => {
  assert.equal(intervalsOverlap(1000, 2000, 2000, 3000), false);
  assert.equal(intervalsOverlap(1000, 2001, 2000, 3000), true);

  const policy: TimePolicy = {
    ...createDefaultTimePolicy(),
    taskOverrides: { "task-override-1": "study" },
    projectRules: [
      { pattern: "Aster", categoryId: "work" },
      { pattern: "Aster.Learning.*", categoryId: "study" },
    ],
    tagRules: [
      { tag: "ops", categoryId: "life", priority: 1 },
      { tag: "deep", categoryId: "study", priority: 10 },
    ],
  };

  // Explicit wins over everything
  assert.deepEqual(
    resolveActivityCategory(policy, {
      explicitCategoryId: "leisure",
      taskUuid: "task-override-1",
      project: "Aster",
      tags: ["deep"],
    }),
    { categoryId: "leisure", ruleSource: "explicit", ruleVersion: 1 },
  );

  // Task override beats project & tag rules
  assert.equal(
    resolveActivityCategory(policy, {
      taskUuid: "task-override-1",
      project: "Aster",
    }).categoryId,
    "study",
  );

  // Longest project segment rule beats shorter prefix
  assert.equal(
    resolveActivityCategory(policy, { project: "Aster.Learning.Book" })
      .categoryId,
    "study",
  );

  // Segment boundary: Aster must NOT match AsterOther
  assert.equal(
    resolveActivityCategory(policy, { project: "AsterOther" }).categoryId,
    "uncategorized",
  );
  assert.equal(
    resolveActivityCategory(policy, { project: "Aster.Time" }).categoryId,
    "work",
  );

  // Higher priority tag wins; unmatched falls back cleanly to uncategorized
  assert.equal(
    resolveActivityCategory(policy, { tags: ["ops", "deep"] }).categoryId,
    "study",
  );
  assert.equal(resolveActivityCategory(policy, {}).categoryId, "uncategorized");
});

test("daily and weekly ledger keep C + U = T invariant with unlocated estimates and sleep candidates", () => {
  const policy = createDefaultTimePolicy();
  policy.sleepTemplate = {
    ...policy.sleepTemplate,
    enabled: true,
    tag: "作息",
  };
  const tz = policy.timezone;
  const day = "2026-11-15";
  const nowMs = zonedDateTimeToUtcMs("2026-11-16", "09:00", tz); // Full day 2026-11-15 is in the past

  const workStart = zonedDateTimeToUtcMs(day, "08:00", tz);
  const dayEnd = dayBoundsMs(day, tz).dayEndMs; // 16 hours [08:00, 00:00 next day)

  const locatedWork: Activity = {
    id: "act-1",
    version: 1,
    kind: "located",
    title: "Deep work",
    categoryId: "work",
    ruleVersion: 1,
    ruleSource: "explicit",
    taskUuid: "task-1",
    startMs: workStart,
    endMs: dayEnd,
    precision: "exact",
    source: "timer",
    reviewState: "ok",
    timezone: tz,
    createdAtMs: workStart,
    updatedAtMs: dayEnd,
  };

  // Cross-day window estimate: 2026-11-15 23:00 to 2026-11-16 01:00
  const unlocatedRead: Activity = {
    id: "est-1",
    version: 1,
    kind: "unlocated_estimate",
    title: "Reading",
    categoryId: "study",
    ruleVersion: 1,
    ruleSource: "explicit",
    windowStartMs: zonedDateTimeToUtcMs("2026-11-15", "23:00", tz),
    windowEndMs: zonedDateTimeToUtcMs("2026-11-16", "01:00", tz),
    targetDate: "2026-11-15",
    estimatedSeconds: 3600,
    precision: "estimated_duration",
    source: "bot",
    reviewState: "ok",
    timezone: tz,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };

  const daily = computeDailyLedger(
    day,
    [locatedWork, unlocatedRead],
    policy,
    nowMs,
  );
  assert.equal(daily.pastCapacitySeconds, 24 * 3600);
  assert.equal(daily.coveredSeconds, 16 * 3600);
  assert.equal(daily.unrecordedSeconds, 8 * 3600);
  // 16 + 8 = 24, unlocated estimate does NOT inflate covered or reduce unrecorded
  assert.equal(daily.coveredSeconds + daily.unrecordedSeconds, 24 * 3600);
  assert.equal(daily.unlocatedEstimates.length, 1);
  // Pending sleep candidate stays in U until confirmed
  assert.equal(daily.sleepCandidates.length, 1);
  assert.equal(daily.sleepCandidates[0].status, "pending");
  assert.equal(daily.sleepCandidates[0].hasConflict, false);

  // Weekly report deduplicates cross-day unlocated estimate by ID and marks partial week
  const weekly = computeWeeklyDistribution(
    "2026-11-09",
    [locatedWork, unlocatedRead],
    policy,
    nowMs,
  );
  assert.equal(weekly.isPartialWeek, false); // 2026-11-09..2026-11-15 ended at 2026-11-16 00:00
  assert.equal(weekly.unlocatedEstimates.length, 1);
  assert.equal(
    weekly.coveredSeconds + weekly.unrecordedSeconds,
    weekly.pastCapacitySeconds,
  );

  // Task totals explicitly emit 0 for requested untimed tasks
  const totals = computeTaskTotalsSeconds(
    [locatedWork],
    ["task-1", "task-untimed"],
    nowMs,
  );
  assert.equal(totals["task-1"], 16 * 3600);
  assert.equal(totals["task-untimed"], 0);
});

test("confirmedThrough isolates provisional auto-stop drafts from formal category totals and clamps overrun reads", () => {
  const policy = createDefaultTimePolicy();
  const tz = policy.timezone;
  const day = "2026-11-15";

  // Manual confirmed block 09:00..10:00 + unconfirmed auto-stopped block 13:40..14:40
  const confirmedMorning: Activity = {
    id: "act-morning",
    version: 1,
    kind: "located",
    title: "Morning work",
    categoryId: "work",
    ruleVersion: 1,
    ruleSource: "explicit",
    startMs: zonedDateTimeToUtcMs(day, "09:00", tz),
    endMs: zonedDateTimeToUtcMs(day, "10:00", tz),
    confirmedThroughMs: zonedDateTimeToUtcMs(day, "10:00", tz),
    precision: "exact",
    source: "manual",
    reviewState: "ok",
    timezone: tz,
    createdAtMs: zonedDateTimeToUtcMs(day, "09:00", tz),
    updatedAtMs: zonedDateTimeToUtcMs(day, "10:00", tz),
  };

  // Running uncapped or auto-stopped draft with confirmedThrough = startMs (13:40) and autoStopAt = 14:40
  const cappedDraft: Activity = {
    id: "act-draft",
    version: 2,
    kind: "located",
    title: "Deep study",
    categoryId: "study",
    ruleVersion: 1,
    ruleSource: "explicit",
    startMs: zonedDateTimeToUtcMs(day, "13:40", tz),
    endMs: zonedDateTimeToUtcMs(day, "14:40", tz),
    confirmedThroughMs: zonedDateTimeToUtcMs(day, "13:40", tz),
    autoStopAtMs: zonedDateTimeToUtcMs(day, "14:40", tz),
    timerStoppedAtMs: zonedDateTimeToUtcMs(day, "14:40", tz),
    stopReason: "duration_limit",
    reviewReason: "auto_stopped",
    precision: "exact",
    source: "timer",
    reviewState: "review_required",
    timezone: tz,
    createdAtMs: zonedDateTimeToUtcMs(day, "13:40", tz),
    updatedAtMs: zonedDateTimeToUtcMs(day, "14:40", tz),
  };

  const at1500 = zonedDateTimeToUtcMs(day, "15:00", tz);
  const summary = computeDailyLedger(
    day,
    [confirmedMorning, cappedDraft],
    policy,
    at1500,
  );
  // Formal totals ONLY count confirmed morning 1h; unconfirmed study draft MUST NOT enter byCategorySeconds["study"].
  assert.equal(summary.coveredSeconds, 3600);
  assert.equal(summary.provisionalSeconds, 3600);
  assert.equal(summary.reviewRequiredSeconds, 3600);
  assert.equal(summary.byCategorySeconds.work, 3600);
  assert.equal(summary.byCategorySeconds.study ?? 0, 0);
  assert.equal(
    summary.coveredSeconds + summary.unrecordedSeconds,
    summary.pastCapacitySeconds,
  );

  // Even an unsettled active activity with autoStopAt = 14:40 clamps at 14:40 when queried at 16:00.
  const activeCapped: Activity = {
    ...cappedDraft,
    endMs: undefined,
    timerStoppedAtMs: undefined,
    stopReason: undefined,
    reviewState: "ok",
    reviewReason: undefined,
  };
  const at1600 = zonedDateTimeToUtcMs(day, "16:00", tz);
  const clampedSummary = computeDailyLedger(
    day,
    [activeCapped],
    policy,
    at1600,
  );
  assert.equal(clampedSummary.locatedSegments.length, 1);
  assert.equal(clampedSummary.locatedSegments[0].durationSeconds, 3600);
  assert.equal(clampedSummary.locatedSegments[0].running, false);
});
