import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createAiServer } from "../src/server.ts";
import {
  socketClient,
  WorkspaceError,
  connectWorkspace,
} from "../src/transport.ts";

const uuid = "11111111-1111-4111-8111-111111111111";
const task = {
  description: "Task",
  tags: [],
  project: "Work",
  due: "20261112T060000Z",
  priority: "H",
};
const item = { id: "", name: "Work", color: "gray", favorite: false };
const cases: [string, any, string, string, any?][] = [
  ["workspace_get", {}, "GET", "/api/workspace"],
  ["tasks_list", {}, "GET", "/api/tasks"],
  [
    "tasks_list",
    { filter: "status:pending +Work" },
    "GET",
    "/api/tasks?filter=status%3Apending%20%2BWork",
  ],
  ["task_get", { uuid }, "GET", "/api/tasks?filter=uuid%3A" + uuid],
  [
    "quick_preview",
    { text: "明天 报告" },
    "POST",
    "/api/quick/preview",
    { text: "明天 报告" },
  ],
  ["task_create", { task }, "POST", "/api/tasks", task],
  [
    "task_edit",
    { uuid, task },
    "POST",
    "/api/action",
    { uuid, task, action: "edit" },
  ],
  ...["complete", "reopen", "start", "stop", "delete", "restore"].map(
    (a) =>
      ["task_" + a, { uuid }, "POST", "/api/action", { uuid, action: a }] as [
        string,
        any,
        string,
        string,
        any,
      ],
  ),
  [
    "task_wait",
    { uuid, wait: "" },
    "POST",
    "/api/action",
    { uuid, wait: "", action: "wait" },
  ],
  [
    "task_note_remove",
    { uuid, entry: "now", description: "Note" },
    "POST",
    "/api/action",
    { uuid, entry: "now", description: "Note", action: "note.remove" },
  ],
  ["recurrence_get", { uuid }, "GET", "/api/recurrence?uuid=" + uuid],
  [
    "recurrence_edit",
    { uuid, recur: "", until: "" },
    "POST",
    "/api/action",
    { uuid, recur: "", until: "", action: "recurrence.edit" },
  ],
  [
    "project_save",
    {
      revision: 7,
      item: { name: "Work.Child", description: "goal" },
      originalName: "Old",
    },
    "POST",
    "/api/organization",
    {
      revision: 7,
      kind: "project",
      action: "save",
      item: { name: "Work.Child", description: "goal" },
      originalName: "Old",
    },
  ],
  [
    "project_delete",
    { revision: 7, name: "Work" },
    "POST",
    "/api/organization",
    {
      revision: 7,
      kind: "project",
      action: "delete",
      item: { name: "Work", description: "" },
    },
  ],
  [
    "project_status",
    {
      revision: 7,
      name: "Work",
      status: "active",
      outcome: "Ship",
      replaceProject: "Old",
    },
    "POST",
    "/api/organization",
    {
      revision: 7,
      name: "Work",
      status: "active",
      outcome: "Ship",
      replaceProject: "Old",
      kind: "project",
      action: "status",
    },
  ],
  ...["save", "delete"].flatMap(
    (action) =>
      [
        [
          "label_" + action,
          { revision: 7, item },
          "POST",
          "/api/organization",
          { revision: 7, item, kind: "tag", action },
        ],
        [
          "filter_" + action,
          {
            revision: 7,
            item: {
              ...item,
              description: "",
              expression: "status:pending",
            },
          },
          "POST",
          "/api/organization",
          {
            revision: 7,
            item: {
              ...item,
              description: "",
              expression: "status:pending",
            },
            kind: "filter",
            action,
          },
        ],
      ] as [string, any, string, string, any][],
  ),
  [
    "column_save",
    { revision: 7, column: { id: "", name: "Doing" } },
    "POST",
    "/api/organization",
    {
      revision: 7,
      column: { id: "", name: "Doing" },
      kind: "board",
      action: "column.save",
    },
  ],
  [
    "column_delete",
    { revision: 7, columnId: "c" },
    "POST",
    "/api/organization",
    { revision: 7, columnId: "c", kind: "board", action: "column.delete" },
  ],
  [
    "column_move",
    { revision: 7, columnId: "c", direction: "left" },
    "POST",
    "/api/organization",
    {
      revision: 7,
      columnId: "c",
      direction: "left",
      kind: "board",
      action: "column.move",
    },
  ],
  [
    "board_task_move",
    { revision: 7, uuid, columnId: "unsectioned", beforeUuid: null },
    "POST",
    "/api/organization",
    {
      revision: 7,
      uuid,
      columnId: "unsectioned",
      beforeUuid: null,
      kind: "board",
      action: "task.move",
    },
  ],
  [
    "energy_elixir",
    { revision: 7 },
    "POST",
    "/api/organization",
    { revision: 7, kind: "energy", action: "elixir" },
  ],
  ["recovery_list", {}, "GET", "/api/recovery"],
  ["backup_export", {}, "GET", "/api/export"],
  ["backup_points", {}, "GET", "/api/backup/points"],
  ["backup_download", { id: uuid }, "GET", "/api/backup/download?id=" + uuid],
  [
    "backup_preview",
    { backup: { version: 1 } },
    "POST",
    "/api/backup/preview",
    { version: 1 },
  ],
  [
    "backup_restore",
    { token: uuid, confirmation: "RESTORE" },
    "POST",
    "/api/backup/restore",
    { token: uuid },
  ],
];

