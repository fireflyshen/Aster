import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zonedDateTimeToUtcMs } from "../../core/time/zone.ts";
import type { TaskService } from "../../core/tasks/service.ts";
import { listBillExpenses } from "../src/time/bills-reader.ts";
import { createTimeHandlers } from "../src/time/time-api.ts";
import { createTimeStore } from "../src/time/time-store.ts";

function at(hhmm: string, date = "2026-11-15"): number {
  return zonedDateTimeToUtcMs(date, hhmm, "Asia/Shanghai");
}

function makeFakeTaskService(
  tasks: Array<{
    uuid: string;
    description: string;
    project?: string;
    tags?: string[];
  }>,
): TaskService {
  return {
    connection: { kind: "local" },
    rawTask: async (uuid: string) => {
      const task = tasks.find((task) => task.uuid === uuid);
      if (!task) throw new Error("Task not found");
      return { ...task, status: "pending", entry: "20261115T000000Z" };
    },
    exportTasks: async () =>
      tasks.map((t, idx) => ({
        id: idx + 1,
        uuid: t.uuid,
        description: t.description,
        status: "pending",
        entry: "20261115T000000Z",
        modified: "20261115T000000Z",
        project: t.project,
        tags: t.tags ?? [],
        urgency: 1,
        annotations: [],
      })),
  } as never;
}

