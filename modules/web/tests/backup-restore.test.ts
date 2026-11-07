import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  validateBackup,
  pausedBackup,
  type AsterBackup,
} from "../server/backup-validation.ts";
import { createWorkspaceGate } from "../server/workspace-gate.ts";
import { createBackupRestore } from "../server/backup-restore.ts";
import type { TaskService } from "../../../src/core/tasks/service.ts";
import type { createRecoveryService } from "../server/recovery.ts";
import type { createOrganizationService } from "../server/organization-service.ts";
const uuid = "123e4567-e89b-42d3-a456-426614174000";
function fixture(): AsterBackup {
  return {
    format: "aster-backup",
    version: 1,
    exportedAt: "2026-11-04T10:00:00Z",
    taskwarrior: {
      tasks: [
        {
          uuid,
          description: "Keep every field",
          status: "pending",
          entry: "20261104T080000Z",
          modified: "20261104T080000Z",
          proof: "custom",
          annotations: [{ entry: "20261104T090000Z", description: "Note" }],
        },
      ],
      uda: { "uda.proof.type": "string" },
    },
    organization: {
      revision: 5,
      filters: [],
      tags: [],
      projects: [
        {
          name: "Studio",
          description: "Build carefully",
          color: "blue",
        },
      ],
      board: {
        columns: [{ id: "ready", name: "Ready" }],
        placements: [{ uuid, columnId: "ready" }],
        order: [uuid],
      },
    },
    recovery: { version: 1, entries: [] },
    timewarrior: {
      available: true,
      intervals: [
        {
          start: "20261104T080000Z",
          end: "20261104T090000Z",
          tags: ["uuid:" + uuid],
          annotation: "Focus",
        },
      ],
    },
  };
}
test("backup validation preserves raw task data and rejects malformed or credential-bearing configuration", () => {
  const data = fixture();
  assert.deepEqual(validateBackup(data), data);
  const secret = fixture();
  secret.taskwarrior.uda!["taskd.credentials"] = "not allowed";
  assert.throws(() => validateBackup(secret), /Only custom/);
  const invalid = fixture();
  invalid.taskwarrior.tasks[0].due = "20260231T000000Z";
  assert.throws(() => validateBackup(invalid), /calendar date/);
  const duplicate = fixture();
  duplicate.taskwarrior.tasks.push({ ...duplicate.taskwarrior.tasks[0] });
  assert.throws(() => validateBackup(duplicate), /Duplicate task/);
  const missing = fixture();
  missing.timewarrior = { available: false, intervals: null };
  assert.throws(() => validateBackup(missing), /no timer history/);
  const derived = fixture();
  derived.organization.energy = {
    remaining: 100,
  } as AsterBackup["organization"]["energy"];
  assert.equal(validateBackup(derived).organization.energy, undefined);
});
test("restoring an active snapshot pauses task starts and freezes open intervals at capture time", () => {
  const data = fixture();
  data.taskwarrior.tasks[0].start = "20261104T090000Z";
  delete data.timewarrior.intervals![0].end;
  const result = pausedBackup(data);
  assert.equal(result.taskwarrior.tasks[0].start, undefined);
  assert.equal(result.timewarrior.intervals![0].end, "20261104T100000Z");
  assert.equal(data.taskwarrior.tasks[0].start, "20261104T090000Z");
});
test("exclusive restore waits for in-flight clients and rejects new requests without running them", async () => {
  const gate = createWorkspaceGate();
  const release = gate.enter();
  let began = false;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const restore = gate.exclusive(async () => {
    began = true;
    await done;
  });
  await Promise.resolve();
  assert.equal(began, false);
  assert.throws(() => gate.enter(), { status: 423 });
  release();
  await Promise.resolve();
  assert.equal(began, true);
  finish();
  await restore;
  gate.enter()();
  await assert.rejects(
    gate.exclusive(async () => {
      throw new Error("failed");
    }),
    /failed/,
  );
  gate.enter()();
});
test("changed workspace and running timers are rejected before staging any native data", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-preview-");
  let current = fixture();
  let nativeCalls = 0;
  const service = {
    dataDirectory: () => {
      nativeCalls++;
      throw new Error("must not stage");
    },
  } as unknown as TaskService;
  const recovery = {
    export: async () => structuredClone(current),
  } as unknown as ReturnType<typeof createRecoveryService>;
  const organization = {} as ReturnType<typeof createOrganizationService>;
  try {
    const restore = createBackupRestore(
      service,
      organization,
      recovery,
      createWorkspaceGate(),
      {
        organization: dir + "/organization.json",
        recovery: dir + "/recovery.json",
      },
    );
    const plan = await restore.preview(fixture());
    current.organization.revision++;
    await assert.rejects(restore.apply(plan.token), { status: 409 });
    assert.equal(nativeCalls, 0);
    current = fixture();
    current.taskwarrior.tasks[0].start = "20261104T090000Z";
    const running = await restore.preview(fixture());
    assert.equal(running.activeTimers, true);
    await assert.rejects(restore.apply(running.token), /Stop all/);
    assert.equal(nativeCalls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
