import type { TaskService } from "../../../core/tasks/service.ts";
import { exportTimewarrior } from "../../../core/tasks/timewarrior.ts";
import type {
  ActivityKind,
  ActivitySource,
  TimePolicy,
} from "../../../core/time/model.ts";
import { localDateOf } from "../../../core/time/zone.ts";
import { runMaintenanceBackup } from "../maintenance-backup.ts";
import type { WorkspaceGate, WorkspaceRouteSpec } from "../workspace-api.ts";
import type { TimeBackupService } from "./time-backup.ts";
import type { TimeCoordinator } from "./time-coordinator.ts";
import {
  analyzeTimewarriorSnapshot,
  applyTimewarriorSnapshotImport,
  type RawTimewarriorInterval,
  type TaskSnapshotLookup,
} from "./time-import.ts";
import { TimeStoreError, type TimeStore } from "./time-store.ts";

function optionalString(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) {
    throw new TimeStoreError(
      400,
      "INVALID_INPUT",
      `Text exceeds ${max} characters.`,
    );
  }
  return trimmed;
}

function requiredString(value: unknown, field: string, max = 500): string {
  const s = optionalString(value, max);
  if (!s) {
    throw new TimeStoreError(
      400,
      "MISSING_FIELD",
      `Missing required field: ${field}.`,
    );
  }
  return s;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TimeStoreError(
      400,
      "INVALID_NUMBER",
      `Field ${field} must be a finite number.`,
    );
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TimeStoreError(
      400,
      "INVALID_NUMBER",
      "Expected a finite numeric value.",
    );
  }
  return value;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TimeStoreError(
      400,
      "INVALID_ARRAY",
      "Expected an array of strings.",
    );
  }
  return value as string[];
}

