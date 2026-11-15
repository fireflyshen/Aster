import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zonedDateTimeToUtcMs } from "../../core/time/zone.ts";
import type { TaskService } from "../../core/tasks/service.ts";
import { createTimeHandlers } from "../src/time/time-api.ts";
import { createTimeCoordinator } from "../src/time/time-coordinator.ts";
import { createTimeAutoStopScheduler } from "../src/time/time-scheduler.ts";
import { createTimeStore, TimeStoreError } from "../src/time/time-store.ts";
import { createWorkspaceGate } from "../src/transport/workspace-gate.ts";

function at(hhmm: string, date = "2026-11-15"): number {
  return zonedDateTimeToUtcMs(date, hhmm, "Asia/Shanghai");
}

function durationSec(act: { startMs?: number; endMs?: number }): number {
  return Math.round(((act.endMs ?? 0) - (act.startMs ?? 0)) / 1000);
}

function configurePolicy(
  store: Awaited<ReturnType<typeof createTimeStore>>,
): void {
  store.updatePolicy({
    expectedPolicyVersion: store.getStatus().policy.policyVersion,
    patch: { timezone: "Asia/Shanghai" },
  });
}

function assertTimeError(
  fn: () => unknown,
  code: string,
  status?: number,
): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(
      err instanceof TimeStoreError,
      `Expected TimeStoreError, got ${err}`,
    );
    assert.equal(err.code, code);
    if (status !== undefined) assert.equal(err.status, status);
    return true;
  });
}

