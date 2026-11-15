import assert from "node:assert/strict";
import test from "node:test";
import type { Activity, TimerSnapshot } from "../time/model.ts";
import {
  displayedActiveActivitySeconds,
  displayedTaskSecondsFromSnapshot,
  isSnapshotNewerOrEqual,
  mergeTimerSnapshot,
  snapshotLiveStatus,
} from "../time/snapshot.ts";
import { zonedDateTimeToUtcMs } from "../time/zone.ts";
import {
  calculateTimeModeEnergy,
  energyDayWindow,
  liveEnergySummary,
} from "../workspace/energy.ts";

function makeSnapshot(overrides: Partial<TimerSnapshot> = {}): TimerSnapshot {
  return {
    backend: "time",
    contractVersion: 1,
    timeEpoch: 1,
    taskDataEpoch: 1,
    state: "ready",
    sessionVersion: 1,
    snapshotAt: "2026-11-15T10:00:00.000Z",
    liveUntil: "2026-11-15T10:00:30.000Z",
    activeActivity: null,
    taskTotalsSeconds: {},
    totalsComplete: true,
    historyComplete: true,
    ...overrides,
  };
}

test("UI-01..03: TimerSnapshot monotonic merge, liveUntil cap, non-task safety, and omitted keys", () => {
  const s1 = makeSnapshot({
    timeEpoch: 1,
    taskDataEpoch: 2,
    sessionVersion: 5,
    snapshotAt: "2026-11-15T10:00:00.000Z",
    liveUntil: "2026-11-15T10:00:30.000Z",
    activeActivity: {
      id: "act-b",
      version: 1,
      title: "Task B",
      categoryId: "work",
      taskUuid: "task-b",
      startedAt: "2026-11-15T09:50:00.000Z",
      state: "running",
    },
    taskTotalsSeconds: {
      "task-a": 1200,
      "task-b": 600,
      "task-zero": 0,
    },
  });

  // Out-of-order stale response must be ignored monotonically.
  const olderSession = makeSnapshot({
    timeEpoch: 1,
    taskDataEpoch: 2,
    sessionVersion: 4,
    snapshotAt: "2026-11-15T10:00:10.000Z",
    activeActivity: null,
    taskTotalsSeconds: { "task-a": 999 },
  });
  assert.equal(isSnapshotNewerOrEqual(olderSession, s1), false);

  let tracked = mergeTimerSnapshot(null, s1, 1000);
  tracked = mergeTimerSnapshot(tracked, olderSession, 2000);
  assert.equal(tracked.snapshot.sessionVersion, 5);
  assert.equal(tracked.receivedMonoMs, 1000);

  // At +10s mono: ONLY active task-b advances (600 + 10); inactive task-a stays 1200; task-zero stays 0; omitted returns undefined ("—").
  assert.equal(snapshotLiveStatus(tracked, 11_000).stateLabel, "live");
  assert.equal(snapshotLiveStatus(tracked, 11_000).canTick, true);
  assert.equal(
    displayedTaskSecondsFromSnapshot(tracked, "task-b", 11_000),
    610,
  );
  assert.equal(
    displayedTaskSecondsFromSnapshot(tracked, "task-a", 11_000),
    1200,
  );
  assert.equal(
    displayedTaskSecondsFromSnapshot(tracked, "task-zero", 11_000),
    0,
  );
  assert.equal(
    displayedTaskSecondsFromSnapshot(tracked, "task-missing", 11_000),
    undefined,
  );
  assert.equal(displayedActiveActivitySeconds(tracked, 11_000), 610);

  // Sleep / offline for 2 hours (> 30s liveUntil): caps strictly at +30s and transitions to stale.
  const twoHoursLaterMono = 1000 + 2 * 3600 * 1000;
  const staleStatus = snapshotLiveStatus(tracked, twoHoursLaterMono);
  assert.equal(staleStatus.stateLabel, "stale");
  assert.equal(staleStatus.canTick, false);
  assert.equal(staleStatus.expired, true);
  assert.equal(staleStatus.cappedExtraSeconds, 30);
  assert.equal(
    displayedTaskSecondsFromSnapshot(tracked, "task-b", twoHoursLaterMono),
    630,
  );
  assert.equal(displayedActiveActivitySeconds(tracked, twoHoursLaterMono), 630);

  // pending_reconcile / restoring / review_required freeze extrapolation completely.
  const pendingSnap = mergeTimerSnapshot(
    tracked,
    makeSnapshot({
      timeEpoch: 1,
      taskDataEpoch: 2,
      sessionVersion: 6,
      state: "pending_reconcile",
      activeActivity: {
        id: "act-b",
        version: 1,
        title: "Task B",
        categoryId: "work",
        taskUuid: "task-b",
        startedAt: "2026-11-15T09:50:00.000Z",
        state: "running",
      },
      taskTotalsSeconds: { "task-b": 615 },
    }),
    20_000,
  );
  assert.equal(snapshotLiveStatus(pendingSnap, 25_000).canTick, false);
  assert.equal(
    snapshotLiveStatus(pendingSnap, 25_000).stateLabel,
    "pending_reconcile",
  );
  assert.equal(
    displayedTaskSecondsFromSnapshot(pendingSnap, "task-b", 25_000),
    615,
  );

  // Non-task active activity advances global banner while keeping every task row static.
  const nonTaskSnap = mergeTimerSnapshot(
    pendingSnap,
    makeSnapshot({
      timeEpoch: 1,
      taskDataEpoch: 2,
      sessionVersion: 7,
      state: "ready",
      snapshotAt: "2026-11-15T11:00:00.000Z",
      liveUntil: "2026-11-15T11:00:30.000Z",
      activeActivity: {
        id: "act-walk",
        version: 1,
        title: "散步",
        categoryId: "health",
        taskUuid: undefined,
        startedAt: "2026-11-15T10:50:00.000Z",
        state: "running",
      },
      taskTotalsSeconds: { "task-a": 1200 },
    }),
    30_000,
  );
  assert.equal(displayedActiveActivitySeconds(nonTaskSnap, 42_000), 612);
  assert.equal(
    displayedTaskSecondsFromSnapshot(nonTaskSnap, "task-a", 42_000),
    1200,
  );
});

