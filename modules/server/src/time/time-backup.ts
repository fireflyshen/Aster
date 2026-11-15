import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  atomicWriteJson,
  sha256File,
  sqliteOnlineBackup,
  verifySqliteIntegrity,
} from "./time-barrier.ts";
import { CURRENT_TIME_SCHEMA_VERSION } from "./time-schema.ts";
import { TimeStoreError, type TimeStore } from "./time-store.ts";

export type TimeBackupManifest = {
  backupId: string;
  releaseId?: string;
  identity?: string;
  createdAt: string;
  schemaVersion: number;
  timeEpoch: number;
  taskDataEpoch: number;
  restoreBarrierAt: number;
  sessionVersion: number;
  activeActivityId: string | null;
  pendingOperationsCount: number;
  files: {
    sqlite: { name: string; sha256: string; bytes: number };
    barrier?: { name: string; sha256: string; bytes: number };
  };
};

export type TimeRestorePreview = {
  token: string;
  candidateSchemaVersion: number;
  candidateCounts: {
    activities: number;
    operations: number;
    importBatches: number;
    hasOpenActivity: boolean;
  };
  currentCounts: {
    activities: number;
    timeEpoch: number;
    taskDataEpoch: number;
    sessionVersion: number;
    hasOpenActivity: boolean;
  };
  warnings: string[];
};

