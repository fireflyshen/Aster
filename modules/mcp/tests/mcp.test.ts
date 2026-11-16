import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createAiServer } from "../src/server.ts";
import {
  socketClient,
  WorkspaceError,
  connectWorkspace,
} from "../src/transport.ts";

const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const uuid3 = "33333333-3333-4333-8333-333333333333";
const task = {
  description: "Task",
  tags: [],
  project: "Work",
  due: "20261112T060000Z",
  priority: "H",
};
const richTask = {
  ...task,
  parentUuid: uuid2,
  taskDescription: "## Study guide\nRead ch. 2 and write tests.",
};
const compositeToolNames = [
  "habit_todo_create",
  "plan_apply",
  "project_digest",
  "task_patch",
];
const item = { id: "", name: "Work", color: "gray", favorite: false };
const cases: [string, any, string, string, any?][] = [
  ["workspace_get", {}, "GET", "/api/workspace"],
  ["tasks_list", {}, "GET", "/api/tasks"],
  [
    "tasks_list",
    { filter: "status:pending +Work" },
    "GET",
    "/api/tasks?filter=status%3Apending%20%2BWork",
  ],
  ["task_get", { uuid }, "GET", "/api/tasks?filter=uuid%3A" + uuid],
  [
    "quick_preview",
    { text: "明天 报告" },
    "POST",
    "/api/quick/preview",
    { text: "明天 报告" },
  ],
  ["task_create", { task }, "POST", "/api/tasks", task],
  ["task_create", { task: richTask }, "POST", "/api/tasks", richTask],
  [
    "task_edit",
    { uuid, task },
    "POST",
    "/api/action",
    { uuid, task, action: "edit" },
  ],
  ...["complete", "reopen", "start", "stop", "delete", "restore"].map(
    (a) =>
      ["task_" + a, { uuid }, "POST", "/api/action", { uuid, action: a }] as [
        string,
        any,
        string,
        string,
        any,
      ],
  ),
  [
    "task_wait",
    { uuid, wait: "" },
    "POST",
    "/api/action",
    { uuid, wait: "", action: "wait" },
  ],
  [
    "task_state_set",
    {
      uuid,
      state: "waiting",
      waitReason: "等待回复",
      checkDate: "2026-11-20",
    },
    "POST",
    "/api/action",
    {
      uuid,
      state: "waiting",
      waitReason: "等待回复",
      checkDate: "2026-11-20",
      action: "state.set",
    },
  ],
  [
    "task_schedule",
    { uuid, scheduled: "2026-11-18" },
    "POST",
    "/api/action",
    { uuid, scheduled: "2026-11-18", action: "schedule" },
  ],
  [
    "task_depends",
    { uuid, add: [uuid2] },
    "POST",
    "/api/action",
    { uuid, add: [uuid2], action: "depends" },
  ],
  ["state_summary", {}, "GET", "/api/state/summary"],
  [
    "state_history",
    { uuid, limit: 20 },
    "GET",
    `/api/state/history?uuid=${encodeURIComponent(uuid)}&limit=20`,
  ],
  [
    "task_note_remove",
    { uuid, entry: "now", description: "Note" },
    "POST",
    "/api/action",
    { uuid, entry: "now", description: "Note", action: "note.remove" },
  ],
  ["recurrence_get", { uuid }, "GET", "/api/recurrence?uuid=" + uuid],
  [
    "recurrence_edit",
    { uuid, recur: "", until: "" },
    "POST",
    "/api/action",
    { uuid, recur: "", until: "", action: "recurrence.edit" },
  ],
  [
    "project_save",
    {
      revision: 7,
      item: { name: "Work.Child", description: "goal" },
      originalName: "Old",
    },
    "POST",
    "/api/organization",
    {
      revision: 7,
      kind: "project",
      action: "save",
      item: { name: "Work.Child", description: "goal" },
      originalName: "Old",
    },
  ],
  [
    "project_delete",
    { revision: 7, name: "Work" },
    "POST",
    "/api/organization",
    {
      revision: 7,
      kind: "project",
      action: "delete",
      item: { name: "Work", description: "" },
    },
  ],
  [
    "project_status",
    {
      revision: 7,
      name: "Work",
      status: "active",
      outcome: "Ship",
      replaceProject: "Old",
    },
    "POST",
    "/api/organization",
    {
      revision: 7,
      name: "Work",
      status: "active",
      outcome: "Ship",
      replaceProject: "Old",
      kind: "project",
      action: "status",
    },
  ],
  ...["save", "delete"].flatMap(
    (action) =>
      [
        [
          "label_" + action,
          { revision: 7, item },
          "POST",
          "/api/organization",
          { revision: 7, item, kind: "tag", action },
        ],
        [
          "filter_" + action,
          {
            revision: 7,
            item: {
              ...item,
              description: "",
              expression: "status:pending",
            },
          },
          "POST",
          "/api/organization",
          {
            revision: 7,
            item: {
              ...item,
              description: "",
              expression: "status:pending",
            },
            kind: "filter",
            action,
          },
        ],
      ] as [string, any, string, string, any][],
  ),
  [
    "column_save",
    { revision: 7, column: { id: "", name: "Doing" } },
    "POST",
    "/api/organization",
    {
      revision: 7,
      column: { id: "", name: "Doing" },
      kind: "board",
      action: "column.save",
    },
  ],
  [
    "column_save",
    { revision: 7, column: { id: "", name: "Phase 1", project: "Work" } },
    "POST",
    "/api/organization",
    {
      revision: 7,
      column: { id: "", name: "Phase 1", project: "Work" },
      kind: "board",
      action: "column.save",
    },
  ],
  [
    "column_delete",
    { revision: 7, columnId: "c" },
    "POST",
    "/api/organization",
    { revision: 7, columnId: "c", kind: "board", action: "column.delete" },
  ],
  [
    "column_move",
    { revision: 7, columnId: "c", direction: "left" },
    "POST",
    "/api/organization",
    {
      revision: 7,
      columnId: "c",
      direction: "left",
      kind: "board",
      action: "column.move",
    },
  ],
  [
    "board_task_move",
    { revision: 7, uuid, columnId: "unsectioned", beforeUuid: null },
    "POST",
    "/api/organization",
    {
      revision: 7,
      uuid,
      columnId: "unsectioned",
      beforeUuid: null,
      kind: "board",
      action: "task.move",
    },
  ],
  [
    "board_task_move",
    {
      revision: 7,
      uuid,
      columnId: "c1",
      beforeUuid: null,
      parentUuid: uuid2,
    },
    "POST",
    "/api/organization",
    {
      revision: 7,
      uuid,
      columnId: "c1",
      beforeUuid: null,
      parentUuid: uuid2,
      kind: "board",
      action: "task.move",
    },
  ],
  [
    "subtask_link",
    { revision: 7, childUuid: uuid, parentUuid: uuid2 },
    "POST",
    "/api/organization",
    {
      revision: 7,
      childUuid: uuid,
      parentUuid: uuid2,
      kind: "subtask",
      action: "link",
    },
  ],
  [
    "subtask_unlink",
    { revision: 7, childUuid: uuid },
    "POST",
    "/api/organization",
    {
      revision: 7,
      childUuid: uuid,
      kind: "subtask",
      action: "unlink",
    },
  ],
  [
    "task_description_set",
    { revision: 7, uuid, description: "Markdown body" },
    "POST",
    "/api/organization",
    {
      revision: 7,
      uuid,
      description: "Markdown body",
      kind: "description",
      action: "set",
    },
  ],
  [
    "task_description_delete",
    { revision: 7, uuid },
    "POST",
    "/api/organization",
    {
      revision: 7,
      uuid,
      kind: "description",
      action: "delete",
    },
  ],
  [
    "energy_elixir",
    { revision: 7 },
    "POST",
    "/api/organization",
    { revision: 7, kind: "energy", action: "elixir" },
  ],
  ["recovery_list", {}, "GET", "/api/recovery"],
  ["backup_export", {}, "GET", "/api/export"],
  ["backup_points", {}, "GET", "/api/backup/points"],
  ["backup_download", { id: uuid }, "GET", "/api/backup/download?id=" + uuid],
  [
    "backup_preview",
    { backup: { version: 1 } },
    "POST",
    "/api/backup/preview",
    { version: 1 },
  ],
  [
    "backup_restore",
    { token: uuid, confirmation: "RESTORE" },
    "POST",
    "/api/backup/restore",
    { token: uuid },
  ],
  ["time_status", {}, "GET", "/api/time/status"],
  [
    "time_start",
    {
      idempotencyKey: "k-start-1",
      title: "Study Aster Time",
      explicitCategoryId: "study",
    },
    "POST",
    "/api/time/start",
    {
      idempotencyKey: "k-start-1",
      title: "Study Aster Time",
      explicitCategoryId: "study",
      source: "bot",
    },
  ],
  [
    "time_stop",
    {
      idempotencyKey: "k-stop-1",
      expectedActivityId: "act-1",
      expectedVersion: 1,
    },
    "POST",
    "/api/time/stop",
    {
      idempotencyKey: "k-stop-1",
      expectedActivityId: "act-1",
      expectedVersion: 1,
    },
  ],
  [
    "time_log",
    {
      idempotencyKey: "k-log-1",
      title: "Read book",
      startMs: 1763164800000,
      endMs: 1763168400000,
      precision: "estimated_bounds",
    },
    "POST",
    "/api/time/log",
    {
      idempotencyKey: "k-log-1",
      title: "Read book",
      startMs: 1763164800000,
      endMs: 1763168400000,
      precision: "estimated_bounds",
      source: "bot",
    },
  ],
  [
    "time_estimate",
    {
      idempotencyKey: "k-est-1",
      title: "Play game",
      estimatedSeconds: 5400,
      targetDate: "2026-11-15",
    },
    "POST",
    "/api/time/estimate",
    {
      idempotencyKey: "k-est-1",
      title: "Play game",
      estimatedSeconds: 5400,
      targetDate: "2026-11-15",
      source: "bot",
    },
  ],
  [
    "time_locate",
    {
      idempotencyKey: "k-loc-1",
      activityId: "act-est-1",
      expectedVersion: 1,
      startMs: 1763168400000,
      endMs: 1763173800000,
    },
    "POST",
    "/api/time/locate",
    {
      idempotencyKey: "k-loc-1",
      activityId: "act-est-1",
      expectedVersion: 1,
      startMs: 1763168400000,
      endMs: 1763173800000,
    },
  ],
  [
    "time_update",
    {
      idempotencyKey: "k-upd-1",
      activityId: "act-1",
      expectedVersion: 2,
      patch: { title: "Read Rust book", confirmReview: true },
    },
    "POST",
    "/api/time/update",
    {
      idempotencyKey: "k-upd-1",
      activityId: "act-1",
      expectedVersion: 2,
      patch: { title: "Read Rust book", confirmReview: true },
    },
  ],
  [
    "time_undo",
    {
      idempotencyKey: "k-undo-1",
      targetOperationId: "op-1",
    },
    "POST",
    "/api/time/undo",
    {
      idempotencyKey: "k-undo-1",
      targetOperationId: "op-1",
    },
  ],
  [
    "time_daily",
    { date: "2026-11-15" },
    "GET",
    "/api/time/daily?date=2026-11-15",
  ],
  [
    "time_weekly",
    { weekStart: "2026-11-09" },
    "GET",
    "/api/time/weekly?weekStart=2026-11-09",
  ],
  [
    "time_reconcile_digest",
    { date: "2026-11-15" },
    "GET",
    "/api/time/reconcile-digest?date=2026-11-15",
  ],
  [
    "time_sleep_confirm",
    { idempotencyKey: "k-sleep-ok", date: "2026-11-15" },
    "POST",
    "/api/time/sleep/confirm",
    { idempotencyKey: "k-sleep-ok", date: "2026-11-15" },
  ],
  [
    "time_sleep_dismiss",
    { idempotencyKey: "k-sleep-skip", date: "2026-11-15" },
    "POST",
    "/api/time/sleep/dismiss",
    { idempotencyKey: "k-sleep-skip", date: "2026-11-15" },
  ],
  ["time_policy_get", {}, "GET", "/api/time/policy"],
  [
    "time_policy_update",
    {
      idempotencyKey: "k-pol-1",
      expectedPolicyVersion: 1,
      patch: {
        timezone: "Asia/Shanghai",
        longActivityThresholdSeconds: 21600,
      },
    },
    "POST",
    "/api/time/policy",
    {
      idempotencyKey: "k-pol-1",
      expectedPolicyVersion: 1,
      patch: {
        timezone: "Asia/Shanghai",
        longActivityThresholdSeconds: 21600,
      },
    },
  ],
  [
    "operation_get",
    { id: "op-pending-1" },
    "GET",
    "/api/time/operation?id=op-pending-1",
  ],
  [
    "time_operation_resolve",
    { operationId: "op-pending-1", action: "accept_started" },
    "POST",
    "/api/time/operation/resolve",
    { operationId: "op-pending-1", action: "accept_started" },
  ],
  [
    "time_confirm",
    {
      idempotencyKey: "k-confirm-1",
      activityId: "act-1",
      expectedVersion: 1,
      throughMs: 1763175600000,
    },
    "POST",
    "/api/time/confirm",
    {
      idempotencyKey: "k-confirm-1",
      activityId: "act-1",
      expectedVersion: 1,
      throughMs: 1763175600000,
    },
  ],
  [
    "time_plan_create",
    {
      idempotencyKey: "k-plan-new-1",
      title: "Focused draft",
      allowanceMinutes: 60,
      plannedStartTime: "14:00",
      hardStopTime: "15:00",
    },
    "POST",
    "/api/time/plans/create",
    {
      idempotencyKey: "k-plan-new-1",
      title: "Focused draft",
      allowanceMinutes: 60,
      plannedStartTime: "14:00",
      hardStopTime: "15:00",
    },
  ],
  [
    "time_plan_list",
    { includeArchived: true },
    "GET",
    "/api/time/plans?includeArchived=1",
  ],
  [
    "time_plan_update",
    {
      idempotencyKey: "k-plan-upd-1",
      planId: "plan-1",
      expectedVersion: 1,
      addAllowanceMinutes: 15,
    },
    "POST",
    "/api/time/plans/update",
    {
      idempotencyKey: "k-plan-upd-1",
      planId: "plan-1",
      expectedVersion: 1,
      addAllowanceMinutes: 15,
    },
  ],
  [
    "time_plan_start",
    { idempotencyKey: "k-plan-start-1", planId: "plan-1" },
    "POST",
    "/api/time/plans/start",
    { idempotencyKey: "k-plan-start-1", planId: "plan-1" },
  ],
  ["time_events_list", { limit: 10 }, "GET", "/api/time/events?limit=10"],
  [
    "time_events_ack",
    { eventIds: ["ev-1"] },
    "POST",
    "/api/time/events/ack",
    { eventIds: ["ev-1"] },
  ],
  [
    "time_task_detail",
    { taskUuid: uuid },
    "GET",
    `/api/time/task-detail?taskUuid=${uuid}`,
  ],
  [
    "time_task_budget_set",
    { taskUuid: uuid, mode: "set", allowanceSeconds: 3600 },
    "POST",
    "/api/time/task-budget",
    { taskUuid: uuid, mode: "set", allowanceSeconds: 3600 },
  ],
  [
    "time_cost_report",
    { granularity: "week", date: "2026-11-15", sortBy: "highest_cost" },
    "GET",
    "/api/time/cost-report?granularity=week&date=2026-11-15&sortBy=highest_cost",
  ],
  [
    "time_bills_expenses",
    { q: "keyboard", limit: 10 },
    "GET",
    "/api/time/bills/expenses?q=keyboard&limit=10",
  ],
  [
    "time_bills_link",
    {
      txKey: "bean:2026-11.bean:10",
      taskUuid: uuid,
      source: "beancount",
      txId: "tx-1",
      payTime: "2026-11-15T10:00:00+08:00",
      payee: "Store",
      narration: "Keyboard",
      account: "Expenses:Gear",
      currency: "CNY",
      amount: 399,
      cnyAmountCents: 39900,
    },
    "POST",
    "/api/time/bills/link",
    {
      txKey: "bean:2026-11.bean:10",
      taskUuid: uuid,
      source: "beancount",
      txId: "tx-1",
      payTime: "2026-11-15T10:00:00+08:00",
      payee: "Store",
      narration: "Keyboard",
      account: "Expenses:Gear",
      currency: "CNY",
      amount: 399,
      cnyAmountCents: 39900,
    },
  ],
  [
    "time_bills_unlink",
    { linkId: "link-1" },
    "POST",
    "/api/time/bills/unlink",
    { linkId: "link-1" },
  ],
  ["habit_today", {}, "GET", "/api/habits/today"],
  [
    "habits_list",
    { status: "active", project: "Study", tag: "evening" },
    "GET",
    "/api/habits?status=active&project=Study&tag=evening",
  ],
  [
    "habit_detail",
    { habitId: uuid, days: 30 },
    "GET",
    `/api/habits/detail?id=${uuid}&days=30`,
  ],
  [
    "habit_heatmap",
    { days: 90, project: "Health" },
    "GET",
    "/api/habits/heatmap?days=90&project=Health",
  ],
  [
    "habit_day_detail",
    { date: "2026-11-15" },
    "GET",
    "/api/habits/day?date=2026-11-15",
  ],
  [
    "habit_bind",
    {
      taskUuid: uuid,
      kind: "positive",
      schedule: { type: "daily" },
      abEnabled: true,
      subtaskPlans: { [uuid2]: "B" },
    },
    "POST",
    "/api/habits/bind",
    {
      taskUuid: uuid,
      kind: "positive",
      schedule: { type: "daily" },
      abEnabled: true,
      subtaskPlans: { [uuid2]: "B" },
    },
  ],
  [
    "habit_unbind",
    { taskUuid: uuid },
    "POST",
    "/api/habits/unbind",
    { taskUuid: uuid },
  ],
  [
    "habit_status",
    { habitId: uuid, status: "paused" },
    "POST",
    "/api/habits/status",
    { habitId: uuid, status: "paused" },
  ],
  [
    "habit_toggle",
    { habitId: uuid, date: "2026-11-15", completed: true },
    "POST",
    "/api/habits/toggle",
    { habitId: uuid, date: "2026-11-15", completed: true },
  ],
  [
    "habit_checklist_item",
    {
      habitId: uuid,
      itemId: uuid2,
      date: "2026-11-15",
      done: true,
      sets: "3",
      reps: "12",
      weight: "40kg",
    },
    "POST",
    "/api/habits/checklist-item",
    {
      habitId: uuid,
      itemId: uuid2,
      date: "2026-11-15",
      done: true,
      sets: "3",
      reps: "12",
      weight: "40kg",
    },
  ],
  [
    "habit_switch_plan",
    { habitId: uuid, planId: "plan-b", date: "2026-11-15" },
    "POST",
    "/api/habits/switch-plan",
    { habitId: uuid, planId: "plan-b", date: "2026-11-15" },
  ],
  [
    "habit_negative_record",
    { habitId: uuid, date: "2026-11-15", note: "聚餐" },
    "POST",
    "/api/habits/negative/record",
    { habitId: uuid, date: "2026-11-15", note: "聚餐" },
  ],
  [
    "habit_negative_undo",
    { habitId: uuid, date: "2026-11-15" },
    "POST",
    "/api/habits/negative/undo",
    { habitId: uuid, date: "2026-11-15" },
  ],
  [
    "habit_negative_note",
    { habitId: uuid, eventId: "ev-neg-1", note: "朋友聚餐" },
    "POST",
    "/api/habits/negative/note",
    { habitId: uuid, eventId: "ev-neg-1", note: "朋友聚餐" },
  ],
  [
    "habit_daily_note",
    { habitId: uuid, date: "2026-11-15", note: "拉伸 10 分钟" },
    "POST",
    "/api/habits/daily-note",
    { habitId: uuid, date: "2026-11-15", note: "拉伸 10 分钟" },
  ],
];