test("Energy V1 adapts to timezone 06:00 boundary, ignores non-task activities, and pauses incomplete cutover cycles", () => {
  const tz = "Asia/Shanghai";
  // 2026-11-15 05:59+08:00 still belongs to 2026-11-14 energy day; 06:00 resets to 2026-11-15.
  const beforeReset = new Date(zonedDateTimeToUtcMs("2026-11-15", "05:59", tz));
  const atReset = new Date(zonedDateTimeToUtcMs("2026-11-15", "06:00", tz));
  assert.equal(energyDayWindow(beforeReset, tz).day, "2026-11-14");
  assert.equal(energyDayWindow(atReset, tz).day, "2026-11-15");

  const startMs = zonedDateTimeToUtcMs("2026-11-15", "08:00", tz);
  const taskActivity: Activity = {
    id: "t-act",
    version: 1,
    kind: "located",
    title: "Implement Time",
    categoryId: "work",
    ruleVersion: 1,
    ruleSource: "explicit",
    taskUuid: "task-1",
    startMs,
    endMs: startMs + 3600 * 1000,
    precision: "exact",
    source: "task_bridge",
    reviewState: "ok",
    timezone: tz,
    createdAtMs: startMs,
    updatedAtMs: startMs + 3600 * 1000,
  };
  const walkActivity: Activity = {
    id: "walk-act",
    version: 1,
    kind: "located",
    title: "散步",
    categoryId: "health",
    ruleVersion: 1,
    ruleSource: "explicit",
    startMs: startMs + 3600 * 1000,
    endMs: startMs + 7200 * 1000,
    precision: "exact",
    source: "bot",
    reviewState: "ok",
    timezone: tz,
    createdAtMs: startMs,
    updatedAtMs: startMs + 7200 * 1000,
  };
  const now = new Date(startMs + 7200 * 1000);

  // Task has stale Taskwarrior `start` while no active Time activity -> MUST NOT fall back to task.start.
  const summary = calculateTimeModeEnergy({
    tasks: [
      {
        uuid: "task-1",
        status: "pending",
        start: "2026-11-15T01:00:00.000Z",
      },
    ],
    activities: [taskActivity, walkActivity],
    activeActivityId: null,
    timezone: tz,
    now,
  });
  assert.equal(summary.mode, "time");
  assert.equal(summary.complete, true);
  assert.equal(summary.paused, false);
  // 1 task started (-5) + 1h task work (-20 @ 180s/pt) = -25 -> 75 remaining; non-task walk excluded!
  assert.equal(summary.trackedSecondsToday, 3600);
  assert.equal(summary.used, 25);
  assert.equal(summary.remaining, 75);
  assert.equal(summary.activeCount, 0);

  // Mid-cycle cutover without pre-cutover import pauses remaining estimation (`null`).
  const paused = calculateTimeModeEnergy({
    tasks: [],
    activities: [taskActivity],
    activeActivityId: null,
    timezone: tz,
    cutoverAtMs: zonedDateTimeToUtcMs("2026-11-15", "09:30", tz),
    importedRanges: [],
    now,
  });
  assert.equal(paused.remaining, null);
  assert.equal(paused.complete, false);
  assert.equal(paused.paused, true);
  assert.ok(paused.incompleteReason);
  // liveEnergySummary stays paused inside same day, resets after next 06:00 boundary.
  assert.equal(
    liveEnergySummary(paused, new Date(now.getTime() + 60_000))?.remaining,
    null,
  );
  const nextCycle = new Date(zonedDateTimeToUtcMs("2026-11-16", "06:01", tz));
  const afterNextReset = liveEnergySummary(paused, nextCycle)!;
  assert.equal(afterNextReset.day, "2026-11-16");
  assert.equal(afterNextReset.paused, false);
  assert.equal(afterNextReset.remaining, 100);

  // Covering import restores complete energy calculation.
  const resumed = calculateTimeModeEnergy({
    tasks: [],
    activities: [taskActivity],
    activeActivityId: null,
    timezone: tz,
    cutoverAtMs: zonedDateTimeToUtcMs("2026-11-15", "09:30", tz),
    importedRanges: [
      {
        rangeStartMs: zonedDateTimeToUtcMs("2026-11-15", "05:00", tz),
        rangeEndMs: zonedDateTimeToUtcMs("2026-11-15", "09:30", tz),
      },
    ],
    now,
  });
  assert.equal(resumed.complete, true);
  assert.equal(resumed.paused, false);
  assert.equal(typeof resumed.remaining, "number");
});
