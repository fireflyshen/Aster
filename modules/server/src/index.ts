import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskService } from "../../core/tasks/service.ts";
import { workspaceIdentity } from "../../core/connection/settings.ts";
import { createWorkspaceGate } from "./workspace-gate.ts";
import { createBackupRestore } from "./backup-restore.ts";
import { createTaskActions } from "./task-actions.ts";
import { createRecoveryService } from "./recovery.ts";
import { createAuthorization } from "./auth.ts";
import { createOrganizationService } from "./organization-service.ts";
import { startWorkspaceSocket } from "./workspace-ipc.ts";
import { createApiHandler } from "./task-routes.ts";
import { createWorkspaceHandlers } from "./workspace-api.ts";

const development = process.env.NODE_ENV === "development";
const sshTarget = process.env.SSH_TARGET ?? (development ? "dmit" : undefined);
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:4180";
const team = process.env.CF_ACCESS_TEAM_DOMAIN;
const audience = process.env.CF_ACCESS_AUD;
if (process.env.NODE_ENV === "production" && (!team || !audience)) {
  throw new Error("Access configuration required");
}

const organizationFile = resolve(
  process.env.ORGANIZATION_FILE || "data/organization.json",
);
const recoveryFile = resolve(
  process.env.RECOVERY_FILE || resolve(dirname(organizationFile), "recovery.json"),
);

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
const organization = createOrganizationService(service, organizationFile);
const recovery = createRecoveryService(service, organization, recoveryFile);
const taskAction = createTaskActions(service, organization, recovery);
const gate = createWorkspaceGate();
const backupRestore = createBackupRestore(
  service,
  organization,
  recovery,
  gate,
  { organization: organizationFile, recovery: recoveryFile },
);

await backupRestore.repair();

const identity = workspaceIdentity(service.connection);
const handlers = createWorkspaceHandlers({
  identity,
  gate,
  service,
  organization,
  recovery,
  backupRestore,
  taskAction,
});

const handleApi = createApiHandler({
  authorized,
  origin,
  enter: gate.enter,
  handlers,
});

function resolveClientRoot(): string {
  if (process.env.CLIENT_ROOT) return resolve(process.env.CLIENT_ROOT);
  const colocated = fileURLToPath(new URL("./client/", import.meta.url));
  if (existsSync(colocated)) return resolve(colocated);
  return resolve(fileURLToPath(new URL("../web/client/", import.meta.url)));
}

const clientRoot = resolveClientRoot();
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

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
      await handleApi(req, res, route, send);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method || "")) {
      send(404, {});
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

if (process.env.WORKSPACE_SOCKET) {
  process.umask(0o077);
  await startWorkspaceSocket(process.env.WORKSPACE_SOCKET, identity, handlers);
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