type RestorePlan = {
  candidatePath: string;
  currentFingerprint: string;
  expiresAt: number;
  preview: TimeRestorePreview;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function createTimeBackupService(
  store: TimeStore,
  options: {
    restoreRootDir?: string;
    identity?: string;
    now?: () => number;
  } = {},
) {
  const nowFn = options.now ?? (() => Date.now());
  const restoreRoot =
    options.restoreRootDir ??
    join(dirname(store.dbPath), "time-restore-points");
  const plans = new Map<string, RestorePlan>();

  function currentFingerprint(): string {
    const status = store.getStatus();
    return `${status.timeEpoch}:${status.taskDataEpoch}:${status.sessionVersion}:${status.activeActivity?.id ?? ""}`;
  }

  async function exportStaging(
    stagingDir: string,
    metaInput: { backupId?: string; releaseId?: string } = {},
  ): Promise<TimeBackupManifest> {
    const backupId = metaInput.backupId ?? randomUUID();
    await mkdir(stagingDir, { recursive: true, mode: 0o700 });

    const targetSqlite = join(stagingDir, "time.sqlite");
    const sqliteCheck = await sqliteOnlineBackup(store.dbPath, targetSqlite);

    let barrierFileInfo:
      | { name: string; sha256: string; bytes: number }
      | undefined;
    if (await fileExists(store.barrierPath)) {
      const targetBarrier = join(stagingDir, "time-barrier.json");
      await copyFile(store.barrierPath, targetBarrier);
      const info = await sha256File(targetBarrier);
      barrierFileInfo = { name: "time-barrier.json", ...info };
    }

    const status = store.getStatus();
    const manifest: TimeBackupManifest = {
      backupId,
      ...(metaInput.releaseId ? { releaseId: metaInput.releaseId } : {}),
      ...(options.identity ? { identity: options.identity } : {}),
      createdAt: new Date(nowFn()).toISOString(),
      schemaVersion: status.schemaVersion,
      timeEpoch: status.timeEpoch,
      taskDataEpoch: status.taskDataEpoch,
      restoreBarrierAt: status.restoreBarrierAt,
      sessionVersion: status.sessionVersion,
      activeActivityId: status.activeActivity?.id ?? null,
      pendingOperationsCount: status.pendingOperationsCount,
      files: {
        sqlite: { name: "time.sqlite", ...sqliteCheck },
        ...(barrierFileInfo ? { barrier: barrierFileInfo } : {}),
      },
    };

    // Publish manifest last so unfinished staging directories are never treated as complete.
    await atomicWriteJson(join(stagingDir, "manifest.json"), manifest);
    return manifest;
  }

  async function previewRestore(
    candidateSqlitePath: string,
  ): Promise<TimeRestorePreview> {
    if (!(await fileExists(candidateSqlitePath))) {
      throw new TimeStoreError(
        400,
        "BACKUP_FILE_MISSING",
        "Backup database file does not exist.",
      );
    }

    await verifySqliteIntegrity(candidateSqlitePath);

    let candidateSchemaVersion = 0;
    let candidateActivities = 0;
    let candidateOperations = 0;
    let candidateBatches = 0;
    let candidateHasOpen = false;

    const db = new DatabaseSync(candidateSqlitePath, { readOnly: true });
    try {
      const meta = db
        .prepare(
          "SELECT schema_version, active_activity_id FROM time_meta WHERE id = 1",
        )
        .get() as
        | { schema_version: number; active_activity_id: string | null }
        | undefined;
      if (!meta) {
        throw new TimeStoreError(
          400,
          "INVALID_TIME_BACKUP",
          "Backup file is missing time_meta table.",
        );
      }
      if (meta.schema_version > CURRENT_TIME_SCHEMA_VERSION) {
        throw new TimeStoreError(
          400,
          "UNSUPPORTED_SCHEMA_VERSION",
          `Backup schema version ${meta.schema_version} is newer than supported version ${CURRENT_TIME_SCHEMA_VERSION}.`,
        );
      }
      candidateSchemaVersion = meta.schema_version;
      candidateActivities = (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM activities WHERE review_state != 'voided'",
          )
          .get() as {
          cnt: number;
        }
      ).cnt;
      candidateOperations = (
        db.prepare("SELECT COUNT(*) as cnt FROM operations").get() as {
          cnt: number;
        }
      ).cnt;
      candidateBatches = (
        db.prepare("SELECT COUNT(*) as cnt FROM import_batches").get() as {
          cnt: number;
        }
      ).cnt;
      const openCount = (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM activities WHERE kind = 'located' AND end_ms IS NULL AND review_state != 'voided'",
          )
          .get() as { cnt: number }
      ).cnt;
      candidateHasOpen = openCount > 0 || Boolean(meta.active_activity_id);
    } finally {
      db.close();
    }

    for (const [id, plan] of plans) {
      if (plan.expiresAt < nowFn()) plans.delete(id);
    }
    if (plans.size >= 5) {
      plans.delete(plans.keys().next().value!);
    }

    const status = store.getStatus();
    const currentActivities = store.queryActivities().length;
    const token = randomUUID();
    const warnings: string[] = [
      "Restoring Time will replace the current time.sqlite ledger after saving a pre-restore backup.",
    ];
    if (candidateHasOpen) {
      warnings.push(
        "The backup contains an open activity; it will be frozen for review at restore time rather than counting server downtime.",
      );
    }

    const preview: TimeRestorePreview = {
      token,
      candidateSchemaVersion,
      candidateCounts: {
        activities: candidateActivities,
        operations: candidateOperations,
        importBatches: candidateBatches,
        hasOpenActivity: candidateHasOpen,
      },
      currentCounts: {
        activities: currentActivities,
        timeEpoch: status.timeEpoch,
        taskDataEpoch: status.taskDataEpoch,
        sessionVersion: status.sessionVersion,
        hasOpenActivity: Boolean(status.activeActivity),
      },
      warnings,
    };

    plans.set(token, {
      candidatePath: candidateSqlitePath,
      currentFingerprint: currentFingerprint(),
      expiresAt: nowFn() + 10 * 60_000,
      preview,
    });
    return preview;
  }

  async function applyRestore(token: string) {
    const plan = plans.get(token);
    if (!plan || plan.expiresAt < nowFn()) {
      throw new TimeStoreError(
        400,
        "RESTORE_PREVIEW_EXPIRED",
        "Restore preview is missing or expired. Preview the backup again.",
      );
    }
    if (currentFingerprint() !== plan.currentFingerprint) {
      throw new TimeStoreError(
        409,
        "TIME_CHANGED_AFTER_PREVIEW",
        "Time state changed after preview. Preview again before restoring.",
      );
    }

    await verifySqliteIntegrity(plan.candidatePath);
    plans.delete(token);

    const restoreId = randomUUID();
    const preRestoreDir = join(restoreRoot, `before-${restoreId}`);
    await exportStaging(preRestoreDir, { backupId: restoreId });

    const ts = nowFn();
    store.setRestoring(true);
    try {
      store.close();
      await rm(`${store.dbPath}-wal`, { force: true });
      await rm(`${store.dbPath}-shm`, { force: true });
      await copyFile(plan.candidatePath, store.dbPath);

      const nextBarrier = await store.reopenAfterExternalSwap({
        bumpTimeEpoch: true,
        setRestoreBarrierAt: ts,
        freezeActiveAtMs: ts,
      });
      store.setRestoring(false);

      const status = store.getStatus();
      return {
        restoreId,
        preRestoreDir,
        timeEpoch: nextBarrier.timeEpoch,
        taskDataEpoch: nextBarrier.taskDataEpoch,
        restoreBarrierAt: nextBarrier.restoreBarrierAt,
        frozenActiveActivityId: status.activeActivity?.id ?? null,
        pendingOperationsCount: status.pendingOperationsCount,
      };
    } finally {
      store.setRestoring(false);
    }
  }

  async function previewRestoreBuffer(
    bytes: Buffer,
  ): Promise<TimeRestorePreview> {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new TimeStoreError(
        400,
        "INVALID_TIME_BACKUP",
        "Backup database payload is empty or invalid.",
      );
    }
    await mkdir(restoreRoot, { recursive: true, mode: 0o700 });
    const candidatePath = join(restoreRoot, `candidate-${randomUUID()}.sqlite`);
    await writeFile(candidatePath, bytes, { mode: 0o600 });
    try {
      return await previewRestore(candidatePath);
    } catch (error) {
      await rm(candidatePath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function exportBundle() {
    const backupId = randomUUID();
    const tempDir = join(restoreRoot, `export-${backupId}`);
    try {
      const manifest = await exportStaging(tempDir, { backupId });
      const sqliteBytes = await readFile(join(tempDir, "time.sqlite"));
      const barrierJson = await store.readBarrier();
      return {
        format: "aster-time-backup" as const,
        version: 1 as const,
        manifest,
        barrier: barrierJson,
        sqliteBase64: sqliteBytes.toString("base64"),
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  return {
    exportStaging,
    exportBundle,
    previewRestore,
    previewRestoreBuffer,
    applyRestore,
  };
}

export type TimeBackupService = ReturnType<typeof createTimeBackupService>;
