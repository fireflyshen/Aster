import { createServer } from "node:http";
import { createConnection } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import { body } from "./validation.ts";
import type { Organization } from "../../../src/core/workspace/organization.ts";

// Local Unix socket: existing SSH users reach the same process and revision queue.
// It never listens on TCP and does not change the public API's Access protection.
export async function startWorkspaceSocket(
  path: string,
  identity: string,
  workspace: {
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
  },
) {
  if (!path.startsWith("/") || path.length > 100)
    throw new Error("Use an absolute, short workspace socket path.");
  try {
    const previous = await lstat(path);
    if (!previous.isSocket())
      throw new Error("Workspace path exists and is not a socket.");
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
    else if (current)
      throw new Error("Workspace socket changed during startup.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    let release: (() => void) | undefined;
    try {
      // Restore obtains the exclusive gate itself; holding a reader here would deadlock.
      const restoreRequest =
        req.method === "POST" && req.url === "/api/backup/restore";
      if (!restoreRequest) release = workspace.enter?.();
      if (req.method === "GET" && req.url === "/api/workspace") {
        res.end(
          JSON.stringify({
            identity,
            organization: await workspace.load(),
          }),
        );
        return;
      }
      const route = new URL(req.url || "/", "http://localhost").pathname;
      if (
        !(
          (req.method === "POST" &&
            [
              "/api/organization",
              "/api/action",
              "/api/tasks",
              "/api/quick/preview",
              "/api/backup/preview",
              "/api/backup/restore",
            ].includes(route)) ||
          (req.method === "GET" &&
            [
              "/api/recovery",
              "/api/recurrence",
              "/api/tasks",
              "/api/export",
              "/api/backup/points",
              "/api/backup/download",
            ].includes(route))
        )
      ) {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      if (req.headers["x-aster-source"] !== identity) {
        res.writeHead(409);
        res.end(
          JSON.stringify({
            error: "Different Taskwarrior source. Check connection settings.",
          }),
        );
        return;
      }
      let result;
      const parameters = new URL(req.url || "/", "http://localhost")
        .searchParams;
      if (req.method === "GET" && route === "/api/tasks" && workspace.tasks)
        result = await workspace.tasks(parameters.get("filter") ?? undefined);
      else if (
        req.method === "POST" &&
        route === "/api/quick/preview" &&
        workspace.parse
      )
        result = workspace.parse(await body(req));
      else if (
        req.method === "GET" &&
        route === "/api/export" &&
        workspace.export
      )
        result = await workspace.export();
      else if (
        req.method === "GET" &&
        route === "/api/backup/points" &&
        workspace.points
      )
        result = { points: await workspace.points() };
      else if (
        req.method === "GET" &&
        route === "/api/backup/download" &&
        workspace.download
      )
        result = await workspace.download(parameters.get("id") || "");
      else if (
        req.method === "POST" &&
        route === "/api/backup/preview" &&
        workspace.preview
      )
        result = await workspace.preview(await body(req, 8 * 1024 * 1024));
      else if (restoreRequest && workspace.restore)
        result = await workspace.restore((await body(req)).token);
      else if (
        req.method === "POST" &&
        route === "/api/tasks" &&
        workspace.addTask
      ) {
        result = await workspace.addTask(await body(req));
        res.end(JSON.stringify(result ?? { ok: true }));
        return;
      } else if (
        req.method === "GET" &&
        route === "/api/recovery" &&
        workspace.deleted
      )
        result = await workspace.deleted();
      else if (
        req.method === "GET" &&
        route === "/api/recurrence" &&
        workspace.series
      )
        result = await workspace.series(
          new URL(req.url!, "http://localhost").searchParams.get("uuid") || "",
        );
      else if (
        req.method === "POST" &&
        route === "/api/action" &&
        workspace.action
      )
        result = await workspace.action(await body(req));
      else if (req.method === "POST" && route === "/api/organization")
        result = await workspace.change(await body(req));
      else {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      res.end(JSON.stringify(result ?? { ok: true }));
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
