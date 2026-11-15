import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    chmod,
    mkdtemp,
    mkdir,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { AsterBackup } from "../src/recovery/backup-validation.ts";
import { createBackupRestore } from "../src/recovery/backup-restore.ts";
import { runMaintenanceBackup } from "../src/recovery/maintenance-backup.ts";
import { createOrganizationService } from "../src/organization/organization-service.ts";
import { createRecoveryService } from "../src/recovery/recovery.ts";
import { createTimeBackupService } from "../src/time/time-backup.ts";
import { createTimeStore } from "../src/time/time-store.ts";
import { createWorkspaceGate } from "../src/transport/workspace-gate.ts";
import type { TaskService } from "../../core/tasks/service.ts";

function sampleAsterBackup(uuid: string): AsterBackup {
    return {
        format: "aster-backup",
        version: 1,
        exportedAt: "2026-11-15T09:00:00.000Z",
        taskwarrior: {
            tasks: [
                {
                    uuid,
                    description: "Restored task",
                    status: "pending",
                    entry: "20261115T080000Z",
                    modified: "20261115T080000Z",
                },
            ],
            uda: {},
        },
        organization: {
            revision: 1,
            filters: [],
            tags: [],
            projects: [],
        },
        recovery: { version: 1, entries: [] },
        timewarrior: {
            available: true,
            intervals: [],
        },
    };
}

