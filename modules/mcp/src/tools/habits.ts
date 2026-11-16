import { z } from "zod";
import { type McpToolRegistrar, uuidSchema } from "./helpers.ts";

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Calendar date in YYYY-MM-DD format within workspace timezone.");

const habitIdSchema = z
  .string()
  .min(1)
  .max(120)
  .describe("Habit ID or linked Taskwarrior taskUuid.");

const habitKindSchema = z
  .enum(["positive", "negative"])
  .describe(
    "positive: check off when done (supports subtasks/A-B workouts); negative: record only when a lapse occurs (no event by midnight = achieved).",
  );

const habitScheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }).strict(),
  z
    .object({
      type: z.literal("weekly"),
      weekdays: z
        .array(z.number().int().min(1).max(7))
        .min(1)
        .max(7)
        .describe("ISO weekdays: 1=Monday .. 7=Sunday."),
    })
    .strict(),
  z
    .object({
      type: z.literal("interval"),
      intervalDays: z.number().int().min(1).max(365),
      anchorDate: localDateSchema,
    })
    .strict(),
]);

const habitSubtaskPlansSchema = z
  .record(z.string().min(1), z.enum(["A", "B"]))
  .describe(
    "Optional map of subtask UUID -> 'A' or 'B' when abEnabled is true.",
  );

const habitTodoSubtaskSchema = z
  .object({
    title: z.string().min(1).max(2000),
    taskDescription: z.string().max(20000).optional(),
    plan: z.enum(["A", "B"]).optional(),
  })
  .strict();

