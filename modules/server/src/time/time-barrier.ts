import { createHash, randomUUID } from "node:crypto";
import { open, readFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

export type TimeBarrierState = {
    timeEpoch: number;
    taskDataEpoch: number;
    restoreBarrierAt: number;
    updatedAtMs: number;
};

export const DEFAULT_BARRIER_STATE = (): TimeBarrierState => ({
    timeEpoch: 1,
    taskDataEpoch: 1,
    restoreBarrierAt: 0,
    updatedAtMs: 0,
});

export function defaultBarrierPath(dbPath: string): string {
    return `${dbPath}.barrier.json`;
}

export async function atomicWriteJson(
    path: string,
    value: unknown,
): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    const file = await open(temp, "wx", 0o600);
    try {
        await file.writeFile(JSON.stringify(value, null, 2));
        await file.sync();
    } finally {
        await file.close();
    }
    await rename(temp, path);
}

export async function readBarrierState(
    barrierPath: string,
): Promise<TimeBarrierState> {
    try {
        const raw = JSON.parse(
            await readFile(barrierPath, "utf8"),
        ) as Partial<TimeBarrierState>;
        return {
            timeEpoch:
                typeof raw.timeEpoch === "number" && raw.timeEpoch >= 1
                    ? Math.floor(raw.timeEpoch)
                    : 1,
            taskDataEpoch:
                typeof raw.taskDataEpoch === "number" && raw.taskDataEpoch >= 1
                    ? Math.floor(raw.taskDataEpoch)
                    : 1,
            restoreBarrierAt:
                typeof raw.restoreBarrierAt === "number" &&
                raw.restoreBarrierAt >= 0
                    ? Math.floor(raw.restoreBarrierAt)
                    : 0,
            updatedAtMs:
                typeof raw.updatedAtMs === "number" && raw.updatedAtMs >= 0
                    ? Math.floor(raw.updatedAtMs)
                    : 0,
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return DEFAULT_BARRIER_STATE();
        }
        throw error;
    }
}

export async function writeBarrierState(
    barrierPath: string,
    next: TimeBarrierState,
): Promise<TimeBarrierState> {
    const current = await readBarrierState(barrierPath);
    const monotonic: TimeBarrierState = {
        timeEpoch: Math.max(current.timeEpoch, next.timeEpoch),
        taskDataEpoch: Math.max(current.taskDataEpoch, next.taskDataEpoch),
        restoreBarrierAt: Math.max(
            current.restoreBarrierAt,
            next.restoreBarrierAt,
        ),
        updatedAtMs: Math.max(current.updatedAtMs, next.updatedAtMs),
    };
    await atomicWriteJson(barrierPath, monotonic);
    return monotonic;
}

export async function sha256File(
    filePath: string,
): Promise<{ sha256: string; bytes: number }> {
    const content = await readFile(filePath);
    const info = await stat(filePath);
    return {
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: info.size,
    };
}

export async function verifySqliteIntegrity(dbPath: string): Promise<void> {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
        const row = db.prepare("PRAGMA integrity_check").get() as
            Record<string, unknown> | undefined;
        const value = row ? Object.values(row)[0] : undefined;
        if (value !== "ok") {
            throw new Error(`SQLite integrity_check failed: ${String(value)}`);
        }
    } finally {
        db.close();
    }
}

export async function sqliteOnlineBackup(
    sourcePath: string,
    targetPath: string,
): Promise<{ sha256: string; bytes: number }> {
    if (typeof backup !== "function") {
        throw new Error(
            "Current Node.js runtime does not support node:sqlite backup(). Node 22.16.0+ is required.",
        );
    }
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(sourcePath, { readOnly: true });
    try {
        await backup(db, targetPath);
    } finally {
        db.close();
    }
    await verifySqliteIntegrity(targetPath);
    return sha256File(targetPath);
}

/**
 * Runtime preflight verifying DatabaseSync, backup(), and PRAGMA integrity_check
 * against a temporary database before starting or upgrading Time storage.
 */
export async function checkSqliteBackupSupport(
    scratchDir: string,
): Promise<{ nodeVersion: string; ok: true }> {
    if (typeof backup !== "function") {
        throw new Error(
            `Node ${process.version} lacks node:sqlite backup() (requires >= 22.16.0).`,
        );
    }
    await mkdir(scratchDir, { recursive: true, mode: 0o700 });
    const tempSrc = `${scratchDir}/preflight-src-${randomUUID()}.sqlite`;
    const tempDst = `${scratchDir}/preflight-dst-${randomUUID()}.sqlite`;
    const { rm } = await import("node:fs/promises");
    try {
        const db = new DatabaseSync(tempSrc);
        try {
            db.exec(
                "CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY);",
            );
        } finally {
            db.close();
        }
        await sqliteOnlineBackup(tempSrc, tempDst);
        return { nodeVersion: process.version, ok: true };
    } finally {
        await Promise.all([
            rm(tempSrc, { force: true }).catch(() => undefined),
            rm(tempDst, { force: true }).catch(() => undefined),
            rm(`${tempSrc}-wal`, { force: true }).catch(() => undefined),
            rm(`${tempSrc}-shm`, { force: true }).catch(() => undefined),
        ]);
    }
}
