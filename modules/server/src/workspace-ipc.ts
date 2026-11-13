import { createServer } from "node:http";
import { createConnection } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import type { Organization } from "../../core/workspace/organization.ts";
import { body } from "./validation.ts";
import {
  createWorkspaceRoutes,
  type WorkspaceHandlers,
} from "./workspace-api.ts";

/** Legacy-compatible IPC surface for unit tests injecting custom workspace stubs. */
export type LegacyWorkspaceSocketTarget = {
  load: () => Promise<Organization>;
  change: (input: unknown) => Promise<Organization>;
  enter?: () => () => void;
  addTask?: (input: unknown) => Promise<unknown>;
  action?: (input: Record<string, unknown>) => Promise<unknown>;
  deleted?: () => Promise<unknown>;
  series?: (uuid: string) => Promise<unknown>;
  tasks?: (filter?: string) => Promise<unknown>;
  parse?: (input: unknown) => unknown;
  export?: () => Promise<unknown>;
  points?: () => Promise<unknown>;
  download?: (id: string) => Promise<unknown>;
  preview?: (input: unknown) => Promise<unknown>;
  restore?: (token: unknown) => Promise<unknown>;
};

function isFullHandlers(
  target: WorkspaceHandlers | LegacyWorkspaceSocketTarget,
): target is WorkspaceHandlers {
  return "loadOrganization" in target;
}

function unsupported(): never {
  throw Object.assign(new Error("Route is unavailable."), { status: 404 });
}

function normalizeIpcHandlers(
  identity: string,
  target: WorkspaceHandlers | LegacyWorkspaceSocketTarget,
): WorkspaceHandlers {
  if (isFullHandlers(target)) return target;
  return {
    identity,
    enter: target.enter ?? (() => () => undefined),
    workspace: target.load,
    loadOrganization: target.load,
    changeOrganization: target.change,
    tasks: (parameters) =>
      target.tasks
        ? target.tasks(parameters.get("filter") ?? undefined)
        : unsupported(),
    addTask: (input) => (target.addTask ? target.addTask(input) : unsupported()),
    action: (input) => (target.action ? target.action(input) : unsupported()),
    parseQuickTask: (input) => (target.parse ? target.parse(input) : unsupported()),
    deleted: () => (target.deleted ? target.deleted() : unsupported()),
    series: (uuid) => (target.series ? target.series(uuid) : unsupported()),
    exportBackup: () => (target.export ? target.export() : unsupported()),
    points: () => (target.points ? target.points() : unsupported()),
    download: (id) => (target.download ? target.download(id) : unsupported()),
    preview: (input) => (target.preview ? target.preview(input) : unsupported()),
    restore: (token) => (target.restore ? target.restore(token) : unsupported()),
  };
}

async function prepareSocketPath(path: string): Promise<void> {
  if (!path.startsWith("/") || path.length > 100) {
    throw new Error("Use an absolute, short workspace socket path.");
  }
  try {
    const previous = await lstat(path);
    if (!previous.isSocket()) {
      throw new Error("Workspace path exists and is not a socket.");
    }
    await new Promise<void>((resolve, reject) => {
      const probe = createConnection(path);
      probe.once("connect", () => {
        probe.destroy();
        reject(new Error("Workspace socket is already serving."));
      });
      probe.once("error", (error: NodeJS.ErrnoException) => {
        if (["ECONNREFUSED", "ENOENT"].includes(error.code || "")) resolve();
        else reject(error);
      });
      probe.setTimeout(1000, () => {
        probe.destroy();
        reject(new Error("Unable to verify stale workspace socket."));
      });
    });
    const current = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (current && current.ino === previous.ino) await unlink(path);
    else if (current) {
      throw new Error("Workspace socket changed during startup.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Starts the private Unix socket IPC server over the unified workspace route table. */
export async function startWorkspaceSocket(
  path: string,
  identity: string,
  workspace: WorkspaceHandlers | LegacyWorkspaceSocketTarget,
) {
  await prepareSocketPath(path);
  const handlers = normalizeIpcHandlers(identity, workspace);
  const routes = createWorkspaceRoutes(handlers);

  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    let release: (() => void) | undefined;
    try {
      const parsed = new URL(req.url || "/", "http://localhost");
      const route = parsed.pathname.slice(1);
      const spec = routes.get(`${req.method || ""} ${route}`);
      if (!spec) {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      // Restore obtains the exclusive gate itself; holding a reader here would deadlock.
      if (!spec.skipGate) release = handlers.enter();
      if (!spec.publicWorkspace && req.headers["x-aster-source"] !== identity) {
        res.writeHead(409);
        res.end(
          JSON.stringify({
            error: "Different Taskwarrior source. Check connection settings.",
          }),
        );
        return;
      }
      const result = await spec.handle({
        searchParams: parsed.searchParams,
        readBody: (limit) => body(req, limit),
        transport: "ipc",
      });
      res.writeHead(result.status);
      res.end(JSON.stringify(result.body));
    } catch (error) {
      const e = error as Error & { status?: number; outcome?: string };
      res.writeHead(e.status || 400);
      res.end(JSON.stringify({ error: e.message, outcome: e.outcome }));
    } finally {
      release?.();
    }
  });
  server.requestTimeout = 20000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
  await chmod(path, 0o600);
  return server;
}
