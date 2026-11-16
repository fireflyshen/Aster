import { z } from "zod";
import { type McpToolRegistrar, uuidSchema } from "./helpers.ts";

export const taskStateSchema = z.enum([
  "planned",
  "doing",
  "waiting",
  "parked",
]);

export const stateDateSchema = z
  .string()
  .max(40)
  .describe(
    "Date in YYYY-MM-DD, ISO-8601, or UTC YYYYMMDDTHHmmssZ; empty string clears when supported.",
  );

/** Registers task state machine read and transition MCP tools. */
export function registerStateTools({
  register,
  get,
  post,
}: McpToolRegistrar): void {
  register(
    "task_state_set",
    "Transition an open top-level non-habit task between planned, doing (up to configured limit, default 5), waiting (requires waitReason + checkDate), and parked (default +30d checkDate). On 409 STATE_DOING_LIMIT, ask the user or Cadence which doing task to return to planned and retry with replaceUuid.",
    {
      uuid: uuidSchema,
      state: taskStateSchema,
      waitReason: z.string().min(1).max(200).optional(),
      checkDate: stateDateSchema.optional(),
      scheduled: stateDateSchema.optional(),
      replaceUuid: uuidSchema.optional(),
    },
    false,
    (i) => post("/api/action", { action: "state.set", ...i }),
  );

  register(
    "task_schedule",
    "Set or clear the scheduled date on a planned top-level non-habit task without changing its state.",
    {
      uuid: uuidSchema,
      scheduled: stateDateSchema,
    },
    false,
    (i) => post("/api/action", { action: "schedule", ...i }),
  );

  register(
    "task_depends",
    "Add or remove UUID dependencies on a task while guarding against cycles.",
    {
      uuid: uuidSchema,
      add: z.array(uuidSchema).max(50).optional(),
      remove: z.array(uuidSchema).max(50).optional(),
    },
    false,
    (i) => post("/api/action", { action: "depends", ...i }),
  );

  register(
    "state_summary",
    "Read task state counts, doing list and active doing limit, upcoming scheduled tasks, waitingDue, parkedReviewDue, promotionBlocked, and anomalies.",
    {},
    true,
    () => get("/api/state/summary"),
  );

  register(
    "state_limit_set",
    "Update the configurable max number of simultaneous doing tasks in the 'Now' view (1-20, default 5). Persisted in shared workspace preferences.",
    {
      doingLimit: z.number().int().min(1).max(20),
    },
    false,
    (i) => post("/api/preferences", { doingLimit: i.doingLimit }),
  );

  register(
    "state_history",
    "Read append-only task state transition audit history, optionally filtered by task uuid and limit.",
    {
      uuid: uuidSchema.optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    true,
    (i) => {
      const qs = new URLSearchParams();
      if (i.uuid) qs.set("uuid", i.uuid);
      if (i.limit !== undefined) qs.set("limit", String(i.limit));
      const query = qs.toString();
      return get("/api/state/history" + (query ? `?${query}` : ""));
    },
  );
}
