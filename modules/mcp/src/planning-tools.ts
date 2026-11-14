import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  compareTasksByUrgency,
  hydrateTaskwarriorTasks,
  taskGroup,
  type TaskwarriorTask,
} from "../../core/tasks/model.ts";
import {
  defaultBoard,
  inheritSubtaskColumns,
  taskColumnId,
  UNSECTIONED,
  unsectionedColumn,
  type BoardColumn,
} from "../../core/workspace/board.ts";
import { inProject, projectStatus } from "../../core/workspace/focus.ts";
import type {
  Organization,
  SavedProject,
} from "../../core/workspace/organization.ts";
import { buildSubtaskMeta } from "../../core/workspace/subtasks.ts";
import {
  colorSchema,
  dateSchema,
  type McpToolRegistrar,
  revisionSchema,
  uuidSchema,
} from "./tool-helpers.ts";
import { WorkspaceError } from "./transport.ts";

const planSubtaskSchema = z
  .object({
    description: z.string().min(1).max(2000),
    taskDescription: z.string().max(20000).optional(),
    due: dateSchema.optional(),
    priority: z.enum(["", "H", "M", "L"]).optional(),
    tags: z.array(z.string().min(1).max(80)).max(30).optional(),
    wait: dateSchema.optional(),
    note: z.string().max(8000).optional(),
  })
  .strict();

const planTaskSchema = z
  .object({
    description: z.string().min(1).max(2000),
    taskDescription: z.string().max(20000).optional(),
    project: z.string().max(200).optional(),
    columnName: z.string().max(60).optional(),
    columnId: z.string().optional(),
    due: dateSchema.optional(),
    priority: z.enum(["", "H", "M", "L"]).optional(),
    tags: z.array(z.string().min(1).max(80)).max(30).optional(),
    wait: dateSchema.optional(),
    recur: z.string().max(200).optional(),
    until: dateSchema.optional(),
    note: z.string().max(8000).optional(),
    isNextStep: z.boolean().optional(),
    subtasks: z.array(planSubtaskSchema).max(50).optional(),
  })
  .strict();

const planProjectSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    color: colorSchema.optional(),
    status: z.enum(["active", "later", "completed"]).optional(),
    outcome: z.string().max(500).optional(),
    replaceProject: z.string().min(1).max(200).optional(),
  })
  .strict();

const planColumnSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1).max(60),
  })
  .strict();

interface DigestTaskNode {
  uuid: string;
  description: string;
  status: string;
  project?: string;
  priority?: string;
  urgency: number;
  due?: string;
  wait?: string;
  end?: string;
  tags: string[];
  isNextStep?: boolean;
  taskDescription?: string;
  parentUuid?: string;
  subtaskProgress?: { done: number; total: number };
  subtasks?: DigestTaskNode[];
}

function toDigestNode(
  task: TaskwarriorTask,
  org: Organization,
  nextStepUuids: ReadonlySet<string>,
  childrenOf: Map<string, TaskwarriorTask[]>,
  stats: Record<string, { done: number; total: number }>,
  parentOf: Record<string, string>,
  includeSubtasks = false,
): DigestTaskNode {
  const children = childrenOf.get(task.uuid) || [];
  const taskDescription = org.descriptions?.[task.uuid];
  const node: DigestTaskNode = {
    uuid: task.uuid,
    description: task.description,
    status: task.status,
    ...(task.project ? { project: task.project } : {}),
    ...(task.priority ? { priority: task.priority } : {}),
    urgency: Number(task.urgency.toFixed(2)),
    ...(task.due ? { due: task.due.toISOString() } : {}),
    ...(task.wait ? { wait: task.wait.toISOString() } : {}),
    ...(task.end ? { end: task.end.toISOString() } : {}),
    tags: task.tags,
    ...(nextStepUuids.has(task.uuid) ? { isNextStep: true } : {}),
    ...(taskDescription ? { taskDescription } : {}),
    ...(parentOf[task.uuid] ? { parentUuid: parentOf[task.uuid] } : {}),
  };
  if (stats[task.uuid]) node.subtaskProgress = stats[task.uuid];
  if (includeSubtasks && children.length > 0) {
    node.subtasks = children.map((child) =>
      toDigestNode(
        child,
        org,
        nextStepUuids,
        childrenOf,
        stats,
        parentOf,
        true,
      ),
    );
  }
  return node;
}