test("STOP-01..STOP-04: manual start only, min(start+allowance, hardStop), idle no-record, and expired start protection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-stop-01-"));
  let now = at("13:00");
  try {
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => now,
    });
    configurePolicy(store);

    // Validation guards: plannedStart >= hardStop, hardStop <= now, non-positive allowance -> 400 INVALID_TIMING_PLAN
    assertTimeError(
      () =>
        store.createTimingPlan({
          title: "Bad window",
          allowanceSeconds: 3600,
          plannedStartAtMs: at("15:00"),
          hardStopAtMs: at("15:00"),
        }),
      "INVALID_TIMING_PLAN",
      400,
    );
    assertTimeError(
      () =>
        store.createTimingPlan({
          title: "Past hard stop",
          hardStopAtMs: at("12:59"),
        }),
      "INVALID_TIMING_PLAN",
      400,
    );
    assertTimeError(
      () =>
        store.createTimingPlan({
          title: "Zero allowance",
          allowanceSeconds: 0,
        }),
      "INVALID_TIMING_PLAN",
      400,
    );

    // STOP-01: 60m allowance, planned 14:00, hardStop 15:00 -> start early at 13:40 -> autoStopAt = 14:40
    const { plan: plan1 } = store.createTimingPlan({
      idempotencyKey: "plan-1",
      title: "Deep work",
      categoryId: "work",
      allowanceSeconds: 3600,
      plannedStartAtMs: at("14:00"),
      hardStopAtMs: at("15:00"),
    });
    assert.equal(plan1.status, "scheduled");
    assert.equal(plan1.remainingSeconds, 3600);

    // Passing plannedStartAt (13:15) on an unrelated idle plan does NOT auto-start
    const { plan: idlePlan } = store.createTimingPlan({
      idempotencyKey: "plan-idle",
      title: "Never started",
      allowanceSeconds: 1800,
      plannedStartAtMs: at("13:15"),
      hardStopAtMs: at("13:30"),
    });

    now = at("13:40");
    const started = store.startActivity({
      idempotencyKey: "start-p1",
      timingPlanId: plan1.id,
    });
    assert.equal(started.activity?.startMs, at("13:40"));
    assert.equal(started.activity?.autoStopAtMs, at("14:40"));
    assert.equal(started.activity?.autoStopBasis, "duration_limit");
    // STOP-12: capped timer suppresses hourly checkpoint reminders
    assert.equal(started.activity?.reviewDueAtMs, undefined);

    // Snapshot exposes autoStopAt for client-side live clamp
    const snapMid = store.getTimerSnapshot({ nowMs: at("14:22") });
    assert.equal(
      snapMid.activeActivity?.autoStopAt,
      new Date(at("14:40")).toISOString(),
    );
    assert.equal(snapMid.activeActivity?.timingPlanId, plan1.id);

    // Settle due timers late (at 14:55) -> stopped strictly at 14:40
    now = at("14:55");
    const settled = store.settleDueTimers(now);
    assert.equal(settled.settled, true);
    assert.equal(settled.activity?.endMs, at("14:40"));
    assert.equal(durationSec(settled.activity!), 3600);
    assert.equal(settled.activity?.stopReason, "duration_limit");
    assert.equal(settled.activity?.reviewState, "review_required");
    assert.equal(settled.activity?.reviewReason, "auto_stopped");
    assert.equal(settled.event?.kind, "auto_stopped");

    // STOP-03: idlePlan crossed 13:15 plannedStart and 13:30 hardStop without any activity ever created
    const allActs = store.queryActivities({});
    assert.equal(
      allActs.filter((a) => a.timingPlanId === idlePlan.id).length,
      0,
    );
    assert.equal(store.getTimingPlan(idlePlan.id, now)?.status, "expired");

    // STOP-04: Trying to start an expired plan throws 409 TIMING_PLAN_EXPIRED WITHOUT disturbing an active unrelated timer!
    now = at("15:10");
    const unrelated = store.startActivity({
      idempotencyKey: "start-unrelated",
      title: "Unrelated task",
    });
    assertTimeError(
      () =>
        store.startActivity({
          idempotencyKey: "start-expired-plan",
          timingPlanId: idlePlan.id,
        }),
      "TIMING_PLAN_EXPIRED",
      409,
    );
    assert.equal(store.getStatus().activeActivity?.id, unrelated.activity?.id);
    assert.equal(
      store.queryActivities({}).filter((a) => a.timingPlanId === idlePlan.id)
        .length,
      0,
    );

    // STOP-02: Late start inside window (start 14:30, allowance 60m, hardStop 15:00) -> autoStopAt = 15:00
    now = at("14:00", "2026-11-16");
    const { plan: planLate } = store.createTimingPlan({
      title: "Late afternoon",
      allowanceSeconds: 3600,
      plannedStartAtMs: at("14:00", "2026-11-16"),
      hardStopAtMs: at("15:00", "2026-11-16"),
    });
    now = at("14:30", "2026-11-16");
    const lateStart = store.startActivity({
      idempotencyKey: "start-late",
      timingPlanId: planLate.id,
    });
    assert.equal(lateStart.activity?.autoStopAtMs, at("15:00", "2026-11-16"));
    assert.equal(lateStart.activity?.autoStopBasis, "hard_deadline");

    now = at("15:05", "2026-11-16");
    const lateSettled = store.settleDueTimers(now);
    assert.equal(lateSettled.activity?.endMs, at("15:00", "2026-11-16"));
    assert.equal(durationSec(lateSettled.activity!), 1800);
    assert.equal(lateSettled.activity?.stopReason, "hard_deadline");

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("STOP-05 & STOP-10: pause/resume shares quota & hardStop; manual early stop stays confirmed and never re-triggers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-stop-05-"));
  let now = at("13:50");
  try {
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => now,
    });
    configurePolicy(store);

    const { plan } = store.createTimingPlan({
      title: "Quota shared work",
      allowanceSeconds: 3600,
      plannedStartAtMs: at("14:00"),
      hardStopAtMs: at("15:00"),
    });

    // Segment 1: 14:00 -> 14:20 (20m) then pause
    now = at("14:00");
    const s1 = store.startActivity({
      idempotencyKey: "p5-s1",
      timingPlanId: plan.id,
    });
    assert.equal(s1.activity?.autoStopAtMs, at("15:00"));

    now = at("14:20");
    const paused = store.stopActivity({
      idempotencyKey: "p5-pause",
      pause: true,
    });
    assert.equal(paused.activity?.endMs, at("14:20"));
    assert.equal(paused.activity?.reviewState, "ok");
    assert.equal(paused.activity?.confirmedThroughMs, at("14:20"));
    assert.equal(paused.activity?.stopReason, "manual_pause");

    const afterPause = store.getTimingPlan(plan.id, now)!;
    assert.equal(afterPause.consumedSeconds, 1200);
    assert.equal(afterPause.remainingSeconds, 2400);
    assert.equal(afterPause.status, "paused");

    // Segment 2: resume at 14:40 -> remaining 40m would be 15:20, clamped to hardStop 15:00!
    now = at("14:40");
    const s2 = store.startActivity({
      idempotencyKey: "p5-s2",
      timingPlanId: plan.id,
    });
    assert.equal(s2.activity?.autoStopAtMs, at("15:00"));
    assert.equal(s2.activity?.autoStopBasis, "hard_deadline");

    // Settle at 15:05 -> auto-stops strictly at 15:00; total accumulated = 40m (2400s), remaining = 20m but past hardStop
    now = at("15:05");
    const settled = store.settleDueTimers(now);
    assert.equal(durationSec(settled.activity!), 1200);
    assert.equal(settled.activity?.endMs, at("15:00"));
    const expiredPlan = store.getTimingPlan(plan.id, now)!;
    assert.equal(expiredPlan.consumedSeconds, 2400);
    assert.equal(expiredPlan.remainingSeconds, 1200);
    assert.equal(expiredPlan.status, "expired");

    // Exhaustion check with no hardStop: 30m allowance, run 30m -> stopped (exhausted), restarting throws TIME_ALLOWANCE_EXHAUSTED
    const { plan: noHardPlan } = store.createTimingPlan({
      title: "Pure allowance",
      allowanceSeconds: 1800,
    });
    now = at("16:00");
    store.startActivity({
      idempotencyKey: "p5-nh1",
      timingPlanId: noHardPlan.id,
    });
    now = at("16:35");
    store.settleDueTimers(now);
    assert.equal(store.getTimingPlan(noHardPlan.id, now)?.status, "stopped");
    assertTimeError(
      () =>
        store.startActivity({
          idempotencyKey: "p5-nh-again",
          timingPlanId: noHardPlan.id,
        }),
      "TIME_ALLOWANCE_EXHAUSTED",
      409,
    );

    // STOP-10: manual stop before autoStopAt stays ok and never re-triggers
    const { plan: earlyPlan } = store.createTimingPlan({
      title: "Finish early",
      allowanceSeconds: 3600,
      hardStopAtMs: at("19:00"),
    });
    now = at("17:00");
    const earlyRun = store.startActivity({
      idempotencyKey: "early-start",
      timingPlanId: earlyPlan.id,
    });
    assert.equal(earlyRun.activity?.autoStopAtMs, at("18:00"));
    now = at("17:25");
    const manualStop = store.stopActivity({ idempotencyKey: "early-stop" });
    assert.equal(manualStop.activity?.reviewState, "ok");
    assert.equal(manualStop.activity?.stopReason, "manual_stop");
    assert.equal(manualStop.activity?.confirmedThroughMs, at("17:25"));
    assert.equal(manualStop.activity?.endMs, at("17:25"));
    assert.equal(manualStop.activity?.autoStopAtMs, at("18:00"));

    now = at("19:30");
    assert.equal(store.settleDueTimers(now).settled, false);
    assert.equal(store.listTimeEvents({ includeAcknowledged: true }).length, 2);

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("STOP-06, STOP-09, STOP-11: restart recovery, scheduler gate lock, dedup events, no TW write, and extend-vs-settle concurrency", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-stop-06-"));
  let now = at("13:55");
  const dbPath = join(dir, "time.sqlite");
  try {
    const store1 = await createTimeStore(dbPath, {
      now: () => now,
    });
    configurePolicy(store1);

    const { plan } = store1.createTimingPlan({
      title: "Restart test",
      allowanceSeconds: 3600,
      hardStopAtMs: at("15:00"),
    });
    now = at("14:00");
    const started = store1.startActivity({
      idempotencyKey: "s1",
      timingPlanId: plan.id,
      taskUuid: "11111111-1111-1111-1111-111111111111",
    });
    const actId = started.activity!.id;
    store1.close();

    // Reopen at 15:20 (simulating process restart after hardStop) -> startup reconcile settles at 15:00
    now = at("15:20");
    const store2 = await createTimeStore(dbPath, { now: () => now });
    const twCalls: string[] = [];
    const coordinator = createTimeCoordinator({
      store: store2,
      now: () => now,
      service: {
        rawTask: async () => {
          twCalls.push("rawTask");
          throw new Error("should not call");
        },
        startTask: async () => {
          twCalls.push("startTask");
          throw new Error("should not call");
        },
        stopTask: async () => {
          twCalls.push("stopTask");
          throw new Error("should not call");
        },
        modifyTask: async () => {
          twCalls.push("modifyTask");
          throw new Error("should not call");
        },
        doneTask: async () => {
          twCalls.push("doneTask");
          throw new Error("should not call");
        },
      } as unknown as TaskService,
    });
    await coordinator.reconcileStartup();

    // STOP-09: Taskwarrior untouched
    assert.equal(twCalls.length, 0);
    const settledAct = store2.queryActivities({}).find((a) => a.id === actId)!;
    assert.equal(settledAct.endMs, at("15:00"));
    assert.equal(durationSec(settledAct), 3600);
    assert.equal(settledAct.reviewState, "review_required");
    assert.equal(settledAct.reviewReason, "auto_stopped");

    // Re-settling produces NO duplicate event
    store2.settleDueTimers(now + 60_000);
    const events = store2.listTimeEvents({ includeAcknowledged: true });
    assert.equal(events.length, 1);
    assert.equal(events[0].dedupKey, `auto_stop:${actId}:v1`);

    // 15:00..15:20 downtime never counted in formal OR provisional totals
    const summary = store2.getDailySummary("2026-11-15", now);
    assert.equal(summary.coveredSeconds, 0);
    assert.equal(summary.provisionalSeconds, 3600);

    // Scheduler test: respects 423 restore gate lock & settles once unlocked
    now = at("16:00");
    const { plan: schedPlan } = store2.createTimingPlan({
      title: "Scheduler plan",
      allowanceSeconds: 600,
    });
    const run2 = store2.startActivity({
      idempotencyKey: "sched-start",
      timingPlanId: schedPlan.id,
    });
    assert.equal(run2.activity?.autoStopAtMs, at("16:10"));

    let locked = true;
    const scheduler = createTimeAutoStopScheduler({
      store: store2,
      gate: {
        enter: () => {
          if (locked)
            throw new TimeStoreError(423, "WORKSPACE_RESTORING", "locked");
          return () => {};
        },
      },
      now: () => now,
      pollIntervalMs: 60_000,
    });
    now = at("16:12");
    assert.equal(scheduler.tickNow().skipped, "locked");
    locked = false;
    assert.equal(scheduler.tickNow().settled, true);
    const act2After = store2
      .queryActivities({})
      .find((a) => a.id === run2.activity!.id)!;
    assert.equal(act2After.endMs, at("16:10"));
    assert.equal(act2After.version, 2);
    // Stale client attempting to extend against pre-stop version 1 is rejected
    assertTimeError(
      () =>
        store2.updateTimingPlan({
          planId: schedPlan.id,
          expectedVersion: 1,
          expectedActivityId: act2After.id,
          expectedActivityVersion: 1,
          patch: { addAllowanceSeconds: 600 },
        }),
      "ACTIVE_ACTIVITY_MISMATCH",
      409,
    );

    scheduler.stop();
    store2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("STOP-07, STOP-08, STOP-12: provisional isolation (C+U=T), confirm/correct/extend, overrun tracking, and uncapped checkpoints", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-stop-07-"));
  let now = at("13:40");
  try {
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => now,
    });
    configurePolicy(store);

    const { plan } = store.createTimingPlan({
      title: "Focus block",
      categoryId: "work",
      allowanceSeconds: 3600,
      plannedStartAtMs: at("14:00"),
      hardStopAtMs: at("15:00"),
    });
    const run = store.startActivity({
      idempotencyKey: "s7-start",
      timingPlanId: plan.id,
    });

    // Auto-stops at 14:40 -> stays provisional, NOT in formal coveredSeconds or category totals
    now = at("14:40");
    store.settleDueTimers(now);
    const beforeConfirm = store.getDailySummary("2026-11-15", now);
    assert.equal(beforeConfirm.coveredSeconds, 0);
    assert.equal(beforeConfirm.provisionalSeconds, 3600);
    assert.equal(beforeConfirm.reviewRequiredSeconds, 3600);
    assert.equal(beforeConfirm.byCategorySeconds.work ?? 0, 0);
    assert.equal(
      beforeConfirm.coveredSeconds + beforeConfirm.unrecordedSeconds,
      beforeConfirm.pastCapacitySeconds,
    );

    // Confirm action -> formalizes into coveredSeconds & byCategorySeconds
    const stoppedId = beforeConfirm.locatedSegments[0].activityId;
    const stoppedAct = store
      .queryActivities({})
      .find((a) => a.id === stoppedId)!;
    const confirmed = store.confirmActivity({
      idempotencyKey: "s7-confirm",
      activityId: stoppedAct.id,
      expectedVersion: stoppedAct.version,
    });
    assert.equal(confirmed.activity?.reviewState, "ok");
    assert.equal(confirmed.activity?.confirmedThroughMs, at("14:40"));

    const afterConfirm = store.getDailySummary("2026-11-15", at("14:45"));
    assert.equal(afterConfirm.coveredSeconds, 3600);
    assert.equal(afterConfirm.provisionalSeconds, 0);
    assert.equal(afterConfirm.byCategorySeconds.work, 3600);
    assert.equal(
      afterConfirm.coveredSeconds + afterConfirm.unrecordedSeconds,
      afterConfirm.pastCapacitySeconds,
    );

    // Path 2: User says "actually stopped at 14:10" -> formal updates to 30m, releasing 14:10..14:40
    const corrected = store.updateActivity({
      idempotencyKey: "s7-correct",
      activityId: confirmed.activity!.id,
      expectedVersion: confirmed.activity!.version,
      patch: { endMs: at("14:10") },
    });
    const afterCorrect = store.getDailySummary("2026-11-15", at("14:45"));
    assert.equal(afterCorrect.coveredSeconds, 1800);
    assert.equal(
      afterCorrect.unrecordedSeconds,
      afterCorrect.pastCapacitySeconds - 1800,
    );

    // Path 3: User actually worked +10m beyond 60m plan -> manually extend activity beyond allowance displays exceededPlanSeconds
    const overrun = store.updateActivity({
      idempotencyKey: "s7-overrun",
      activityId: corrected.activity.id,
      expectedVersion: corrected.activity.version,
      patch: { endMs: at("14:50") }, // 70m vs 60m plan allowance
    });
    assert.equal(durationSec(overrun.activity), 4200);
    const afterOverrun = store.getDailySummary("2026-11-15", at("14:55"));
    assert.equal(afterOverrun.locatedSegments[0].exceededPlanSeconds, 600);

    // Path 4: Extend plan (+15m -> total 75m vs 70m overrun consumed -> 5m remaining) + explicitly move hardStop later, then continue
    now = at("14:55");
    const { plan: pExt } = store.updateTimingPlan({
      planId: plan.id,
      expectedVersion: 1,
      patch: { addAllowanceSeconds: 900, hardStopAtMs: at("15:30") },
    });
    assert.equal(pExt.status, "paused");
    assert.equal(pExt.remainingSeconds, 300);
    const cont = store.startActivity({
      idempotencyKey: "s7-cont",
      timingPlanId: plan.id,
    });
    assert.equal(cont.activity?.autoStopAtMs, at("15:00"));
    store.stopActivity({
      idempotencyKey: "s7-stop-cont",
      effectiveAtMs: at("15:00"),
    });

    // STOP-12 uncapped activity checkpoint flow: starts with 60m reviewDueAtMs, emits checkpoint_due once overdue, confirms prefix!
    now = at("16:00");
    const uncapped = store.startActivity({
      idempotencyKey: "uncapped-1",
      title: "Open exploration",
      explicitCategoryId: "study",
    });
    assert.equal(uncapped.activity?.reviewDueAtMs, at("17:00"));
    assert.equal(uncapped.activity?.confirmedThroughMs, at("16:00"));

    // Before 17:00, nothing due yet
    now = at("16:45");
    store.settleDueTimers(now);
    assert.equal(
      store
        .listTimeEvents({ includeAcknowledged: true })
        .filter((e) => e.kind === "checkpoint_due").length,
      0,
    );

    // At 17:05, hourly checkpoint event emitted once (dedup)
    now = at("17:05");
    store.settleDueTimers(now);
    store.settleDueTimers(now + 10_000);
    const cpEvents = store
      .listTimeEvents({ includeAcknowledged: true })
      .filter((e) => e.kind === "checkpoint_due");
    assert.equal(cpEvents.length, 1);
    assert.equal(cpEvents[0].activityId, uncapped.activity!.id);

    // Formal total is unchanged while provisional 65m waits for confirmation; confirming through 17:05 formalizes 65m & shifts next checkpoint to 18:05
    const beforeCpConfirm = store.getDailySummary("2026-11-15", now);
    assert.equal(beforeCpConfirm.provisionalSeconds, 65 * 60);
    assert.equal(beforeCpConfirm.coveredSeconds, 4200 + 300);
    const cpDone = store.confirmActivity({
      idempotencyKey: "cp-confirm",
      activityId: uncapped.activity!.id,
      expectedVersion: uncapped.activity!.version,
      throughMs: now,
    });
    assert.equal(cpDone.activity?.confirmedThroughMs, at("17:05"));
    assert.equal(cpDone.activity?.reviewDueAtMs, at("18:05"));

    const afterCpConfirm = store.getDailySummary("2026-11-15", now);
    assert.equal(afterCpConfirm.coveredSeconds, 4200 + 300 + 65 * 60);
    assert.equal(afterCpConfirm.provisionalSeconds, 0);

    assert.equal(run.activity?.timingPlanId, plan.id);
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP API handlers cover timing plans, start/pause, auto-stop events, and checkpoint confirmation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-stop-http-"));
  let now = at("13:30");
  try {
    const store = await createTimeStore(join(dir, "time.sqlite"), {
      now: () => now,
    });
    configurePolicy(store);

    const handlers = createTimeHandlers({
      identity: "web:test",
      gate: createWorkspaceGate(),
      service: {} as TaskService,
      store,
      isEnabled: () => true,
      paths: {
        dataDir: dir,
        organizationFile: join(dir, "org.json"),
        recoveryFile: join(dir, "rec.json"),
        timeFile: join(dir, "time.sqlite"),
      },
    });

    async function call(
      method: "GET" | "POST",
      route: string,
      body: Record<string, unknown> = {},
      query = "",
    ) {
      const spec = handlers.find(
        (h) => h.method === method && h.route === route,
      );
      assert.ok(spec, `Missing handler ${method} ${route}`);
      return spec.handle({
        searchParams: new URLSearchParams(query),
        readBody: async () => body,
        transport: "http",
      });
    }

    const createdRes = await call("POST", "api/time/plans/create", {
      title: "Design review",
      allowanceMinutes: 30,
      plannedStartTime: "14:00",
      hardStopTime: "15:00",
      receivedAtMs: now,
    });
    assert.equal(createdRes.status, 200);
    const created = createdRes.body as {
      plan: { id: string; version: number; allowanceSeconds: number };
    };
    assert.equal(created.plan.allowanceSeconds, 1800);

    const listRes = await call("GET", "api/time/plans");
    assert.equal((listRes.body as { plans: unknown[] }).plans.length, 1);

    now = at("14:00");
    const startedRes = await call("POST", "api/time/plans/start", {
      idempotencyKey: "http-start",
      planId: created.plan.id,
      receivedAtMs: now,
    });
    assert.equal(startedRes.status, 200);
    const startedBody = startedRes.body as {
      activity: { id: string; autoStopAtMs: number };
      plan: { status: string };
    };
    assert.equal(startedBody.activity.autoStopAtMs, at("14:30"));
    assert.equal(startedBody.plan.status, "active");

    // Auto-stop triggers by 14:35 when querying events!
    now = at("14:35");
    const evRes = await call("GET", "api/time/events");
    const events = (
      evRes.body as { events: Array<{ id: string; activityId: string }> }
    ).events;
    assert.equal(events.length, 1);

    const ackRes = await call("POST", "api/time/events/ack", {
      eventIds: [events[0].id],
    });
    assert.equal(
      (ackRes.body as { acknowledgedCount: number }).acknowledgedCount,
      1,
    );
    const evAfterAck = await call("GET", "api/time/events");
    assert.equal((evAfterAck.body as { events: unknown[] }).events.length, 0);

    // Extend +15m explicitly via API while confirming existing stopped segment
    const stoppedActs = store.queryActivities({});
    const confirmRes = await call("POST", "api/time/confirm", {
      idempotencyKey: "http-confirm",
      activityId: stoppedActs[0].id,
      expectedVersion: stoppedActs[0].version,
      receivedAtMs: now,
    });
    assert.equal(
      (confirmRes.body as { activity: { reviewState: string } }).activity
        .reviewState,
      "ok",
    );

    const extendRes = await call("POST", "api/time/plans/update", {
      planId: created.plan.id,
      expectedVersion: created.plan.version,
      addAllowanceMinutes: 15,
      receivedAtMs: now,
    });
    assert.equal(
      (extendRes.body as { plan: { remainingSeconds: number } }).plan
        .remainingSeconds,
      900,
    );

    const startAgain = await call("POST", "api/time/plans/start", {
      idempotencyKey: "http-resume",
      planId: created.plan.id,
      receivedAtMs: now,
    });
    assert.equal(startAgain.status, 200);
    now = at("14:40");
    const pauseRes = await call("POST", "api/time/stop", {
      idempotencyKey: "http-pause",
      pause: true,
      receivedAtMs: now,
    });
    assert.equal(
      (pauseRes.body as { plan: { remainingSeconds: number } }).plan
        .remainingSeconds,
      600,
    );

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
