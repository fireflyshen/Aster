import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { createTaskService } from "../../../src/core/tasks/service.ts";
import { createOrganizationService } from "./organization-service.ts";
import { createAuthorization } from "./auth.ts";
import { body, taskInput } from "./validation.ts";

const development = process.env.NODE_ENV === "development";
const sshTarget = process.env.SSH_TARGET ?? (development ? "rn" : undefined);
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:4180";
const team = process.env.CF_ACCESS_TEAM_DOMAIN;
const audience = process.env.CF_ACCESS_AUD;
if (process.env.NODE_ENV === "production" && (!team || !audience)) throw new Error("Access configuration required");
const service = createTaskService({
  kind: sshTarget ? "ssh" : "local",
  key: "aster-web",
  label: "RN",
  taskCommand: process.env.TASK_COMMAND || "/usr/local/bin/task",
  taskrc: process.env.TASKRC || "/etc/taskwarrior/taskrc",
  sshTarget,
});
const authorized = createAuthorization(team, audience);
const organization = createOrganizationService(
  service,
  process.env.ORGANIZATION_FILE || resolve("data/organization.json"),
);
const clientRoot = resolve(fileURLToPath(new URL("./client/", import.meta.url)));
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
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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
        send(401, { error: "Session expired. Reopen this page to sign in." });
        return;
      }
      if (req.method === "GET" && route === "api/tasks") {
        const parameters = new URL(req.url!, origin).searchParams;
        const [tasks, projects] = await Promise.all([
          parameters.has("filter")
            ? service.filterTasks(parameters.get("filter")!)
            : service.loadTasks(parameters.get("scope") === "completed" ? "completed" : "pending"),
          service.loadProjects(),
        ]);
        send(200, {
          tasks,
          projects,
        });
        return;
      }
      if (req.method === "GET" && route === "api/organization") {
        const { actualTags: _, ...data } = await organization.load();
        send(200, data);
        return;
      }
      if (req.method === "POST") {
        if (req.headers.origin !== origin || !req.headers["content-type"]?.startsWith("application/json")) {
          send(403, { error: "Invalid request origin" });
          return;
        }
        const input = await body(req);
        if (route === "api/organization") {
          send(200, await organization.change(input));
          return;
        }
        if (route === "api/tasks") await service.addTask(taskInput(input));
        else if (route === "api/action") {
          if (typeof input.uuid !== "string") throw new Error("Task not found");
          switch (input.action) {
            case "edit":
              await service.editTask(input.uuid, taskInput(input.task));
              break;
            case "complete":
              await service.completeTask(input.uuid);
              break;
            case "reopen":
              await service.reopenTask(input.uuid);
              break;
            case "delete":
              await service.deleteTask(input.uuid);
              break;
            default:
              throw new Error("Unsupported action");
          }
        } else {
          send(404, {});
          return;
        }
        send(200, { ok: true });
        return;
      }
      send(404, {});
      return;
    }
    if (!["GET", "HEAD"].includes(req.method || "")) {
      send(404, {});
      return;
    }
    if (vite) {
      vite.middlewares(req, res, () => send(404, {}));
      return;
    }
    const target = resolve(clientRoot, decodeURIComponent(route || "index.html"));
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
      error: e.outcome === "unknown" ? "Result unconfirmed. Refresh and check tasks before trying again." : e.message,
      outcome: e.outcome,
    });
  }
});
if (development) {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
}
server.requestTimeout = 20000;
server.listen(Number(process.env.PORT || 4180), process.env.HOST || "127.0.0.1", () =>
  console.log("Aster listening on port " + (server.address() as { port: number }).port),
);
