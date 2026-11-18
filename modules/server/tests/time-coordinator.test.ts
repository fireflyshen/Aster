import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  mergeTimerSnapshot,
  snapshotLiveStatus,
} from "../../core/time/snapshot.ts";
import { TaskExecutionError } from "../../core/connection/errors.ts";
import type { RawTask } from "../../core/tasks/raw.ts";
import type { TaskService } from "../../core/tasks/service.ts";
import { createTimeCoordinator } from "../src/time/time-coordinator.ts";
import { createTimeStore, TimeStoreError } from "../src/time/time-store.ts";

function makeMemoryTaskHarness() {
  const tasks = new Map<string, RawTask>();
  const calls: string[] = [];
  let startError: ((uuid: string) => Error | null) | undefined;
  let stopError: ((uuid: string) => Error | null) | undefined;

  const service = {
    rawTask: async (uuid: string) => {
      calls.push(`rawTask:${uuid}`);
      const t = tasks.get(uuid);
      if (!t) throw new Error(`Missing task ${uuid}`);
      return structuredClone(t);
    },
    startTask: async (uuid: string) => {
      calls.push(`startTask:${uuid}`);
      const err = startError?.(uuid);
      if (err) throw err;
      const t = tasks.get(uuid);
      if (t) {
        t.start = "20261115T100000Z";
        t.modified = "20261115T100000Z";
      }
    },
    stopTask: async (uuid: string) => {
      calls.push(`stopTask:${uuid}`);
      const err = stopError?.(uuid);
      if (err) throw err;
      const t = tasks.get(uuid);
      if (t) {
        delete t.start;
        t.modified = "20261115T100500Z";
      }
    },
    completeTask: async (uuid: string) => {
      calls.push(`completeTask:${uuid}`);
      const t = tasks.get(uuid);
      if (t) {
        delete t.start;
        t.status = "completed";
        t.end = "20261115T101000Z";
      }
    },
  } as unknown as TaskService;

  return {
    tasks,
    calls,
    service,
    setStartError: (fn?: (uuid: string) => Error | null) => {
      startError = fn;
    },
    setStopError: (fn?: (uuid: string) => Error | null) => {
      stopError = fn;
    },
  };
}

