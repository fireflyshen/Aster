import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zonedDateTimeToUtcMs } from "../../core/time/zone.ts";
import { createTimeBackupService } from "../src/time/time-backup.ts";
import { checkSqliteBackupSupport } from "../src/time/time-barrier.ts";
import {
  analyzeTimewarriorSnapshot,
  applyTimewarriorSnapshotImport,
} from "../src/time/time-import.ts";
import { CURRENT_TIME_SCHEMA_VERSION } from "../src/time/time-schema.ts";
import { createTimeStore, TimeStoreError } from "../src/time/time-store.ts";

test("time store preflight, single-active timer switching, long-activity warning, and optimistic concurrency", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-time-store-");
  try {
    const preflight = await checkSqliteBackupSupport(join(dir, "preflight"));
    assert.equal(preflight.ok, true);

    let fakeNow = zonedDateTimeToUtcMs("2026-11-15", "22:00", "Asia/Shanghai");
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => fakeNow,
    });

    const startRead = store.startActivity({
      idempotencyKey: "msg-1",
      title: "看书",
      explicitCategoryId: "study",
      source: "bot",
    });
    assert.equal(startRead.changed, true);
    assert.equal(startRead.sessionVersion, 1);
    assert.equal(startRead.activity.id.length, 36);

    // Same idempotency key + same input returns original receipt
    const retryRead = store.startActivity({
      idempotencyKey: "msg-1",
      title: "看书",
      explicitCategoryId: "study",
      source: "bot",
    });
    assert.equal(retryRead.operationId, startRead.operationId);
    assert.equal(retryRead.activity.id, startRead.activity.id);

    // Same key + different input is rejected (409)
    assert.throws(
      () =>
        store.startActivity({
          idempotencyKey: "msg-1",
          title: "打游戏",
          explicitCategoryId: "leisure",
        }),
      (err: unknown) =>
        err instanceof TimeStoreError && err.code === "IDEMPOTENCY_CONFLICT",
    );

    // Stale expectedSessionVersion cannot stop/switch active activity
    assert.throws(
      () =>
        store.stopActivity({
          idempotencyKey: "stale-stop",
          expectedSessionVersion: 0,
        }),
      (err: unknown) =>
        err instanceof TimeStoreError &&
        err.code === "SESSION_VERSION_CONFLICT",
    );

    // TIMER-01: Next day 12:00 (14 hours later) start walk -> closes reading with LONG_ACTIVITY_CLOSED warning
    fakeNow = zonedDateTimeToUtcMs("2026-11-16", "12:00", "Asia/Shanghai");
    const switchWalk = store.startActivity({
      idempotencyKey: "msg-2",
      title: "散步",
      explicitCategoryId: "exercise",
      source: "bot",
    });
    assert.equal(switchWalk.warnings.length, 1);
    assert.equal(switchWalk.warnings[0].code, "LONG_ACTIVITY_CLOSED");
    assert.equal(switchWalk.warnings[0].durationSeconds, 14 * 3600);
    assert.equal(switchWalk.closedActivity?.reviewState, "review_required");

    // Edit old reading end time back to 23:30 without disturbing walk
    const edited = store.updateActivity({
      idempotencyKey: "msg-3",
      activityId: switchWalk.closedActivity!.id,
      expectedVersion: switchWalk.closedActivity!.version,
      patch: {
        endMs: zonedDateTimeToUtcMs("2026-11-15", "23:30", "Asia/Shanghai"),
      },
    });
    assert.equal(edited.activity.reviewState, "ok");

    const dayNov16 = store.getDailySummary("2026-11-16", fakeNow + 600_000);
    assert.equal(dayNov16.coveredSeconds, 0);
    assert.equal(dayNov16.provisionalSeconds, 600); // Only 10m provisional walk; reading's 00:00..12:00 released!
    assert.equal(store.getStatus().activeActivity?.id, switchWalk.activity.id);

    // Stopping formalizes the 10m interval into coveredSeconds
    store.stopActivity({
      idempotencyKey: "msg-4",
      effectiveAtMs: fakeNow + 600_000,
    });
    const dayNov16AfterStop = store.getDailySummary(
      "2026-11-16",
      fakeNow + 600_000,
    );
    assert.equal(dayNov16AfterStop.coveredSeconds, 600);
    assert.equal(dayNov16AfterStop.provisionalSeconds, 0);

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unlocated estimate converts in-place (16+8+1 -> 17+7+0), handles conflicts, and supports version-checked undo", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-time-est-");
  try {
    const day = "2026-11-15";
    const tz = "Asia/Shanghai";
    const nowMs = zonedDateTimeToUtcMs("2026-11-16", "08:00", tz);
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => nowMs,
    });

    // 16h located [05:00, 21:00)
    store.logLocatedActivity({
      idempotencyKey: "loc-1",
      title: "Work",
      explicitCategoryId: "work",
      startMs: zonedDateTimeToUtcMs(day, "05:00", tz),
      endMs: zonedDateTimeToUtcMs(day, "21:00", tz),
    });

    // Two windowed estimates for 19:00-21:00 (EST-01)
    const est1 = store.logUnlocatedEstimate({
      idempotencyKey: "est-1",
      title: "吃饭",
      explicitCategoryId: "life",
      estimatedSeconds: 3600,
      targetDate: day,
      windowStartMs: zonedDateTimeToUtcMs(day, "19:00", tz),
      windowEndMs: zonedDateTimeToUtcMs(day, "21:00", tz),
    });
    const est2 = store.logUnlocatedEstimate({
      idempotencyKey: "est-2",
      title: "看电影",
      explicitCategoryId: "leisure",
      estimatedSeconds: 3600,
      targetDate: day,
      windowStartMs: zonedDateTimeToUtcMs(day, "19:00", tz),
      windowEndMs: zonedDateTimeToUtcMs(day, "21:00", tz),
    });

    let summary = store.getDailySummary(day, nowMs);
    assert.equal(summary.coveredSeconds, 16 * 3600);
    assert.equal(summary.unrecordedSeconds, 8 * 3600);
    assert.equal(summary.unlocatedEstimates.length, 2);

    // Attempting to locate into occupied [20:00, 21:00) fails cleanly with conflicts
    assert.throws(
      () =>
        store.locateEstimate({
          idempotencyKey: "locate-conflict",
          activityId: est1.activity.id,
          expectedVersion: est1.activity.version,
          startMs: zonedDateTimeToUtcMs(day, "20:00", tz),
          endMs: zonedDateTimeToUtcMs(day, "21:00", tz),
        }),
      (err: unknown) =>
        err instanceof TimeStoreError &&
        err.code === "INTERVAL_CONFLICT" &&
        Array.isArray(err.details?.conflicts) &&
        err.details!.conflicts.length === 1,
    );

    // Locating est1 into empty [21:00, 22:00) transforms SAME activity UUID in-place
    const located = store.locateEstimate({
      idempotencyKey: "locate-ok",
      activityId: est1.activity.id,
      expectedVersion: est1.activity.version,
      startMs: zonedDateTimeToUtcMs(day, "21:00", tz),
      endMs: zonedDateTimeToUtcMs(day, "22:00", tz),
    });
    assert.equal(located.activity.id, est1.activity.id);
    assert.equal(located.activity.kind, "located");

    summary = store.getDailySummary(day, nowMs);
    assert.equal(summary.coveredSeconds, 17 * 3600);
    assert.equal(summary.unrecordedSeconds, 7 * 3600);
    assert.equal(summary.unlocatedEstimates.length, 1);
    assert.equal(summary.unlocatedEstimates[0].id, est2.activity.id);

    // Undo locate converts back to unlocated estimate; if modified afterwards, undo rejects
    store.undoOperation({
      idempotencyKey: "undo-locate",
      targetOperationId: located.operationId,
    });
    summary = store.getDailySummary(day, nowMs);
    assert.equal(summary.coveredSeconds, 16 * 3600);
    assert.equal(summary.unlocatedEstimates.length, 2);

    // Double undo fails
    assert.throws(
      () =>
        store.undoOperation({
          idempotencyKey: "undo-locate-again",
          targetOperationId: located.operationId,
        }),
      (err: unknown) =>
        err instanceof TimeStoreError &&
        err.code === "OPERATION_ALREADY_UNDONE",
    );

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sleep candidate confirmation is idempotent, detects unstopped timer conflicts, and respects undo", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-time-sleep-");
  try {
    const tz = "Asia/Shanghai";
    let nowMs = zonedDateTimeToUtcMs("2026-11-15", "22:00", tz);
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => nowMs,
    });

    // Unstopped timer running from 22:00 across the night
    const timer = store.startActivity({
      idempotencyKey: "sleep-block-start",
      title: "Late work",
      explicitCategoryId: "work",
    });

    nowMs = zonedDateTimeToUtcMs("2026-11-16", "21:30", tz);
    const digest = store.getReconcileDigest("2026-11-16", nowMs);
    assert.equal(digest.sleepCandidates.length, 1);
    assert.equal(digest.sleepCandidates[0].hasConflict, true);

    assert.throws(
      () =>
        store.confirmSleepCandidate({
          idempotencyKey: "sleep-confirm-conflict",
          date: "2026-11-16",
        }),
      (err: unknown) =>
        err instanceof TimeStoreError && err.code === "INTERVAL_CONFLICT",
    );

    // Fix timer end to 23:00 on 2026-11-15
    store.stopActivity({
      idempotencyKey: "stop-late",
      effectiveAtMs: zonedDateTimeToUtcMs("2026-11-15", "23:00", tz),
    });

    const confirmed = store.confirmSleepCandidate({
      idempotencyKey: "sleep-confirm-1",
      date: "2026-11-16",
    });
    assert.equal(confirmed.changed, true);

    // Repeating confirmation for same date with new idempotency key does NOT duplicate
    const confirmedAgain = store.confirmSleepCandidate({
      idempotencyKey: "sleep-confirm-2",
      date: "2026-11-16",
    });
    assert.equal(confirmedAgain.changed, false);
    assert.equal(confirmedAgain.activity.id, confirmed.activity.id);

    // Undo clears sleep decision so it goes back to pending
    store.undoOperation({
      idempotencyKey: "sleep-undo",
      targetOperationId: confirmed.operationId,
    });
    const digestAfterUndo = store.getReconcileDigest("2026-11-16", nowMs);
    assert.equal(digestAfterUndo.sleepCandidates.length, 1);
    assert.equal(digestAfterUndo.sleepCandidates[0].status, "pending");
    void timer;

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("independent Time backup and restore bump monotonic epoch/barrier, freeze open timers, and reject late pre-restore retries", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-time-backup-");
  try {
    let nowMs = zonedDateTimeToUtcMs("2026-11-15", "10:00", "Asia/Shanghai");
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => nowMs,
    });
    const backupSvc = createTimeBackupService(store, {
      restoreRootDir: join(dir, "restore-points"),
      now: () => nowMs,
    });

    // Start an open activity at 10:00 and take snapshot S1
    const act1 = store.startActivity({
      idempotencyKey: "k1",
      title: "Writing",
      explicitCategoryId: "work",
    });
    const stagingDir = join(dir, "staging-1");
    const manifest = await backupSvc.exportStaging(stagingDir, {
      backupId: "b1",
    });
    assert.equal(manifest.schemaVersion, CURRENT_TIME_SCHEMA_VERSION);
    assert.equal(manifest.activeActivityId, act1.activity.id);
    assert.ok(manifest.files.sqlite.sha256.length === 64);

    // Continue working after S1
    nowMs = zonedDateTimeToUtcMs("2026-11-15", "12:00", "Asia/Shanghai");
    store.startActivity({
      idempotencyKey: "k2",
      title: "Lunch",
      explicitCategoryId: "life",
    });

    // Preview & apply restore to S1 at 14:00
    nowMs = zonedDateTimeToUtcMs("2026-11-15", "14:00", "Asia/Shanghai");
    const preview = await backupSvc.previewRestore(
      join(stagingDir, "time.sqlite"),
    );
    assert.equal(preview.candidateCounts.hasOpenActivity, true);

    const restored = await backupSvc.applyRestore(preview.token);
    assert.equal(restored.timeEpoch, 2);
    assert.equal(restored.restoreBarrierAt, nowMs);
    assert.equal(restored.frozenActiveActivityId, act1.activity.id);

    // Restored open activity is frozen with suspendAt = 14:00 and review_required
    const snap = store.getTimerSnapshot({ nowMs: nowMs + 3600_000 });
    assert.equal(snap.timeEpoch, 2);
    assert.equal(snap.activeActivity?.state, "review_required");
    assert.equal(snap.activeActivity?.suspendAt, new Date(nowMs).toISOString());

    // Downtime after restore (14:00..15:00) is NOT counted; pre-restore frozen tail stays provisional until confirmed
    const daily = store.getDailySummary("2026-11-15", nowMs + 3600_000);
    assert.equal(daily.coveredSeconds, 0);
    assert.equal(daily.provisionalSeconds, 4 * 3600); // 10:00..14:00 only
    assert.equal(daily.reviewRequiredSeconds, 4 * 3600);

    // Delayed retry predating restoreBarrierAt is isolated cleanly (REST-05)
    assert.throws(
      () =>
        store.logLocatedActivity({
          idempotencyKey: "late-msg-from-before-restore",
          receivedAtMs: zonedDateTimeToUtcMs(
            "2026-11-15",
            "11:30",
            "Asia/Shanghai",
          ),
          title: "Stale message",
          startMs: zonedDateTimeToUtcMs("2026-11-15", "08:00", "Asia/Shanghai"),
          endMs: zonedDateTimeToUtcMs("2026-11-15", "09:00", "Asia/Shanghai"),
        }),
      (err: unknown) =>
        err instanceof TimeStoreError &&
        err.code === "RESTORE_BARRIER_REJECTED",
    );

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("frozen Timewarrior snapshot import deduplicates, clips at cutover, and quarantines overlaps", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-time-import-");
  try {
    const cutoverAtMs = zonedDateTimeToUtcMs(
      "2026-11-15",
      "12:00",
      "Asia/Shanghai",
    );
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      cutoverAtMs,
      now: () => cutoverAtMs,
    });

    // Pre-existing Time interval [09:30, 10:30)
    store.logLocatedActivity({
      idempotencyKey: "existing-1",
      title: "Existing",
      explicitCategoryId: "study",
      startMs: zonedDateTimeToUtcMs("2026-11-15", "09:30", "Asia/Shanghai"),
      endMs: zonedDateTimeToUtcMs("2026-11-15", "10:30", "Asia/Shanghai"),
    });

    const intervals = [
      // Clean pre-cutover interval
      {
        id: 4,
        start: "20261115T000000Z", // 08:00+08
        end: "20261115T010000Z", // 09:00+08
        tags: ["uuid:11111111-1111-4111-8111-111111111111", "coding"],
      },
      // Overlaps existing 09:30..10:30 -> quarantined
      {
        id: 3,
        start: "20261115T011500Z", // 09:15+08
        end: "20261115T021500Z", // 10:15+08
        tags: ["overlap"],
      },
      // Open interval crossing cutover -> quarantined unless clipOpenToCutover
      {
        id: 2,
        start: "20261115T033000Z", // 11:30+08
        tags: ["open-task"],
      },
      // Post-cutover interval -> skipped
      {
        id: 1,
        start: "20261115T043000Z", // 12:30+08
        end: "20261115T050000Z",
        tags: ["after-cutover"],
      },
    ];

    const preview = analyzeTimewarriorSnapshot(store, {
      intervals,
      cutoverAtMs,
      taskLookup: (uuid) =>
        uuid === "11111111-1111-4111-8111-111111111111"
          ? { description: "Build Time", project: "Aster.Time" }
          : undefined,
    }).preview;

    assert.equal(preview.importableCount, 1);
    assert.equal(preview.conflictCount, 2);
    assert.equal(preview.skippedAfterCutoverCount, 1);
    assert.equal(preview.openAtCutoverCount, 1);

    const applied = applyTimewarriorSnapshotImport(store, {
      intervals,
      cutoverAtMs,
    });
    assert.equal(applied.reusedExistingBatch, false);
    assert.equal(applied.importedCount, 1);
    assert.equal(applied.conflictCount, 2);
    assert.equal(applied.skippedCount, 1);

    // Re-importing same snapshot with different Timewarrior positional @ids is idempotent
    const reimported = applyTimewarriorSnapshotImport(store, {
      intervals: intervals.map((item, idx) => ({
        ...item,
        id: 100 + idx,
      })),
      cutoverAtMs,
    });
    assert.equal(reimported.reusedExistingBatch, true);
    assert.equal(reimported.batchId, applied.batchId);

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("coordinated dependency checks and task restore hooks enforce epoch monotonicity and isolate non-task activities", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-time-restore-hook-");
  try {
    let nowMs = zonedDateTimeToUtcMs("2026-11-15", "10:00", "Asia/Shanghai");
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => nowMs,
    });

    const taskA = "11111111-1111-4111-8111-111111111111";
    const taskB = "22222222-2222-4222-8222-222222222222";
    const taskC = "33333333-3333-4333-8333-333333333333";

    // Start task A cleanly
    store.startActivity({
      idempotencyKey: "start-a",
      title: "Task A",
      taskUuid: taskA,
    });

    // Pending cross-system switch from A -> B leaves A in dependencies
    const prep = store.beginCoordinatedOperation({
      idempotencyKey: "coord-b",
      kind: "task_start",
      inputHash: "hash-b",
      receivedAtMs: nowMs,
      targetTaskUuid: taskB,
      preState: { start: undefined },
      effectiveAtMs: nowMs + 1000,
    });
    assert.equal(prep.replay, false);
    store.updateCoordinatedState(prep.record.operationId, {
      state: "pending_reconcile",
      externalDisposition: "unknown",
    });

    // COORD-03 & COORD-04: C is unaffected, A & B are protected!
    assert.equal(store.isTaskAffectedByTimerOrPending(taskC).affected, false);
    assert.equal(store.isTaskAffectedByTimerOrPending(taskA).affected, true);
    assert.equal(store.isTaskAffectedByTimerOrPending(taskB).affected, true);

    // Task restore prepare bumps taskDataEpoch and freezes task-bound active activity A
    nowMs += 60_000;
    const preparedRestore = await store.prepareTaskRestore("restore-1", nowMs);
    assert.equal(preparedRestore.taskDataEpoch, 2);
    assert.ok(preparedRestore.frozenActivityId);

    // Even if native restore rolls back, taskDataEpoch stays 2 and pending op is not replayed (REST-02/03)
    const finalized = store.finalizeTaskRestore(
      "restore-1",
      "rolled_back",
      () => ({
        exists: true,
        status: "pending",
      }),
    );
    assert.equal(finalized.taskDataEpoch, 2);
    assert.equal(finalized.outcome, "rolled_back");
    assert.equal(store.getStatus().taskDataEpoch, 2);
    assert.equal(
      store.getStatus().activeActivity?.reviewState,
      "review_required",
    );
    assert.equal(store.getStatus().activeActivity?.suspendMs, nowMs);

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("editing an existing paid activity into sleep clears its captured rate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-sleep-rate-"));
  const now = zonedDateTimeToUtcMs("2026-11-15", "12:00", "Asia/Shanghai");
  const store = await createTimeStore(join(dir, "time.sqlite"), {
    now: () => now,
  });
  try {
    const logged = store.logLocatedActivity({
      idempotencyKey: "paid",
      title: "Rest",
      explicitCategoryId: "work",
      startMs: now - 3600000,
      endMs: now - 1800000,
    });
    assert.equal(logged.activity.hourlyRateCents, 10000);
    const edited = store.updateActivity({
      idempotencyKey: "sleep",
      activityId: logged.activity.id,
      expectedVersion: logged.activity.version,
      patch: { categoryId: "sleep", title: "睡眠" },
    });
    assert.equal(edited.activity.hourlyRateCents, 0);
    assert.equal(edited.activity.startMs, logged.activity.startMs);
    assert.equal(edited.activity.endMs, logged.activity.endMs);
    assert.equal(
      store.getDailySummary("2026-11-15", now).confirmedCostCents,
      0,
    );
    const back = store.updateActivity({
      idempotencyKey: "back-to-work",
      activityId: edited.activity.id,
      expectedVersion: edited.activity.version,
      patch: { categoryId: "work" },
    });
    assert.equal(back.activity.hourlyRateCents, 10000);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
