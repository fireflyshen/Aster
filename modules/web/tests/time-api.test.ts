import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { createTimeHandlers } from "../../server/src/time/time-api.ts";
import { createTimeBackupService } from "../../server/src/time/time-backup.ts";
import {
    createTimeStore,
    TimeStoreError,
} from "../../server/src/time/time-store.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const coreRoot = path.resolve(webRoot, "..", "core");

const compiled = esbuild.buildSync({
    entryPoints: [path.join(webRoot, "src/features/time/time-api.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    alias: {
        "@": path.join(webRoot, "src"),
        "@core": coreRoot,
        "@shared": path.join(webRoot, "shared"),
    },
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
const timeApi = await import(moduleUrl);

const compiledFormat = esbuild.buildSync({
    entryPoints: [path.join(webRoot, "src/features/time/time-format.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    alias: {
        "@": path.join(webRoot, "src"),
        "@core": coreRoot,
        "@shared": path.join(webRoot, "shared"),
    },
});

const formatUrl = `data:text/javascript;base64,${Buffer.from(compiledFormat.outputFiles[0].text).toString("base64")}`;
const timeFormat = await import(formatUrl);

test("web time-api routes cleanly through real server handlers without double /api prefix or wrapped POST bodies", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aster-web-time-"));
    const dbPath = path.join(dir, "time.sqlite");
    const barrierPath = path.join(dir, "time-barrier.json");
    const store = await createTimeStore(dbPath, {
        barrierPath,
        enabled: true,
        cutoverAtMs: 1763164800000,
        now: () => 1763193600000, // 2026-11-15T08:00:00Z = 16:00 Asia/Shanghai
    });
    store.updatePolicy({
        expectedPolicyVersion: store.getPolicy().policyVersion,
        patch: { timezone: "Asia/Shanghai" },
    });
    const backup = createTimeBackupService(store, {
        restoreRootDir: path.join(dir, "time-restore-points"),
        identity: "web-contract-test",
        now: () => 1763193600000,
    });

    const handlers = createTimeHandlers({
        identity: "web-contract-test",
        gate: {
            exclusive: (fn) => fn(),
            shared: (fn) => fn(),
        } as never,
        service: {
            connection: { kind: "local" },
            rawTask: async () => {
                throw new Error("not used");
            },
            exportTasks: async () => [],
        } as never,
        store,
        backup,
        isEnabled: () => true,
        paths: {
            dataDir: dir,
            organizationFile: path.join(dir, "organization.json"),
            recoveryFile: path.join(dir, "recovery.json"),
            timeFile: dbPath,
        },
    });

    const routeMap = new Map(
        handlers.map((r) => [`${r.method}:${r.route}`, r]),
    );
    const fetchedUrls: string[] = [];
    const origFetch = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const rawUrl = String(input);
        fetchedUrls.push(rawUrl);
        assert.ok(!rawUrl.startsWith("/api/api/"), `Unexpected URL: ${rawUrl}`);

        const parsed = new URL(rawUrl, "http://127.0.0.1:4180");
        const method = (init?.method || "GET").toUpperCase();
        const route = parsed.pathname.replace(/^\//, "");
        const spec = routeMap.get(`${method}:${route}`);

        if (!spec) {
            return new Response(JSON.stringify({}), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        const bodyText = typeof init?.body === "string" ? init.body : "";
        try {
            const res = await spec.handle({
                searchParams: parsed.searchParams,
                readBody: async () => (bodyText ? JSON.parse(bodyText) : {}),
                transport: "http",
            } as never);
            return new Response(JSON.stringify(res.body), {
                status: res.status,
                headers: { "Content-Type": "application/json" },
            });
        } catch (err) {
            if (err instanceof TimeStoreError) {
                return new Response(
                    JSON.stringify({
                        error: err.message,
                        code: err.code,
                        ...(err.details ? { details: err.details } : {}),
                    }),
                    {
                        status: err.status,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }
            throw err;
        }
    }) as typeof fetch;

    try {
        // 1. Initial reads required by all 3 Web pages
        const status = await timeApi.fetchTimeStatus();
        assert.equal(status.enabled, true);
        assert.equal(status.initialized, true);
        assert.equal(status.available, true);

        const policy = await timeApi.fetchTimePolicy();
        assert.equal(policy.timezone, "Asia/Shanghai");
        assert.ok(policy.policyVersion >= 1);

        const daily = await timeApi.fetchDailySummary("2026-11-15");
        assert.equal(daily.date, "2026-11-15");

        const digest = await timeApi.fetchReconcileDigest("2026-11-15");
        assert.ok(Array.isArray(digest.pendingOperations));
        assert.ok(Array.isArray(digest.reviewItems));

        const weekly = await timeApi.fetchWeeklySummary("2026-11-15");
        assert.equal(weekly.daily.length, 7);

        // 2. Mutations: start, stop, log, estimate, locate, update, undo, sleep, policy
        const started = await timeApi.startTimeActivity({
            title: "Live Web Start",
            explicitCategoryId: "study",
        });
        assert.equal(started.activity?.title, "Live Web Start");

        const stopped = await timeApi.stopTimeActivity({
            expectedActivityId: started.activity!.id,
            expectedVersion: started.activity!.version,
        });
        assert.ok(stopped.activity?.endMs);

        const logged = await timeApi.logTimeActivity({
            title: "Evening Reading",
            startMs: 1763164800000,
            endMs: 1763168400000,
            precision: "estimated_bounds",
        });
        assert.equal(logged.activity?.precision, "estimated_bounds");

        const estimated = await timeApi.estimateTimeActivity({
            title: "Unlocated Walk",
            estimatedSeconds: 1800,
            targetDate: "2026-11-15",
        });
        const located = await timeApi.locateTimeEstimate({
            activityId: estimated.activity!.id,
            expectedVersion: estimated.activity!.version,
            startMs: 1763172000000,
            endMs: 1763173800000,
        });
        assert.equal(located.activity?.kind, "located");
        assert.equal(located.activity?.startMs, 1763172000000);

        const updated = await timeApi.updateTimeActivity({
            activityId: located.activity!.id,
            expectedVersion: located.activity!.version,
            patch: { title: "Evening Walk" },
        });
        assert.equal(updated.activity?.title, "Evening Walk");

        const undone = await timeApi.undoTimeOperation(updated.operationId);
        assert.equal(undone.undoneOperationId, updated.operationId);

        const sleepConfirmed =
            await timeApi.confirmSleepCandidate("2026-11-14");
        assert.ok(sleepConfirmed.activity?.id);

        const nextPolicy = await timeApi.updateTimePolicy({
            expectedPolicyVersion: policy.policyVersion,
            patch: { longActivityThresholdSeconds: 5400 },
        });
        assert.equal(nextPolicy.longActivityThresholdSeconds, 5400);

        // 2.5 TimingPlan lifecycle + pause + confirm + events contract
        const createdPlan = await timeApi.createTimingPlan({
            title: "Focused block",
            categoryId: "work",
            allowanceMinutes: 30,
            hardStopAtMs: 1763197200000, // 17:00 Asia/Shanghai
        });
        assert.equal(createdPlan.plan.allowanceSeconds, 1800);

        const plans = await timeApi.fetchTimingPlans();
        assert.equal(plans.length, 1);

        const startedPlan = await timeApi.startTimingPlan({
            planId: createdPlan.plan.id,
        });
        assert.equal(startedPlan.activity?.timingPlanId, createdPlan.plan.id);

        const pausedPlan = await timeApi.stopTimeActivity({
            expectedActivityId: startedPlan.activity!.id,
            expectedVersion: startedPlan.activity!.version,
            pause: true,
        });
        assert.equal(pausedPlan.activity?.stopReason, "manual_pause");

        const updatedPlan = await timeApi.updateTimingPlan({
            planId: createdPlan.plan.id,
            expectedVersion: createdPlan.plan.version,
            addAllowanceMinutes: 15,
        });
        assert.equal(updatedPlan.plan.allowanceSeconds, 2700);

        const events = await timeApi.fetchTimeEvents();
        assert.ok(Array.isArray(events));

        // Confirm activity endpoint contract on active uncapped timer
        const openRun = await timeApi.startTimeActivity({
            title: "Open run",
        });
        const confirmedOpen = await timeApi.confirmTimeActivity({
            activityId: openRun.activity!.id,
            expectedVersion: openRun.activity!.version,
            throughMs: 1763193600000,
        });
        assert.equal(confirmedOpen.activity?.confirmedThroughMs, 1763193600000);
        await timeApi.stopTimeActivity({
            expectedActivityId: confirmedOpen.activity!.id,
            expectedVersion: confirmedOpen.activity!.version,
        });

        // 3. Independent backup export -> preview -> restore field contract
        const exported = await timeApi.exportTimeBackup();
        assert.ok(
            typeof exported.sqliteBase64 === "string" &&
                exported.sqliteBase64.length > 0,
        );
        const preview = await timeApi.previewTimeBackupRestore(
            exported.sqliteBase64,
        );
        assert.ok(typeof preview.candidateCounts.activities === "number");
        assert.ok(typeof preview.currentCounts.timeEpoch === "number");
        assert.ok(Array.isArray(preview.warnings));
        const restored = await timeApi.applyTimeBackupRestore(preview.token);
        assert.ok(restored.timeEpoch > preview.currentCounts.timeEpoch);

        assert.ok(fetchedUrls.length >= 16);
        assert.ok(fetchedUrls.every((u) => u.startsWith("/api/time/")));
    } finally {
        globalThis.fetch = origFetch;
        store.close();
        await rm(dir, { recursive: true, force: true });
    }
});

test("time log snapping avoids sub-minute overlap and formats Chinese conflict details", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aster-web-time-snap-"));
    const dbPath = path.join(dir, "time.sqlite");
    const barrierPath = path.join(dir, "time-barrier.json");
    let fakeNow = Date.parse("2026-11-15T08:45:00.000Z"); // 16:45:00 Asia/Shanghai
    const store = await createTimeStore(dbPath, {
        barrierPath,
        enabled: true,
        cutoverAtMs: Date.parse("2026-11-15T00:00:00.000Z"),
        now: () => fakeNow,
    });
    store.updatePolicy({
        expectedPolicyVersion: store.getPolicy().policyVersion,
        patch: { timezone: "Asia/Shanghai" },
    });

    const handlers = createTimeHandlers({
        identity: "web-snap-test",
        gate: {
            exclusive: (fn) => fn(),
            shared: (fn) => fn(),
        } as never,
        service: {
            connection: { kind: "local" },
            rawTask: async () => {
                throw new Error("not used");
            },
            exportTasks: async () => [],
        } as never,
        store,
        isEnabled: () => true,
        paths: {
            dataDir: dir,
            organizationFile: path.join(dir, "organization.json"),
            recoveryFile: path.join(dir, "recovery.json"),
            timeFile: dbPath,
        },
    });

    const routeMap = new Map(
        handlers.map((r) => [`${r.method}:${r.route}`, r]),
    );
    const origFetch = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const parsed = new URL(String(input), "http://127.0.0.1:4180");
        const method = (init?.method || "GET").toUpperCase();
        const route = parsed.pathname.replace(/^\//, "");
        const spec = routeMap.get(`${method}:${route}`);
        if (!spec) {
            return new Response(JSON.stringify({}), { status: 404 });
        }
        const bodyText = typeof init?.body === "string" ? init.body : "";
        try {
            const res = await spec.handle({
                searchParams: parsed.searchParams,
                readBody: async () => (bodyText ? JSON.parse(bodyText) : {}),
                transport: "http",
            } as never);
            return new Response(JSON.stringify(res.body), {
                status: res.status,
                headers: { "Content-Type": "application/json" },
            });
        } catch (err) {
            if (err instanceof TimeStoreError) {
                return new Response(
                    JSON.stringify({
                        error: err.message,
                        code: err.code,
                        ...(err.details ? { details: err.details } : {}),
                    }),
                    {
                        status: err.status,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }
            throw err;
        }
    }) as typeof fetch;

    try {
        // Previous timer starts at 16:45:00 and stops at 16:53:42.000
        await timeApi.startTimeActivity({
            title: "C++ if、switch 与循环",
            explicitCategoryId: "study",
        });
        fakeNow = Date.parse("2026-11-15T08:53:42.000Z"); // 16:53:42
        await timeApi.stopTimeActivity();
        fakeNow = Date.parse("2026-11-15T09:30:00.000Z"); // 17:30:00

        const daily = await timeApi.fetchDailySummary("2026-11-15");
        assert.equal(daily.locatedSegments.length, 1);

        // User types minute-precision start 16:53:00 -> 17:26:00
        const rawStartMs = Date.parse("2026-11-15T08:53:00.000Z");
        const endMs = Date.parse("2026-11-15T09:26:00.000Z");
        const snappedStartMs = timeFormat.snapMinuteStartToSegments(
            rawStartMs,
            endMs,
            daily.locatedSegments,
        );
        assert.equal(snappedStartMs, Date.parse("2026-11-15T08:53:42.000Z"));

        const saved = await timeApi.logTimeActivity({
            title: "C++学习",
            startMs: snappedStartMs,
            endMs,
            explicitCategoryId: "study",
            projectSnapshot: "Learn.Cpp",
            tags: ["cpp"],
            precision: "exact",
        });
        assert.equal(saved.activity?.projectSnapshot, "Learn.Cpp");
        assert.equal(saved.activity?.startMs, snappedStartMs);

        // Genuine overlap returns details.conflicts & Chinese conflict description with seconds
        let capturedErr: unknown;
        try {
            await timeApi.logTimeActivity({
                title: "真正重叠测试",
                startMs: Date.parse("2026-11-15T08:50:00.000Z"), // 16:50:00
                endMs: Date.parse("2026-11-15T08:55:00.000Z"), // 16:55:00
            });
        } catch (err) {
            capturedErr = err;
        }
        assert.ok(capturedErr, "expected overlap error");
        const localized = timeFormat.formatTimeErrorMessage(
            capturedErr,
            "Asia/Shanghai",
        );
        assert.match(localized, /C\+\+ if、switch 与循环/);
        assert.match(localized, /16:45 – 16:53:42/);
    } finally {
        globalThis.fetch = origFetch;
        store.close();
        await rm(dir, { recursive: true, force: true });
    }
});

test("web time-api routes cost budgets, task detail, cost report, and read-only bills links", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aster-web-cost-"));
    const billsDir = path.join(dir, "Bills");
    const beanMonthDir = path.join(billsDir, "journal", "2026");
    await mkdir(beanMonthDir, { recursive: true });
    await writeFile(
        path.join(beanMonthDir, "2026-11.bean"),
        `2026-11-15 * "Keychron" "Mechanical keyboard"
  source: "manual"
  pay_time: "2026-11-15T10:30:00+08:00"
  tx_id: "tx-kb-web-01"
  Expenses:Shopping:Gear  399.00 CNY
  Assets:Alipay          -399.00 CNY
`,
        "utf8",
    );

    let fakeNow = Date.parse("2026-11-15T05:00:00.000Z"); // 13:00 Asia/Shanghai
    const taskUuid = "aaaaaaaa-3333-4333-8333-333333333333";
    const dbPath = path.join(dir, "time.sqlite");
    const store = await createTimeStore(dbPath, {
        barrierPath: path.join(dir, "time-barrier.json"),
        enabled: true,
        billsDir,
        now: () => fakeNow,
    });
    store.updatePolicy({
        expectedPolicyVersion: store.getPolicy().policyVersion,
        patch: {
            timezone: "Asia/Shanghai",
            hourlyRateCents: 10_000,
            taskListHighlightCost: true,
        },
    });

    const handlers = createTimeHandlers({
        identity: "web-cost-test",
        gate: {
            exclusive: (fn) => fn(),
            shared: (fn) => fn(),
        } as never,
        service: {
            connection: { kind: "local" },
            rawTask: async () => {
                throw new Error("not used");
            },
            exportTasks: async () => [
                {
                    id: 1,
                    uuid: taskUuid,
                    description: "Compare mechanical keyboards",
                    status: "pending",
                    entry: "20261115T000000Z",
                    modified: "20261115T000000Z",
                    project: "Life.Gear",
                    tags: ["hardware"],
                    urgency: 1,
                    annotations: [],
                },
            ],
        } as never,
        store,
        isEnabled: () => true,
        paths: {
            dataDir: dir,
            organizationFile: path.join(dir, "organization.json"),
            recoveryFile: path.join(dir, "recovery.json"),
            timeFile: dbPath,
        },
    });

    const routeMap = new Map(
        handlers.map((r) => [`${r.method}:${r.route}`, r]),
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const parsed = new URL(String(input), "http://127.0.0.1:4180");
        const method = (init?.method || "GET").toUpperCase();
        const route = parsed.pathname.replace(/^\//, "");
        const spec = routeMap.get(`${method}:${route}`);
        if (!spec) {
            return new Response(JSON.stringify({}), { status: 404 });
        }
        const bodyText = typeof init?.body === "string" ? init.body : "";
        try {
            const res = await spec.handle({
                searchParams: parsed.searchParams,
                readBody: async () => (bodyText ? JSON.parse(bodyText) : {}),
                transport: "http",
            } as never);
            return new Response(JSON.stringify(res.body), {
                status: res.status,
                headers: { "Content-Type": "application/json" },
            });
        } catch (err) {
            if (err instanceof TimeStoreError) {
                return new Response(
                    JSON.stringify({ error: err.message, code: err.code }),
                    {
                        status: err.status,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }
            throw err;
        }
    }) as typeof fetch;

    try {
        assert.equal(timeFormat.formatCurrencyCny(10_000), "¥100");
        assert.match(timeFormat.formatRateConversionHint(10_000), /¥50.*¥200/);
        const contPreview = timeFormat.computeContinuationCostPreview({
            requestedSeconds: 1800,
            hourlyRateCents: 10_000,
            hardStopAtMs: fakeNow + 1200_000, // 20m remaining
            nowMs: fakeNow,
        });
        assert.equal(contPreview.effectiveSeconds, 1200);
        assert.equal(contPreview.cappedByHardStop, true);

        const setRes = await timeApi.setTaskBudget({
            taskUuid,
            mode: "set",
            allowanceSeconds: 3600,
            plannedStartDate: "2026-11-15",
            plannedStartTime: "14:00",
            hardStopDate: "2026-11-15",
            hardStopTime: "15:00",
        });
        assert.equal(setRes.summary.initialBudgetCents, 10_000);
        assert.equal(setRes.summary.currentBudgetCents, 10_000);

        const addRes = await timeApi.setTaskBudget({
            taskUuid,
            mode: "add",
            addAllowanceSeconds: 1800,
        });
        assert.equal(addRes.summary.initialBudgetCents, 10_000);
        assert.equal(addRes.summary.currentBudgetCents, 15_000);

        // Advance clock past 16:00 CST before logging 14:00-16:00 CST work
        fakeNow = Date.parse("2026-11-15T08:30:00.000Z"); // 16:30 CST

        // Log 2h confirmed work on the task (¥200 vs ¥100 initial budget => +¥100 overage)
        await timeApi.logTimeActivity({
            title: "Compare mechanical keyboards",
            taskUuid,
            projectSnapshot: "Life.Gear",
            tags: ["hardware"],
            startMs: Date.parse("2026-11-15T06:00:00.000Z"), // 14:00 CST
            endMs: Date.parse("2026-11-15T08:00:00.000Z"), // 16:00 CST
        });

        const billsRes = await timeApi.fetchBillExpenses({
            q: "Keychron",
            limit: 20,
        });
        assert.equal(billsRes.available, true);
        assert.equal(billsRes.expenses.length, 1);

        const linked = await timeApi.linkBillExpense({
            txKey: billsRes.expenses[0].txKey,
            taskUuid,
            source: billsRes.expenses[0].source,
            txId: billsRes.expenses[0].txId,
            payTime: billsRes.expenses[0].payTime,
            payee: billsRes.expenses[0].payee,
            narration: billsRes.expenses[0].narration,
            account: billsRes.expenses[0].account,
            currency: billsRes.expenses[0].currency,
            amount: billsRes.expenses[0].amount,
            cnyAmountCents: billsRes.expenses[0].cnyAmountCents,
        });
        assert.ok(linked.link.id);

        const detail = await timeApi.fetchTaskCostDetail(taskUuid);
        assert.equal(detail.summary.confirmedCostCents, 20_000);
        assert.equal(detail.summary.overInitialBudgetCents, 10_000);
        assert.equal(detail.summary.linkedCashCents, 39_900);
        assert.equal(detail.summary.combinedCostCents, 59_900);
        assert.equal(detail.billLinks.length, 1);

        const report = await timeApi.fetchCostReport({
            granularity: "week",
            date: "2026-11-15",
            sortBy: "highest_cost",
        });
        assert.equal(report.totalPeriodConfirmedCostCents, 20_000);
        assert.equal(report.totalCashExpenseCents, 39_900);
        assert.equal(report.totalCombinedCostCents, 59_900);
        assert.equal(report.byTask.length, 1);
        assert.equal(report.byProject[0]?.projectName, "Life.Gear");

        const unlinked = await timeApi.unlinkBillLink(linked.link.id);
        assert.equal(unlinked.deleted, true);
        const detailAfter = await timeApi.fetchTaskCostDetail(taskUuid);
        assert.equal(detailAfter.billLinks.length, 0);
    } finally {
        globalThis.fetch = origFetch;
        store.close();
        await rm(dir, { recursive: true, force: true });
    }
});
