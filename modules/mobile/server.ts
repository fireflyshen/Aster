import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { createPublicKey, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { createTaskService } from "../../src/tasks/service.ts";
import type { TaskInput } from "../../src/tasks/arguments.ts";

const development = process.env.NODE_ENV === "development";
const sshTarget = process.env.SSH_TARGET ?? (development ? "rn" : undefined);
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:4180";
const team = process.env.CF_ACCESS_TEAM_DOMAIN;
const audience = process.env.CF_ACCESS_AUD;
if (process.env.NODE_ENV === "production" && (!team || !audience)) throw new Error("Access configuration required");
const service = createTaskService({
  kind: sshTarget ? "ssh" : "local",
  key: "aster-mobile",
  label: "RN",
  taskCommand: process.env.TASK_COMMAND || "/usr/local/bin/task",
  taskrc: process.env.TASKRC || "/etc/taskwarrior/taskrc",
  sshTarget,
});
let keys: { kid: string; [key: string]: unknown }[] = [];
let expires = 0;
async function authorized(req: IncomingMessage) {
  if (!team || !audience) return process.env.NODE_ENV !== "production";
  try {
    const token = req.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    const now = Date.now() / 1000;
    if (
      header.alg !== "RS256" ||
      claims.iss !== team ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      (claims.nbf && claims.nbf > now) ||
      ![claims.aud].flat().includes(audience)
    )
      return false;
    if (expires < Date.now() || !keys.some((k) => k.kid === header.kid)) {
      const response = await fetch(`${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return false;
      keys = (await response.json()).keys;
      expires = Date.now() + 3600000;
    }
    const key = keys.find((k) => k.kid === header.kid);
    return (
      !!key &&
      verify(
        "RSA-SHA256",
        Buffer.from(parts.slice(0, 2).join(".")),
        createPublicKey({ key, format: "jwk" }),
        Buffer.from(parts[2], "base64url"),
      )
    );
  } catch {
    return false;
  }
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error("内容太长");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function taskInput(value: unknown): TaskInput {
  const v = value as Record<string, unknown>;
  if (
    !v ||
    typeof v.description !== "string" ||
    !v.description.trim() ||
    v.description.length > 2000 ||
    /[\0\r\n]/.test(v.description)
  )
    throw new Error("请填写任务");
  for (const field of ["project", "due", "priority"])
    if (
      v[field] !== undefined &&
      (typeof v[field] !== "string" || (v[field] as string).length > 200 || /[\0\r\n]/.test(v[field] as string))
    )
      throw new Error("字段格式不正确");
  if (v.due && !/^\d{8}T\d{6}Z$/.test(String(v.due))) throw new Error("日期格式不正确");
  if (
    !Array.isArray(v.tags) ||
    v.tags.length > 30 ||
    v.tags.some((t) => typeof t !== "string" || !/^\+?[\p{L}\p{N}_@.\-]{1,80}$/u.test(t))
  )
    throw new Error("标签不能包含空格或特殊命令字符");
  return v as unknown as TaskInput;
}
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
        send(401, { error: "登录已过期，请重新打开页面登录" });
        return;
      }
      if (req.method === "GET" && route === "api/tasks") {
        send(200, {
          tasks: await service.loadTasks(
            new URL(req.url!, origin).searchParams.get("scope") === "completed" ? "completed" : "pending",
          ),
          projects: await service.loadProjects(),
        });
        return;
      }
      if (req.method === "POST") {
        if (req.headers.origin !== origin || !req.headers["content-type"]?.startsWith("application/json")) {
          send(403, { error: "请求来源不正确" });
          return;
        }
        const input = await body(req);
        if (route === "api/tasks") await service.addTask(taskInput(input));
        else if (route === "api/action") {
          if (typeof input.uuid !== "string") throw new Error("任务不存在");
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
              throw new Error("不支持的操作");
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
    const e = error as Error & { outcome?: string };
    send(400, {
      error: e.outcome === "unknown" ? "结果尚未确认，请刷新检查任务后再操作。" : e.message,
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