export function createTimeHandlers(deps: {
  identity: string;
  gate: WorkspaceGate;
  service: TaskService;
  store?: TimeStore;
  backup?: TimeBackupService;
  coordinator?: TimeCoordinator;
  isEnabled: () => boolean;
  paths: {
    dataDir: string;
    organizationFile: string;
    recoveryFile: string;
    timeFile: string;
    resolveTaskchampionDbPath?: () => Promise<string | undefined>;
  };
}) {
  const {
    identity,
    gate,
    service,
    store,
    backup,
    coordinator,
    isEnabled,
    paths,
  } = deps;

  function requireStore(): TimeStore {
    if (!store) {
      throw new TimeStoreError(
        503,
        "TIME_NOT_INITIALIZED",
        "Time module is not initialized in this workspace.",
      );
    }
    return store;
  }

  function requireEnabledStore(): TimeStore {
    const s = requireStore();
    if (!isEnabled()) {
      throw new TimeStoreError(
        409,
        "TIME_DISABLED",
        "Time module is currently disabled.",
      );
    }
    return s;
  }

  function defaultDate(s: TimeStore): string {
    const tz = s.getPolicy().timezone;
    return localDateOf(Date.now(), tz);
  }

  async function loadImportIntervals(
    body: Record<string, unknown>,
  ): Promise<RawTimewarriorInterval[]> {
    if (typeof body.rawJson === "string") {
      const parsed = JSON.parse(body.rawJson) as unknown;
      if (!Array.isArray(parsed)) {
        throw new TimeStoreError(
          400,
          "INVALID_IMPORT",
          "rawJson must be a JSON array.",
        );
      }
      return parsed as RawTimewarriorInterval[];
    }
    if (Array.isArray(body.intervals)) {
      return body.intervals as RawTimewarriorInterval[];
    }
    return (await exportTimewarrior(
      service.connection,
    )) as RawTimewarriorInterval[];
  }

  async function loadReadOnlyTaskLookup(): Promise<
    TaskSnapshotLookup | undefined
  > {
    try {
      const tasks = await service.exportTasks();
      const map = new Map(
        tasks.map((t) => [
          t.uuid.toLowerCase(),
          {
            description: t.description,
            project: typeof t.project === "string" ? t.project : undefined,
            tags: Array.isArray(t.tags)
              ? t.tags.filter((x): x is string => typeof x === "string")
              : undefined,
          },
        ]),
      );
      return (uuid: string) => map.get(uuid.toLowerCase());
    } catch {
      return undefined;
    }
  }

  let restoringTime = false;

  const routes: WorkspaceRouteSpec[] = [
    {
      method: "GET",
      route: "api/time/status",
      handle: async () => {
        if (!store) {
          return {
            status: 200,
            body: {
              initialized: false,
              enabled: false,
              available: false,
            },
          };
        }
        try {
          const st = store.getStatus();
          return {
            status: 200,
            body: {
              ...st,
              enabled: isEnabled(),
              available: true,
            },
          };
        } catch (err) {
          if (err instanceof TimeStoreError && err.code === "TIME_RESTORING") {
            return {
              status: 200,
              body: {
                initialized: true,
                enabled: isEnabled(),
                available: false,
                restoring: true,
              },
            };
          }
          throw err;
        }
      },
    },
    {
      method: "GET",
      route: "api/time/snapshot",
      handle: async ({ searchParams }) => {
        if (!store) {
          const ts = new Date().toISOString();
          return {
            status: 200,
            body: {
              backend: "time",
              contractVersion: 1,
              timeEpoch: 0,
              taskDataEpoch: 0,
              state: "unavailable",
              sessionVersion: 0,
              snapshotAt: ts,
              liveUntil: ts,
              activeActivity: null,
              taskTotalsSeconds: {},
              totalsComplete: false,
              historyComplete: false,
            },
          };
        }
        const rawUuids = searchParams.get("uuids");
        const taskUuids = rawUuids
          ? rawUuids
              .split(",")
              .map((u) => u.trim())
              .filter(Boolean)
          : undefined;
        return {
          status: 200,
          body: store.getTimerSnapshot({ taskUuids }),
        };
      },
    },
    {
      method: "GET",
      route: "api/time/daily",
      handle: async ({ searchParams }) => {
        const s = requireStore();
        const date = searchParams.get("date") || defaultDate(s);
        return {
          status: 200,
          body: s.getDailySummary(date),
        };
      },
    },
    {
      method: "GET",
      route: "api/time/weekly",
      handle: async ({ searchParams }) => {
        const s = requireStore();
        const dateOrWeekStart =
          searchParams.get("weekStart") ||
          searchParams.get("date") ||
          defaultDate(s);
        return {
          status: 200,
          body: s.getWeeklySummary(dateOrWeekStart),
        };
      },
    },
    {
      method: "GET",
      route: "api/time/reconcile-digest",
      handle: async ({ searchParams }) => {
        const s = requireStore();
        const date = searchParams.get("date") || defaultDate(s);
        return {
          status: 200,
          body: s.getReconcileDigest(date),
        };
      },
    },
    {
      method: "GET",
      route: "api/time/activities",
      handle: async ({ searchParams }) => {
        const s = requireStore();
        const startMs = searchParams.get("startMs");
        const endMs = searchParams.get("endMs");
        const kind = searchParams.get("kind") as ActivityKind | null;
        const categoryId = searchParams.get("categoryId") || undefined;
        const taskUuid = searchParams.get("taskUuid") || undefined;
        const includeVoided = searchParams.get("includeVoided") === "1";
        return {
          status: 200,
          body: {
            activities: s.queryActivities({
              ...(startMs ? { startMs: Number(startMs) } : {}),
              ...(endMs ? { endMs: Number(endMs) } : {}),
              ...(kind ? { kind } : {}),
              ...(categoryId ? { categoryId } : {}),
              ...(taskUuid ? { taskUuid } : {}),
              includeVoided,
            }),
          },
        };
      },
    },
    {
      method: "GET",
      route: "api/time/policy",
      handle: async () => {
        const s = requireStore();
        return { status: 200, body: s.getPolicy() };
      },
    },
    {
      method: "POST",
      route: "api/time/policy",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        const expectedPolicyVersion = requiredNumber(
          body.expectedPolicyVersion,
          "expectedPolicyVersion",
        );
        if (!body.patch || typeof body.patch !== "object") {
          throw new TimeStoreError(
            400,
            "INVALID_POLICY",
            "Missing policy patch object.",
          );
        }
        return {
          status: 200,
          body: s.updatePolicy({
            idempotencyKey: optionalString(body.idempotencyKey, 200),
            expectedPolicyVersion,
            patch: body.patch as Partial<Omit<TimePolicy, "policyVersion">>,
            receivedAtMs: optionalNumber(body.receivedAtMs),
          }),
        };
      },
    },
    {
      method: "GET",
      route: "api/time/operation",
      handle: async ({ searchParams }) => {
        const s = requireStore();
        const id = searchParams.get("id") || "";
        if (!id.trim()) {
          throw new TimeStoreError(
            400,
            "MISSING_FIELD",
            "Missing operation id or idempotencyKey.",
          );
        }
        const op = s.getOperation(id.trim());
        if (!op) {
          return { status: 404, body: { found: false, operation: null } };
        }
        if (coordinator && op.state === "pending_reconcile") {
          const detail = await coordinator.inspectPendingOperation(
            op.operationId,
          );
          return { status: 200, body: { found: true, ...detail } };
        }
        return { status: 200, body: { found: true, operation: op } };
      },
    },
    {
      method: "POST",
      route: "api/time/start",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        const idempotencyKey = requiredString(
          body.idempotencyKey,
          "idempotencyKey",
          200,
        );
        const taskUuid = optionalString(body.taskUuid, 64);
        let title = optionalString(body.title, 500);
        let projectSnapshot = optionalString(body.projectSnapshot, 200);
        let tags = optionalStringArray(body.tags);

        // Read-only task lookup if taskUuid is provided without explicit title (never mutates Taskwarrior).
        if (taskUuid && (!title || !projectSnapshot)) {
          try {
            const raw = await service.rawTask(taskUuid);
            if (!title) title = raw.description;
            if (
              !projectSnapshot &&
              typeof raw.project === "string" &&
              raw.project
            ) {
              projectSnapshot = raw.project;
            }
            if (!tags && Array.isArray(raw.tags)) {
              tags = raw.tags.filter((t): t is string => typeof t === "string");
            }
          } catch {
            // Fall back to supplied title; native Time logs don't require Taskwarrior availability.
          }
        }
        if (!title) {
          throw new TimeStoreError(
            400,
            "MISSING_FIELD",
            "Missing required field: title.",
          );
        }

        const receipt = s.startActivity({
          idempotencyKey,
          receivedAtMs: optionalNumber(body.receivedAtMs),
          effectiveAtMs: optionalNumber(body.effectiveAtMs),
          title,
          explicitCategoryId: optionalString(body.explicitCategoryId, 100),
          taskUuid,
          projectSnapshot,
          tags,
          source: optionalString(body.source, 40) as ActivitySource | undefined,
          note: optionalString(body.note, 2000),
          rawInput: optionalString(body.rawInput, 2000),
          sameTaskNoop: Boolean(body.sameTaskNoop),
          expectedSessionVersion: optionalNumber(body.expectedSessionVersion),
        });
        return { status: 200, body: receipt };
      },
    },
    {
      method: "POST",
      route: "api/time/stop",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        return {
          status: 200,
          body: s.stopActivity({
            idempotencyKey: requiredString(
              body.idempotencyKey,
              "idempotencyKey",
              200,
            ),
            receivedAtMs: optionalNumber(body.receivedAtMs),
            effectiveAtMs: optionalNumber(body.effectiveAtMs),
            expectedActivityId: optionalString(body.expectedActivityId, 64),
            expectedVersion: optionalNumber(body.expectedVersion),
            expectedSessionVersion: optionalNumber(body.expectedSessionVersion),
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/log",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        return {
          status: 200,
          body: s.logLocatedActivity({
            idempotencyKey: requiredString(
              body.idempotencyKey,
              "idempotencyKey",
              200,
            ),
            receivedAtMs: optionalNumber(body.receivedAtMs),
            title: requiredString(body.title, "title", 500),
            startMs: requiredNumber(body.startMs, "startMs"),
            endMs: requiredNumber(body.endMs, "endMs"),
            explicitCategoryId: optionalString(body.explicitCategoryId, 100),
            taskUuid: optionalString(body.taskUuid, 64),
            projectSnapshot: optionalString(body.projectSnapshot, 200),
            tags: optionalStringArray(body.tags),
            precision:
              body.precision === "estimated_bounds" ||
              body.precision === "approximate"
                ? "estimated_bounds"
                : "exact",
            source: optionalString(body.source, 40) as
              | ActivitySource
              | undefined,
            note: optionalString(body.note, 2000),
            rawInput: optionalString(body.rawInput, 2000),
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/estimate",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        return {
          status: 200,
          body: s.logUnlocatedEstimate({
            idempotencyKey: requiredString(
              body.idempotencyKey,
              "idempotencyKey",
              200,
            ),
            receivedAtMs: optionalNumber(body.receivedAtMs),
            title: requiredString(body.title, "title", 500),
            estimatedSeconds: requiredNumber(
              body.estimatedSeconds,
              "estimatedSeconds",
            ),
            targetDate: optionalString(body.targetDate, 10),
            windowStartMs: optionalNumber(body.windowStartMs),
            windowEndMs: optionalNumber(body.windowEndMs),
            explicitCategoryId: optionalString(body.explicitCategoryId, 100),
            taskUuid: optionalString(body.taskUuid, 64),
            projectSnapshot: optionalString(body.projectSnapshot, 200),
            tags: optionalStringArray(body.tags),
            source: optionalString(body.source, 40) as
              | ActivitySource
              | undefined,
            note: optionalString(body.note, 2000),
            rawInput: optionalString(body.rawInput, 2000),
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/locate",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        return {
          status: 200,
          body: s.locateEstimate({
            idempotencyKey: requiredString(
              body.idempotencyKey,
              "idempotencyKey",
              200,
            ),
            activityId: requiredString(body.activityId, "activityId", 64),
            expectedVersion: requiredNumber(
              body.expectedVersion,
              "expectedVersion",
            ),
            startMs: requiredNumber(body.startMs, "startMs"),
            endMs: requiredNumber(body.endMs, "endMs"),
            receivedAtMs: optionalNumber(body.receivedAtMs),
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/update",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        if (!body.patch || typeof body.patch !== "object") {
          throw new TimeStoreError(
            400,
            "INVALID_PATCH",
            "Missing update patch object.",
          );
        }
        return {
          status: 200,
          body: s.updateActivity({
            idempotencyKey: requiredString(
              body.idempotencyKey,
              "idempotencyKey",
              200,
            ),
            activityId: requiredString(body.activityId, "activityId", 64),
            expectedVersion: requiredNumber(
              body.expectedVersion,
              "expectedVersion",
            ),
            receivedAtMs: optionalNumber(body.receivedAtMs),
            patch: body.patch as Parameters<
              TimeStore["updateActivity"]
            >[0]["patch"],
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/undo",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        return {
          status: 200,
          body: s.undoOperation({
            idempotencyKey: requiredString(
              body.idempotencyKey,
              "idempotencyKey",
              200,
            ),
            targetOperationId: requiredString(
              body.targetOperationId,
              "targetOperationId",
              64,
            ),
            receivedAtMs: optionalNumber(body.receivedAtMs),
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/sleep/confirm",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        return {
          status: 200,
          body: s.confirmSleepCandidate({
            idempotencyKey: requiredString(
              body.idempotencyKey,
              "idempotencyKey",
              200,
            ),
            date: requiredString(body.date, "date", 10),
            receivedAtMs: optionalNumber(body.receivedAtMs),
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/sleep/dismiss",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody();
        return {
          status: 200,
          body: s.dismissSleepCandidate({
            idempotencyKey: requiredString(
              body.idempotencyKey,
              "idempotencyKey",
              200,
            ),
            date: requiredString(body.date, "date", 10),
            receivedAtMs: optionalNumber(body.receivedAtMs),
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/operation/resolve",
      handle: async ({ readBody }) => {
        requireEnabledStore();
        if (!coordinator) {
          throw new TimeStoreError(
            503,
            "COORDINATOR_UNAVAILABLE",
            "Time coordinator unavailable.",
          );
        }
        const body = await readBody();
        const operationId = requiredString(body.operationId, "operationId", 64);
        const action = requiredString(body.action, "action", 32);
        if (
          action !== "dismiss" &&
          action !== "accept_started" &&
          action !== "stop_active"
        ) {
          throw new TimeStoreError(
            400,
            "INVALID_ACTION",
            "Unsupported resolve action.",
          );
        }
        return {
          status: 200,
          body: await coordinator.resolvePending({
            operationId,
            action,
            effectiveAtMs: optionalNumber(body.effectiveAtMs),
          }),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/import/preview",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody(8 * 1024 * 1024);
        const intervals = await loadImportIntervals(body);
        const taskLookup = await loadReadOnlyTaskLookup();
        const cutoverAtMs =
          optionalNumber(body.cutoverAtMs) ??
          optionalNumber(body.cutoverMs) ??
          s.getStatus().cutoverAtMs ??
          Date.now();
        return {
          status: 200,
          body: analyzeTimewarriorSnapshot(s, {
            intervals,
            cutoverAtMs,
            clipOpenToCutover: Boolean(
              body.clipOpenToCutover ?? body.acceptOpenIntervalAsActivity,
            ),
            taskLookup,
          }).preview,
        };
      },
    },
    {
      method: "POST",
      route: "api/time/import/apply",
      handle: async ({ readBody }) => {
        const s = requireEnabledStore();
        const body = await readBody(8 * 1024 * 1024);
        const intervals = await loadImportIntervals(body);
        const taskLookup = await loadReadOnlyTaskLookup();
        const cutoverAtMs =
          optionalNumber(body.cutoverAtMs) ??
          optionalNumber(body.cutoverMs) ??
          s.getStatus().cutoverAtMs ??
          Date.now();
        return {
          status: 200,
          body: applyTimewarriorSnapshotImport(s, {
            intervals,
            cutoverAtMs,
            clipOpenToCutover: Boolean(
              body.clipOpenToCutover ?? body.acceptOpenIntervalAsActivity,
            ),
            taskLookup,
            nowMs: optionalNumber(body.receivedAtMs),
          }),
        };
      },
    },
    {
      method: "GET",
      route: "api/time/backup/export",
      handle: async () => {
        requireStore();
        if (!backup) {
          throw new TimeStoreError(
            503,
            "BACKUP_UNAVAILABLE",
            "Time backup unavailable.",
          );
        }
        return {
          status: 200,
          body: await backup.exportBundle(),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/backup/preview",
      handle: async ({ readBody }) => {
        requireStore();
        if (!backup) {
          throw new TimeStoreError(
            503,
            "BACKUP_UNAVAILABLE",
            "Time backup unavailable.",
          );
        }
        const body = await readBody(16 * 1024 * 1024);
        const sqliteBase64 = requiredString(
          body.sqliteBase64,
          "sqliteBase64",
          16 * 1024 * 1024,
        );
        const bytes = Buffer.from(sqliteBase64, "base64");
        return {
          status: 200,
          body: await backup.previewRestoreBuffer(bytes),
        };
      },
    },
    {
      method: "POST",
      route: "api/time/backup/restore",
      skipGate: true,
      handle: async ({ readBody }) => {
        requireStore();
        if (!backup) {
          throw new TimeStoreError(
            503,
            "BACKUP_UNAVAILABLE",
            "Time backup unavailable.",
          );
        }
        if (restoringTime) {
          throw Object.assign(
            new Error("Another Time restore is already running."),
            { status: 423 },
          );
        }
        const body = await readBody();
        const token = requiredString(body.token, "token", 128);
        restoringTime = true;
        try {
          return {
            status: 200,
            body: await gate.exclusive(() => backup.applyRestore(token)),
          };
        } finally {
          restoringTime = false;
        }
      },
    },
    {
      method: "POST",
      route: "api/internal/maintenance/backup",
      skipGate: true,
      handle: async ({ readBody, transport }) => {
        if (transport !== "ipc") {
          throw Object.assign(
            new Error("Forbidden on public HTTP transport."),
            {
              status: 403,
            },
          );
        }
        const body = await readBody();
        const backupId = requiredString(body.backupId, "backupId", 64);
        const releaseId = optionalString(body.releaseId, 64);
        const taskchampionDbPath = paths.resolveTaskchampionDbPath
          ? await paths.resolveTaskchampionDbPath()
          : undefined;
        const result = await gate.exclusive(() =>
          runMaintenanceBackup({
            backupId,
            releaseId,
            sourceIdentity: identity,
            dataDir: paths.dataDir,
            organizationFile: paths.organizationFile,
            recoveryFile: paths.recoveryFile,
            timeFile: paths.timeFile,
            taskchampionDbPath,
            timeEnabled: isEnabled(),
            timeBackup: backup,
          }),
        );
        return {
          status: 200,
          body: result,
        };
      },
    },
  ];

  return routes;
}