function findColumnByName(
  columns: BoardColumn[],
  name: string,
  targetProject: string,
): BoardColumn | undefined {
  const normalized = name.trim().toLocaleLowerCase();
  return (
    columns.find(
      (column) =>
        (column.project || "") === targetProject &&
        column.name.toLocaleLowerCase() === normalized,
    ) ||
    columns.find((column) => column.name.toLocaleLowerCase() === normalized)
  );
}

/** Registers high-leverage read/plan MCP tools for AI project takeover and progress tracking. */
export function registerPlanningTools({
  register,
  get,
  post,
  org,
}: McpToolRegistrar): void {
  register(
    "project_digest",
    "Read a structured progress and planning snapshot in one call (revision, projects, board sections, nested subtasks, taskDescriptions, urgency ranking, overdue/today counts, and recently completed tasks).",
    {
      project: z.string().max(200).optional(),
      includeCompletedDays: z.number().int().min(0).max(90).optional(),
    },
    true,
    async (i) => {
      const [workspace, taskPayload] = await Promise.all([
        get("/api/workspace"),
        get("/api/tasks?scope=all"),
      ]);
      const organization = workspace.organization as Organization;
      const now = new Date();
      const scopeProject = i.project?.trim() || "";
      const completedDays = i.includeCompletedDays ?? 7;
      const completedCutoff =
        completedDays > 0
          ? new Date(now.getTime() - completedDays * 86_400_000)
          : undefined;

      const allTasks = hydrateTaskwarriorTasks(
        Array.isArray(taskPayload.tasks) ? taskPayload.tasks : [],
      );
      const scopedTasks = scopeProject
        ? allTasks.filter((task) => inProject(task.project, scopeProject))
        : allTasks;

      const openTasks = scopedTasks.filter(
        (task) => task.status === "pending" || task.status === "waiting",
      );
      const completedTasks = scopedTasks.filter(
        (task) => task.status === "completed",
      );
      const recentlyCompleted = (
        completedCutoff
          ? completedTasks.filter(
              (task) => task.end && task.end >= completedCutoff,
            )
          : []
      ).sort(
        (a, b) => (b.end?.getTime() ?? 0) - (a.end?.getTime() ?? 0),
      );

      const projects = (organization.projects || []).filter(
        (project) => !scopeProject || inProject(project.name, scopeProject),
      );
      const nextStepUuids = new Set(
        projects.flatMap((project) =>
          project.nextTask ? [project.nextTask] : [],
        ),
      );
      const meta = buildSubtaskMeta(scopedTasks, organization);
      const board = inheritSubtaskColumns(
        organization.board || defaultBoard(),
        scopedTasks,
        organization.subtasks || {},
      );
      const scopedColumns = board.columns.filter((column) =>
        scopeProject
          ? (column.project || "") === scopeProject || !column.project
          : true,
      );
      const columns = [unsectionedColumn, ...scopedColumns];

      const openTaskUuids = new Set(openTasks.map((task) => task.uuid));
      const openRoots = openTasks.filter((task) => {
        const parentUuid = meta.parentOf[task.uuid];
        return !parentUuid || !openTaskUuids.has(parentUuid);
      });
      const orderIndex = new Map(
        board.order.map((uuid, index) => [uuid, index]),
      );
      const groupedByColumn = new Map<string, TaskwarriorTask[]>();
      for (const column of columns) groupedByColumn.set(column.id, []);
      for (const task of openRoots) {
        const colId = taskColumnId(task, board);
        const list = groupedByColumn.get(colId) || groupedByColumn.get(UNSECTIONED);
        list?.push(task);
      }

      const sections = columns
        .map((column) => {
          const items = [...(groupedByColumn.get(column.id) || [])].sort(
            (a, b) =>
              (orderIndex.get(a.uuid) ?? Infinity) -
              (orderIndex.get(b.uuid) ?? Infinity),
          );
          return {
            id: column.id,
            name: column.name,
            ...(column.project ? { project: column.project } : {}),
            tasks: items.map((task) =>
              toDigestNode(
                task,
                organization,
                nextStepUuids,
                meta.childrenOf,
                meta.stats,
                meta.parentOf,
                true,
              ),
            ),
          };
        })
        .filter((section) => section.tasks.length > 0);

      const overdue = openTasks
        .filter((task) => taskGroup(task, now) === "overdue")
        .sort(compareTasksByUrgency);
      const dueToday = openTasks
        .filter((task) => taskGroup(task, now) === "today")
        .sort(compareTasksByUrgency);
      const waiting = openTasks.filter(
        (task) => taskGroup(task, now) === "waiting",
      );
      const topUrgency = openTasks
        .filter((task) => taskGroup(task, now) !== "waiting")
        .sort(compareTasksByUrgency)
        .slice(0, 15);

      const summarizeFlat = (task: TaskwarriorTask) =>
        toDigestNode(
          task,
          organization,
          nextStepUuids,
          meta.childrenOf,
          meta.stats,
          meta.parentOf,
          false,
        );

      return {
        nowUtc: now.toISOString(),
        revision: organization.revision,
        ...(scopeProject ? { scopeProject } : {}),
        energy: organization.energy,
        timing: organization.timing,
        counts: {
          overdue: overdue.length,
          dueToday: dueToday.length,
          openTotal: openTasks.length,
          waiting: waiting.length,
          completedRecent: recentlyCompleted.length,
          completedTotal: completedTasks.length,
        },
        projects: projects.map((project: SavedProject) => ({
          name: project.name,
          status: projectStatus(project),
          description: project.description,
          ...(project.outcome ? { outcome: project.outcome } : {}),
          ...(project.color ? { color: project.color } : {}),
          ...(project.nextTask ? { nextTask: project.nextTask } : {}),
          openCount: openTasks.filter((t) => inProject(t.project, project.name))
            .length,
          completedCount: completedTasks.filter((t) =>
            inProject(t.project, project.name),
          ).length,
        })),
        columns,
        overdueTasks: overdue.map(summarizeFlat),
        dueTodayTasks: dueToday.map(summarizeFlat),
        topUrgencyTasks: topUrgency.map(summarizeFlat),
        recentlyCompleted: recentlyCompleted.slice(0, 30).map(summarizeFlat),
        sections,
      };
    },
  );

  register(
    "plan_apply",
    "Apply a structured project plan cleanly in one call: optionally save/activate project, ensure project-scoped board columns, create parent tasks + child subtasks with Markdown descriptions, place each subtree into its column, and optionally pin nextTask. Validates revision upfront; reports partialProgress if interrupted.",
    {
      revision: revisionSchema,
      project: planProjectSchema.optional(),
      columns: z.array(planColumnSchema).max(30).optional(),
      tasks: z.array(planTaskSchema).max(50),
    },
    false,
    async (i) => {
      const nextStepProjects = new Set<string>();
      for (const task of i.tasks) {
        if (!task.isNextStep) continue;
        const proj = task.project ?? i.project?.name ?? "";
        if (!proj) {
          throw new Error(
            "Tasks marked isNextStep require a project name or top-level project.",
          );
        }
        if (nextStepProjects.has(proj)) {
          throw new Error(
            `Only one task can be marked isNextStep for project "${proj}".`,
          );
        }
        nextStepProjects.add(proj);
      }

      const workspace = await get("/api/workspace");
      let currentOrg = workspace.organization as Organization;
      if (currentOrg.revision !== i.revision) {
        throw new WorkspaceError(
          `Revision conflict: expected ${i.revision}, current is ${currentOrg.revision}. Refresh via workspace_get or project_digest first.`,
          409,
        );
      }
      let rev = currentOrg.revision;

      const progress: {
        project?: string;
        columns: { id: string; name: string; created: boolean }[];
        createdTasks: {
          uuid: string;
          description: string;
          columnId?: string;
          subtaskUuids: string[];
        }[];
        nextTask?: string;
      } = {
        columns: [],
        createdTasks: [],
      };

      const applyOrg = async (change: Record<string, unknown>) => {
        const updated = (await org({
          revision: rev,
          ...change,
        })) as Organization;
        currentOrg = updated;
        rev = updated.revision;
        return updated;
      };

      try {
        const scopeProject = i.project?.name?.trim() || "";
        if (i.project) {
          const existing = currentOrg.projects?.find(
            (project) => project.name === scopeProject,
          );
          if (
            !existing ||
            i.project.description !== undefined ||
            i.project.color !== undefined ||
            i.project.outcome !== undefined
          ) {
            await applyOrg({
              kind: "project",
              action: "save",
              item: {
                name: scopeProject,
                description:
                  i.project.description ?? existing?.description ?? "",
                ...(i.project.color || existing?.color
                  ? { color: i.project.color || existing?.color }
                  : {}),
                ...(i.project.outcome !== undefined
                  ? { outcome: i.project.outcome }
                  : existing?.outcome !== undefined
                    ? { outcome: existing.outcome }
                    : {}),
                ...(existing?.nextTask ? { nextTask: existing.nextTask } : {}),
              },
            });
          }
          if (
            i.project.status &&
            i.project.status !== projectStatus(existing)
          ) {
            await applyOrg({
              kind: "project",
              action: "status",
              name: scopeProject,
              status: i.project.status,
              ...(i.project.outcome !== undefined
                ? { outcome: i.project.outcome }
                : existing?.outcome !== undefined
                  ? { outcome: existing.outcome }
                  : {}),
              ...(i.project.replaceProject
                ? { replaceProject: i.project.replaceProject }
                : {}),
              ...(i.project.status === "completed"
                ? { remaining: "keep" }
                : {}),
            });
          }
          progress.project = scopeProject;
        }

        if (i.columns?.length) {
          for (const column of i.columns) {
            const name = column.name.trim();
            const existingCols = currentOrg.board?.columns || [];
            const match = column.id
              ? existingCols.find((item) => item.id === column.id)
              : existingCols.find(
                  (item) =>
                    (item.project || "") === scopeProject &&
                    item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
                );
            if (match && !column.id) {
              progress.columns.push({
                id: match.id,
                name: match.name,
                created: false,
              });
              continue;
            }
            const beforeIds = new Set(existingCols.map((item) => item.id));
            await applyOrg({
              kind: "board",
              action: "column.save",
              column: {
                id: column.id || "",
                name,
                ...(scopeProject ? { project: scopeProject } : {}),
              },
            });
            const afterCols = currentOrg.board?.columns || [];
            const savedCol =
              (column.id
                ? afterCols.find((item) => item.id === column.id)
                : undefined) ||
              afterCols.find((item) => !beforeIds.has(item.id)) ||
              findColumnByName(afterCols, name, scopeProject);
            if (savedCol) {
              progress.columns.push({
                id: savedCol.id,
                name: savedCol.name,
                created: !column.id,
              });
            }
          }
        }

        for (const planned of i.tasks) {
          const targetProject = (planned.project ?? scopeProject) || undefined;
          const created = await post("/api/tasks", {
            description: planned.description,
            tags: planned.tags || [],
            ...(targetProject ? { project: targetProject } : {}),
            ...(planned.due ? { due: planned.due } : {}),
            ...(planned.priority !== undefined
              ? { priority: planned.priority }
              : {}),
            ...(planned.recur ? { recur: planned.recur } : {}),
            ...(planned.until ? { until: planned.until } : {}),
            ...(planned.note ? { note: planned.note } : {}),
            ...(planned.taskDescription
              ? { taskDescription: planned.taskDescription }
              : {}),
          });
          const parentUuid = created?.uuid;
          if (typeof parentUuid !== "string" || !parentUuid) {
            throw new Error(
              `Task creation did not return a UUID for "${planned.description}".`,
            );
          }

          if (planned.wait) {
            await post("/api/action", {
              action: "wait",
              uuid: parentUuid,
              wait: planned.wait,
            });
          }

          const subtaskUuids: string[] = [];
          for (const sub of planned.subtasks || []) {
            const subDue = sub.due ?? planned.due;
            const subPriority = sub.priority ?? planned.priority;
            const subTags = sub.tags ?? planned.tags ?? [];
            const createdSub = await post("/api/tasks", {
              description: sub.description,
              tags: subTags,
              ...(targetProject ? { project: targetProject } : {}),
              ...(subDue ? { due: subDue } : {}),
              ...(subPriority !== undefined ? { priority: subPriority } : {}),
              ...(sub.note ? { note: sub.note } : {}),
              ...(sub.taskDescription
                ? { taskDescription: sub.taskDescription }
                : {}),
              parentUuid,
            });
            const childUuid = createdSub?.uuid;
            if (typeof childUuid !== "string" || !childUuid) {
              throw new Error(
                `Subtask creation did not return a UUID for "${sub.description}".`,
              );
            }
            if (sub.wait) {
              await post("/api/action", {
                action: "wait",
                uuid: childUuid,
                wait: sub.wait,
              });
            }
            subtaskUuids.push(childUuid);
          }

          let resolvedColumnId = planned.columnId;
          if (!resolvedColumnId && planned.columnName) {
            const matched = findColumnByName(
              currentOrg.board?.columns || [],
              planned.columnName,
              targetProject || "",
            );
            if (!matched) {
              throw new Error(
                `Board column "${planned.columnName}" not found.`,
              );
            }
            resolvedColumnId = matched.id;
          }
          if (resolvedColumnId) {
            await applyOrg({
              kind: "board",
              action: "task.move",
              uuid: parentUuid,
              columnId: resolvedColumnId,
              beforeUuid: null,
            });
          }

          progress.createdTasks.push({
            uuid: parentUuid,
            description: planned.description,
            ...(resolvedColumnId ? { columnId: resolvedColumnId } : {}),
            subtaskUuids,
          });

          if (planned.isNextStep && targetProject) {
            const projRecord = currentOrg.projects?.find(
              (project) => project.name === targetProject,
            );
            await applyOrg({
              kind: "project",
              action: "save",
              item: {
                name: targetProject,
                description: projRecord?.description ?? "",
                ...(projRecord?.color ? { color: projRecord.color } : {}),
                ...(projRecord?.outcome !== undefined
                  ? { outcome: projRecord.outcome }
                  : {}),
                nextTask: parentUuid,
              },
            });
            progress.nextTask = parentUuid;
          }
        }

        return {
          ok: true,
          revision: rev,
          ...progress,
        };
      } catch (error) {
        const err = error as Error;
        const partial = JSON.stringify(progress);
        if (err instanceof WorkspaceError) {
          throw new WorkspaceError(
            `${err.message} Partial progress: ${partial}`,
            err.status,
            err.outcome,
          );
        }
        throw new Error(`${err.message} Partial progress: ${partial}`);
      }
    },
    false,
  );
}

