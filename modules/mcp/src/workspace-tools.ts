import { z } from "zod";
import {
  colorSchema,
  type McpToolRegistrar,
  revisionSchema,
  uuidSchema,
} from "./tool-helpers.ts";

const projectSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000),
    color: colorSchema.optional(),
    outcome: z.string().max(500).optional(),
    nextTask: z.union([uuidSchema, z.literal("")]).optional(),
  })
  .strict();

const labelSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(60),
    color: colorSchema,
    favorite: z.boolean(),
  })
  .strict();

const filterSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(60),
    description: z.string().max(500),
    expression: z.string().min(1).max(1024),
    color: colorSchema,
    favorite: z.boolean(),
  })
  .strict();

/** Registers workspace organization, board, energy, recovery, and backup MCP tools. */
export function registerWorkspaceTools({
  register,
  get,
  post,
  org,
}: McpToolRegistrar): void {
  register(
    "workspace_get",
    "Read source identity, revision, project tree/Focus goals/next steps, filters, labels, board order/placements, timer availability and energy. Client themes/layout are local preferences.",
    {},
    true,
    () => get("/api/workspace"),
  );

  register(
    "project_save",
    "Create/edit project. Dot paths create hierarchy; originalName renames/moves entire branch. Set description/color/outcome/nextTask (empty clears next step). Status uses project_status. Read workspace first.",
    {
      revision: revisionSchema,
      item: projectSchema,
      originalName: z.string().max(200).optional(),
    },
    false,
    (i) => org({ kind: "project", action: "save", ...i }),
  );

  register(
    "project_delete",
    "Remove project branch metadata and move its tasks to Inbox; keeps tasks, UUIDs and completion status.",
    { revision: revisionSchema, name: z.string().min(1).max(200) },
    false,
    (i) =>
      org({
        revision: i.revision,
        kind: "project",
        action: "delete",
        item: { name: i.name, description: "" },
      }),
  );

  register(
    "project_status",
    "Activate (max 3), pause/reopen to later, or complete project without completing tasks. Activation needs outcome. replaceProject pauses one active project atomically. remaining=keep confirms keeping unfinished tasks when completing.",
    {
      revision: revisionSchema,
      name: z.string().min(1).max(200),
      status: z.enum(["active", "later", "completed"]),
      outcome: z.string().max(500).optional(),
      replaceProject: z.string().optional(),
      remaining: z.literal("keep").optional(),
    },
    false,
    (i) => org({ kind: "project", action: "status", ...i }),
  );

  for (const [name, kind, item] of [
    ["filter", "filter", filterSchema],
    ["label", "tag", labelSchema],
  ] as const) {
    register(
      `${name}_save`,
      `Create/edit ${name}, including color/favorite. New item uses id=empty string; use existing id for edits/rename. Label renames also update tasks and saved filters.`,
      { revision: revisionSchema, item },
      false,
      (i) => org({ kind, action: "save", ...i }),
    );
    register(
      `${name}_delete`,
      `Delete ${name}. Label removal keeps tasks. Pass the current item from workspace_get.`,
      { revision: revisionSchema, item },
      false,
      (i) => org({ kind, action: "delete", ...i }),
    );
  }

  register(
    "column_save",
    "Create/rename shared list group/board column. New column id is empty string.",
    {
      revision: revisionSchema,
      column: z
        .object({ id: z.string(), name: z.string().min(1).max(60) })
        .strict(),
    },
    false,
    (i) => org({ kind: "board", action: "column.save", ...i }),
  );

  register(
    "column_delete",
    "Delete column and move cards to unsectioned, retaining all tasks.",
    { revision: revisionSchema, columnId: z.string() },
    false,
    (i) => org({ kind: "board", action: "column.delete", ...i }),
  );

  register(
    "column_move",
    "Move column/group left or right.",
    {
      revision: revisionSchema,
      columnId: z.string(),
      direction: z.enum(["left", "right"]),
    },
    false,
    (i) => org({ kind: "board", action: "column.move", ...i }),
  );

  register(
    "board_task_move",
    "Move/sort task in shared list/board. columnId=unsectioned for no group; beforeUuid=null appends. Never changes completion or timer state.",
    {
      revision: revisionSchema,
      uuid: uuidSchema,
      columnId: z.string(),
      beforeUuid: uuidSchema.nullable(),
    },
    false,
    (i) => org({ kind: "board", action: "task.move", ...i }),
  );

  register(
    "energy_elixir",
    "Apply existing energy recovery (+30), subject to server rules and timer availability.",
    { revision: revisionSchema },
    false,
    (i) => org({ kind: "energy", action: "elixir", ...i }),
    false,
  );

  register(
    "recovery_list",
    "List deleted tasks and recovery snapshots.",
    {},
    true,
    () => get("/api/recovery"),
  );

  register(
    "backup_export",
    "Export full JSON backup including tasks, organization, recovery and timer history. Treat as private data.",
    {},
    true,
    () => get("/api/export"),
  );

  register("backup_points", "List server restore points.", {}, true, () =>
    get("/api/backup/points"),
  );

  register(
    "backup_download",
    "Download one restore point as JSON.",
    { id: uuidSchema },
    true,
    (i) => get("/api/backup/download?id=" + encodeURIComponent(i.id)),
  );

  register(
    "backup_preview",
    "Validate backup JSON and preview replacement scope/warnings. Returns short-lived restore token bound to current state; does not replace data.",
    { backup: z.record(z.string(), z.unknown()) },
    true,
    (i) => post("/api/backup/preview", i.backup),
  );

  register(
    "backup_restore",
    "Replace workspace using token from backup_preview after reviewing scope/warnings and explicit user confirmation. Requires confirmation=RESTORE. Saves pre-restore copy; token expires/invalidates if workspace changes. Never retry unknown result.",
    { token: uuidSchema, confirmation: z.literal("RESTORE") },
    false,
    (i) => post("/api/backup/restore", { token: i.token }),
  );
}