function buildQuery(
  entries: Array<[string, string | number | undefined]>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Registers Habit-as-a-Todo read, bind/create, daily execution, negative tracking, and heatmap MCP tools. */
export function registerHabitTools({
  register,
  get,
  post,
}: McpToolRegistrar): void {
  register(
    "habit_today",
    "Read today's scheduled habits, their todayEvaluation (achieved status, checklist progress, negative lapse events), active A/B plan, linked taskUuid, and streak summary.",
    {},
    true,
    () => get("/api/habits/today"),
  );

  register(
    "habits_list",
    "List habits filtered by status, Taskwarrior project, or tag. Each habit stays linked 1:1 with a pending Todo taskUuid.",
    {
      status: z.enum(["active", "paused", "archived", "all"]).optional(),
      project: z.string().max(200).optional(),
      tag: z.string().max(80).optional(),
    },
    true,
    (i) =>
      get(
        `/api/habits${buildQuery([
          ["status", i.status],
          ["project", i.project],
          ["tag", i.tag],
        ])}`,
      ),
  );

  register(
    "habit_detail",
    "Inspect one habit (by habit ID or linked taskUuid): streak metrics, schedule, A/B plans/subtasks, individual heatmap, and recent daily logs.",
    {
      habitId: habitIdSchema,
      days: z.number().int().min(1).max(366).optional(),
    },
    true,
    (i) =>
      get(
        `/api/habits/detail${buildQuery([
          ["id", i.habitId],
          ["days", i.days],
        ])}`,
      ),
  );

  register(
    "habit_heatmap",
    "Read aggregate or project/tag/habit-filtered heatmap cells (distinguishing unscheduled hollow, zero neutral gray, partial not counted, and today in_progress).",
    {
      days: z.number().int().min(7).max(366).optional(),
      startDate: localDateSchema.optional(),
      endDate: localDateSchema.optional(),
      project: z.string().max(200).optional(),
      tag: z.string().max(80).optional(),
      habitId: z.string().min(1).max(120).optional(),
    },
    true,
    (i) =>
      get(
        `/api/habits/heatmap${buildQuery([
          ["days", i.days],
          ["startDate", i.startDate],
          ["endDate", i.endDate],
          ["project", i.project],
          ["tag", i.tag],
          ["habitId", i.habitId],
        ])}`,
      ),
  );

  register(
    "habit_day_detail",
    "Inspect every habit scheduled on a specific calendar date (defaults to today) with evaluation status, checklist progress, events, and daily notes for review or backfill.",
    {
      date: localDateSchema.optional(),
      project: z.string().max(200).optional(),
      tag: z.string().max(80).optional(),
      habitId: z.string().min(1).max(120).optional(),
    },
    true,
    (i) =>
      get(
        `/api/habits/day${buildQuery([
          ["date", i.date],
          ["project", i.project],
          ["tag", i.tag],
          ["habitId", i.habitId],
        ])}`,
      ),
  );

  register(
    "habit_todo_create",
    "Create a new Habit-backed Todo (pending Taskwarrior task + optional action subtasks) and immediately bind Habit rules onto it in one call. Prefer this over creating bare habits without a Todo.",
    {
      title: z.string().min(1).max(2000),
      kind: habitKindSchema,
      schedule: habitScheduleSchema,
      project: z.string().max(200).optional(),
      tags: z.array(z.string().min(1).max(80)).max(30).optional(),
      priority: z.enum(["", "H", "M", "L"]).optional(),
      taskDescription: z
        .string()
        .max(20000)
        .optional()
        .describe(
          "Optional principle or workout guide stored as Markdown description on the Todo.",
        ),
      trackTime: z
        .boolean()
        .optional()
        .describe(
          "Set true only for timed positive habits (e.g. workouts/reading). Omit/false for pure check-in and negative habits so timing UI stays hidden.",
        ),
      abEnabled: z.boolean().optional(),
      effectiveFromDate: localDateSchema.optional(),
      subtasks: z.array(habitTodoSubtaskSchema).max(50).optional(),
    },
    false,
    async (i) => {
      const parentRes = (await post("/api/tasks", {
        description: i.title,
        project: i.project || "",
        tags: i.tags || [],
        priority: i.priority || "",
        ...(i.taskDescription ? { taskDescription: i.taskDescription } : {}),
      })) as { uuid?: string };
      const taskUuid = parentRes?.uuid;
      if (!taskUuid) {
        throw new Error(
          "POST /api/tasks did not return created task uuid; check tasks_list before retrying.",
        );
      }

      const subtaskUuids: string[] = [];
      const subtaskPlans: Record<string, "A" | "B"> = {};
      for (const sub of i.subtasks || []) {
        const subRes = (await post("/api/tasks", {
          description: sub.title,
          project: i.project || "",
          tags: [],
          parentUuid: taskUuid,
          ...(sub.taskDescription
            ? { taskDescription: sub.taskDescription }
            : {}),
        })) as { uuid?: string };
        if (!subRes?.uuid) {
          throw new Error(
            `Subtask "${sub.title}" creation did not return uuid.`,
          );
        }
        subtaskUuids.push(subRes.uuid);
        if (i.abEnabled || sub.plan) {
          subtaskPlans[subRes.uuid] = sub.plan || "A";
        }
      }

      const bindRes = (await post("/api/habits/bind", {
        taskUuid,
        kind: i.kind,
        schedule: i.schedule,
        ...(i.trackTime !== undefined ? { trackTime: i.trackTime } : {}),
        ...(i.abEnabled !== undefined ? { abEnabled: i.abEnabled } : {}),
        ...(Object.keys(subtaskPlans).length ? { subtaskPlans } : {}),
        ...(i.effectiveFromDate
          ? { effectiveFromDate: i.effectiveFromDate }
          : {}),
      })) as { habit: unknown };

      return {
        ok: true,
        taskUuid,
        subtaskUuids,
        habit: bindRes.habit,
      };
    },
    false,
  );

  register(
    "habit_bind",
    "Enable or update Habit configuration on an existing pending Todo (taskUuid). Automatically syncs title, project, tags, description, and child subtasks from Taskwarrior.",
    {
      taskUuid: uuidSchema,
      kind: habitKindSchema,
      schedule: habitScheduleSchema,
      status: z.enum(["active", "paused", "archived"]).optional(),
      trackTime: z
        .boolean()
        .optional()
        .describe(
          "Set true only for timed positive habits; false/omitted disables task timing & cost panels.",
        ),
      abEnabled: z.boolean().optional(),
      subtaskPlans: habitSubtaskPlansSchema.optional(),
      effectiveFromDate: localDateSchema.optional(),
    },
    false,
    (i) => post("/api/habits/bind", i),
    false,
  );

  register(
    "habit_unbind",
    "Remove Habit configuration from a Todo while preserving the Taskwarrior task and its subtasks.",
    { taskUuid: uuidSchema },
    false,
    (i) => post("/api/habits/unbind", i),
  );

  register(
    "habit_status",
    "Pause, resume ('active'), or archive a habit while preserving historical streaks and logs.",
    {
      habitId: habitIdSchema,
      status: z.enum(["active", "paused", "archived"]),
    },
    false,
    (i) => post("/api/habits/status", i),
    false,
  );

  register(
    "habit_toggle",
    "Check or uncheck a positive habit on a date (defaults to today). Always use this instead of task_complete so the underlying Todo stays active for future days.",
    {
      habitId: habitIdSchema,
      date: localDateSchema.optional(),
      completed: z.boolean().optional(),
    },
    false,
    (i) => post("/api/habits/toggle", i),
    false,
  );

  register(
    "habit_checklist_item",
    "Toggle a checklist/workout subtask for a date (never calling task_complete on the child task) and optionally log sets, reps, or weight. Auto-completes the habit when all required items are done.",
    {
      habitId: habitIdSchema,
      itemId: z
        .string()
        .min(1)
        .max(120)
        .describe("Subtask UUID or checklist item id."),
      date: localDateSchema.optional(),
      done: z.boolean().optional(),
      sets: z.string().max(40).nullable().optional(),
      reps: z.string().max(40).nullable().optional(),
      weight: z.string().max(40).nullable().optional(),
      planId: z.string().min(1).max(80).optional(),
    },
    false,
    (i) => post("/api/habits/checklist-item", i),
    false,
  );

  register(
    "habit_switch_plan",
    "Switch the active A/B plan (e.g. 'plan-a' or 'plan-b') for an A/B checklist habit on a specific date.",
    {
      habitId: habitIdSchema,
      planId: z.string().min(1).max(80),
      date: localDateSchema.optional(),
    },
    false,
    (i) => post("/api/habits/switch-plan", i),
    false,
  );

  register(
    "habit_negative_record",
    "Record one lapse/occurrence of a negative habit on a date (defaults to today) with an optional brief context note. Negative habits succeed automatically if zero occurrences exist.",
    {
      habitId: habitIdSchema,
      date: localDateSchema.optional(),
      note: z.string().max(500).optional(),
      occurredAtMs: z.number().int().positive().optional(),
    },
    false,
    (i) => post("/api/habits/negative/record", i),
    false,
  );

  register(
    "habit_negative_undo",
    "Undo the latest (or specific eventId) recorded lapse of a negative habit on a date.",
    {
      habitId: habitIdSchema,
      date: localDateSchema.optional(),
      eventId: z.string().min(1).max(120).optional(),
    },
    false,
    (i) => post("/api/habits/negative/undo", i),
    false,
  );

  register(
    "habit_negative_note",
    "Update the context note on an existing negative habit occurrence event.",
    {
      habitId: habitIdSchema,
      eventId: z.string().min(1).max(120),
      note: z.string().max(500),
    },
    false,
    (i) => post("/api/habits/negative/note", i),
    false,
  );

  register(
    "habit_daily_note",
    "Set or clear a daily reflection note for a habit on a date (defaults to today); does not affect achievement.",
    {
      habitId: habitIdSchema,
      date: localDateSchema.optional(),
      note: z.string().max(2000),
    },
    false,
    (i) => post("/api/habits/daily-note", i),
    false,
  );
}