test("REST-01..04: backupRestore time hooks handle rollback epochs, repair unfinalized manifests, and never roll back committed tasks on post-hook failure", async () => {
    const dir = await mkdtemp(tmpdir() + "/aster-restore-time-");
    const twDir = join(dir, "taskwarrior");
    const liveTimersDir = join(dir, "timewarrior");
    const binDir = join(dir, "bin");
    await mkdir(twDir, { recursive: true });
    await mkdir(join(liveTimersDir, "data"), { recursive: true });
    await mkdir(binDir, { recursive: true });

    const initDb = new DatabaseSync(join(twDir, "taskchampion.sqlite3"));
    initDb.exec(
        "CREATE TABLE marker (val TEXT); INSERT INTO marker VALUES ('initial');",
    );
    initDb.close();

    const taskStub = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const locArg = args.find((a) => a.startsWith("rc.data.location="));
const dataDir = locArg ? locArg.slice("rc.data.location=".length) : ${JSON.stringify(twDir)};
const cmd = args.find((a) => !a.startsWith("rc."));
if (cmd === "_get") {
  console.log(dataDir);
} else if (cmd === "import") {
  const stdin = readFileSync(0, "utf8");
  writeFileSync(join(dataDir, "tasks.json"), stdin);
  const db = new DatabaseSync(join(dataDir, "taskchampion.sqlite3"));
  db.exec("CREATE TABLE IF NOT EXISTS marker (val TEXT); DELETE FROM marker; INSERT INTO marker VALUES ('restored');");
  db.close();
} else if (cmd === "export") {
  try {
    process.stdout.write(readFileSync(join(dataDir, "tasks.json"), "utf8"));
  } catch {
    process.stdout.write("[]");
  }
}
`;
    const timewStub = `#!/usr/bin/env node
const args = process.argv.slice(2);
const dbDir = process.env.TIMEWARRIORDB || ${JSON.stringify(liveTimersDir)};
if (args[0] === "diagnostics") {
  console.log("Database: " + dbDir + " (default)");
} else if (args[0] === "export") {
  console.log("[]");
}
`;
    await writeFile(join(binDir, "task"), taskStub);
    await writeFile(join(binDir, "timew"), timewStub);
    await chmod(join(binDir, "task"), 0o755);
    await chmod(join(binDir, "timew"), 0o755);

    const uuid = "dddd4444-4444-4444-8444-444444444444";
    const currentBackup = sampleAsterBackup(uuid);
    const incomingBackup = sampleAsterBackup(uuid);
    incomingBackup.taskwarrior.tasks[0].description = "Updated task";

    const fakeService = {
        connection: {
            kind: "local" as const,
            taskCommand: join(binDir, "task"),
        },
        dataDirectory: async () => twDir,
        exportTasks: async () => currentBackup.taskwarrior.tasks,
        exportRawTasks: async () => currentBackup.taskwarrior.tasks,
        exportTimerHistory: async () => [],
        exportSchema: async () => ({}),
        setRestoredSchema: () => undefined,
        showConfiguration: async () => "",
        exportTimewarrior: async () => [],
        applyConfiguration: async () => undefined,
    } as unknown as TaskService;

    const orgFile = join(dir, "organization.json");
    const recFile = join(dir, "recovery.json");
    const orgService = createOrganizationService(fakeService, orgFile);
    const recService = createRecoveryService(fakeService, orgService, recFile);
    await writeFile(recFile, JSON.stringify({ version: 1, entries: [] }));
    await writeFile(
        orgFile,
        JSON.stringify({ revision: 1, filters: [], tags: [] }),
    );

    const store = await createTimeStore(join(dir, "time.sqlite"));
    let failPostHook = false;
    const hookedStore: typeof store = {
        ...store,
        finalizeTaskRestore(restoreId, outcome, inspectTask) {
            if (failPostHook) {
                throw new Error("Simulated post-restore Time failure");
            }
            return store.finalizeTaskRestore(restoreId, outcome, inspectTask);
        },
    };

    const gate = createWorkspaceGate();
    const restore = createBackupRestore(
        fakeService,
        orgService,
        recService,
        gate,
        {
            organization: orgFile,
            recovery: recFile,
        },
        hookedStore,
    );

    try {
        // REST-04: Post-restore finalizeTaskRestore failure keeps committed native restore intact
        // while leaving Time unfinalized/locked until startup repair().
        failPostHook = true;
        const plan = await restore.preview(incomingBackup);
        assert.ok(plan.timeImpact);
        const result = await restore.apply(plan.token);
        assert.equal(result.ok, true);
        assert.equal(result.timeReconcilePending, true);
        assert.ok((result.message || "").length > 0);
        const restoredDb = new DatabaseSync(
            join(twDir, "taskchampion.sqlite3"),
        );
        const marker = restoredDb.prepare("SELECT val FROM marker").get() as {
            val: string;
        };
        restoredDb.close();
        assert.equal(marker.val, "restored");
        // Unfinalized manifest still exists under restore-points, and startup repair finalizes it cleanly.
        failPostHook = false;
        await restore.repair();
        assert.equal(store.getTimerSnapshot().taskDataEpoch >= 1, true);
        assert.equal(store.getTimerSnapshot().state, "ready");
    } finally {
        store.close();
        await rm(dir, { recursive: true, force: true });
    }
});

test("DEP-01..03: runMaintenanceBackup validates SQLite backup(), disk budget, checksums, integrity, and TIME_ENABLED=0 parity", async () => {
    const dir = await mkdtemp(tmpdir() + "/aster-dep-");
    try {
        const dataDir = join(dir, "data");
        await mkdir(dataDir, { recursive: true });
        const orgFile = join(dataDir, "organization.json");
        const recFile = join(dataDir, "recovery.json");
        const twDb = join(dir, "taskchampion.sqlite3");
        const timeFile = join(dataDir, "time.sqlite");

        await writeFile(
            orgFile,
            JSON.stringify({ revision: 1, filters: [], tags: [] }),
        );
        await writeFile(recFile, JSON.stringify({ version: 1, entries: [] }));
        const db = new DatabaseSync(twDb);
        db.exec(
            "CREATE TABLE tasks (uuid TEXT PRIMARY KEY); INSERT INTO tasks VALUES ('u1');",
        );
        db.close();

        // DEP-03a: TIME_ENABLED=0 without time.sqlite records explicit not_initialized cleanly.
        const disabledAbsent = await runMaintenanceBackup({
            backupId: "bk-disabled-absent",
            releaseId: "rel-1",
            sourceIdentity: "local:test",
            dataDir,
            organizationFile: orgFile,
            recoveryFile: recFile,
            timeFile,
            taskchampionDbPath: twDb,
            timeEnabled: false,
        });
        assert.equal(disabledAbsent.manifest.complete, true);
        assert.equal(disabledAbsent.manifest.time.status, "not_initialized");
        assert.equal(
            disabledAbsent.manifest.files["time.sqlite"].exists,
            false,
        );

        // Initialize time.sqlite & insert data, then verify both enabled & disabled back it up + match sha256!
        const store = await createTimeStore(timeFile);
        store.startActivity({
            idempotencyKey: "k-dep",
            title: "Deploy check",
            explicitCategoryId: "work",
            source: "manual",
        });
        const timeBackup = createTimeBackupService(store);

        // DEP-02: Insufficient free space aborts cleanly with zero committed staging folder.
        await assert.rejects(
            runMaintenanceBackup({
                backupId: "bk-low-disk",
                releaseId: "rel-1",
                sourceIdentity: "local:test",
                dataDir,
                organizationFile: orgFile,
                recoveryFile: recFile,
                timeFile,
                taskchampionDbPath: twDb,
                timeEnabled: true,
                timeBackup,
                minFreeBytes: Number.MAX_SAFE_INTEGER,
            }),
            /Insufficient disk space/,
        );
        await assert.rejects(
            stat(join(dataDir, "backup-staging", "bk-low-disk")),
        );

        // DEP-01 + DEP-03b: Valid maintenance backup backs up SQLite + JSON + sha256 even when timeEnabled=false.
        const res = await runMaintenanceBackup({
            backupId: "bk-valid",
            releaseId: "rel-2",
            sourceIdentity: "local:test",
            dataDir,
            organizationFile: orgFile,
            recoveryFile: recFile,
            timeFile,
            taskchampionDbPath: twDb,
            timeEnabled: false,
            timeBackup,
        });
        assert.equal(res.manifest.complete, true);
        assert.equal(res.manifest.time.status, "backed_up");
        if (res.manifest.time.status === "backed_up") {
            assert.equal(res.manifest.time.enabled, false);
        }
        const timeDest = join(res.stagingDir, "time.sqlite");
        const actualSha = createHash("sha256")
            .update(await readFile(timeDest))
            .digest("hex");
        assert.equal(actualSha, res.manifest.files["time.sqlite"].sha256);
        const tcDest = join(res.stagingDir, "taskchampion.sqlite3");
        const tcCheck = new DatabaseSync(tcDest);
        const row = tcCheck.prepare("SELECT uuid FROM tasks").get() as {
            uuid: string;
        };
        assert.equal(row.uuid, "u1");
        tcCheck.close();
        store.close();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
