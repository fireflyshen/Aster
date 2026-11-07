import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createTaskService } from "../../../src/core/tasks/service.ts";
import { resolveConnection } from "../../../src/core/connection/settings.ts";
import { createOrganizationService } from "../server/organization-service.ts";
import { createRecoveryService } from "../server/recovery.ts";
import { createOrganizationStore } from "../server/organization-store.ts";
import type { RawTask } from "../../../src/core/tasks/raw.ts";
const uuid = "123e4567-e89b-42d3-a456-426614174000";

test("delete snapshot is durable before native write; unknown deletion stays recoverable after restart", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-recovery-");
  let task: RawTask = {
    uuid,
    description: "Keep me",
    status: "completed",
    end: "20261101T100000Z",
    annotations: [{ entry: "20261101T090000Z", description: "Private note" }],
    custom: "preserved",
  };
  let restores = 0;
  const connection = resolveConnection({ connectionMode: "local" }, "darwin");
  const service = createTaskService(connection, async ({ args }) => {
    if (args[0] === "--version") return { stdout: "3.5.0", stderr: "" };
    if (args.includes("export"))
      return { stdout: JSON.stringify([task]), stderr: "" };
    if (args.includes("delete")) {
      const journal = JSON.parse(
        await readFile(dir + "/recovery.json", "utf8"),
      );
      assert.equal(journal.entries[0].task.status, "completed");
      assert.equal(journal.entries[0].phase, "prepared");
      task = { ...task, status: "deleted" };
      throw Object.assign(new Error("connection timed out"), {
        killed: true,
      });
    }
    if (args.includes("modify")) {
      restores++;
      assert.ok(args.includes("status:completed"));
      assert.ok(args.includes("end:20261101T100000Z"));
      assert.ok(args.includes("start:"));
      task = { ...task, status: "completed" };
    }
    return { stdout: "OK", stderr: "" };
  });
  const organization = createOrganizationService(
    service,
    dir + "/organization.json",
  );
  try {
    const first = createRecoveryService(
      service,
      organization,
      dir + "/recovery.json",
    );
    await assert.rejects(first.delete(uuid), { outcome: "unknown" });
    assert.equal((await stat(dir + "/recovery.json")).mode & 0o777, 0o600);
    const restarted = createRecoveryService(
      service,
      organization,
      dir + "/recovery.json",
    );
    assert.equal((await restarted.list()).tasks[0].restoreStatus, "completed");
    await restarted.restore(uuid);
    assert.equal(restores, 1);
    assert.equal(task.custom, "preserved");
    assert.deepEqual((await restarted.list()).tasks, []);
    await assert.rejects(restarted.restore(uuid), /no longer deleted/);
    assert.equal(restores, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("placement recovery merges latest metadata and safely falls back when a column was removed", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-placement-");
  try {
    const store = createOrganizationStore(dir + "/organization.json");
    const input = {
      revision: 0,
      kind: "board" as const,
      action: "column.save" as const,
      column: { id: "", name: "Current" },
    };
    const saved = await store.change(input, [], async () => {}, {
      tasks: [],
    });
    await store.restorePlacement(uuid, {
      columnId: "removed-column",
      beforeUuid: null,
    });
    const result = await store.read();
    assert.equal(result.board!.columns[0].name, "Current");
    assert.equal(result.board!.placements[0].columnId, "unsectioned");
    assert.equal(result.revision, saved.revision + 1);
    assert.deepEqual(result.board!.order, [uuid]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed placement recovery can finish later without restoring a native task twice", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-resume-");
  let task: RawTask = { uuid, status: "pending", description: "Resume" };
  let restores = 0;
  let fail = true;
  const service = createTaskService(
    resolveConnection({ connectionMode: "local" }, "darwin"),
    async ({ args }) => {
      if (args[0] === "--version") return { stdout: "3.5.0", stderr: "" };
      if (args.includes("export"))
        return { stdout: JSON.stringify([task]), stderr: "" };
      if (args.includes("delete")) task = { ...task, status: "deleted" };
      if (args.includes("modify")) {
        restores++;
        task = { ...task, status: "pending" };
      }
      return { stdout: "OK", stderr: "" };
    },
  );
  const real = createOrganizationService(service, dir + "/organization.json");
  const org = {
    ...real,
    restorePlacement: async () => {
      if (fail) throw new Error("disk full");
    },
  };
  try {
    const recovery = createRecoveryService(
      service,
      org,
      dir + "/recovery.json",
    );
    await recovery.delete(uuid);
    await assert.rejects(recovery.restore(uuid), { outcome: "unknown" });
    assert.equal((await recovery.list()).tasks[0].finishing, true);
    fail = false;
    await recovery.restore(uuid);
    assert.equal(restores, 1);
    assert.equal((await recovery.list()).tasks.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("partial exports explicitly report missing timers and omit credentials from custom-field definitions", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-export-");
  const service = createTaskService(
    resolveConnection({ connectionMode: "local" }, "darwin"),
    async ({ args, executable }) => {
      if (executable.endsWith("/timew"))
        throw new Error("timer database unavailable");
      if (args[0] === "--version") return { stdout: "3.5.0", stderr: "" };
      if (args.includes("_show"))
        return {
          stdout:
            "uda.proof.type=string\nuda.proof.label=Proof\ntaskd.credentials=DO-NOT-EXPORT",
          stderr: "",
        };
      return {
        stdout: JSON.stringify([
          {
            uuid,
            status: "deleted",
            description: "Preserve raw",
            annotations: [{ entry: "20261101T100000Z", description: "note" }],
            proof: "retained",
          },
        ]),
        stderr: "",
      };
    },
  );
  try {
    const organization = createOrganizationService(
      service,
      dir + "/organization.json",
    );
    const recovery = createRecoveryService(
      service,
      organization,
      dir + "/recovery.json",
    );
    const backup = await recovery.export();
    assert.equal(backup.timewarrior.available, false);
    assert.equal(backup.timewarrior.intervals, null);
    assert.equal(backup.warnings.length, 1);
    assert.equal(backup.taskwarrior.tasks[0].proof, "retained");
    assert.deepEqual(backup.taskwarrior.uda, {
      "uda.proof.type": "string",
      "uda.proof.label": "Proof",
    });
    assert.ok(!JSON.stringify(backup).includes("DO-NOT-EXPORT"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
