import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { workspaceIdentity } from "../../core/connection/settings.ts";
import { createTaskService } from "../../core/tasks/service.ts";
import { createOrganizationService } from "./organization/organization-service.ts";
import { createBackupRestore } from "./recovery/backup-restore.ts";
import { createRecoveryService } from "./recovery/recovery.ts";
import { createStateHistoryStore } from "./tasks/state-history.ts";
import { createTaskStateManager } from "./tasks/state-changes.ts";
import { createStateTransitionScheduler } from "./tasks/state-scheduler.ts";
import { createTaskActions } from "./tasks/task-actions.ts";
import { createTimeHandlers } from "./time/time-api.ts";
import { createTimeBackupService } from "./time/time-backup.ts";
import { checkSqliteBackupSupport } from "./time/time-barrier.ts";
import { createTimeCoordinator } from "./time/time-coordinator.ts";
import { createTimeAutoStopScheduler } from "./time/time-scheduler.ts";
import { createTimeStore } from "./time/time-store.ts";
import { createHabitHandlers } from "./habits/habit-api.ts";
import { createHabitStore } from "./habits/habit-store.ts";
import { runCliMaintenanceIfRequested } from "./transport/cli-maintenance.ts";
import { createApiHandler } from "./transport/http-adapter.ts";
import {
  createAsterHttpServer,
  resolveClientRoot,
} from "./transport/http-server.ts";
import { createWorkspaceHandlers } from "./transport/workspace-api.ts";
import { createWorkspaceGate } from "./transport/workspace-gate.ts";
import { startWorkspaceSocket } from "./transport/workspace-ipc.ts";

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
const habitsFile = resolve(
  process.env.HABITS_DB_FILE || resolve(dataDir, "habits.sqlite"),
);
const stateLogFile = resolve(
  process.env.STATE_LOG_FILE || resolve(dataDir, "state-history.jsonl"),
);
const timeEnabledFlag = process.env.TIME_ENABLED !== "0";

const service = createTaskService({
  kind: sshTarget ? "ssh" : "local",
  key: "aster-web",
  label:
    process.env.WORKSPACE_LABEL ||
    (sshTarget ? sshTarget.toUpperCase() : "LOCAL"),
  taskCommand: process.env.TASK_COMMAND || "/usr/local/bin/task",
  taskrc:
    process.env.TASKRC ?? (sshTarget ? "/etc/taskwarrior/taskrc" : undefined),
  sshTarget,
});
const identity = workspaceIdentity(service.connection);

await runCliMaintenanceIfRequested({
  service,
  identity,
  dataDir,
  organizationFile,
  recoveryFile,
  timeFile,
  stateLogFile,
  timeEnabled: timeEnabledFlag,
});

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
const isTimeEnabled = () => Boolean(timeEnabledFlag && timeStore);
const habitStore = createHabitStore(habitsFile, {
  getTimezone: () =>
    timeStore
      ? timeStore.getPolicy().timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
});

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
const stateHistory = createStateHistoryStore(stateLogFile);
const stateManager = createTaskStateManager({
  service,
  organization,
  history: stateHistory,
  habitStore,
  getTimezone: () => habitStore.getTimezone(),
});
const timeCoordinator = timeStore
  ? createTimeCoordinator({
      service,
      store: timeStore,
      beforeStart: stateManager.ensureStartReady,
      prepareComplete: stateManager.prepareComplete,
    })
  : undefined;
const recovery = createRecoveryService(
  service,
  organization,
  recoveryFile,
  habitStore,
  stateHistory,
);
const taskAction = createTaskActions(
  service,
  organization,
  recovery,
  timeCoordinator
    ? { isEnabled: isTimeEnabled, coordinator: timeCoordinator }
    : undefined,
  habitStore,
  stateManager,
);
const gate = createWorkspaceGate();
const backupRestore = createBackupRestore(
  service,
  organization,
  recovery,
  gate,
  { organization: organizationFile, recovery: recoveryFile },
  timeStore,
  habitStore,
  stateHistory,
);

await backupRestore.repair();
if (timeCoordinator && isTimeEnabled()) {
  await timeCoordinator.reconcileStartup();
}

const timeScheduler =
  timeStore && isTimeEnabled()
    ? createTimeAutoStopScheduler({ store: timeStore, gate })
    : undefined;
timeScheduler?.start();

const stateScheduler = createStateTransitionScheduler({
  stateManager,
  gate,
  getTimezone: () => habitStore.getTimezone(),
});
stateScheduler.start();

const timeRoutes = createTimeHandlers({
  identity,
  gate,
  service,
  store: timeStore,
  backup: timeBackup,
  coordinator: timeCoordinator,
  beforeStart: stateManager.ensureStartReady,
  isEnabled: isTimeEnabled,
  paths: {
    dataDir,
    organizationFile,
    recoveryFile,
    timeFile,
    stateLogFile,
    resolveTaskchampionDbPath: async () =>
      (
        await import("./transport/cli-maintenance.ts")
      ).resolveTaskchampionDbPath(service),
  },
});

const habitRoutes = createHabitHandlers({
  store: habitStore,
  loadCatalog: async () => {
    const [tasks, org] = await Promise.all([
      service.loadTasks("pending"),
      organization.load(),
    ]);
    return {
      tasks,
      subtasks: org.subtasks ?? {},
      descriptions: org.descriptions ?? {},
    };
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
  stateManager,
  timeSnapshot: timeStore
    ? {
        isEnabled: isTimeEnabled,
        getTimerSnapshot: timeStore.getTimerSnapshot,
      }
    : undefined,
  extraRoutes: [...timeRoutes, ...habitRoutes],
});

const handleApi = createApiHandler({
  origin,
  enter: gate.enter,
  handlers,
});

const server = createAsterHttpServer({
  origin,
  development,
  clientRoot: resolveClientRoot(import.meta.url),
  isTimeEnabled,
  timeStore,
  handleApi,
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
