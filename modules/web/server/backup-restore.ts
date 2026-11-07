import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  chmod,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { TaskService } from "../../../src/core/tasks/service.ts";
import type { createOrganizationService } from "./organization-service.ts";
import type { createRecoveryService } from "./recovery.ts";
import type { createWorkspaceGate } from "./workspace-gate.ts";
import {
  backupCounts,
  pausedBackup,
  validateBackup,
  type AsterBackup,
} from "./backup-validation.ts";
import {
  canonical,
  canonicalTasks,
  canonicalIntervals,
  nativePaths,
  sqliteSnapshot,
  stageNative,
} from "./native-restore.ts";
import type { RestorePreview, RestorePoint } from "../shared/backup.ts";

type Item = {
  live: string;
  previous: string;
  staged: string | null;
  existed: boolean;
};
type Manifest = RestorePoint & { items: Item[]; token: string };
const exists = async (path: string) =>
  stat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
export async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + randomUUID() + ".tmp";
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
}
export function createBackupRestore(
  service: TaskService,
  organization: ReturnType<typeof createOrganizationService>,
  recovery: ReturnType<typeof createRecoveryService>,
  gate: ReturnType<typeof createWorkspaceGate>,
  paths: { organization: string; recovery: string },
) {
  const root = join(dirname(paths.organization), "restore-points");
  const schemaFile = join(dirname(paths.organization), "restored-uda.json");
  const plans = new Map<
    string,
    {
      data: AsterBackup;
      fingerprint: string;
      expires: number;
      preview: RestorePreview;
    }
  >();
  async function snapshot() {
    return (await recovery.export()) as AsterBackup;
  }
  const fingerprint = (data: AsterBackup) =>
    createHash("sha256")
      .update(
        canonical({
          tasks: canonicalTasks(data.taskwarrior.tasks),
          uda: data.taskwarrior.uda,
          organization: data.organization,
          recovery: data.recovery,
          timers: canonicalIntervals(data.timewarrior.intervals || []),
          available: data.timewarrior.available,
        }),
      )
      .digest("hex");
  const active = (data: AsterBackup) =>
    data.taskwarrior.tasks.some(
      (task) =>
        !!task.start &&
        task.status !== "deleted" &&
        task.status !== "completed",
    ) || !!data.timewarrior.intervals?.some((interval) => !interval.end);
  async function loadSchema() {
    if (await exists(schemaFile)) {
      const schema = JSON.parse(await readFile(schemaFile, "utf8"));
      if (
        !schema ||
        Array.isArray(schema) ||
        typeof schema !== "object" ||
        Object.entries(schema).some(
          ([key, value]) =>
            !/^uda\.[A-Za-z0-9_.-]+$/.test(key) ||
            typeof value !== "string" ||
            /[\0\r\n]/.test(value),
        )
      )
        throw new Error("Restored task field definitions are invalid.");
      service.setRestoredSchema(schema);
    }
  }
  async function points(): Promise<RestorePoint[]> {
    const dirs = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const result: RestorePoint[] = [];
    for (const id of dirs) {
      if (!/^[0-9a-f-]{36}$/.test(id)) continue;
      const file = join(root, id, "manifest.json");
      if (!(await exists(file))) continue;
      const data = JSON.parse(await readFile(file, "utf8")) as Manifest;
      result.push({ id, createdAt: data.createdAt, state: data.state });
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function rollback(directory: string, manifest: Manifest) {
    for (const item of [...manifest.items].reverse()) {
      if (await exists(item.previous)) {
        await rm(item.live, { recursive: true, force: true });
        await rename(item.previous, item.live);
      } else if (!item.existed && item.staged && !(await exists(item.staged)))
        await rm(item.live, { recursive: true, force: true });
    }
    manifest.state = "rolledBack";
    await atomicJson(join(directory, "manifest.json"), manifest);
  }
  async function repair() {
    const pending = (await points()).filter(
      (point) => point.state === "prepared",
    );
    if (pending.length) {
      const native = await nativePaths(service);
      const allowed = new Set(
        [
          native.database,
          native.database + "-wal",
          native.database + "-shm",
          native.timers,
          paths.organization,
          paths.recovery,
          schemaFile,
        ].map((path) => resolve(path)),
      );
      for (const point of pending) {
        const directory = join(root, point.id);
        const manifest = JSON.parse(
          await readFile(join(directory, "manifest.json"), "utf8"),
        ) as Manifest;
        if (
          !Array.isArray(manifest.items) ||
          manifest.items.some(
            (item) =>
              !allowed.has(resolve(item.live)) ||
              !resolve(item.previous).startsWith(directory + "/") ||
              (item.staged &&
                !resolve(item.staged).startsWith(directory + "/")),
          )
        )
          throw new Error(
            "Unsafe restore manifest. Keep the restore point and inspect before starting Aster.",
          );
        await rollback(directory, manifest);
      }
    }
    await loadSchema();
  }
  async function preview(value: unknown): Promise<RestorePreview> {
    const data = validateBackup(value);
    const current = await snapshot();
    if (!current.timewarrior.available)
      throw new Error(
        "Current timer history is unavailable. Repair the timer connection before replacing the workspace.",
      );
    // Limit memory and expire uploads. A plan contains no client-supplied filesystem paths.
    for (const [id, plan] of plans)
      if (plan.expires < Date.now()) plans.delete(id);
    if (plans.size >= 3) plans.delete(plans.keys().next().value!);
    const token = randomUUID();
    const result: RestorePreview = {
      token,
      exportedAt: data.exportedAt,
      current: backupCounts(current),
      incoming: backupCounts(data),
      activeTimers: active(current),
      stoppedOccurrences:
        data.taskwarrior.tasks.filter((task) => !!task.start).length +
        (data.timewarrior.intervals || []).filter((interval) => !interval.end)
          .length,
      warnings: [
        "The current workspace will be replaced. A restore point will be saved first.",
        "Close other Taskwarrior and TinyCast clients before restoring.",
      ],
    };
    plans.set(token, {
      data,
      fingerprint: fingerprint(current),
      expires: Date.now() + 10 * 60_000,
      preview: result,
    });
    return result;
  }
  let preparing = false;
  async function apply(token: unknown) {
    if (preparing)
      throw Object.assign(new Error("Another backup is being prepared."), {
        status: 423,
      });
    preparing = true;
    try {
      return await applyPrepared(token);
    } finally {
      preparing = false;
    }
  }
  async function applyPrepared(token: unknown) {
    if (typeof token !== "string")
      throw new Error("Choose and preview a backup first.");
    const plan = plans.get(token);
    if (!plan || plan.expires < Date.now())
      throw new Error("Preview expired. Preview the file again.");
    const release = gate.enter();
    try {
      const current = await snapshot();
      if (fingerprint(current) !== plan.fingerprint)
        throw Object.assign(
          new Error(
            "Workspace changed after preview. Preview again before restoring.",
          ),
          { status: 409 },
        );
      if (active(current))
        throw new Error("Stop all running timers before restoring.");
    } finally {
      release();
    }
    const data = pausedBackup(plan.data);
    const id = randomUUID();
    const directory = join(root, id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const native = await nativePaths(service);
      const device = (await stat(directory)).dev;
      if (
        (await stat(dirname(native.database))).dev !== device ||
        (await stat(dirname(native.timers))).dev !== device
      )
        throw new Error(
          "Restore requires workspace and native data on the same filesystem for an atomic switch.",
        );
      const staged = await stageNative(service, data, directory);
      return await gate.exclusive(async () => {
        const current = await snapshot();
        if (fingerprint(current) !== plan.fingerprint)
          throw Object.assign(
            new Error(
              "Workspace changed after preview. Preview again before restoring.",
            ),
            { status: 409 },
          );
        if (active(current))
          throw new Error("Stop all running timers before restoring.");
        const original = join(directory, "before.json");
        await atomicJson(original, current);
        await sqliteSnapshot(
          native.database,
          join(directory, "before.sqlite3"),
        );
        await chmod(join(directory, "before.sqlite3"), 0o600);
        const nextOrg = {
          ...data.organization,
          revision:
            Math.max(
              current.organization.revision,
              data.organization.revision,
            ) + 1,
        };
        await atomicJson(join(directory, "organization.json"), nextOrg);
        await atomicJson(join(directory, "recovery.json"), data.recovery);
        await atomicJson(
          join(directory, "uda.json"),
          data.taskwarrior.uda || {},
        );
        // A second read catches CLI changes during backup creation. Other clients must stay closed for the short swap.
        if (fingerprint(await snapshot()) !== plan.fingerprint)
          throw Object.assign(
            new Error("Native data changed during preparation. Preview again."),
            { status: 409 },
          );
        const candidates: [string, string | null][] = [
          [native.database, staged.database],
          [native.database + "-wal", null],
          [native.database + "-shm", null],
          [native.timers, staged.timers],
          [paths.organization, join(directory, "organization.json")],
          [paths.recovery, join(directory, "recovery.json")],
          [schemaFile, join(directory, "uda.json")],
        ];
        const items: Item[] = [];
        for (const [live, staged] of candidates)
          items.push({
            live,
            staged,
            previous: join(directory, `original-${items.length}`),
            existed: await exists(live),
          });
        const manifest: Manifest = {
          id,
          token,
          createdAt: new Date().toISOString(),
          state: "prepared",
          items,
        };
        await atomicJson(join(directory, "manifest.json"), manifest);
        try {
          for (const item of items) {
            await mkdir(dirname(item.live), { recursive: true });
            if (item.existed) await rename(item.live, item.previous);
            if (item.staged) {
              await rename(item.staged, item.live);
              const info = await stat(item.live);
              if (info.isFile()) await chmod(item.live, 0o600);
            }
          }
          manifest.state = "committed";
          await atomicJson(join(directory, "manifest.json"), manifest);
          service.setRestoredSchema(data.taskwarrior.uda || {});
          plans.delete(token);
          return { ok: true, id };
        } catch (error) {
          try {
            await rollback(directory, manifest);
            await loadSchema();
          } catch (rollbackError) {
            throw Object.assign(
              new Error(
                "Restore could not be confirmed. Keep the restore point and restart Aster to recover.",
                { cause: rollbackError },
              ),
              { outcome: "unknown" },
            );
          }
          throw new Error(
            "Restore failed and the previous workspace was restored.",
            { cause: error },
          );
        }
      });
    } catch (error) {
      if (!(await exists(join(directory, "manifest.json"))))
        await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async function download(id: string) {
    if (
      !/^[0-9a-f-]{36}$/.test(id) ||
      !(await points()).some((point) => point.id === id)
    )
      throw new Error("Restore point not found.");
    return JSON.parse(await readFile(join(root, id, "before.json"), "utf8"));
  }
  return { repair, preview, apply, points, download };
}
