import assert from "node:assert/strict";
import test from "node:test";
import {
  computeContinuationCostPreview,
  computeCostReport,
  computeDurationCostCents,
  computeTaskCostSummary,
  formatCurrencyCny,
  formatRateConversionHint,
} from "../time/cost.ts";
import {
  computeDailyLedger,
  computeWeeklyDistribution,
} from "../time/ledger.ts";
import {
  createDefaultTimePolicy,
  UNASSIGNED_PROJECT_KEY,
  UNTAGGED_KEY,
  type Activity,
  type BillLink,
  type TaskBudget,
  type TimePolicy,
  type TimingPlan,
} from "../time/model.ts";
import { displayedTaskCostFromSnapshot } from "../time/snapshot.ts";
import { zonedDateTimeToUtcMs } from "../time/zone.ts";

function at(hhmm: string, date = "2026-11-15"): number {
  return zonedDateTimeToUtcMs(date, hhmm, "Asia/Shanghai");
}

function makePolicy(hourlyRateCents = 10_000): TimePolicy {
  return {
    ...createDefaultTimePolicy(),
    timezone: "Asia/Shanghai",
    hourlyRateCents,
  };
}

function makeActivity(overrides: Partial<Activity> & { id: string }): Activity {
  const { id, ...rest } = overrides;
  return {
    id,
    version: 1,
    kind: "located",
    title: "Test activity",
    categoryId: "work",
    ruleSource: "explicit",
    ruleVersion: 1,
    precision: "exact",
    reviewState: "ok",
    source: "manual",
    timezone: "Asia/Shanghai",
    createdAtMs: at("08:00"),
    updatedAtMs: at("08:00"),
    ...rest,
  };
}

test("cost math & formatting calculate exact CNY cents and live conversion hints", () => {
  assert.equal(computeDurationCostCents(3600, 10_000), 10_000);
  assert.equal(computeDurationCostCents(1800, 10_000), 5_000);
  assert.equal(computeDurationCostCents(1200, 10_000), 3_333);
  assert.equal(computeDurationCostCents(3600, 0), 0);
  assert.equal(formatCurrencyCny(10_000), "¥100");
  assert.equal(formatCurrencyCny(5_050), "¥50.5");
  assert.equal(formatCurrencyCny(3_333), "¥33.33");
  assert.equal(
    formatRateConversionHint(10_000),
    "30 分钟 ≈ ¥50，2 小时 ≈ ¥200",
  );
});

test("historical segments keep captured hourlyRateCents while provisional segments remain isolated from confirmed totals", () => {
  const policy = makePolicy(20_000); // Updated later to ¥200/h
  const taskId = "11111111-1111-4111-8111-111111111111";

  const oldConfirmed = makeActivity({
    id: "act-old",
    title: "Confirmed at ¥100",
    taskUuid: taskId,
    projectSnapshot: "Work.Aster",
    tags: ["dev", "core"],
    startMs: at("09:00"),
    endMs: at("10:00"),
    confirmedThroughMs: at("10:00"),
    hourlyRateCents: 10_000, // historical ¥100/h
  });
  const unconfirmedAutoStopped = makeActivity({
    id: "act-prov",
    title: "Auto-stopped needs review",
    taskUuid: taskId,
    projectSnapshot: "Work.Aster",
    tags: ["dev"],
    startMs: at("10:00"),
    endMs: at("11:00"),
    confirmedThroughMs: at("10:00"),
    reviewState: "review_required",
    reviewReason: "auto_stopped",
    hourlyRateCents: 20_000, // ¥200/h provisional
  });
  const sleepSeg = makeActivity({
    id: "act-sleep",
    title: "睡眠",
    categoryId: "sleep",
    startMs: at("00:00"),
    endMs: at("07:00"),
    confirmedThroughMs: at("07:00"),
    hourlyRateCents: 10_000, // legacy sleep rate must be ignored,
  });

  const budget: TaskBudget = {
    taskUuid: taskId,
    hourlyRateCents: 10_000,
    initialAllowanceSeconds: 1800, // initially 30m = ¥50
    initialBudgetCents: 5_000,
    currentAllowanceSeconds: 5400, // later bumped to 90m = ¥150
    currentBudgetCents: 15_000,
    createdAtMs: at("08:30"),
    updatedAtMs: at("09:30"),
  };

  const daily = computeDailyLedger(
    "2026-11-15",
    [sleepSeg, oldConfirmed, unconfirmedAutoStopped],
    policy,
    at("12:00"),
  );
  // Sleep is ¥0, oldConfirmed is ¥100, provisional ¥200 stays OUT of confirmedCostCents
  assert.equal(daily.confirmedCostCents, 10_000);
  assert.equal(daily.provisionalCostCents, 20_000);
  assert.equal(daily.byProjectCostCents["Work.Aster"], 10_000);
  assert.equal(daily.byProjectCostCents["睡眠"], 0);
  assert.equal(daily.byTagCostCents.dev, 10_000);
  assert.equal(daily.byTagCostCents.core, 10_000);
  assert.equal(daily.byTagCostCents[UNTAGGED_KEY], 0);

  const weekly = computeWeeklyDistribution(
    "2026-11-09",
    [sleepSeg, oldConfirmed, unconfirmedAutoStopped],
    policy,
    at("12:00"),
  );
  assert.equal(weekly.confirmedCostCents, 10_000);
  assert.equal(weekly.provisionalCostCents, 20_000);
  assert.equal(weekly.byProjectCostCents["Work.Aster"], 10_000);

  const taskSummary = computeTaskCostSummary({
    taskUuid: taskId,
    activities: [oldConfirmed, unconfirmedAutoStopped],
    budget,
    policy,
    asOfMs: at("12:00"),
  });
  assert.equal(taskSummary.confirmedSeconds, 3600);
  assert.equal(taskSummary.confirmedCostCents, 10_000);
  assert.equal(taskSummary.provisionalSeconds, 3600);
  assert.equal(taskSummary.provisionalCostCents, 20_000);
  assert.equal(taskSummary.initialBudgetCents, 5_000);
  assert.equal(taskSummary.currentBudgetCents, 15_000);
  assert.equal(taskSummary.addedBudgetCents, 10_000);
  // Overrun vs initial estimate = ¥100 confirmed - ¥50 initial = ¥50 (ignores provisional ¥200!)
  assert.equal(taskSummary.overInitialBudgetCents, 5_000);
  assert.equal(taskSummary.overCurrentBudgetCents, 0);
});

