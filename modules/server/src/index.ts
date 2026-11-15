import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskService } from "../../core/tasks/service.ts";
import { workspaceIdentity } from "../../core/connection/settings.ts";
import { createWorkspaceGate } from "./workspace-gate.ts";
import { createBackupRestore } from "./backup-restore.ts";
import { createTaskActions } from "./task-actions.ts";
import { createRecoveryService } from "./recovery.ts";
import { createOrganizationService } from "./organization-service.ts";
import { startWorkspaceSocket } from "./workspace-ipc.ts";
import { createApiHandler } from "./task-routes.ts";
import { createWorkspaceHandlers } from "./workspace-api.ts";
import { createTimeStore } from "./time/time-store.ts";
import { createTimeBackupService } from "./time/time-backup.ts";
import { createTimeCoordinator } from "./time/time-coordinator.ts";
import { createTimeHandlers } from "./time/time-api.ts";
import { checkSqliteBackupSupport } from "./time/time-barrier.ts";
import { runMaintenanceBackup } from "./maintenance-backup.ts";

const development = process.env.NODE_ENV === "development";
const sshTarget = process.env.SSH_TARGET ?? (development ? "dmit" : undefined);
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:4180";

const organizationFile = resolve(
  process.env.ORGANIZATION_FILE || "data/organization.json",
);
const dataDir = dirname(organizationFile);
const recoveryFile = resolve(
  process.env.RECOVERY_FILE || resolve(dataDir, "recovery.json"),
);
const timeFile = resolve(
  process.env.TIME_DB_FILE || resolve(dataDir, "time.sqlite"),
);
const timeEnabledFlag = process.env.TIME_ENABLED !== "0";

const service = createTaskService({
  kind: sshTarget ? "ssh" : "local",
  key: "aster-web",
  label: "DMIT",
  taskCommand: process.env.TASK_COMMAND || "/usr/local/bin/task",
  taskrc:
    process.env.TASKRC ?? (sshTarget ? "/etc/taskwarrior/taskrc" : undefined),
  sshTarget,
});
const identity = workspaceIdentity(service.connection);

async function resolveTaskchampionDbPath(): Promise<string | undefined> {
  if (process.env.TASKCHAMPION_DB) return resolve(process.env.TASKCHAMPION_DB);
  try {
    const dir = (await service.dataDirectory()).trim();
    if (dir) return join(dir, "taskchampion.sqlite3");
  } catch {
    // Fall back cleanly if Taskwarrior data directory cannot be queried.
  }
  return "/var/lib/taskwarrior/taskchampion.sqlite3";
}

function readCliArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

if (process.argv.includes("--maintenance-backup")) {
  const backupId =
    readCliArg("--backup-id") ||
    process.env.BACKUP_ID ||
    `maint-${Date.now()}`;
  const releaseId = readCliArg("--release-id") || process.env.RELEASE_ID || backupId;
  const taskchampionDbPath = await resolveTaskchampionDbPath();
  try {
    const result = await runMaintenanceBackup({
      backupId,
      releaseId,
      sourceIdentity: identity,
      dataDir,
      organizationFile,
      recoveryFile,
      timeFile,
      taskchampionDbPath,
      timeEnabled: timeEnabledFlag,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const hadOrganizationBefore = existsSync(organizationFile);
const hadTimeDbBefore = existsSync(timeFile);

if (timeEnabledFlag) {
  await checkSqliteBackupSupport(dataDir);
}

const timeStore =
  timeEnabledFlag || hadTimeDbBefore
    ? await createTimeStore(timeFile, {
        enabled: timeEnabledFlag,
        ...(!hadTimeDbBefore && hadOrganizationBefore
          ? { cutoverAtMs: Date.now() }
          : {}),
      })
    : undefined;
const timeBackup = timeStore ? createTimeBackupService(timeStore) : undefined;
const timeCoordinator = timeStore
  ? createTimeCoordinator({ service, store: timeStore })
  : undefined;

const isTimeEnabled = () => Boolean(timeEnabledFlag && timeStore);

const organization = createOrganizationService(
  service,
  organizationFile,
  timeStore
    ? {
        isEnabled: isTimeEnabled,
        getEnergyInputs: timeStore.getEnergyInputs,
        getTimerSnapshot: timeStore.getTimerSnapshot,
      }
    : undefined,
);
const recovery = createRecoveryService(service, organization, recoveryFile);
const taskAction = createTaskActions(
  service,
  organization,
  recovery,
  timeCoordinator
    ? {
        isEnabled: isTimeEnabled,
        coordinator: timeCoordinator,
      }
    : undefined,
);
const gate = createWorkspaceGate();
const backupRestore = createBackupRestore(
  service,
  organization,
  recovery,
  gate,
  { organization: organizationFile, recovery: recoveryFile },
  timeStore,
);

await backupRestore.repair();
if (timeCoordinator && isTimeEnabled()) {
  await timeCoordinator.reconcileStartup();
}

const timeRoutes = createTimeHandlers({
  identity,
  gate,
  service,
  store: timeStore,
  backup: timeBackup,
  coordinator: timeCoordinator,
  isEnabled: isTimeEnabled,
  paths: {
    dataDir,
    organizationFile,
    recoveryFile,
    timeFile,
    resolveTaskchampionDbPath,
  },
});

const handlers = createWorkspaceHandlers({
  identity,
  gate,
  service,
  organization,
  recovery,
  backupRestore,
  taskAction,
  timeSnapshot: timeStore
    ? {
        isEnabled: isTimeEnabled,
        getTimerSnapshot: timeStore.getTimerSnapshot,
      }
    : undefined,
  extraRoutes: timeRoutes,
});

const handleApi = createApiHandler({
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
      if (isTimeEnabled() && timeStore) {
        try {
          const snap = timeStore.getTimerSnapshot();
          const barrier = await timeStore.readBarrier();
          const st =
            snap.state === "restoring"
              ? { state: "restoring", timeEpoch: snap.timeEpoch }
              : {
                  state: snap.state,
                  timeEpoch: snap.timeEpoch,
                  taskDataEpoch: snap.taskDataEpoch,
                  barrierTimeEpoch: barrier.timeEpoch,
                  schemaVersion: timeStore.getStatus().schemaVersion,
                };
          send(200, { ok: true, time: { enabled: true, ...st } });
        } catch (timeErr) {
          send(503, {
            ok: false,
            error:
              timeErr instanceof Error ? timeErr.message : String(timeErr),
          });
        }
      } else {
        send(200, { ok: true, time: { enabled: false } });
      }
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
    const e = error as Error & {
      outcome?: string;
      status?: number;
      code?: string;
      details?: unknown;
      operationId?: string;
    };
    send(e.status || 400, {
      error:
        e.outcome === "unknown" && !e.message
          ? "Result unconfirmed. Refresh and check tasks before trying again."
          : e.outcome === "unknown" && !e.code
            ? "Result unconfirmed. Refresh and check tasks before trying again."
            : e.message,
      outcome: e.outcome,
      ...(typeof e.code === "string" ? { code: e.code } : {}),
      ...(e.details !== undefined ? { details: e.details } : {}),
      ...(typeof e.operationId === "string"
        ? { operationId: e.operationId }
        : {}),
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
