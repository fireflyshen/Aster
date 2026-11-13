import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWorkspaceSocket } from "../src/workspace-ipc.ts";
import { createWorkspaceGate } from "../src/workspace-gate.ts";
import { parseQuickTask } from "../../core/tasks/quick-task.ts";

test("TUI private reads and backup operations enforce source identity and release the gate before restore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atui-"));
  const socket = join(dir, "w.sock");
  const gate = createWorkspaceGate();
  let restored = false;
  const server = await startWorkspaceSocket(socket, "same-source", {
    enter: gate.enter,
    load: async () => ({ revision: 0, filters: [], tags: [] }),
    change: async () => ({ revision: 1, filters: [], tags: [] }),
    tasks: async (filter?: string) => ({
      tasks: [{ uuid: "task", description: filter || "all" }],
    }),
    parse: (input) => parseQuickTask((input as { text: string }).text),
    export: async () => ({ version: 1, exportedAt: "test" }),
    points: async () => [{ id: "point", state: "committed" }],
    download: async (id) => ({ id }),
    preview: async () => ({ token: "plan", incoming: { tasks: 2 } }),
    restore: async (token) =>
      gate.exclusive(async () => {
        assert.equal(token, "plan");
        restored = true;
        return { ok: true };
      }),
  });
  async function call(path: string, data?: unknown, source = "same-source") {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        {
          socketPath: socket,
          path,
          method: data ? "POST" : "GET",
          headers: {
            "X-Aster-Source": source,
            "Content-Type": "application/json",
          },
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () =>
            resolve({ status: res.statusCode!, body: JSON.parse(text) }),
          );
        },
      );
      req.setTimeout(2000, () => req.destroy(new Error("request deadlocked")));
      req.on("error", reject);
      req.end(data ? JSON.stringify(data) : undefined);
    });
  }
  try {
    for (const path of [
      "/api/tasks",
      "/api/export",
      "/api/backup/points",
      "/api/backup/download?id=point",
    ])
      assert.equal((await call(path, undefined, "other")).status, 409);
    for (const path of [
      "/api/quick/preview",
      "/api/backup/preview",
      "/api/backup/restore",
    ])
      assert.equal((await call(path, { token: "plan" }, "other")).status, 409);
    assert.equal(restored, false);
    assert.equal(
      (await call("/api/tasks?filter=status%3Apending")).body.tasks[0]
        .description,
      "status:pending",
    );
    assert.equal(
      (await call("/api/quick/preview", { text: "明天 报告 #工作 p1" })).body
        .task.project,
      "工作",
    );
    assert.equal((await call("/api/export")).body.version, 1);
    assert.equal((await call("/api/backup/points")).body.points.length, 1);
    assert.equal(
      (await call("/api/backup/download?id=point")).body.id,
      "point",
    );
    assert.equal(
      (await call("/api/backup/preview", { tasks: [] })).body.token,
      "plan",
    );
    assert.equal(
      (await call("/api/backup/restore", { token: "plan" })).status,
      200,
    );
    assert.equal(restored, true);
    assert.equal((await call("/api/workspace")).status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