test("unbudgeted tasks never report overInitialBudgetCents and continuation preview respects hardStopAtMs", () => {
  const policy = makePolicy(10_000);
  const unbudgetedId = "22222222-2222-4222-8222-222222222222";
  const act = makeActivity({
    id: "act-unbudgeted",
    taskUuid: unbudgetedId,
    startMs: at("09:00"),
    endMs: at("12:00"),
    confirmedThroughMs: at("12:00"),
    hourlyRateCents: 10_000,
  });
  const summary = computeTaskCostSummary({
    taskUuid: unbudgetedId,
    activities: [act],
    policy,
    asOfMs: at("13:00"),
  });
  assert.equal(summary.hasBudget, false);
  assert.equal(summary.confirmedCostCents, 30_000);
  assert.equal(summary.overInitialBudgetCents, 0);
  assert.equal(summary.overCurrentBudgetCents, 0);

  // Continuation preview: wants 30m (¥50), hard stop in 20m -> capped to 20m
  const capped = computeContinuationCostPreview({
    requestedSeconds: 1800,
    hourlyRateCents: 10_000,
    nowMs: at("14:40"),
    hardStopAtMs: at("15:00"),
  });
  assert.equal(capped.cappedByHardStop, true);
  assert.equal(capped.expired, false);
  assert.equal(capped.effectiveSeconds, 1200);
  assert.equal(capped.additionalCostCents, 3333);

  const expired = computeContinuationCostPreview({
    requestedSeconds: 1800,
    hourlyRateCents: 10_000,
    nowMs: at("15:05"),
    hardStopAtMs: at("15:00"),
  });
  assert.equal(expired.expired, true);
  assert.equal(expired.effectiveSeconds, 0);
  assert.equal(expired.additionalCostCents, 0);
});

