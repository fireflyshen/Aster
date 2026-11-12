import { parseQuickTask } from "../../../src/core/tasks/quick-task.ts";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskService } from "../../../src/core/tasks/service.ts";
import { workspaceIdentity } from "../../../src/core/connection/settings.ts";
import { createWorkspaceGate } from "./workspace-gate.ts";
import { createBackupRestore } from "./backup-restore.ts";
import { createTaskActions } from "./task-actions.ts";
import { createRecoveryService } from "./recovery.ts";
import { createAuthorization } from "./auth.ts";
import { createOrganizationService } from "./organization-service.ts";
import { startWorkspaceSocket } from "./workspace-ipc.ts";
import { body, taskInput } from "./validation.ts";

const development = process.env.NODE_ENV === "development";
const sshTarget = process.env.SSH_TARGET ?? (development ? "dmit" : undefined);
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:4180";
const team = process.env.CF_ACCESS_TEAM_DOMAIN;
const audience = process.env.CF_ACCESS_AUD;
if (process.env.NODE_ENV === "production" && (!team || !audience))
  throw new Error("Access configuration required");
const service = createTaskService({
  kind: sshTarget ? "ssh" : "local",
  key: "aster-web",
  label: "DMIT",
  taskCommand: process.env.TASK_COMMAND || "/usr/local/bin/task",
  taskrc:
    process.env.TASKRC ?? (sshTarget ? "/etc/taskwarrior/taskrc" : undefined),
  sshTarget,
});
const authorized = createAuthorization(team, audience);
const organization = createOrganizationService(
  service,
  process.env.ORGANIZATION_FILE || resolve("data/organization.json"),
);
const recovery = createRecoveryService(
  service,
  organization,
  process.env.RECOVERY_FILE ||
    resolve(
      dirname(
        process.env.ORGANIZATION_FILE || resolve("data/organization.json"),
      ),
      "recovery.json",
    ),
);
const taskAction = createTaskActions(service, organization, recovery);
const handleAddTask = async (input: Record<string, unknown>) => {
  const output = await service.addTask(taskInput(input));
  const createdUuid = output.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  )?.[0];
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
};
const gate = createWorkspaceGate();
const backupRestore = createBackupRestore(
  service,
  organization,
  recovery,
  gate,
  {
    organization: resolve(
      process.env.ORGANIZATION_FILE || "data/organization.json",
    ),
    recovery: resolve(
      process.env.RECOVERY_FILE ||
        dirname(
          resolve(process.env.ORGANIZATION_FILE || "data/organization.json"),
        ) + "/recovery.json",
    ),
  },
);
await backupRestore.repair();
const clientRoot = resolve(
  fileURLToPath(new URL("./client/", import.meta.url)),
);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
let vite: import("vite").ViteDevServer | undefined;
const server = createServer(async (req, res) => {
  const send = (status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    (development
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws:; "
      : "default-src 'self'; script-src 'self'; connect-src 'self'; ") +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  try {
    const path = new URL(req.url || "/", origin).pathname;
    if (path === "/healthz") {
      send(200, { ok: true });
      return;
    }
    const route = path.slice(1);
    if (route.startsWith("api/")) {
      if (!(await authorized(req))) {
        send(401, {
          error: "Session expired. Reopen this page to sign in.",
        });
        return;
      }
      if (
        req.method === "POST" &&
        ["api/backup/preview", "api/backup/restore"].includes(route)
      ) {
        if (
          req.headers.origin !== origin ||
          !req.headers["content-type"]?.startsWith("application/json")
        ) {
          send(403, { error: "Invalid request origin" });
          return;
        }
        const input = await body(
          req,
          route.endsWith("preview") ? 8 * 1024 * 1024 : 65536,
        );
        if (route.endsWith("restore")) {
          send(200, await backupRestore.apply(input.token));
          return;
        }
        const release = gate.enter();
        try {
          send(200, await backupRestore.preview(input));
        } finally {
          release();
        }
        return;
      }
      const release = gate.enter();
      try {
        if (req.method === "GET" && route === "api/backup/points") {
          send(200, { points: await backupRestore.points() });
          return;
        }
        if (req.method === "GET" && route === "api/backup/download") {
          const id = new URL(req.url!, origin).searchParams.get("id") || "";
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="aster-restore-point.json"',
          );
          send(200, await backupRestore.download(id));
          return;
        }
        if (req.method === "GET" && route === "api/tasks") {
          const parameters = new URL(req.url!, origin).searchParams;
          const [workspace, projects] = await Promise.all([
            organization.snapshot(),
            service.loadProjects(),
          ]);

          let tasks: Awaited<ReturnType<typeof service.loadTasks>> = [];
          if (parameters.has("filter")) {
            tasks = await service.filterTasks(parameters.get("filter")!);
          } else if (parameters.get("scope") === "completed") {
            tasks = await service.loadTasks("completed");
          } else if (parameters.get("scope") === "board") {
            const [pending, completed] = await Promise.all([
              service.loadTasks("pending"),
              service.loadTasks("completed"),
            ]);
            tasks = [...pending, ...completed];
          } else {
            // scope === "pending" or default:
            // Load pending tasks PLUS completed tasks that are subtasks of pending tasks,
            // so subtask checklists maintain their completed items (1/3, 2/3) exactly like Todoist!
            const [pending, completed] = await Promise.all([
              service.loadTasks("pending"),
              service.loadTasks("completed"),
            ]);
            const subtaskLinks = workspace.subtasks || {};
            const pendingUuids = new Set(pending.map((t) => t.uuid));
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
            const completedSubtasks = completed.filter((t) =>
              isAncestorPending(t.uuid),
            );
            tasks = [...pending, ...completedSubtasks];
          }

          send(200, {
            tasks,
            projects: [
              ...new Set([
                ...projects,
                ...(workspace.projects || []).map((project) => project.name),
              ]),
            ].sort((a, b) => a.localeCompare(b)),
          });
          return;
        }
        if (req.method === "GET" && route === "api/recovery") {
          send(200, await recovery.list());
          return;
        }
        if (req.method === "GET" && route === "api/export") {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="aster-backup.json"',
          );
          send(200, await recovery.export());
          return;
        }
        if (req.method === "GET" && route === "api/recurrence") {
          const uuid = new URL(req.url!, origin).searchParams.get("uuid") || "";
          const task = await service.rawTask(uuid);
          if (task.status !== "recurring")
            throw new Error("This series has stopped or no longer exists.");
          send(200, {
            uuid: task.uuid,
            description: task.description,
            recur: task.recur,
            until: task.until || "",
            due: task.due,
          });
          return;
        }
        if (req.method === "GET" && route === "api/organization") {
          send(200, await organization.load());
          return;
        }
        if (req.method === "GET" && route === "api/workspace") {
          send(200, {
            identity: workspaceIdentity(service.connection),
            organization: await organization.workspace(),
          });
          return;
        }
        if (req.method === "POST") {
          if (
            req.headers.origin !== origin ||
            !req.headers["content-type"]?.startsWith("application/json")
          ) {
            send(403, { error: "Invalid request origin" });
            return;
          }
          const input = await body(req);
          if (route === "api/organization") {
            send(200, await organization.change(input));
            return;
          }
          if (route === "api/tasks") {
            send(200, await handleAddTask(input));
            return;
          }
          if (route === "api/action") {
            await taskAction(input);
          } else {
            send(404, {});
            return;
          }
          send(200, { ok: true });
          return;
        }
        send(404, {});
        return;
      } finally {
        release();
      }
    }
    if (!["GET", "HEAD"].includes(req.method || "")) {
      send(404, {});
      return;
    }
    if (vite) {
      vite.middlewares(req, res, () => send(404, {}));
      return;
    }
    const target = resolve(
      clientRoot,
      decodeURIComponent(route || "index.html"),
    );
    if (!target.startsWith(clientRoot + sep) || !mime[extname(target)]) {
      send(404, {});
      return;
    }
    let content: Buffer;
    try {
      content = await readFile(target);
    } catch {
      send(404, {});
      return;
    }
    res.writeHead(200, { "Content-Type": mime[extname(target)] });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    const e = error as Error & { outcome?: string; status?: number };
    send(e.status || 400, {
      error:
        e.outcome === "unknown"
          ? "Result unconfirmed. Refresh and check tasks before trying again."
          : e.message,
      outcome: e.outcome,
    });
  }
});
if (development) {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
}
if (process.env.WORKSPACE_SOCKET) {
  process.umask(0o077);
  await startWorkspaceSocket(
    process.env.WORKSPACE_SOCKET,
    workspaceIdentity(service.connection),
    {
      ...organization,
      enter: gate.enter,
      action: taskAction,
      addTask: (input) => handleAddTask(input as Record<string, unknown>),
      deleted: recovery.list,
      tasks: async (filter) => ({
        tasks:
          filter !== undefined
            ? await service.filterTasks(filter)
            : (
                await Promise.all([
                  service.loadTasks(),
                  service.loadTasks("completed"),
                ])
              ).flat(),
      }),
      parse: (input) => {
        const text = (input as { text?: unknown })?.text;
        if (typeof text !== "string" || text.length > 4000)
          throw new Error("Enter a short task expression.");
        return parseQuickTask(text);
      },
      export: recovery.export,
      points: backupRestore.points,
      download: backupRestore.download,
      preview: backupRestore.preview,
      restore: backupRestore.apply,
      series: async (uuid: string) => {
        const task = await service.rawTask(uuid);
        if (task.status !== "recurring")
          throw new Error("This series has stopped or no longer exists.");
        return {
          uuid: task.uuid,
          description: task.description,
          recur: task.recur,
          until: task.until || "",
          due: task.due,
        };
      },
    },
  );
}
server.requestTimeout = 20000;
server.listen(
  Number(process.env.PORT || 4180),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      "Aster listening on port " + (server.address() as { port: number }).port,
    ),
);
