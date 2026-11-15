import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
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
import { runMaintenanceBackup } from "../src/maintenance-backup.ts";
import { createTimeStore } from "../src/time/time-store.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "aster-first-time-deploy-"));
  const dataDir = join(dir, "data");
  await mkdir(dataDir);
  const input = {
    backupId: "first-time-upgrade",
    sourceIdentity: "local:test",
    dataDir,
    organizationFile: join(dataDir, "organization.json"),
    recoveryFile: join(dataDir, "recovery.json"),
    timeFile: join(dataDir, "time.sqlite"),
    timeEnabled: true,
  };
  await writeFile(input.organizationFile, '{"revision":1}');
  return { dir, input };
}

test("missing enabled Time database still aborts without verified legacy migration", async () => {
  const { dir, input } = await fixture();
  try {
    await assert.rejects(
      runMaintenanceBackup(input),
      /Time is enabled, but database file is missing/,
    );
    await assert.rejects(
      stat(join(input.dataDir, "backup-staging", input.backupId)),
      { code: "ENOENT" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("first legacy upgrade backs up metadata and records Time as not initialized without creating a database", async () => {
  const { dir, input } = await fixture();
  try {
    const result = await runMaintenanceBackup({
      ...input,
      allowUninitializedTime: true,
    });
    assert.deepEqual(result.manifest.time, { status: "not_initialized" });
    assert.equal(result.manifest.files["time.sqlite"].exists, false);
    assert.equal(result.manifest.files["organization.json"].exists, true);
    assert.equal(
      await readFile(join(result.stagingDir, "organization.json"), "utf8"),
      '{"revision":1}',
    );
    await assert.rejects(stat(input.timeFile), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const suffix of [".barrier.json", "-wal", "-shm"]) {
  for (const timeEnabled of [true, false]) {
    test(`orphaned ${suffix} prevents treating a missing database as uninitialized (enabled=${timeEnabled})`, async () => {
      const { dir, input } = await fixture();
      try {
        await writeFile(input.timeFile + suffix, "existing-time-artifact");
        await assert.rejects(
          runMaintenanceBackup({
            ...input,
            timeEnabled,
            allowUninitializedTime: true,
          }),
          /Time artifacts remain/,
        );
        assert.equal(
          await readFile(input.timeFile + suffix, "utf8"),
          "existing-time-artifact",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}

test("legacy allowance still backs up an existing Time database", async () => {
  const { dir, input } = await fixture();
  try {
    const store = await createTimeStore(input.timeFile);
    store.close();
    const result = await runMaintenanceBackup({
      ...input,
      allowUninitializedTime: true,
    });
    assert.equal(result.manifest.time.status, "backed_up");
    assert.equal(result.manifest.files["time.sqlite"].exists, true);
    assert.ok(result.manifest.files["time.sqlite"].bytes > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("maintenance CLI allows first deployment only with the legacy flag, then startup initializes Time", async () => {
  const { dir, input } = await fixture();
  try {
    const taskDb = join(dir, "taskchampion.sqlite3");
    const db = new DatabaseSync(taskDb);
    db.exec(
      "CREATE TABLE marker (id INTEGER PRIMARY KEY); INSERT INTO marker VALUES (1);",
    );
    db.close();
    const run = (flags: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          fileURLToPath(new URL("../src/index.ts", import.meta.url)),
          "--maintenance-backup",
          "--backup-id",
          input.backupId,
          ...flags,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            SSH_TARGET: "",
            NODE_ENV: "production",
            TIME_ENABLED: "1",
            ORGANIZATION_FILE: input.organizationFile,
            RECOVERY_FILE: input.recoveryFile,
            TIME_DB_FILE: input.timeFile,
            TASKCHAMPION_DB: taskDb,
          },
        },
      );
    const blocked = run([]);
    assert.notEqual(blocked.status, 0);
    assert.match(
      blocked.stderr,
      /Time is enabled, but database file is missing/,
    );
    const allowed = run(["--allow-uninitialized-time"]);
    assert.equal(allowed.status, 0, allowed.stderr);
    const backup = JSON.parse(allowed.stdout);
    assert.equal(backup.manifest.time.status, "not_initialized");
    assert.equal(backup.manifest.files["taskchampion.sqlite3"].exists, true);
    await assert.rejects(stat(input.timeFile), { code: "ENOENT" });
    // The normal startup path owns initialization, after the pre-release backup.
    const store = await createTimeStore(input.timeFile, {
      enabled: true,
      cutoverAtMs: 12345,
    });
    try {
      assert.equal(store.getStatus().enabled, true);
      assert.equal(store.getStatus().cutoverAtMs, 12345);
    } finally {
      store.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
