import { z } from "zod";
import {
  dateSchema,
  type McpToolRegistrar,
  uuidSchema,
} from "./tool-helpers.ts";

const taskSchema = z
  .object({
    description: z.string().min(1).max(2000),
    tags: z.array(z.string().min(1).max(80)).max(30),
    project: z.string().max(200).optional(),
    due: dateSchema.optional(),
    priority: z.enum(["", "H", "M", "L"]).optional(),
    recur: z.string().max(200).optional(),
    until: dateSchema.optional(),
    note: z.string().max(8000).optional(),
  })
  .strict();

const taskCreateSchema = taskSchema
  .extend({
    parentUuid: uuidSchema.optional(),
    taskDescription: z.string().max(20000).optional(),
  })
  .strict();

const taskPatchSchema = z
  .object({
    uuid: uuidSchema,
    description: z.string().min(1).max(2000).optional(),
    tags: z.array(z.string().min(1).max(80)).max(30).optional(),
    project: z.string().max(200).optional(),
    due: dateSchema.optional(),
    priority: z.enum(["", "H", "M", "L"]).optional(),
    recur: z.string().max(200).optional(),
    until: dateSchema.optional(),
    note: z.string().max(8000).optional(),
  })
  .strict();

const TASK_ACTION_DESCRIPTIONS: Record<string, string> = {
  complete: "Complete task",
  reopen: "Reopen completed task",
  start: "Start timer, subject to energy and timer availability",
  stop: "Stop timer",
  delete: "Soft delete with recovery snapshot",
  restore: "Restore deleted task from recovery",
};

function compactIsoDate(value: string | undefined): string {
  return value
    ? new Date(value)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z")
    : "";
}

function buildEditInput(found: any) {
  return {
    description: found.description,
    tags: found.tags,
    project: found.project || "",
    due: compactIsoDate(found.due),
    priority: found.priority || "",
    ...(found.recur !== undefined ? { recur: found.recur } : {}),
    ...(found.until !== undefined
      ? { until: compactIsoDate(found.until) }
      : {}),
  };
}

async function fetchTaskByUuid(
  get: McpToolRegistrar["get"],
  uuid: string,
): Promise<any> {
  const result = await get(
    "/api/tasks?filter=" + encodeURIComponent("uuid:" + uuid),
  );
  const found = result.tasks.find((t: any) => t.uuid === uuid);
  if (!found) {
    throw new Error("Task not found. Deleted tasks use recovery_list.");
  }
  return found;
}

/** Registers Taskwarrior task and recurrence MCP tools. */
export function registerTaskTools({
  register,
  get,
  post,
}: McpToolRegistrar): void {
  register(
    "tasks_list",
    "Read tasks. Default includes unfinished and completed. Use safe Taskwarrior filter for due dates, status, project trees, labels or search. Deleted tasks use recovery_list.",
    { filter: z.string().min(1).max(1024).optional() },
    true,
    (i) =>
      get(
        "/api/tasks" +
          (i.filter === undefined
            ? ""
            : "?filter=" + encodeURIComponent(i.filter)),
      ),
  );

  register(
    "task_get",
    "Read a task by UUID before editing; returns fields, annotations and editInput with compact UTC dates ready for task_edit. Modify only intended editInput fields; note appends.",
    { uuid: uuidSchema },
    true,
    async (i) => {
      const found = await fetchTaskByUuid(get, i.uuid);
      return {
        ...found,
        editInput: buildEditInput(found),
      };
    },
  );

  register(
    "quick_preview",
    "Parse one-line capture (Chinese/English dates, #project, @labels, p1-p4) in SERVER timezone. Review errors and task fields before task_create; does not write.",
    { text: z.string().max(4000) },
    true,
    (i) => post("/api/quick/preview", i),
  );

  register(
    "task_create",
    "Create task with optional repeat rule, initial note, parentUuid (subtask link) and rich Markdown taskDescription. Dates compact UTC. Read tasks after success; never retry unknown results.",
    { task: taskCreateSchema },
    false,
    (i) => post("/api/tasks", i.task),
    false,
  );

  register(
    "task_edit",
    "Full field edit: first task_get and preserve description/tags/project/due/priority; omitted project/due/priority clear them. Omitted recur/until preserve rules. note APPENDS a note; existing annotations are preserved.",
    { uuid: uuidSchema, task: taskSchema },
    false,
    (i) => post("/api/action", { action: "edit", ...i }),
  );

  register(
    "task_patch",
    "Partially update selected fields (e.g. reschedule due, priority, tags, project, or append note) without clearing omitted fields. Fetches current task first; never auto-retries unknown results.",
    taskPatchSchema.shape,
    false,
    async (i) => {
      const { uuid, ...patch } = i;
      if (Object.values(patch).every((value) => value === undefined)) {
        throw new Error("Provide at least one field to update.");
      }
      const found = await fetchTaskByUuid(get, uuid);
      const base = buildEditInput(found);
      const next = {
        ...base,
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.project !== undefined ? { project: patch.project } : {}),
        ...(patch.due !== undefined ? { due: patch.due } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.recur !== undefined ? { recur: patch.recur } : {}),
        ...(patch.until !== undefined ? { until: patch.until } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      };
      return post("/api/action", { action: "edit", uuid, task: next });
    },
  );

  for (const [action, summary] of Object.entries(TASK_ACTION_DESCRIPTIONS)) {
    register(
      `task_${action}`,
      `${summary}. Uses task UUID; does not change board column.`,
      { uuid: uuidSchema },
      false,
      (i) => post("/api/action", { action, ...i }),
    );
  }

  register(
    "task_wait",
    "Set waiting date, or empty string to clear waiting.",
    { uuid: uuidSchema, wait: dateSchema },
    false,
    (i) => post("/api/action", { action: "wait", ...i }),
  );

  register(
    "task_note_remove",
    "Remove the exact annotation identified by entry and description from task_get.",
    { uuid: uuidSchema, entry: z.string(), description: z.string() },
    false,
    (i) => post("/api/action", { action: "note.remove", ...i }),
  );

  register(
    "recurrence_get",
    "Read recurring parent by its UUID (occurrence parent field).",
    { uuid: uuidSchema },
    true,
    (i) => get("/api/recurrence?uuid=" + encodeURIComponent(i.uuid)),
  );

  register(
    "recurrence_edit",
    "Edit recurring parent rule/ends date. Empty recur stops series while preserving existing occurrences; read recurrence_get first.",
    { uuid: uuidSchema, recur: z.string().max(200), until: dateSchema },
    false,
    (i) => post("/api/action", { action: "recurrence.edit", ...i }),
  );
}
