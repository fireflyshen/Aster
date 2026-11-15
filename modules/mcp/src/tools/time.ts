import { z } from "zod";
import {
  idempotencyKeySchema,
  type McpToolRegistrar,
  resolveIdempotencyKey,
  uuidSchema,
} from "./helpers.ts";

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Calendar date in YYYY-MM-DD format within Time policy timezone.");

const localClockSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .describe("Wall-clock time HH:mm in policy timezone.");

const positiveVersionSchema = z.number().int().positive();

const activitySourceSchema = z.enum([
  "manual",
  "bot",
  "mcp",
  "task_bridge",
  "timewarrior_import",
  "sleep_template",
]);

/** Registers Aster Time Ledger & reconciliation MCP tools. */
export function registerTimeTools({
  register,
  get,
  post,
}: McpToolRegistrar): void {
  register(
    "time_status",
    "Read Time engine state, active running activity, cutover metadata, policy, and unresolved pending operation count.",
    {},
    true,
    () => get("/api/time/status"),
  );

  register(
    "time_start",
    "Start a Time activity (either task-linked, standalone, or linked to a TimingPlan). Automatically closes any previous running activity unless sameTaskNoop is true.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      title: z.string().min(1).max(500).optional(),
      timingPlanId: z.string().min(1).max(64).optional(),
      explicitCategoryId: z.string().min(1).max(100).optional(),
      taskUuid: uuidSchema.optional(),
      projectSnapshot: z.string().max(200).optional(),
      tags: z.array(z.string().min(1).max(80)).max(50).optional(),
      source: activitySourceSchema.optional(),
      note: z.string().max(2000).optional(),
      rawInput: z.string().max(2000).optional(),
      sameTaskNoop: z.boolean().optional(),
      expectedSessionVersion: z.number().int().nonnegative().optional(),
      effectiveAtMs: z.number().int().positive().optional(),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) => {
      if (!i.title && !i.taskUuid && !i.timingPlanId) {
        throw new Error("Provide title, taskUuid, or timingPlanId.");
      }
      return post("/api/time/start", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-start"),
        source: i.source || "bot",
      });
    },
    false,
  );

  register(
    "time_stop",
    "Stop or pause the currently active Time activity, returning a versioned receipt (with updated TimingPlan quota when linked).",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      expectedActivityId: z.string().min(1).max(64).optional(),
      expectedVersion: positiveVersionSchema.optional(),
      expectedSessionVersion: z.number().int().nonnegative().optional(),
      pause: z.boolean().optional(),
      effectiveAtMs: z.number().int().positive().optional(),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/stop", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-stop"),
      }),
    false,
  );

  register(
    "time_log",
    "Log a retroactive located activity interval [startMs, endMs). Use precision='estimated_bounds' when boundaries are approximate.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      title: z.string().min(1).max(500),
      startMs: z.number().int().positive(),
      endMs: z.number().int().positive(),
      explicitCategoryId: z.string().min(1).max(100).optional(),
      taskUuid: uuidSchema.optional(),
      projectSnapshot: z.string().max(200).optional(),
      tags: z.array(z.string().min(1).max(80)).max(50).optional(),
      precision: z
        .enum(["exact", "estimated_bounds", "approximate"])
        .optional(),
      source: activitySourceSchema.optional(),
      note: z.string().max(2000).optional(),
      rawInput: z.string().max(2000).optional(),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/log", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-log"),
        source: i.source || "bot",
      }),
    false,
  );

  register(
    "time_estimate",
    "Record a rough/unlocated time estimate without fabricating fake clock boundaries (keeps covered + unrecorded = total intact).",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      title: z.string().min(1).max(500),
      estimatedSeconds: z.number().int().positive(),
      targetDate: localDateSchema.optional(),
      windowStartMs: z.number().int().positive().optional(),
      windowEndMs: z.number().int().positive().optional(),
      explicitCategoryId: z.string().min(1).max(100).optional(),
      taskUuid: uuidSchema.optional(),
      projectSnapshot: z.string().max(200).optional(),
      tags: z.array(z.string().min(1).max(80)).max(50).optional(),
      source: activitySourceSchema.optional(),
      note: z.string().max(2000).optional(),
      rawInput: z.string().max(2000).optional(),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/estimate", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-est"),
        source: i.source || "bot",
      }),
    false,
  );

  register(
    "time_locate",
    "Convert an unlocated estimate into a located interval [startMs, endMs) atomically with optimistic expectedVersion.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      activityId: z.string().min(1).max(64),
      expectedVersion: positiveVersionSchema,
      startMs: z.number().int().positive(),
      endMs: z.number().int().positive(),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/locate", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-locate"),
      }),
    false,
  );

  register(
    "time_update",
    "Update an existing Time activity using expectedVersion optimistic locking (returns 409 on conflict without silent overwrite).",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      activityId: z.string().min(1).max(64),
      expectedVersion: positiveVersionSchema,
      receivedAtMs: z.number().int().positive().optional(),
      patch: z
        .object({
          title: z.string().min(1).max(500).optional(),
          categoryId: z.string().min(1).max(100).optional(),
          projectSnapshot: z.string().max(200).nullable().optional(),
          tags: z
            .array(z.string().min(1).max(80))
            .max(50)
            .nullable()
            .optional(),
          note: z.string().max(2000).nullable().optional(),
          clearTaskLink: z.boolean().optional(),
          precision: z.enum(["exact", "estimated_bounds"]).optional(),
          startMs: z.number().int().positive().optional(),
          endMs: z.number().int().positive().optional(),
          confirmReview: z.boolean().optional(),
          estimatedSeconds: z.number().int().positive().optional(),
          targetDate: localDateSchema.optional(),
          windowStartMs: z.number().int().positive().nullable().optional(),
          windowEndMs: z.number().int().positive().nullable().optional(),
        })
        .strict(),
    },
    false,
    (i) =>
      post("/api/time/update", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-update"),
      }),
  );

  register(
    "time_undo",
    "Undo a previous Time operation by targetOperationId.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      targetOperationId: z.string().min(1).max(64),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/undo", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-undo"),
      }),
  );

  register(
    "time_daily",
    "Read daily timeline ledger (C + U = T, located segments, gaps, unlocated estimates, sleep candidates).",
    { date: localDateSchema.optional() },
    true,
    (i) =>
      get(
        "/api/time/daily" +
          (i.date ? "?date=" + encodeURIComponent(i.date) : ""),
      ),
  );

  register(
    "time_weekly",
    "Read weekly time distribution summary (isPartialWeek, C + U = T coverage, category totals, daily breakdowns).",
    {
      weekStart: localDateSchema.optional(),
      date: localDateSchema.optional(),
    },
    true,
    (i) => {
      const qs = i.weekStart
        ? `?weekStart=${encodeURIComponent(i.weekStart)}`
        : i.date
          ? `?date=${encodeURIComponent(i.date)}`
          : "";
      return get("/api/time/weekly" + qs);
    },
  );

  register(
    "time_reconcile_digest",
    "Read compact evening reconciliation summary for bots: gaps, review-required segments, unlocated estimates, sleep candidates, and unresolved ops.",
    { date: localDateSchema.optional() },
    true,
    (i) =>
      get(
        "/api/time/reconcile-digest" +
          (i.date ? "?date=" + encodeURIComponent(i.date) : ""),
      ),
  );

  register(
    "time_sleep_confirm",
    "Confirm today's sleep candidate ('睡眠照常') atomically; fails with conflict if overlapping existing logs.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      date: localDateSchema,
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/sleep/confirm", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-sleep-ok"),
      }),
    false,
  );

  register(
    "time_sleep_dismiss",
    "Dismiss today's sleep candidate without creating a log and without nagging.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      date: localDateSchema,
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/sleep/dismiss", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(
          i.idempotencyKey,
          "mcp-sleep-skip",
        ),
      }),
    false,
  );

  register(
    "time_policy_get",
    "Read current Time policy (IANA timezone, categories, auto-classification rules, sleep template, policyVersion).",
    {},
    true,
    () => get("/api/time/policy"),
  );

  register(
    "time_policy_update",
    "Update Time policy using optimistic expectedPolicyVersion.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      expectedPolicyVersion: positiveVersionSchema,
      receivedAtMs: z.number().int().positive().optional(),
      patch: z
        .object({
          timezone: z.string().min(1).max(100).optional(),
          longActivityThresholdSeconds: z.number().int().positive().optional(),
          hourlyRateCents: z.number().int().nonnegative().optional(),
          taskListHighlightCost: z.boolean().optional(),
          categories: z
            .array(
              z
                .object({
                  id: z.string().min(1).max(100),
                  name: z.string().min(1).max(100),
                  color: z.string().max(40).optional(),
                })
                .strict(),
            )
            .optional(),
          projectRules: z
            .array(
              z
                .object({
                  pattern: z.string().min(1).max(200),
                  categoryId: z.string().min(1).max(100),
                })
                .strict(),
            )
            .optional(),
          tagRules: z
            .array(
              z
                .object({
                  tag: z.string().min(1).max(80),
                  categoryId: z.string().min(1).max(100),
                  priority: z.number().int(),
                })
                .strict(),
            )
            .optional(),
          taskOverrides: z.record(uuidSchema, z.string().min(1)).optional(),
          sleepTemplate: z
            .object({
              enabled: z.boolean(),
              startTime: localClockSchema,
              endTime: localClockSchema,
              version: positiveVersionSchema.optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    },
    false,
    (i) =>
      post("/api/time/policy", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-policy"),
      }),
  );

  register(
    "operation_get",
    "Inspect a Time or coordinated operation by operationId or idempotencyKey before deciding whether to retry or resolve.",
    { id: z.string().min(1).max(200) },
    true,
    (i) => get("/api/time/operation?id=" + encodeURIComponent(i.id)),
  );

  register(
    "time_operation_resolve",
    "Explicitly resolve a pending_reconcile coordinated operation after checking operation_get.",
    {
      operationId: z.string().min(1).max(64),
      action: z.enum(["dismiss", "accept_started", "stop_active"]),
      effectiveAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) => post("/api/time/operation/resolve", i),
  );

  register(
    "time_confirm",
    "Confirm an auto-stopped segment or an uncapped running activity checkpoint up to throughMs, moving verified time from provisional into formal totals.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      activityId: z.string().min(1).max(64),
      expectedVersion: positiveVersionSchema,
      throughMs: z.number().int().positive().optional(),
      nextCheckpointSeconds: z.number().int().positive().optional(),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/confirm", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-confirm"),
      }),
    false,
  );

  register(
    "time_plan_create",
    "Create a manual-start, auto-stop TimingPlan (never auto-starts at plannedStartAt). Enforces min(actualStart + remaining, hardStopAt).",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      title: z.string().min(1).max(500),
      categoryId: z.string().min(1).max(100).optional(),
      taskUuid: uuidSchema.optional(),
      projectSnapshot: z.string().max(200).optional(),
      tags: z.array(z.string().min(1).max(80)).max(50).optional(),
      note: z.string().max(2000).optional(),
      allowanceSeconds: z.number().int().positive().optional(),
      allowanceMinutes: z.number().positive().optional(),
      plannedStartAtMs: z.number().int().positive().optional(),
      plannedStartDate: localDateSchema.optional(),
      plannedStartTime: localClockSchema.optional(),
      hardStopAtMs: z.number().int().positive().optional(),
      hardStopDate: localDateSchema.optional(),
      hardStopTime: localClockSchema.optional(),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/plans/create", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-plan-new"),
      }),
    false,
  );

  register(
    "time_plan_list",
    "List TimingPlans with consumed/remaining quota and computed status (scheduled, active, paused, stopped, expired, archived).",
    {
      includeArchived: z.boolean().optional(),
      taskUuid: uuidSchema.optional(),
    },
    true,
    (i) => {
      const params = new URLSearchParams();
      if (i.includeArchived) params.set("includeArchived", "1");
      if (i.taskUuid) params.set("taskUuid", i.taskUuid);
      const qs = params.toString() ? "?" + params.toString() : "";
      return get("/api/time/plans" + qs);
    },
  );

  register(
    "time_plan_update",
    "Update, extend (+addAllowanceSeconds / +addAllowanceMinutes), reschedule hardStopAt, or archive a TimingPlan with version checks.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      planId: z.string().min(1).max(64),
      expectedVersion: positiveVersionSchema,
      expectedSessionVersion: z.number().int().nonnegative().optional(),
      expectedActivityId: z.string().min(1).max(64).optional(),
      expectedActivityVersion: positiveVersionSchema.optional(),
      title: z.string().min(1).max(500).optional(),
      categoryId: z.string().min(1).max(100).nullable().optional(),
      taskUuid: uuidSchema.nullable().optional(),
      projectSnapshot: z.string().max(200).nullable().optional(),
      tags: z.array(z.string().min(1).max(80)).max(50).nullable().optional(),
      note: z.string().max(2000).nullable().optional(),
      allowanceSeconds: z.number().int().positive().nullable().optional(),
      allowanceMinutes: z.number().positive().nullable().optional(),
      addAllowanceSeconds: z.number().int().positive().optional(),
      addAllowanceMinutes: z.number().positive().optional(),
      plannedStartAtMs: z.number().int().positive().nullable().optional(),
      plannedStartDate: localDateSchema.optional(),
      plannedStartTime: localClockSchema.nullable().optional(),
      hardStopAtMs: z.number().int().positive().nullable().optional(),
      hardStopDate: localDateSchema.optional(),
      hardStopTime: localClockSchema.nullable().optional(),
      archived: z.boolean().optional(),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/plans/update", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(i.idempotencyKey, "mcp-plan-upd"),
      }),
    false,
  );

  register(
    "time_plan_start",
    "Manually start or resume an existing TimingPlan. Returns 409 TIMING_PLAN_EXPIRED if past hardStopAt or 409 TIME_ALLOWANCE_EXHAUSTED if quota is 0.",
    {
      idempotencyKey: idempotencyKeySchema.optional(),
      planId: z.string().min(1).max(64),
      sameTaskNoop: z.boolean().optional(),
      expectedSessionVersion: z.number().int().nonnegative().optional(),
      effectiveAtMs: z.number().int().positive().optional(),
      receivedAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) =>
      post("/api/time/plans/start", {
        ...i,
        idempotencyKey: resolveIdempotencyKey(
          i.idempotencyKey,
          "mcp-plan-start",
        ),
      }),
    false,
  );

  register(
    "time_events_list",
    "List Time notification events (auto_stopped, checkpoint_due) generated by server-side deadline/checkpoint settlement.",
    {
      includeAcknowledged: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    true,
    (i) => {
      const params = new URLSearchParams();
      if (i.includeAcknowledged) params.set("includeAcknowledged", "1");
      if (i.limit !== undefined) params.set("limit", String(i.limit));
      const qs = params.toString() ? "?" + params.toString() : "";
      return get("/api/time/events" + qs);
    },
  );

  register(
    "time_events_ack",
    "Mark one or more Time notification events as acknowledged.",
    {
      eventIds: z.array(z.string().min(1).max(128)).min(1).max(100),
    },
    false,
    (i) => post("/api/time/events/ack", { eventIds: i.eventIds }),
  );

  register(
    "time_task_detail",
    "Read a task's time cost summary (confirmed vs provisional cost, initial vs added/current budget, overrun), time segments, TimingPlans, and linked read-only Bills expenses.",
    {
      taskUuid: uuidSchema,
    },
    true,
    (i) =>
      get("/api/time/task-detail?taskUuid=" + encodeURIComponent(i.taskUuid)),
  );

  register(
    "time_task_budget_set",
    "Set, add to (preserving initial budget), or clear a task's time budget in seconds/schedule boundaries; monetary budget is derived automatically from policy hourlyRateCents.",
    {
      taskUuid: uuidSchema,
      mode: z.enum(["set", "add", "clear"]).optional(),
      allowanceSeconds: z.number().int().positive().nullable().optional(),
      addAllowanceSeconds: z.number().int().positive().optional(),
      plannedStartAtMs: z.number().int().positive().nullable().optional(),
      plannedStartDate: localDateSchema.optional(),
      plannedStartTime: localClockSchema.nullable().optional(),
      hardStopAtMs: z.number().int().positive().nullable().optional(),
      hardStopDate: localDateSchema.optional(),
      hardStopTime: localClockSchema.nullable().optional(),
    },
    false,
    (i) => post("/api/time/task-budget", i),
  );

  register(
    "time_cost_report",
    "Generate a weekly or monthly Time Cost Report grouped by Project and Task, sorted by highest_cost or highest_over_budget (with provisional costs kept separate).",
    {
      granularity: z.enum(["week", "month"]),
      date: localDateSchema.optional(),
      sortBy: z.enum(["highest_cost", "highest_over_budget"]).optional(),
    },
    true,
    (i) => {
      const params = new URLSearchParams();
      params.set("granularity", i.granularity);
      if (i.date) params.set("date", i.date);
      if (i.sortBy) params.set("sortBy", i.sortBy);
      return get("/api/time/cost-report?" + params.toString());
    },
  );

  register(
    "time_bills_expenses",
    "Read-only query of cash expense entries from the sibling Bills ledger for optional association with tasks or activities.",
    {
      q: z.string().max(200).optional(),
      fromDate: localDateSchema.optional(),
      toDate: localDateSchema.optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    true,
    (i) => {
      const params = new URLSearchParams();
      if (i.q) params.set("q", i.q);
      if (i.fromDate) params.set("fromDate", i.fromDate);
      if (i.toDate) params.set("toDate", i.toDate);
      if (i.limit !== undefined) params.set("limit", String(i.limit));
      const qs = params.toString() ? "?" + params.toString() : "";
      return get("/api/time/bills/expenses" + qs);
    },
  );

  register(
    "time_bills_link",
    "Associate a read-only Bills cash expense with an Aster task or time activity (never writes to Bills).",
    {
      txKey: z.string().min(1).max(200),
      taskUuid: uuidSchema.optional(),
      activityId: z.string().min(1).max(64).optional(),
      source: z.string().min(1).max(100),
      txId: z.string().min(1).max(200),
      payTime: z.string().min(1).max(64),
      payee: z.string().max(300).optional(),
      narration: z.string().max(500).optional(),
      account: z.string().min(1).max(200),
      currency: z.string().min(1).max(16).optional(),
      amount: z.number(),
      cnyAmountCents: z.number().int(),
      note: z.string().max(500).optional(),
    },
    false,
    (i) => post("/api/time/bills/link", i),
  );

  register(
    "time_bills_unlink",
    "Remove a Bills expense link stored in Aster Time ledger.",
    {
      linkId: z.string().min(1).max(64),
    },
    false,
    (i) => post("/api/time/bills/unlink", { linkId: i.linkId }),
  );
}