test("computeCostReport separates period vs cumulative task costs, sorts by highest_cost & highest_over_budget, and merges Bills links", () => {
  const policy = makePolicy(10_000);
  const taskA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // high period cost, no overrun
  const taskB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // lower period cost, huge overrun from earlier week

  const activities: Activity[] = [
    // Task B had 2h confirmed last week (outside this week 2026-11-09..15, inside month 2026-11)
    makeActivity({
      id: "b-prev",
      title: "Compare headphones",
      taskUuid: taskB,
      projectSnapshot: "Life.Purchase",
      tags: ["research"],
      startMs: at("10:00", "2026-11-05"),
      endMs: at("12:00", "2026-11-05"),
      confirmedThroughMs: at("12:00", "2026-11-05"),
      hourlyRateCents: 10_000,
    }),
    // Task B 1h confirmed this week + 30m unconfirmed
    makeActivity({
      id: "b-curr",
      title: "Compare headphones",
      taskUuid: taskB,
      projectSnapshot: "Life.Purchase",
      tags: ["research"],
      startMs: at("10:00", "2026-11-15"),
      endMs: at("11:00", "2026-11-15"),
      confirmedThroughMs: at("11:00", "2026-11-15"),
      hourlyRateCents: 10_000,
    }),
    makeActivity({
      id: "b-prov",
      title: "Compare headphones",
      taskUuid: taskB,
      projectSnapshot: "Life.Purchase",
      tags: ["research"],
      startMs: at("11:00", "2026-11-15"),
      endMs: at("11:30", "2026-11-15"),
      confirmedThroughMs: at("11:00", "2026-11-15"),
      reviewState: "review_required",
      hourlyRateCents: 10_000,
    }),
    // Task A 3h confirmed this week
    makeActivity({
      id: "a-curr",
      title: "Architecture work",
      taskUuid: taskA,
      projectSnapshot: "Work.Aster",
      startMs: at("14:00", "2026-11-15"),
      endMs: at("17:00", "2026-11-15"),
      confirmedThroughMs: at("17:00", "2026-11-15"),
      hourlyRateCents: 10_000,
    }),
  ];

  const budgets = new Map<string, TaskBudget>([
    [
      taskA,
      {
        taskUuid: taskA,
        hourlyRateCents: 10_000,
        initialAllowanceSeconds: 4 * 3600,
        initialBudgetCents: 40_000,
        currentAllowanceSeconds: 4 * 3600,
        currentBudgetCents: 40_000,
        createdAtMs: at("09:00"),
        updatedAtMs: at("09:00"),
      },
    ],
    [
      taskB,
      {
        taskUuid: taskB,
        hourlyRateCents: 10_000,
        initialAllowanceSeconds: 1800, // ¥50 initial budget
        initialBudgetCents: 5_000,
        currentAllowanceSeconds: 1800,
        currentBudgetCents: 5_000,
        createdAtMs: at("09:00", "2026-11-05"),
        updatedAtMs: at("09:00", "2026-11-05"),
      },
    ],
  ]);

  const billLinks: BillLink[] = [
    {
      id: "link-1",
      txKey: "bean:2026-11.bean:42",
      taskUuid: taskB,
      source: "beancount",
      txId: "tx-42",
      payTime: "2026-11-15T12:00:00+08:00",
      payee: "Sony",
      narration: "Headphones",
      account: "Expenses:Electronics",
      currency: "CNY",
      amount: 1200,
      cnyAmountCents: 120_000,
      createdAtMs: at("12:05", "2026-11-15"),
    },
  ];

  const plans: TimingPlan[] = [];
  const weekByCost = computeCostReport({
    granularity: "week",
    anchorDate: "2026-11-15",
    sortBy: "highest_cost",
    activities,
    budgetsByTaskUuid: budgets,
    plans,
    billLinks,
    policy,
    nowMs: at("18:00", "2026-11-15"),
  });

  assert.equal(weekByCost.periodStartDate, "2026-11-09");
  assert.equal(weekByCost.periodEndDate, "2026-11-15");
  // Week confirmed: Task A ¥300 + Task B ¥100 = ¥400 (provisional ¥50 separate, last week's ¥200 excluded from period)
  assert.equal(weekByCost.totalPeriodConfirmedCostCents, 40_000);
  assert.equal(weekByCost.totalPeriodProvisionalCostCents, 5_000);
  assert.equal(weekByCost.totalCashExpenseCents, 120_000);
  assert.equal(weekByCost.totalCombinedCostCents, 160_000);
  assert.deepEqual(
    weekByCost.byTask.map((r) => r.taskUuid),
    [taskA, taskB],
  );
  // Task B keeps full cumulative ¥300 across weeks while period cost = ¥100!
  const rowB = weekByCost.byTask.find((r) => r.taskUuid === taskB)!;
  assert.equal(rowB.periodCostCents, 10_000);
  assert.equal(rowB.cumulativeCostCents, 30_000);
  assert.equal(rowB.overInitialBudgetCents, 25_000); // ¥300 - ¥50 initial budget
  assert.equal(rowB.cashExpenseCents, 120_000);
  assert.equal(rowB.combinedCumulativeCostCents, 150_000);

  const weekByOverrun = computeCostReport({
    granularity: "week",
    anchorDate: "2026-11-15",
    sortBy: "highest_over_budget",
    activities,
    budgetsByTaskUuid: budgets,
    plans,
    billLinks,
    policy,
    nowMs: at("18:00", "2026-11-15"),
  });
  assert.deepEqual(
    weekByOverrun.byTask.map((r) => r.taskUuid),
    [taskB, taskA],
  );

  const monthReport = computeCostReport({
    granularity: "month",
    anchorDate: "2026-11-15",
    sortBy: "highest_cost",
    activities,
    budgetsByTaskUuid: budgets,
    plans,
    billLinks,
    policy,
    nowMs: at("18:00", "2026-11-15"),
  });
  // Month includes Nov 5 (¥200) + Nov 15 (¥100 + ¥300) = ¥600
  assert.equal(monthReport.totalPeriodConfirmedCostCents, 60_000);

  // Snapshot live calculation puts running elapsed seconds strictly into provisionalCostCents
  const snapSummary = displayedTaskCostFromSnapshot(
    {
      receivedMonoMs: 1_000,
      snapshot: {
        backend: "time",
        contractVersion: 1,
        timeEpoch: 1,
        taskDataEpoch: 1,
        state: "ready",
        sessionVersion: 1,
        snapshotAt: new Date(at("17:30")).toISOString(),
        liveUntil: new Date(at("18:30")).toISOString(),
        activeActivity: {
          id: "act-live",
          version: 1,
          taskUuid: taskA,
          title: "Live work",
          categoryId: "work",
          startedAt: new Date(at("17:30")).toISOString(),
          state: "running",
          hourlyRateCents: 20_000,
        },
        taskTotalsSeconds: {},
        hourlyRateCents: 10_000,
        taskCosts: {
          [taskA]: {
            taskUuid: taskA,
            confirmedSeconds: 3600,
            confirmedCostCents: 10_000,
            provisionalSeconds: 0,
            provisionalCostCents: 0,
            hasBudget: true,
            initialAllowanceSeconds: 7200,
            initialBudgetCents: 20_000,
            currentAllowanceSeconds: 7200,
            currentBudgetCents: 20_000,
            addedBudgetCents: 0,
            overInitialBudgetCents: 0,
            overCurrentBudgetCents: 0,
            linkedCashCents: 0,
            combinedCostCents: 10_000,
            currentHourlyRateCents: 10_000,
          },
        },
        totalsComplete: true,
        historyComplete: true,
      },
    },
    taskA,
    1_801_000,
  );
  assert.equal(snapSummary?.confirmedCostCents, 10_000);
  assert.equal(snapSummary?.provisionalSeconds, 1800);
  assert.equal(snapSummary?.provisionalCostCents, 10_000); // 30m at ¥200/h
});