test("COORD-01..04: skip already-started, unknown outcome pending_reconcile, unrelated fast path, and dependent block", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-coord-");
  try {
    let nowMs = Date.parse("2026-11-15T10:00:00.000Z");
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => nowMs,
    });
    const harness = makeMemoryTaskHarness();
    const coordinator = createTimeCoordinator({
      service: harness.service,
      store,
      now: () => nowMs,
    });

    const uuidA = "aaaa1111-1111-4111-8111-111111111111";
    const uuidB = "bbbb2222-2222-4222-8222-222222222222";
    const uuidC = "cccc3333-3333-4333-8333-333333333333";

    // COORD-01: Task A already has raw.start -> startTask skips external command!
    harness.tasks.set(uuidA, {
      uuid: uuidA,
      id: 1,
      description: "Task A",
      project: "Work",
      status: "pending",
      entry: "20261115T090000Z",
      start: "20261115T095000Z",
      modified: "20261115T095000Z",
    });
    harness.tasks.set(uuidB, {
      uuid: uuidB,
      id: 2,
      description: "Task B",
      project: "Work",
      status: "pending",
      entry: "20261115T090000Z",
      modified: "20261115T090000Z",
    });
    harness.tasks.set(uuidC, {
      uuid: uuidC,
      id: 3,
      description: "Task C",
      project: "Work",
      status: "pending",
      entry: "20261115T090000Z",
      modified: "20261115T090000Z",
    });

    const startARes = await coordinator.startTask(uuidA, {
      idempotencyKey: "k-start-a",
    });
    assert.equal(startARes.skippedExternal, true);
    assert.equal(
      harness.calls.some((c) => c === `startTask:${uuidA}`),
      false,
    );
    assert.equal(store.getStatus().activeActivity?.taskUuid, uuidA);

    // COORD-02 + COORD-04: Start Task B throws unknown outcome EVEN AFTER Taskwarrior mutated start/modified!
    // Must stay pending_reconcile rather than guessing from external start/modified fields.
    harness.setStartError(() => {
      const b = harness.tasks.get(uuidB)!;
      b.start = "20261115T100100Z";
      b.modified = "20261115T100100Z";
      return new TaskExecutionError("timeout after signal", "unknown");
    });
    nowMs += 60_000;
    await assert.rejects(
      coordinator.startTask(uuidB, { idempotencyKey: "k-start-b" }),
      (err: unknown) =>
        err instanceof TimeStoreError &&
        err.status === 409 &&
        err.code === "OPERATION_PENDING_RECONCILE",
    );
    harness.setStartError(undefined);

    const statusDuringPending = store.getStatus();
    assert.equal(statusDuringPending.pendingOperationsCount, 1);
    const snap = store.getTimerSnapshot();
    assert.equal(snap.state, "pending_reconcile");
    // Unresolved op suspends active Task A extrapolation!
    const liveStatus = snapshotLiveStatus(
      mergeTimerSnapshot(null, snap, nowMs),
      nowMs + 10_000,
    );
    assert.equal(liveStatus.canTick, false);
    assert.equal(liveStatus.stateLabel, "pending_reconcile");

    // COORD-03: Unrelated Task C complete & delete succeed despite Task B pending_reconcile!
    const completeC = await coordinator.completeTask(uuidC);
    assert.equal(completeC.ok, true);
    assert.equal(harness.tasks.get(uuidC)?.status, "completed");

    // COORD-04: Dependent Task A (and target Task B) blocked with 409 while op is unresolved!
    await assert.rejects(coordinator.completeTask(uuidA), (err: unknown) => {
      assert.ok(err instanceof TimeStoreError);
      assert.equal(err.status, 409);
      assert.equal(err.code, "OPERATION_PENDING_RECONCILE");
      return true;
    });
    await assert.rejects(coordinator.startTask(uuidB), (err: unknown) => {
      assert.ok(err instanceof TimeStoreError);
      assert.equal(err.status, 409);
      assert.equal(err.code, "TIMER_PENDING_RECONCILE");
      return true;
    });

    // Inspect pending op exposes helpful suggestion hint & allows user resolution without re-running external start.
    const pendingOp = store.listUnresolvedOperations()[0];
    const inspected = await coordinator.inspectPendingOperation(
      pendingOp.operationId,
    );
    assert.match(inspected.suggestionHint || "", /任务现在已开始/);

    const resolved = await coordinator.resolvePending({
      operationId: pendingOp.operationId,
      action: "accept_started",
      effectiveAtMs: nowMs,
    });
    assert.equal(resolved.applied, true);
    assert.equal(resolved.state, "applied");
    assert.equal(store.getStatus().activeActivity?.taskUuid, uuidB);
    assert.equal(store.getTimerSnapshot().state, "ready");

    // Stopping Task A now ONLY clears Task A's raw.start without stopping Task B!
    harness.calls.length = 0;
    const stopA = await coordinator.stopTask(uuidA);
    assert.equal(stopA.timeEffect, "none");
    assert.equal(harness.tasks.get(uuidA)?.start, undefined);
    assert.equal(store.getStatus().activeActivity?.taskUuid, uuidB);

    // Startup reconciliation converts leftover `prepared` operations to `pending_reconcile` without re-running task commands.
    store.beginCoordinatedOperation({
      idempotencyKey: "k-crash-prepared",
      kind: "task_start",
      inputHash: "h-crash",
      receivedAtMs: nowMs + 1000,
      targetTaskUuid: uuidA,
      preState: { status: "pending", start: null },
      effectiveAtMs: nowMs + 1000,
    });
    harness.calls.length = 0;
    const recon = await coordinator.reconcileStartup();
    assert.equal(recon.markedPendingFromPrepared, 1);
    assert.equal(recon.leftPending, 1);
    assert.equal(harness.calls.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("task timing accepts a shared tag without a project and rejects unassigned starts before writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-coord-project-"));
  const store = await createTimeStore(join(dir, "time.sqlite"));
  try {
    const harness = makeMemoryTaskHarness();
    const uuid = "11111111-1111-4111-8111-111111111111";
    harness.tasks.set(uuid, {
      uuid,
      description: "Inbox task",
      status: "pending",
      entry: "20261115T090000Z",
    });
    const coordinator = createTimeCoordinator({
      service: harness.service,
      store,
    });
    await assert.rejects(
      () => coordinator.startTask(uuid),
      (error) =>
        (error as { code?: string }).code === "TIME_ASSIGNMENT_REQUIRED",
    );
    assert.equal(store.getStatus().activeActivity, null);
    assert.ok(!harness.calls.some((call) => call.startsWith("startTask:")));
    store.updatePolicy({
      expectedPolicyVersion: store.getPolicy().policyVersion,
      patch: { zeroRateTags: ["睡眠"] },
    });
    harness.tasks.get(uuid)!.tags = ["睡眠"];
    await coordinator.startTask(uuid);
    assert.equal(store.getStatus().activeActivity?.categoryId, "uncategorized");
    assert.equal(store.getStatus().activeActivity?.hourlyRateCents, 0);
    assert.deepEqual(store.getStatus().activeActivity?.tags, ["睡眠"]);
    assert.equal(store.getStatus().activeActivity?.projectSnapshot, undefined);
    assert.equal(harness.tasks.get(uuid)?.project, undefined);
    assert.equal(harness.tasks.get(uuid)?.status, "pending");
    assert.ok(harness.calls.some((call) => call.startsWith("startTask:")));
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