/** Registers reusable MCP Prompts guiding AI project takeover and daily progress reviews. */
export function registerPlanningPrompts(server: McpServer): void {
  server.registerPrompt(
    "aster_takeover_plan",
    {
      title: "Take Over Project Planning in Aster",
      description:
        "Guide the AI assistant to inspect a project's current state and build/maintain a clean phased plan where the user only checks off tasks.",
      argsSchema: {
        project: z.string().optional(),
      },
    },
    ({ project }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `You are taking over project planning and task management in Aster${project ? ` for project "${project}"` : ""}.`,
              "Workflow:",
              "1. Call `project_digest` first to inspect the current revision, board columns, existing tasks/subtasks, urgency, and recently completed work.",
              "2. Design or refine clear stage/milestone columns for the project, break concrete work into parent tasks with 2-5 checkable child subtasks, and put study links, acceptance criteria, or notes inside `taskDescription` (Markdown).",
              "3. Keep daily `due` load realistic and avoid dumping future phases into today. Prefer `plan_apply` to create phases, tasks, subtasks, and column placements cleanly, and `task_patch` to adjust existing tasks without clearing unspecified fields.",
              "4. Pin exactly one realistic immediate `nextTask` on the active Focus project. The human user should only have to open Aster and mark tasks/subtasks complete.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "aster_daily_review",
    {
      title: "Daily Progress Review & Reschedule",
      description:
        "Inspect what the user completed recently, handle overdue items, unpack next steps, and keep urgency/focus clean.",
      argsSchema: {
        project: z.string().optional(),
      },
    },
    ({ project }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Review my Aster workspace${project ? ` (focus on "${project}")` : ""} and update my plan based on my completion state.`,
              "1. Call `project_digest` and summarize what I completed recently, what is overdue, and top urgency tasks.",
              "2. Use `task_patch` to smoothly reschedule slipped tasks or adjust priorities without losing project/tags.",
              "3. If a phase is finished or thin, use `plan_apply` to queue the next concrete steps with subtasks and `taskDescription` guides.",
              "4. Update the active project's `nextTask` so my Focus view points straight at the next best action.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