test("official MCP client discovers every tool and exercises all business mappings", async () => {
  const calls: any[] = [];
  let failure: Error | undefined;
  const server = createAiServer(async (...args) => {
    calls.push(args);
    if (failure) throw failure;
    if (args[1].startsWith("/api/tasks"))
      return {
        tasks: [
          {
            ...task,
            uuid,
            due: "2026-11-12T06:00:00.000Z",
            annotations: [],
          },
        ],
      };
    return { ok: true };
  });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const list = await client.listTools();
    assert.deepEqual(
      list.tools.map((t) => t.name).sort(),
      [...new Set([...cases.map((c) => c[0]), ...compositeToolNames])].sort(),
    );
    for (const [name, args, method, path, body] of cases) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.deepEqual(
        calls.at(-1),
        body === undefined ? [method, path] : [method, path, body],
        name,
      );
      if (name === "task_get")
        assert.deepEqual(
          JSON.parse((result.content as any)[0].text).editInput,
          task,
        );
    }
    for (const [name, args] of [
      ["task_complete", { uuid: "bad" }],
      ["task_create", { task: { ...task, extra: true } }],
      ["project_delete", { name: "Work" }],
      ["backup_restore", { token: uuid }],
      ["backup_restore", { token: uuid, confirmation: "yes" }],
      ["tasks_list", { shell: "bad" }],
    ] as const) {
      const count = calls.length;
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
      assert.equal(calls.length, count);
    }
    failure = new WorkspaceError("revision conflict", 409);
    let result = await client.callTool({
      name: "energy_elixir",
      arguments: { revision: 7 },
    });
    assert.equal(JSON.parse((result.content as any)[0].text).status, 409);
    failure = new WorkspaceError("Read and check", undefined, "unknown");
    const count = calls.length;
    result = await client.callTool({
      name: "task_create",
      arguments: { task },
    });
    assert.equal(
      JSON.parse((result.content as any)[0].text).outcome,
      "unknown",
    );
    assert.equal(calls.length, count + 1);
  } finally {
    await client.close();
    await server.close();
  }
});