async function callRoute(
  routeMap: Map<string, ReturnType<typeof createTimeHandlers>[number]>,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = new URL(url, "http://127.0.0.1:4180");
  const route = parsed.pathname.replace(/^\//, "");
  const spec = routeMap.get(`${method}:${route}`);
  assert.ok(spec, `Missing handler for ${method}:${route}`);
  const result = await spec.handle({
    searchParams: parsed.searchParams,
    readBody: async () => (body ?? {}) as Record<string, unknown>,
    transport: "http",
  } as never);
  return {
    status: result.status,
    body: result.body as Record<string, unknown>,
  };
}

test("server cost model captures rate snapshots, isolates provisional auto-stops, preserves initial budget on add, and keeps Bills read-only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-time-cost-"));
  const billsDir = join(dir, "Bills");
  const beanMonthDir = join(billsDir, "journal", "2026");
  await mkdir(beanMonthDir, { recursive: true });

  const beanPath = join(beanMonthDir, "2026-11.bean");
  const originalBeanContent = `2026-11-15 * "Keychron" "Mechanical keyboard"
  source: "manual"
  pay_time: "2026-11-15T10:30:00+08:00"
  tx_id: "tx-kb-01"
  Expenses:Shopping:Gear  399.00 CNY
  Assets:Alipay          -399.00 CNY

2026-11-15 * "CloudHost" "USD server rental"
  source: "manual"
  pay_time: "2026-11-15T11:00:00+08:00"
  tx_id: "tx-vps-02"
  Expenses:Cloud:Server   10.00 USD @ 7.20 CNY
  Assets:Card            -72.00 CNY
`;
  await writeFile(beanPath, originalBeanContent, "utf8");
  const beanStatBefore = await stat(beanPath);

  let now = at("13:00");
  const taskUuid = "aaaaaaaa-1111-4111-8111-111111111111";
  const unbudgetedUuid = "bbbbbbbb-2222-4222-8222-222222222222";
  const dbPath = join(dir, "time.sqlite");

  const store = await createTimeStore(dbPath, {
    enabled: true,
    billsDir,
    now: () => now,
  });

  try {
    store.updatePolicy({
      expectedPolicyVersion: store.getPolicy().policyVersion,
      patch: {
        timezone: "Asia/Shanghai",
        hourlyRateCents: 10_000, // ¥100/h
        taskListHighlightCost: true,
      },
    });

    const handlers = createTimeHandlers({
      identity: "cost-test",
      gate: {
        exclusive: (fn: () => Promise<unknown>) => fn(),
        shared: (fn: () => Promise<unknown>) => fn(),
      } as never,
      service: makeFakeTaskService([
        {
          uuid: taskUuid,
          description: "Compare mechanical keyboards",
          project: "Life.Gear",
          tags: ["hardware", "compare"],
        },
        {
          uuid: unbudgetedUuid,
          description: "Quick sync without budget",
          project: "Work.Aster",
          tags: ["meeting"],
        },
      ]),
      store,
      isEnabled: () => true,
      paths: {
        dataDir: dir,
        organizationFile: join(dir, "organization.json"),
        recoveryFile: join(dir, "recovery.json"),
        timeFile: dbPath,
      },
    });
    const routeMap = new Map(
      handlers.map((r) => [`${r.method}:${r.route}`, r]),
    );

    // 1. Set initial budget: 60 minutes @ ¥100/h -> ¥100 initial & current
    const setBudgetRes = await callRoute(
      routeMap,
      "POST",
      "/api/time/task-budget",
      {
        taskUuid,
        mode: "set",
        allowanceSeconds: 3600,
        plannedStartDate: "2026-11-15",
        plannedStartTime: "14:00",
        hardStopDate: "2026-11-15",
        hardStopTime: "15:00",
      },
    );
    assert.equal(setBudgetRes.status, 200);
    const initialBudgetSummary = setBudgetRes.body.summary as Record<
      string,
      unknown
    >;
    assert.equal(initialBudgetSummary.initialBudgetCents, 10_000);
    assert.equal(initialBudgetSummary.currentBudgetCents, 10_000);
    assert.equal(initialBudgetSummary.addedBudgetCents, 0);

    // 2. Log 1 hour @ ¥100/h on taskUuid with project + tags
    await callRoute(routeMap, "POST", "/api/time/log", {
      idempotencyKey: "k-log-1",
      title: "Keyboard switch research",
      startMs: at("09:00"),
      endMs: at("10:00"),
      taskUuid,
      projectSnapshot: "Life.Gear",
      tags: ["hardware", "compare"],
    });

    // 3. Sleep activity captures ¥0 rate automatically even though policy rate is ¥100/h
    const sleepStart = at("00:00");
    const sleepEnd = at("06:00");
    const sleepReceipt = await callRoute(routeMap, "POST", "/api/time/log", {
      idempotencyKey: "k-sleep-1",
      title: "睡眠",
      explicitCategoryId: "sleep",
      startMs: sleepStart,
      endMs: sleepEnd,
    });
    assert.equal(
      (sleepReceipt.body.activity as { hourlyRateCents?: number })
        .hourlyRateCents,
      0,
    );

    // 4. Update policy rate to ¥200/h — historical 09:00–10:00 must keep ¥100/h!
    const currentPolicy = store.getPolicy();
    await callRoute(routeMap, "POST", "/api/time/policy", {
      idempotencyKey: "k-policy-rate-2",
      expectedPolicyVersion: currentPolicy.policyVersion,
      patch: { hourlyRateCents: 20_000 },
    });

    // Add +30m budget at new ¥200/h rate (+¥100 -> current ¥200), preserving initial ¥100!
    const addBudgetRes = await callRoute(
      routeMap,
      "POST",
      "/api/time/task-budget",
      {
        taskUuid,
        mode: "add",
        addAllowanceSeconds: 1800,
      },
    );
    const addedSummary = addBudgetRes.body.summary as Record<string, unknown>;
    assert.equal(addedSummary.initialBudgetCents, 10_000);
    assert.equal(addedSummary.currentBudgetCents, 20_000);
    assert.equal(addedSummary.addedBudgetCents, 10_000);

    // 5. Create bounded TimingPlan on taskUuid (60m allowance, hardStop 15:00) & start at 13:40 -> auto-stops at 14:40
    const createdPlan = await callRoute(
      routeMap,
      "POST",
      "/api/time/plans/create",
      {
        idempotencyKey: "k-plan-1",
        title: "Deep keyboard comparison",
        taskUuid,
        projectSnapshot: "Life.Gear",
        tags: ["hardware"],
        allowanceSeconds: 3600,
        plannedStartDate: "2026-11-15",
        plannedStartTime: "14:00",
        hardStopDate: "2026-11-15",
        hardStopTime: "15:00",
      },
    );
    const planId = (createdPlan.body.plan as { id: string }).id;
    now = at("13:40");
    await callRoute(routeMap, "POST", "/api/time/plans/start", {
      idempotencyKey: "k-plan-start-1",
      planId,
    });

    // Advance past 14:40 -> server auto-stop settlement triggers at 14:40, marked review_required!
    now = at("14:45");
    store.settleDueTimers(now);

    // Inspect task-detail while auto-stopped segment is still unconfirmed:
    // Old 1h (¥100) is confirmed; newly auto-stopped 1h @ ¥200/h (¥200) MUST stay provisional!
    const detailBeforeConfirm = await callRoute(
      routeMap,
      "GET",
      `/api/time/task-detail?taskUuid=${taskUuid}`,
    );
    const beforeSum = detailBeforeConfirm.body.summary as Record<
      string,
      number
    >;
    assert.equal(beforeSum.confirmedCostCents, 10_000);
    assert.equal(beforeSum.provisionalCostCents, 20_000);
    assert.equal(beforeSum.overInitialBudgetCents, 0);

    // 6. User corrects end time to 14:10 (only 30m @ ¥200/h = ¥100) and confirms!
    const segmentsBefore = detailBeforeConfirm.body.segments as Array<{
      activityId: string;
      version: number;
      startMs: number;
    }>;
    const autoSeg = segmentsBefore.find((s) => s.startMs === at("13:40"))!;
    await callRoute(routeMap, "POST", "/api/time/update", {
      idempotencyKey: "k-fix-autostop",
      activityId: autoSeg.activityId,
      expectedVersion: autoSeg.version,
      patch: { endMs: at("14:10"), confirmReview: true },
    });

    // Advance clock to 16:30, then log 1h on unbudgeted task @ ¥200/h -> must report hasBudget=false, overInitialBudgetCents=0
    now = at("16:30");
    const unbudgetedLog = await callRoute(routeMap, "POST", "/api/time/log", {
      idempotencyKey: "k-log-unbudgeted",
      title: "Quick sync",
      startMs: at("15:00"),
      endMs: at("16:00"),
      taskUuid: unbudgetedUuid,
      projectSnapshot: "Work.Aster",
      tags: ["meeting"],
    });
    assert.equal(unbudgetedLog.status, 200);

    // 7. Read-only Bills parsing + linking
    const directBills = listBillExpenses({ billsDir, q: "USD" });
    assert.equal(directBills.available, true);
    assert.equal(directBills.expenses.length, 1);
    assert.equal(directBills.expenses[0].cnyAmountCents, 7_200);

    const billsRes = await callRoute(
      routeMap,
      "GET",
      "/api/time/bills/expenses?q=Keychron",
    );
    const expenses = billsRes.body.expenses as Array<{
      txKey: string;
      source: string;
      txId: string;
      payTime: string;
      payee: string;
      narration: string;
      account: string;
      currency: string;
      amount: number;
      cnyAmountCents: number;
    }>;
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0].cnyAmountCents, 39_900);

    const linkRes = await callRoute(routeMap, "POST", "/api/time/bills/link", {
      txKey: expenses[0].txKey,
      taskUuid,
      source: expenses[0].source,
      txId: expenses[0].txId,
      payTime: expenses[0].payTime,
      payee: expenses[0].payee,
      narration: expenses[0].narration,
      account: expenses[0].account,
      currency: expenses[0].currency,
      amount: expenses[0].amount,
      cnyAmountCents: expenses[0].cnyAmountCents,
    });
    const linkId = (linkRes.body.link as { id: string }).id;

    // 8. Check task-detail & cost-report after confirmation + Bills link
    const detailAfter = await callRoute(
      routeMap,
      "GET",
      `/api/time/task-detail?taskUuid=${taskUuid}`,
    );
    const afterSum = detailAfter.body.summary as Record<string, number>;
    // ¥100 (09:00-10:00 @ ¥100) + ¥100 (13:40-14:10 @ ¥200) = ¥200 confirmed time cost!
    assert.equal(afterSum.confirmedCostCents, 20_000);
    assert.equal(afterSum.provisionalCostCents, 0);
    // Initial budget was ¥100 -> overInitialBudgetCents = ¥100!
    assert.equal(afterSum.overInitialBudgetCents, 10_000);
    assert.equal(afterSum.linkedCashCents, 39_900);
    assert.equal(afterSum.combinedCostCents, 59_900);

    const reportByOverrun = await callRoute(
      routeMap,
      "GET",
      "/api/time/cost-report?granularity=week&date=2026-11-15&sortBy=highest_over_budget",
    );
    const byTask = reportByOverrun.body.byTask as Array<{
      taskUuid: string;
      overInitialBudgetCents: number;
      hasBudget: boolean;
      periodCostCents: number;
      cashExpenseCents: number;
    }>;
    assert.equal(byTask.length, 2);
    // Task with budget overrun comes first even though both have ¥200 period cost!
    assert.equal(byTask[0].taskUuid, taskUuid);
    assert.equal(byTask[0].overInitialBudgetCents, 10_000);
    assert.equal(byTask[1].taskUuid, unbudgetedUuid);
    assert.equal(byTask[1].hasBudget, false);
    assert.equal(byTask[1].overInitialBudgetCents, 0);

    // Daily summary exposes project & tag cost maps cleanly, with sleep at ¥0
    const daily = store.getDailySummary("2026-11-15", at("16:30"));
    assert.equal(daily.confirmedCostCents, 40_000); // ¥200 + ¥200 (sleep ¥0)
    assert.equal(daily.byProjectCostCents["Life.Gear"], 20_000);
    assert.equal(daily.byProjectCostCents["Work.Aster"], 20_000);
    assert.equal(daily.byTagCostCents.hardware, 20_000);
    assert.equal(daily.byTagCostCents.meeting, 20_000);

    // Unlink Bill works cleanly
    const unlinkRes = await callRoute(
      routeMap,
      "POST",
      "/api/time/bills/unlink",
      { linkId },
    );
    assert.equal(unlinkRes.body.deleted, true);

    // Strictly verify Bills .bean file on disk was NEVER modified!
    const beanContentAfter = await readFile(beanPath, "utf8");
    const beanStatAfter = await stat(beanPath);
    assert.equal(beanContentAfter, originalBeanContent);
    assert.equal(beanStatAfter.mtimeMs, beanStatBefore.mtimeMs);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("time records reuse projects and tags across start, log, estimate, plans, and edits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aster-required-project-"));
  const store = await createTimeStore(join(dir, "time.sqlite"), {
    enabled: true,
    now: () => at("18:00"),
  });
  try {
    const handlers = createTimeHandlers({
      identity: "project-test",
      gate: {
        exclusive: (fn: () => unknown) => fn(),
        shared: (fn: () => unknown) => fn(),
      } as never,
      service: makeFakeTaskService([
        { uuid: "task-project", description: "Project task", project: "Work" },
      ]),
      store,
      isEnabled: () => true,
      paths: {
        dataDir: dir,
        organizationFile: join(dir, "organization.json"),
        recoveryFile: join(dir, "recovery.json"),
        timeFile: join(dir, "time.sqlite"),
      },
    });
    const routes = new Map(
      handlers.map((route) => [`${route.method}:${route.route}`, route]),
    );
    for (const [route, fields] of [
      ["start", {}],
      ["log", { startMs: at("06:00"), endMs: at("07:00") }],
      ["estimate", { estimatedSeconds: 600 }],
      ["plans/create", { allowanceMinutes: 30 }],
    ] as const) {
      await assert.rejects(
        () =>
          callRoute(routes, "POST", `/api/time/${route}`, {
            idempotencyKey: `empty-${route}`,
            title: "Empty",
            tags: ["  "],
            ...fields,
          }),
        (error) =>
          (error as { code?: string }).code === "TIME_ASSIGNMENT_REQUIRED",
      );
    }
    const inherited = await callRoute(routes, "POST", "/api/time/estimate", {
      idempotencyKey: "inherit-project",
      title: "Project task",
      taskUuid: "task-project",
      estimatedSeconds: 600,
    });
    assert.equal(
      (inherited.body.activity as { projectSnapshot?: string }).projectSnapshot,
      "Work",
    );
    const explicitDaily = await callRoute(
      routes,
      "POST",
      "/api/time/estimate",
      {
        idempotencyKey: "override-project",
        title: "Project task",
        taskUuid: "task-project",
        projectSnapshot: "",
        tags: ["运动"],
        estimatedSeconds: 600,
      },
    );
    assert.equal(
      (explicitDaily.body.activity as { projectSnapshot?: string })
        .projectSnapshot,
      undefined,
    );
    assert.equal(
      (explicitDaily.body.activity as { categoryId: string }).categoryId,
      "uncategorized",
    );
    const dailyLog = await callRoute(routes, "POST", "/api/time/log", {
      idempotencyKey: "daily-log",
      title: "吃饭",
      projectSnapshot: "   ",
      tags: ["生活"],
      startMs: at("08:00"),
      endMs: at("09:00"),
    });
    const daily = dailyLog.body.activity as {
      projectSnapshot?: string;
      categoryId: string;
    };
    assert.equal(daily.projectSnapshot, undefined);
    assert.equal(daily.categoryId, "uncategorized");
    const estimate = await callRoute(routes, "POST", "/api/time/estimate", {
      idempotencyKey: "daily-estimate",
      title: "Walk",
      tags: ["运动"],
      estimatedSeconds: 600,
    });
    assert.equal(
      (estimate.body.activity as { categoryId: string }).categoryId,
      "uncategorized",
    );
    const planned = await callRoute(routes, "POST", "/api/time/plans/create", {
      title: "Rest",
      tags: ["休息"],
      allowanceMinutes: 30,
    });
    const plan = planned.body.plan as {
      id: string;
      version: number;
      projectSnapshot?: string;
    };
    assert.equal(plan.projectSnapshot, undefined);
    await callRoute(routes, "POST", "/api/time/plans/update", {
      planId: plan.id,
      expectedVersion: plan.version,
      projectSnapshot: null,
      tags: ["休息"],
    });
    const started = await callRoute(routes, "POST", "/api/time/plans/start", {
      idempotencyKey: "daily-plan-start",
      planId: plan.id,
    });
    assert.equal(
      (started.body.activity as { categoryId: string }).categoryId,
      "uncategorized",
    );
    assert.equal(store.getStatus().activeActivity?.projectSnapshot, undefined);
    await callRoute(routes, "POST", "/api/time/stop", {
      idempotencyKey: "daily-plan-stop",
    });
    const ordinary = await callRoute(routes, "POST", "/api/time/start", {
      idempotencyKey: "daily-start",
      title: "整理房间",
      tags: ["生活"],
    });
    assert.equal(
      (ordinary.body.activity as { categoryId: string }).categoryId,
      "uncategorized",
    );
    await callRoute(routes, "POST", "/api/time/stop", {
      idempotencyKey: "daily-stop",
    });
    const logged = await callRoute(routes, "POST", "/api/time/log", {
      idempotencyKey: "project-no-tags",
      title: "Read",
      projectSnapshot: " Study ",
      startMs: at("09:00"),
      endMs: at("10:00"),
    });
    const activity = logged.body.activity as {
      id: string;
      version: number;
      projectSnapshot: string;
      tags?: string[];
    };
    assert.equal(activity.projectSnapshot, "Study");
    assert.equal(activity.tags?.length || 0, 0);
    await assert.rejects(
      () =>
        callRoute(routes, "POST", "/api/time/update", {
          idempotencyKey: "clear-all",
          activityId: activity.id,
          expectedVersion: activity.version,
          patch: { projectSnapshot: null, tags: [] },
        }),
      (error) =>
        (error as { code?: string }).code === "TIME_ASSIGNMENT_REQUIRED",
    );
    assert.equal(store.getActivity(activity.id)?.projectSnapshot, "Study");
    await callRoute(routes, "POST", "/api/time/update", {
      idempotencyKey: "remove-project",
      activityId: activity.id,
      expectedVersion: activity.version,
      patch: { projectSnapshot: null, tags: ["阅读"] },
    });
    assert.equal(store.getActivity(activity.id)?.projectSnapshot, undefined);
    assert.deepEqual(store.getActivity(activity.id)?.tags, ["阅读"]);
    await assert.rejects(() =>
      callRoute(routes, "POST", "/api/time/update", {
        idempotencyKey: "invalid-project",
        activityId: activity.id,
        expectedVersion: store.getActivity(activity.id)!.version,
        patch: { projectSnapshot: 42 },
      }),
    );
    const sleep = await callRoute(routes, "POST", "/api/time/log", {
      idempotencyKey: "sleep-project",
      title: "Nap",
      explicitCategoryId: "sleep",
      startMs: at("13:00"),
      endMs: at("14:00"),
    });
    assert.equal(
      (sleep.body.activity as { projectSnapshot?: string }).projectSnapshot,
      undefined,
    );
    assert.equal(
      (sleep.body.activity as { hourlyRateCents?: number }).hourlyRateCents,
      0,
    );
    const candidate = store.confirmSleepCandidate({
      idempotencyKey: "sleep-candidate-project",
      date: "2026-11-14",
    });
    assert.equal(candidate.activity?.projectSnapshot, undefined);
    assert.equal(candidate.activity?.categoryId, "sleep");
    assert.deepEqual(candidate.activity?.tags, ["睡眠"]);
    assert.deepEqual((sleep.body.activity as { tags?: string[] }).tags, [
      "睡眠",
    ]);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