test("official MCP client discovers every tool and exercises all business mappings", async () => {
  const calls: any[] = [];
  let failure: Error | undefined;
  const server = createAiServer(async (...args) => {
    calls.push(args);
    if (failure) throw failure;
    if (args[1].startsWith("/api/tasks"))
      return {
        tasks: [
          {
            ...task,
            uuid,
            due: "2026-11-12T06:00:00.000Z",
            annotations: [],
          },
        ],
      };
    return { ok: true };
  });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const list = await client.listTools();
    assert.deepEqual(
      list.tools.map((t) => t.name).sort(),
      [...new Set(cases.map((c) => c[0]))].sort(),
    );
    for (const [name, args, method, path, body] of cases) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.deepEqual(
        calls.at(-1),
        body === undefined ? [method, path] : [method, path, body],
        name,
      );
      if (name === "task_get")
        assert.deepEqual(
          JSON.parse((result.content as any)[0].text).editInput,
          task,
        );
    }
    for (const [name, args] of [
      ["task_complete", { uuid: "bad" }],
      ["task_create", { task: { ...task, extra: true } }],
      ["project_delete", { name: "Work" }],
      ["backup_restore", { token: uuid }],
      ["backup_restore", { token: uuid, confirmation: "yes" }],
      ["tasks_list", { shell: "bad" }],
    ] as const) {
      const count = calls.length;
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
      assert.equal(calls.length, count);
    }
    failure = new WorkspaceError("revision conflict", 409);
    let result = await client.callTool({
      name: "energy_elixir",
      arguments: { revision: 7 },
    });
    assert.equal(JSON.parse((result.content as any)[0].text).status, 409);
    failure = new WorkspaceError("Read and check", undefined, "unknown");
    const count = calls.length;
    result = await client.callTool({
      name: "task_create",
      arguments: { task },
    });
    assert.equal(
      JSON.parse((result.content as any)[0].text).outcome,
      "unknown",
    );
    assert.equal(calls.length, count + 1);
  } finally {
    await client.close();
    await server.close();
  }
});

test("stdio process uses private socket identity; interrupted writes are never retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "amcp-"));
  const socket = join(dir, "w.sock");
  let source = "source-A";
  let writes = 0;
  const service = createServer((req, res) => {
    if (req.url === "/api/workspace") {
      res.end(
        JSON.stringify({
          identity: source,
          organization: { revision: 7 },
        }),
      );
      return;
    }
    if (req.headers["x-aster-source"] !== source) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: "source mismatch" }));
      return;
    }
    if (req.method === "POST") {
      writes++;
      req.socket.destroy();
      return;
    }
    res.end(JSON.stringify({ tasks: [{ uuid }] }));
  });
  await new Promise<void>((r) => service.listen(socket, r));
  const client = new Client({ name: "stdio-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--experimental-strip-types",
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    ],
    env: {
      ...(process.env as Record<string, string>),
      ASTER_SOCKET: socket,
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.equal(
      (await client.listTools()).tools.length,
      new Set(cases.map((c) => c[0])).size,
    );
    let result = await client.callTool({
      name: "tasks_list",
      arguments: {},
    });
    assert.ok(!result.isError);
    result = await client.callTool({
      name: "task_create",
      arguments: { task },
    });
    assert.equal(
      JSON.parse((result.content as any)[0].text).outcome,
      "unknown",
    );
    assert.equal(writes, 1);
    source = "source-B";
    result = await client.callTool({ name: "tasks_list", arguments: {} });
    assert.equal(JSON.parse((result.content as any)[0].text).status, 409);
    const direct = socketClient(socket);
    await direct("GET", "/api/tasks");
    source = "source-C";
    await assert.rejects(direct("GET", "/api/workspace"), /source changed/);
    await assert.rejects(
      connectWorkspace({ ASTER_SSH_TARGET: "-bad" }),
      /valid/,
    );
    await assert.rejects(
      connectWorkspace({
        ASTER_SSH_TARGET: "host",
        ASTER_REMOTE_SOCKET: "/tmp/x:bad",
      }),
      /absolute/,
    );
  } finally {
    await client.close();
    await new Promise<void>((r) => service.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
