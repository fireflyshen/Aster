import { parseQuickTask } from "../../core/tasks/quick-task.ts";
import type { TaskService } from "../../core/tasks/service.ts";
import type { Organization } from "../../core/workspace/organization.ts";
import type { createBackupRestore } from "./backup-restore.ts";
import type { createOrganizationService } from "./organization-service.ts";
import type { createRecoveryService } from "./recovery.ts";
import { taskInput } from "./validation.ts";
import type { createWorkspaceGate } from "./workspace-gate.ts";

export type OrganizationService = ReturnType<typeof createOrganizationService>;
export type RecoveryService = ReturnType<typeof createRecoveryService>;
export type BackupRestoreService = ReturnType<typeof createBackupRestore>;
export type WorkspaceGate = ReturnType<typeof createWorkspaceGate>;
export type TransportKind = "http" | "ipc";
export type TaskScopeDefault = "pending" | "all";

export type WorkspaceRouteResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export interface WorkspaceRouteContext {
  searchParams: URLSearchParams;
  readBody: (limitBytes?: number) => Promise<Record<string, unknown>>;
  transport: TransportKind;
}

export interface WorkspaceRouteSpec {
  method: "GET" | "POST";
  route: string;
  skipGate?: boolean;
  publicWorkspace?: boolean;
  handle: (ctx: WorkspaceRouteContext) => Promise<WorkspaceRouteResponse>;
}

export interface WorkspaceHandlers {
  identity: string;
  enter: () => () => void;
  workspace: () => Promise<Organization>;
  loadOrganization: () => Promise<Organization>;
  changeOrganization: (input: unknown) => Promise<Organization>;
  tasks: (
    parameters: URLSearchParams,
    defaultScope: TaskScopeDefault,
  ) => Promise<unknown>;
  addTask: (
    input: Record<string, unknown>,
  ) => Promise<{ ok: true; uuid: string | undefined } | unknown>;
  action: (input: Record<string, unknown>) => Promise<unknown>;
  parseQuickTask: (input: unknown) => unknown;
  deleted: () => Promise<unknown>;
  series: (uuid: string) => Promise<unknown>;
  exportBackup: () => Promise<unknown>;
  points: () => Promise<unknown>;
  download: (id: string) => Promise<unknown>;
  preview: (input: unknown) => Promise<unknown>;
  restore: (token: unknown) => Promise<unknown>;
}

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/** Parses natural-language quick-capture syntax after validating input bounds. */
export function parseQuickTaskPreview(input: unknown) {
  const text = (input as { text?: unknown })?.text;
  if (typeof text !== "string" || text.length > 4000) {
    throw new Error("Enter a short task expression.");
  }
  return parseQuickTask(text);
}

/** Creates a task and optionally links its parent subtask or sets its initial description. */
export async function handleAddTask(
  service: TaskService,
  organization: OrganizationService,
  input: Record<string, unknown>,
): Promise<{ ok: true; uuid: string | undefined }> {
  const output = await service.addTask(taskInput(input));
  const createdUuid = output.match(UUID_PATTERN)?.[0];
  if (createdUuid) {
    let org = await organization.load();
    let rev = org.revision;
    if (typeof input.parentUuid === "string" && input.parentUuid) {
      org = await organization.change({
        revision: rev,
        kind: "subtask",
        action: "link",
        childUuid: createdUuid,
        parentUuid: input.parentUuid,
      });
      rev = org.revision;
    }
    if (
      typeof input.taskDescription === "string" &&
      input.taskDescription.trim()
    ) {
      await organization.change({
        revision: rev,
        kind: "description",
        action: "set",
        uuid: createdUuid,
        description: input.taskDescription.trim(),
      });
    }
  }
  return { ok: true as const, uuid: createdUuid };
}

/** Reads the metadata snapshot for an active recurring task template. */
export async function readRecurringSeries(service: TaskService, uuid: string) {
  const task = await service.rawTask(uuid);
  if (task.status !== "recurring") {
    throw new Error("This series has stopped or no longer exists.");
  }
  return {
    uuid: task.uuid,
    description: task.description,
    recur: task.recur,
    until: task.until || "",
    due: task.due,
  };
}

/** Loads tasks and sorted project names for the requested filter or scope query. */
export async function loadScopedTasks(
  service: TaskService,
  organization: OrganizationService,
  parameters: URLSearchParams,
  defaultScope: TaskScopeDefault = "pending",
) {
  const [workspace, projects] = await Promise.all([
    organization.snapshot(),
    service.loadProjects(),
  ]);
  const scope = parameters.get("scope") || defaultScope;

  let tasks: Awaited<ReturnType<TaskService["loadTasks"]>> = [];
  if (parameters.has("filter")) {
    tasks = await service.filterTasks(parameters.get("filter")!);
  } else if (scope === "completed") {
    tasks = await service.loadTasks("completed");
  } else if (scope === "board" || scope === "all") {
    const [pending, completed] = await Promise.all([
      service.loadTasks("pending"),
      service.loadTasks("completed"),
    ]);
    tasks = [...pending, ...completed];
  } else {
    // Load pending tasks plus completed subtasks under pending ancestors so checklists show progress (e.g. 1/3).
    const [pending, completed] = await Promise.all([
      service.loadTasks("pending"),
      service.loadTasks("completed"),
    ]);
    const subtaskLinks = workspace.subtasks || {};
    const pendingUuids = new Set(pending.map((task) => task.uuid));
    const isAncestorPending = (childUuid: string): boolean => {
      let current = subtaskLinks[childUuid];
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        if (pendingUuids.has(current)) return true;
        visited.add(current);
        current = subtaskLinks[current];
      }
      return false;
    };
    tasks = [...pending, ...completed.filter((t) => isAncestorPending(t.uuid))];
  }

  return {
    tasks,
    projects: [
      ...new Set([
        ...projects,
        ...(workspace.projects || []).map((project) => project.name),
      ]),
    ].sort((a, b) => a.localeCompare(b)),
  };
}

