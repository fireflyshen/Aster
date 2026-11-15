import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { workspaceIdentity, type Connection } from "../connection/settings.ts";
import { createWorkspaceClient, WorkspaceError } from "../workspace/client.ts";

const connection: Connection = {
  kind: "local",
  label: "Local",
  key: "local",
  taskCommand: "task",
};

test("createWorkspaceClient exposes typed time endpoints, returns task uuid on addTask, and preserves structured WorkspaceError fields", async () => {
  const requests: Array<{
    method: string;
    url: string;
    body: Record<string, unknown> | null;
  }> = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      requests.push({
        method: req.method || "GET",
        url: req.url || "",
        body,
      });

      if (req.url === "/api/workspace" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            identity: workspaceIdentity(connection),
            organization: {
              filters: [],
              tags: [],
              projectCounts: {},
              subtasks: {},
              descriptions: {},
              revision: 1,
              projects: [],
              board: {
                columns: [],
                placements: [],
                order: [],
              },
            },
          }),
        );
        return;
      }

      if (req.url === "/api/tasks" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, uuid: "created-task-uuid-1" }));
        return;
      }

      if (req.url === "/api/time/task-budget" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            summary: {
              taskUuid: "created-task-uuid-1",
              confirmedSeconds: 0,
              confirmedCostCents: 0,
              provisionalSeconds: 0,
              provisionalCostCents: 0,
              hasBudget: true,
              initialAllowanceSeconds: 3600,
              initialBudgetCents: 10000,
              currentAllowanceSeconds: 3600,
              currentBudgetCents: 10000,
              addedBudgetCents: 0,
              overInitialBudgetCents: 0,
              overCurrentBudgetCents: 0,
              linkedCashCents: 0,
              combinedCostCents: 0,
              currentHourlyRateCents: 10000,
            },
          }),
        );
        return;
      }

      if (
        req.url?.startsWith("/api/time/cost-report") &&
        req.method === "GET"
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            granularity: "month",
            periodStartDate: "2026-11-01",
            periodEndDate: "2026-11-30",
            timezone: "Asia/Shanghai",
            sortBy: "highest_over_budget",
            hourlyRateCents: 10000,
            totalPeriodConfirmedSeconds: 7200,
            totalPeriodConfirmedCostCents: 20000,
            totalPeriodProvisionalSeconds: 0,
            totalPeriodProvisionalCostCents: 0,
            totalCashExpenseCents: 5000,
            totalCombinedCostCents: 25000,
            byProject: [],
            byTask: [],
            unassignedSegments: [],
            unassignedBillLinks: [],
          }),
        );
        return;
      }

      if (req.url === "/api/time/plans/start" && req.method === "POST") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Timing plan hard stop has already passed.",
            code: "TIMING_PLAN_EXPIRED",
            details: { planId: "plan-expired" },
          }),
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert(addr && typeof addr === "object");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const client = createWorkspaceClient(baseUrl, connection);
    const added = await client.addTask({
      description: "测试预算任务",
      tags: [],
    });
    assert.equal(added.uuid, "created-task-uuid-1");

    const budgetRes = await client.time.setTaskBudget({
      taskUuid: added.uuid!,
      mode: "set",
      allowanceSeconds: 3600,
    });
    assert.equal(budgetRes.summary.initialBudgetCents, 10000);

    const report = await client.time.costReport({
      granularity: "month",
      date: "2026-11-15",
      sortBy: "highest_over_budget",
    });
    assert.equal(report.granularity, "month");
    assert.equal(report.totalCombinedCostCents, 25000);

    await assert.rejects(
      () => client.time.startPlan({ planId: "plan-expired" }),
      (err: unknown) => {
        assert(err instanceof WorkspaceError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.serverCode, "TIMING_PLAN_EXPIRED");
        assert.deepEqual(err.details, { planId: "plan-expired" });
        return true;
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert.equal(
    requests.some(
      (r) =>
        r.method === "GET" &&
        r.url ===
          "/api/time/cost-report?granularity=month&date=2026-11-15&sortBy=highest_over_budget",
    ),
    true,
  );
});