test("legacy sleep rates are zero in cost reports and task summaries including custom sleep categories", () => {
  const policy = makePolicy();
  policy.categories.push({
    id: "night-rest",
    name: "休息",
    color: "gray",
    isSleep: true,
  });
  const activities = [
    makeActivity({
      id: "legacy-sleep",
      categoryId: "sleep",
      taskUuid: "sleep-task",
      hourlyRateCents: 10000,
      startMs: at("00:00"),
      endMs: at("07:00"),
    }),
    makeActivity({
      id: "custom-sleep",
      categoryId: "night-rest",
      hourlyRateCents: 10000,
      startMs: at("07:00"),
      endMs: at("08:00"),
    }),
  ];
  const summary = computeTaskCostSummary({
    taskUuid: "sleep-task",
    activities,
    policy,
    asOfMs: at("12:00"),
  });
  assert.equal(summary.confirmedCostCents, 0);
  assert.equal(summary.confirmedSeconds, 7 * 3600);
  const report = computeCostReport({
    granularity: "week",
    anchorDate: "2026-11-15",
    sortBy: "highest_cost",
    activities,
    budgetsByTaskUuid: new Map(),
    plans: [],
    billLinks: [],
    policy,
    nowMs: at("12:00"),
  });
  assert.equal(report.totalPeriodConfirmedCostCents, 0);
  assert.equal(report.totalPeriodConfirmedSeconds, 8 * 3600);
});

test("legacy sleep without a project is consistently grouped under sleep without rewriting history", () => {
  const policy = makePolicy();
  const activity = makeActivity({
    id: "legacy-sleep",
    title: "Sleep",
    categoryId: "sleep",
    startMs: at("01:00"),
    endMs: at("07:00"),
    confirmedThroughMs: at("07:00"),
  });
  const daily = computeDailyLedger(
    "2026-11-15",
    [activity],
    policy,
    at("18:00"),
  );
  assert.equal(daily.byProjectSeconds["睡眠"], 6 * 3600);
  assert.equal(daily.byProjectSeconds[UNASSIGNED_PROJECT_KEY], undefined);
  assert.equal(daily.locatedSegments[0].projectSnapshot, "睡眠");
  const report = computeCostReport({
    granularity: "week",
    anchorDate: "2026-11-15",
    sortBy: "highest_cost",
    activities: [activity],
    budgetsByTaskUuid: new Map(),
    policy,
    nowMs: at("18:00"),
  });
  assert.equal(report.byProject[0].projectName, "睡眠");
  assert.equal(report.byProject[0].periodSeconds, 6 * 3600);
  assert.equal(report.totalPeriodConfirmedCostCents, 0);
  assert.equal(activity.projectSnapshot, undefined);
});
