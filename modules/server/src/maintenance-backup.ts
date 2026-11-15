import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  checkSqliteBackupSupport,
  defaultBarrierPath,
  readBarrierState,
  sqliteOnlineBackup,
  verifySqliteIntegrity,
} from "./time/time-barrier.ts";
import type { TimeBackupService } from "./time/time-backup.ts";
import { CURRENT_TIME_SCHEMA_VERSION } from "./time/time-schema.ts";

const SAFE_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export type MaintenanceFileRecord = {
  relativePath: string;
  exists: boolean;
  bytes: number;
  sha256: string | null;
};

export type MaintenanceBackupManifest = {
  format: "aster-release-backup";
  version: 1;
  backupId: string;
  releaseId: string;
  sourceIdentity: string;
  createdAt: string;
  complete: true;
  files: Record<string, MaintenanceFileRecord>;
  time:
    | {
        status: "not_initialized";
      }
    | {
        status: "backed_up";
        enabled: boolean;
        schemaVersion: number;
        timeEpoch: number;
        taskDataEpoch: number;
        activeActivityId: string | null;
        pendingOperationsCount: number;
      };
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function hashAndStatFile(path: string): Promise<{
  bytes: number;
  sha256: string;
}> {
  const info = await stat(path);
  const content = await readFile(path);
  const sha256 = createHash("sha256").update(content).digest("hex");
  return { bytes: info.size, sha256 };
}

export async function runMaintenanceBackup(input: {
  backupId: string;
  releaseId?: string;
  sourceIdentity: string;
  dataDir: string;
  organizationFile: string;
  recoveryFile: string;
  timeFile: string;
  taskchampionDbPath?: string;
  timeEnabled: boolean;
  timeBackup?: TimeBackupService;
  minFreeBytes?: number;
}): Promise<{
  backupId: string;
  stagingDir: string;
  manifest: MaintenanceBackupManifest;
}> {
  if (!SAFE_ID_PATTERN.test(input.backupId)) {
    throw new Error(
      "Invalid backupId: must match /^[A-Za-z0-9_.-]{1,64}$/.",
    );
  }
  const releaseId = input.releaseId || input.backupId;
  if (!SAFE_ID_PATTERN.test(releaseId)) {
    throw new Error(
      "Invalid releaseId: must match /^[A-Za-z0-9_.-]{1,64}$/.",
    );
  }

  const dataRoot = resolve(input.dataDir);
  const stagingRoot = join(dataRoot, "backup-staging");
  await checkSqliteBackupSupport(stagingRoot);
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });

  // Verify target staging directory is writable and has sufficient free disk space.
  await access(stagingRoot, fsConstants.W_OK);
  try {
    const fsInfo = await statfs(stagingRoot);
    const freeBytes = Number(fsInfo.bavail) * Number(fsInfo.bsize);
    const threshold = input.minFreeBytes ?? 8 * 1024 * 1024;
    if (Number.isFinite(freeBytes) && freeBytes < threshold) {
      throw new Error(
        `Insufficient disk space in ${stagingRoot} (${freeBytes} bytes free, need >= ${threshold}).`,
      );
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("Insufficient disk space")
    ) {
      throw err;
    }
    // Some synthetic filesystems may not support statfs cleanly; proceed cleanly.
  }

  const finalDir = join(stagingRoot, input.backupId);
  if (await fileExists(finalDir)) {
    throw new Error(`Backup staging directory already exists: ${input.backupId}`);
  }

  const tmpDir = join(stagingRoot, `.tmp-${input.backupId}-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });

  try {
    const files: Record<string, MaintenanceFileRecord> = Object.create(null);

    const jsonCandidates: Array<[string, string]> = [
      ["organization.json", input.organizationFile],
      ["recovery.json", input.recoveryFile],
      ["restored-uda.json", join(dirname(input.organizationFile), "restored-uda.json")],
    ];
    for (const [key, srcPath] of jsonCandidates) {
      if (await fileExists(srcPath)) {
        const dest = join(tmpDir, key);
        await copyFile(srcPath, dest);
        await chmod(dest, 0o600);
        const { bytes, sha256 } = await hashAndStatFile(dest);
        files[key] = { relativePath: key, exists: true, bytes, sha256 };
      } else {
        files[key] = {
          relativePath: key,
          exists: false,
          bytes: 0,
          sha256: null,
        };
      }
    }

    if (input.taskchampionDbPath && (await fileExists(input.taskchampionDbPath))) {
      const dest = join(tmpDir, "taskchampion.sqlite3");
      await sqliteOnlineBackup(input.taskchampionDbPath, dest);
      await verifySqliteIntegrity(dest);
      await chmod(dest, 0o600);
      const { bytes, sha256 } = await hashAndStatFile(dest);
      files["taskchampion.sqlite3"] = {
        relativePath: "taskchampion.sqlite3",
        exists: true,
        bytes,
        sha256,
      };
    } else {
      files["taskchampion.sqlite3"] = {
        relativePath: "taskchampion.sqlite3",
        exists: false,
        bytes: 0,
        sha256: null,
      };
    }

    const timeExists = await fileExists(input.timeFile);
    if (input.timeEnabled && !timeExists) {
      throw new Error(
        `Time is enabled, but database file is missing at ${input.timeFile}.`,
      );
    }

    let timeSummary: MaintenanceBackupManifest["time"];
    if (!timeExists) {
      timeSummary = { status: "not_initialized" };
      files["time.sqlite"] = {
        relativePath: "time.sqlite",
        exists: false,
        bytes: 0,
        sha256: null,
      };
    } else if (input.timeBackup) {
      const timeStageDir = join(tmpDir, "time");
      const timeManifest = await input.timeBackup.exportStaging(timeStageDir, {
        backupId: input.backupId,
        releaseId,
      });
      const stagedSqlitePath = join(timeStageDir, "time.sqlite");
      await verifySqliteIntegrity(stagedSqlitePath);
      const flatTimePath = join(tmpDir, "time.sqlite");
      await copyFile(stagedSqlitePath, flatTimePath);
      await chmod(flatTimePath, 0o600);
      const timeStat = await hashAndStatFile(flatTimePath);
      files["time.sqlite"] = {
        relativePath: "time.sqlite",
        exists: true,
        bytes: timeStat.bytes,
        sha256: timeStat.sha256,
      };
      const barrierSrc = join(timeStageDir, "time-barrier.json");
      if (await fileExists(barrierSrc)) {
        const flatBarrier = join(tmpDir, "time-barrier.json");
        await copyFile(barrierSrc, flatBarrier);
        await chmod(flatBarrier, 0o600);
        const barrierStat = await hashAndStatFile(flatBarrier);
        files["time-barrier.json"] = {
          relativePath: "time-barrier.json",
          exists: true,
          bytes: barrierStat.bytes,
          sha256: barrierStat.sha256,
        };
      }
      timeSummary = {
        status: "backed_up",
        enabled: input.timeEnabled,
        schemaVersion: timeManifest.schemaVersion,
        timeEpoch: timeManifest.timeEpoch,
        taskDataEpoch: timeManifest.taskDataEpoch,
        activeActivityId: timeManifest.activeActivityId,
        pendingOperationsCount: timeManifest.pendingOperationsCount,
      };
    } else {
      // Offline / disabled-db backup using the exact same SQLite online backup + integrity check helpers.
      const flatTimePath = join(tmpDir, "time.sqlite");
      await sqliteOnlineBackup(input.timeFile, flatTimePath);
      await verifySqliteIntegrity(flatTimePath);
      await chmod(flatTimePath, 0o600);
      const timeStat = await hashAndStatFile(flatTimePath);
      files["time.sqlite"] = {
        relativePath: "time.sqlite",
        exists: true,
        bytes: timeStat.bytes,
        sha256: timeStat.sha256,
      };

      const barrierSrc = defaultBarrierPath(input.timeFile);
      const barrier = await readBarrierState(barrierSrc);
      const barrierDest = join(tmpDir, "time-barrier.json");
      await writeFile(barrierDest, JSON.stringify(barrier, null, 2), {
        mode: 0o600,
      });
      const barrierStat = await hashAndStatFile(barrierDest);
      files["time-barrier.json"] = {
        relativePath: "time-barrier.json",
        exists: true,
        bytes: barrierStat.bytes,
        sha256: barrierStat.sha256,
      };

      const inspectDb = new DatabaseSync(flatTimePath, { readOnly: true });
      try {
        const meta = inspectDb
          .prepare(
            "SELECT schema_version, enabled, time_epoch, task_data_epoch, active_activity_id FROM time_meta WHERE id = 1",
          )
          .get() as
          | {
              schema_version: number;
              enabled: number;
              time_epoch: number;
              task_data_epoch: number;
              active_activity_id: string | null;
            }
          | undefined;
        if (!meta) {
          throw new Error("time.sqlite backup missing time_meta row.");
        }
        if (meta.schema_version > CURRENT_TIME_SCHEMA_VERSION) {
          throw new Error(
            `Unsupported time.sqlite schema_version ${meta.schema_version}.`,
          );
        }
        const pendingCnt = (
          inspectDb
            .prepare(
              "SELECT COUNT(*) as cnt FROM operations WHERE state IN ('prepared', 'external_acknowledged', 'skipped_already_satisfied', 'pending_reconcile')",
            )
            .get() as { cnt: number }
        ).cnt;
        timeSummary = {
          status: "backed_up",
          enabled: meta.enabled === 1,
          schemaVersion: meta.schema_version,
          timeEpoch: Math.max(meta.time_epoch, barrier.timeEpoch),
          taskDataEpoch: Math.max(meta.task_data_epoch, barrier.taskDataEpoch),
          activeActivityId: meta.active_activity_id,
          pendingOperationsCount: pendingCnt,
        };
      } finally {
        inspectDb.close();
      }
    }

    const manifest: MaintenanceBackupManifest = {
      format: "aster-release-backup",
      version: 1,
      backupId: input.backupId,
      releaseId,
      sourceIdentity: input.sourceIdentity,
      createdAt: new Date().toISOString(),
      complete: true,
      files,
      time: timeSummary,
    };

    const manifestPath = join(tmpDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await rename(tmpDir, finalDir);
    return {
      backupId: input.backupId,
      stagingDir: finalDir,
      manifest,
    };
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