test("stdio process uses private socket identity; interrupted writes are never retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "amcp-"));
  const socket = join(dir, "w.sock");
  let source = "source-A";
  let writes = 0;
  const service = createServer((req, res) => {
    if (req.url === "/api/workspace") {
      res.end(
        JSON.stringify({
          identity: source,
          organization: { revision: 7 },
        }),
      );
      return;
    }
    if (req.headers["x-aster-source"] !== source) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: "source mismatch" }));
      return;
    }
    if (req.method === "POST") {
      writes++;
      req.socket.destroy();
      return;
    }
    res.end(JSON.stringify({ tasks: [{ uuid }] }));
  });
  await new Promise<void>((r) => service.listen(socket, r));
  const client = new Client({ name: "stdio-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--experimental-strip-types",
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    ],
    env: {
      ...(process.env as Record<string, string>),
      ASTER_SOCKET: socket,
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.equal(
      (await client.listTools()).tools.length,
      new Set([...cases.map((c) => c[0]), ...compositeToolNames]).size,
    );
    let result = await client.callTool({
      name: "tasks_list",
      arguments: {},
    });
    assert.ok(!result.isError);
    result = await client.callTool({
      name: "task_create",
      arguments: { task },
    });
    assert.equal(
      JSON.parse((result.content as any)[0].text).outcome,
      "unknown",
    );
    assert.equal(writes, 1);
    source = "source-B";
    result = await client.callTool({ name: "tasks_list", arguments: {} });
    assert.equal(JSON.parse((result.content as any)[0].text).status, 409);
    const direct = socketClient(socket);
    await direct("GET", "/api/tasks");
    source = "source-C";
    await assert.rejects(direct("GET", "/api/workspace"), /source changed/);
    await assert.rejects(
      connectWorkspace({ ASTER_SSH_TARGET: "-bad" }),
      /valid/,
    );
    await assert.rejects(
      connectWorkspace({
        ASTER_SSH_TARGET: "host",
        ASTER_REMOTE_SOCKET: "/tmp/x:bad",
      }),
      /absolute/,
    );
  } finally {
    await client.close();
    await new Promise<void>((r) => service.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("task_patch preserves omitted fields and planning tools build digests and multi-step plans safely", async () => {
  const now = new Date();
  const yesterdayIso = new Date(now.getTime() - 86_400_000).toISOString();
  const todayLateIso = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    0,
    0,
  ).toISOString();
  let rev = 10;
  let orgState: any = {
    revision: rev,
    projects: [
      {
        name: "Study",
        description: "C++ plan",
        status: "active",
        outcome: "Ship v1",
        nextTask: uuid,
      },
    ],
    filters: [],
    tags: [],
    board: {
      columns: [{ id: "col-1", name: "Phase 1", project: "Study" }],
      placements: [{ uuid, columnId: "col-1" }],
      order: [uuid],
    },
    subtasks: {
      [uuid2]: uuid,
      [uuid3]: "99999999-9999-4999-8999-999999999999",
    },
    descriptions: {
      [uuid]: "Parent study guide",
    },
  };
  let seq = 0;
  const calls: [string, string, any?][] = [];
  const server = createAiServer(async (method, path, body: any) => {
    calls.push(body === undefined ? [method, path] : [method, path, body]);
    if (path === "/api/workspace") {
      return {
        identity: "test",
        organization: structuredClone(orgState),
      };
    }
    if (path === "/api/tasks?scope=all") {
      return {
        tasks: [
          {
            uuid,
            description: "Parent Task",
            status: "pending",
            project: "Study",
            tags: ["cpp"],
            priority: "H",
            urgency: 12.4,
            due: yesterdayIso,
            annotations: [],
          },
          {
            uuid: uuid2,
            description: "Done Child",
            status: "completed",
            project: "Study",
            tags: [],
            urgency: 1.0,
            end: todayLateIso,
            annotations: [],
          },
          {
            uuid: uuid3,
            description: "Orphan Active Child",
            status: "pending",
            project: "Study",
            tags: [],
            urgency: 8.2,
            due: todayLateIso,
            annotations: [],
          },
          {
            uuid: "99999999-9999-4999-8999-999999999999",
            description: "Completed Parent",
            status: "completed",
            project: "Study",
            tags: [],
            urgency: 0,
            end: yesterdayIso,
            annotations: [],
          },
        ],
        projects: ["Study"],
      };
    }
    if (path.startsWith("/api/tasks?filter=uuid%3A")) {
      return {
        tasks: [
          {
            uuid,
            description: "Parent Task",
            status: "pending",
            project: "Study",
            tags: ["cpp"],
            priority: "H",
            urgency: 12.4,
            due: "2026-11-12T06:00:00.000Z",
            annotations: [],
          },
        ],
      };
    }
    if (method === "POST" && path === "/api/tasks") {
      seq++;
      return {
        ok: true,
        uuid: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${seq}`,
      };
    }
    if (method === "POST" && path === "/api/organization") {
      if (body.revision !== orgState.revision) {
        throw new WorkspaceError("conflict", 409);
      }
      rev++;
      orgState = structuredClone(orgState);
      orgState.revision = rev;
      if (body.kind === "board" && body.action === "column.save") {
        orgState.board.columns.push({
          id: "col-new",
          name: body.column.name,
          ...(body.column.project ? { project: body.column.project } : {}),
        });
      }
      if (body.kind === "project" && body.action === "save") {
        const idx = orgState.projects.findIndex(
          (p: any) => p.name === body.item.name,
        );
        if (idx >= 0)
          orgState.projects[idx] = {
            ...orgState.projects[idx],
            ...body.item,
          };
        else orgState.projects.push(body.item);
      }
      if (body.kind === "project" && body.action === "status") {
        const p = orgState.projects.find(
          (item: any) => item.name === body.name,
        );
        if (p) p.status = body.status;
      }
      return structuredClone(orgState);
    }
    return { ok: true };
  });

  const client = new Client({ name: "plan-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const emptyPatch = await client.callTool({
      name: "task_patch",
      arguments: { uuid },
    });
    assert.equal(emptyPatch.isError, true);

    const patched = await client.callTool({
      name: "task_patch",
      arguments: { uuid, priority: "M", note: "Shifted today" },
    });
    assert.ok(!patched.isError);
    assert.deepEqual(calls.at(-1), [
      "POST",
      "/api/action",
      {
        action: "edit",
        uuid,
        task: {
          description: "Parent Task",
          tags: ["cpp"],
          project: "Study",
          due: "20261112T060000Z",
          priority: "M",
          note: "Shifted today",
        },
      },
    ]);

    const digestRes = await client.callTool({
      name: "project_digest",
      arguments: { project: "Study" },
    });
    assert.ok(!digestRes.isError);
    const digest = JSON.parse((digestRes.content as any)[0].text);
    assert.equal(digest.revision, 10);
    assert.equal(digest.counts.overdue, 1);
    assert.equal(digest.counts.dueToday, 1);
    assert.ok(digest.counts.byState);
    assert.ok(Array.isArray(digest.nowList));
    assert.equal(digest.recentlyCompleted.length, 2);
    assert.equal(digest.recentlyCompleted[0].uuid, uuid2);
    assert.equal(digest.sections[0].name, "No section");
    assert.equal(digest.sections[0].tasks[0].uuid, uuid3);
    assert.equal(digest.sections[1].name, "Phase 1");
    assert.equal(
      digest.sections[1].tasks[0].taskDescription,
      "Parent study guide",
    );
    assert.deepEqual(digest.sections[1].tasks[0].subtaskProgress, {
      done: 1,
      total: 1,
    });
    assert.equal(digest.sections[1].tasks[0].isNextStep, true);

    const stalePlan = await client.callTool({
      name: "plan_apply",
      arguments: {
        revision: 9,
        tasks: [{ description: "Stale" }],
      },
    });
    assert.equal(stalePlan.isError, true);
    assert.equal(JSON.parse((stalePlan.content as any)[0].text).status, 409);

    const planRes = await client.callTool({
      name: "plan_apply",
      arguments: {
        revision: 10,
        project: { name: "Study", color: "teal", outcome: "Ship v1" },
        columns: [{ name: "Phase 1" }, { name: "Phase 2" }],
        tasks: [
          {
            description: "Build Socket Client",
            taskDescription: "## Steps\nImplement reconnect",
            columnName: "Phase 2",
            priority: "H",
            isNextStep: true,
            subtasks: [
              { description: "Define interface" },
              { description: "Write unit tests" },
            ],
          },
        ],
      },
    });
    assert.ok(!planRes.isError, JSON.stringify(planRes));
    const planOut = JSON.parse((planRes.content as any)[0].text);
    assert.equal(planOut.columns[0].created, false);
    assert.equal(planOut.columns[1].id, "col-new");
    assert.equal(planOut.columns[1].created, true);
    assert.equal(planOut.createdTasks[0].columnId, "col-new");
    assert.equal(planOut.createdTasks[0].subtaskUuids.length, 2);
    assert.equal(planOut.nextTask, planOut.createdTasks[0].uuid);

    const moveCall = calls.find(
      (c) =>
        c[1] === "/api/organization" &&
        c[2]?.kind === "board" &&
        c[2]?.action === "task.move",
    );
    assert.ok(moveCall);
    assert.equal(moveCall![2].columnId, "col-new");

    const prompts = await client.listPrompts();
    assert.deepEqual(prompts.prompts.map((p) => p.name).sort(), [
      "aster_daily_review",
      "aster_takeover_plan",
    ]);
    const promptResult = await client.getPrompt({
      name: "aster_takeover_plan",
      arguments: { project: "Study" },
    });
    assert.match(
      (promptResult.messages[0].content as { text: string }).text,
      /project_digest/,
    );
  } finally {
    await client.close();
    await server.close();
  }
});
