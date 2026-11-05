import assert from "node:assert/strict";
import test from "node:test";
import { createTaskService } from "../src/core/tasks/service.ts";
import { resolveConnection, workspaceIdentity } from "../src/core/connection/settings.ts";
import { loadTaskView } from "../src/core/workspace/task-views.ts";
import { createWorkspaceClient, WorkspaceError, workspaceUrl } from "../src/core/workspace/client.ts";
import type { Organization } from "../src/core/workspace/organization.ts";

const connection = resolveConnection({ connectionMode: "ssh" });
const organization: Organization = {
  revision: 4,
  filters: [
    {
      id: "focus",
      name: "Focus",
      expression: "+focus and status:pending",
      color: "blue",
      description: "",
      favorite: true,
    },
  ],
  tags: [],
  board: {
    columns: [{ id: "todo", name: "Todo" }],
    placements: [{ uuid: "done", columnId: "todo" }],
    order: ["done", "open"],
  },
};

test("launcher views query native filters and keep board membership independent of status", async () => {
  const calls: string[][] = [];
  const service = createTaskService(resolveConnection({ connectionMode: "local" }, "darwin"), async ({ args }) => {
    if (args[0] === "--version") return { stdout: "3.5.0", stderr: "" };
    calls.push(args);
    const data = args.includes("status:completed")
      ? [
          {
            uuid: "done",
            description: "Completed task",
            status: "completed",
          },
        ]
      : [
          {
            uuid: "open",
            description: "Open task",
            status: "pending",
            project: "Work",
            tags: ["focus"],
          },
        ];
    return { stdout: JSON.stringify(data), stderr: "" };
  });
  assert.equal((await loadTaskView(service, "project:Work"))[0].uuid, "open");
  assert.equal((await loadTaskView(service, "tag:focus"))[0].uuid, "open");
  assert.equal((await loadTaskView(service, "inbox")).length, 0);
  assert.equal((await loadTaskView(service, "column:todo", organization))[0].status, "completed");
  await loadTaskView(service, "filter:focus", organization);
  assert.ok(calls.at(-1)?.includes("+focus"));
  await assert.rejects(loadTaskView(service, "filter:missing", organization), /unavailable/);
  await assert.rejects(loadTaskView(service, "column:todo"), /unavailable/);
  assert.ok(calls.every((args) => args.includes("export")));
});

test("workspace identity ignores display labels, but distinguishes actual Taskwarrior sources", () => {
  assert.equal(workspaceIdentity(connection), workspaceIdentity({ ...connection, label: "RN", key: "web" }));
  for (const change of [{ sshTarget: "other" }, { taskrc: "/different/taskrc" }, { taskCommand: "/bin/other-task" }])
    assert.notEqual(workspaceIdentity(connection), workspaceIdentity({ ...connection, ...change }));
  for (const address of [
    "https://example.com",
    "http://evil.test",
    "http://localhost:4180/other",
    "http://user:pass@localhost:4180",
    "file:///etc/passwd",
  ])
    assert.throws(() => workspaceUrl(address));
});

test("metadata moves verify the source, preserve CAS revision and never retry unknown writes", async (t) => {
  const calls: { url: string; body?: string }[] = [];
  let identity = workspaceIdentity(connection);
  let outcome: "ok" | "conflict" | "unknown" = "ok";
  t.mock.method(globalThis, "fetch", async (url: URL, init?: RequestInit) => {
    calls.push({
      url: url.pathname,
      body: init?.body as string | undefined,
    });
    if (url.pathname === "/api/workspace") return new Response(JSON.stringify({ identity, organization }));
    if (outcome === "unknown") throw new Error("socket closed");
    if (outcome === "conflict") return new Response(JSON.stringify({ error: "Reload before saving" }), { status: 409 });
    return new Response(JSON.stringify(organization));
  });
  const client = createWorkspaceClient("http://localhost:4180", connection);
  const move = {
    revision: 4,
    kind: "board",
    action: "task.move",
    uuid: "done",
    columnId: "todo",
    beforeUuid: null,
  } as const;
  await client.move(move);
  assert.deepEqual(JSON.parse(calls.at(-1)!.body!), move);
  identity = "different";
  const before = calls.filter((call) => call.body).length;
  await assert.rejects(client.move(move), /different Taskwarrior/);
  assert.equal(calls.filter((call) => call.body).length, before);
  identity = workspaceIdentity(connection);
  outcome = "conflict";
  await assert.rejects(client.move(move), (error: unknown) => error instanceof WorkspaceError && !error.uncertain);
  outcome = "unknown";
  await assert.rejects(client.move(move), (error: unknown) => error instanceof WorkspaceError && error.uncertain);
  assert.equal(calls.filter((call) => call.body).length, before + 2);
});