/** Wires server domain services into transport-agnostic workspace route handlers. */
export function createWorkspaceHandlers(deps: {
  identity: string;
  gate: WorkspaceGate;
  service: TaskService;
  organization: OrganizationService;
  recovery: RecoveryService;
  backupRestore: BackupRestoreService;
  taskAction: (input: Record<string, unknown>) => Promise<unknown>;
}): WorkspaceHandlers {
  const {
    identity,
    gate,
    service,
    organization,
    recovery,
    backupRestore,
    taskAction,
  } = deps;
  return {
    identity,
    enter: gate.enter,
    workspace: organization.workspace,
    loadOrganization: organization.load,
    changeOrganization: organization.change,
    tasks: (parameters, defaultScope) =>
      loadScopedTasks(service, organization, parameters, defaultScope),
    addTask: (input) => handleAddTask(service, organization, input),
    action: taskAction,
    parseQuickTask: parseQuickTaskPreview,
    deleted: recovery.list,
    series: (uuid) => readRecurringSeries(service, uuid),
    exportBackup: recovery.export,
    points: backupRestore.points,
    download: backupRestore.download,
    preview: backupRestore.preview,
    restore: backupRestore.apply,
  };
}

/** Builds the unified API route table shared by the public HTTP and private Unix socket transports. */
export function createWorkspaceRoutes(
  handlers: WorkspaceHandlers,
): Map<string, WorkspaceRouteSpec> {
  const routes: WorkspaceRouteSpec[] = [
    {
      method: "GET",
      route: "api/workspace",
      publicWorkspace: true,
      handle: async () => ({
        status: 200,
        body: {
          identity: handlers.identity,
          organization: await handlers.workspace(),
        },
      }),
    },
    {
      method: "GET",
      route: "api/organization",
      handle: async () => ({
        status: 200,
        body: await handlers.loadOrganization(),
      }),
    },
    {
      method: "POST",
      route: "api/organization",
      handle: async ({ readBody }) => ({
        status: 200,
        body: await handlers.changeOrganization(await readBody()),
      }),
    },
    {
      method: "GET",
      route: "api/tasks",
      handle: async ({ searchParams, transport }) => ({
        status: 200,
        body: await handlers.tasks(
          searchParams,
          transport === "http" ? "pending" : "all",
        ),
      }),
    },
    {
      method: "POST",
      route: "api/tasks",
      handle: async ({ readBody }) => ({
        status: 200,
        body: await handlers.addTask(await readBody()),
      }),
    },
    {
      method: "POST",
      route: "api/action",
      handle: async ({ readBody }) => {
        const result = await handlers.action(await readBody());
        return { status: 200, body: result ?? { ok: true } };
      },
    },
    {
      method: "POST",
      route: "api/quick/preview",
      handle: async ({ readBody }) => ({
        status: 200,
        body: handlers.parseQuickTask(await readBody()),
      }),
    },
    {
      method: "GET",
      route: "api/recovery",
      handle: async () => ({ status: 200, body: await handlers.deleted() }),
    },
    {
      method: "GET",
      route: "api/recurrence",
      handle: async ({ searchParams }) => ({
        status: 200,
        body: await handlers.series(searchParams.get("uuid") || ""),
      }),
    },
    {
      method: "GET",
      route: "api/export",
      handle: async () => ({
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="aster-backup.json"',
        },
        body: await handlers.exportBackup(),
      }),
    },
    {
      method: "GET",
      route: "api/backup/points",
      handle: async () => ({
        status: 200,
        body: { points: await handlers.points() },
      }),
    },
    {
      method: "GET",
      route: "api/backup/download",
      handle: async ({ searchParams }) => ({
        status: 200,
        headers: {
          "Content-Disposition":
            'attachment; filename="aster-restore-point.json"',
        },
        body: await handlers.download(searchParams.get("id") || ""),
      }),
    },
    {
      method: "POST",
      route: "api/backup/preview",
      handle: async ({ readBody }) => ({
        status: 200,
        body: await handlers.preview(await readBody(8 * 1024 * 1024)),
      }),
    },
    {
      method: "POST",
      route: "api/backup/restore",
      skipGate: true,
      handle: async ({ readBody }) => {
        const input = await readBody();
        return {
          status: 200,
          body: await handlers.restore(input.token),
        };
      },
    },
  ];
  return new Map(routes.map((spec) => [`${spec.method} ${spec.route}`, spec]));
}
