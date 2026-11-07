import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { createWorkspaceClient } from "../../../src/core/workspace/client.ts";

async function start(env) {
  const child = spawn(
    process.execPath,
    [new URL("../../../dist/web/server.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        SSH_TARGET: "",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Startup timeout " + output));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/port (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Server exited " + output));
    });
  });
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      child.kill();
      await once(child, "exit");
    },
  };
}
test("production API rejects absent and forged Access credentials", async () => {
  const s = await start({
    NODE_ENV: "production",
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-audience",
  });
  try {
    for (const headers of [
      {},
      { "cf-access-jwt-assertion": "eyJhbGciOiJub25lIn0.e30." },
    ])
      for (const route of [
        "api/tasks",
        "api/workspace",
        "api/recovery",
        "api/backup/points",
        "api/backup/download?id=bad",
      ])
        assert.equal((await fetch(s.url + route, { headers })).status, 401);
    for (const route of ["api/backup/preview", "api/backup/restore"])
      assert.equal(
        (
          await fetch(s.url + route, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://aster.example",
            },
            body: "{}",
          })
        ).status,
        401,
      );
    const response = await fetch(s.url);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal((await fetch(s.url + "../server.mjs")).status, 404);
  } finally {
    await s.close();
  }
});
test("HTTP writes enforce origin, UUID and fields; task text remains one argument", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-http-");
  const command = dir + "/task";
  const log = dir + "/args.json";
  await writeFile(
    command,
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a[0]==='--version')console.log('3.5.0');else if(a.includes('export'))console.log('[]');else if(a.includes('_projects'))console.log('');else{fs.writeFileSync(${JSON.stringify(log)},JSON.stringify(a));console.log('OK');}`,
    { mode: 0o755 },
  );
  const s = await start({
    NODE_ENV: "test",
    TASK_COMMAND: command,
    ORGANIZATION_FILE: dir + "/organization.json",
    PUBLIC_ORIGIN: "https://aster.example",
  });
  const post = (route, data, origin = "https://aster.example") =>
    fetch(s.url + "api/" + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(data),
    });
  try {
    assert.equal(
      (
        await post(
          "tasks",
          { description: "test", tags: [] },
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (await post("action", { uuid: "all", action: "delete" })).status,
      400,
    );
    assert.equal(
      (
        await post("tasks", {
          description: "test",
          tags: ["x rc.confirmation=off"],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("tasks", {
          description: "test",
          tags: [],
          due: "tomorrow or all",
        })
      ).status,
      400,
    );
    const description = '中文 "quotes" $(touch /tmp/should-not-exist) <script>';
    assert.equal(
      (
        await post("tasks", {
          description,
          tags: ["工作"],
          due: "20261017T000000Z",
        })
      ).status,
      200,
    );
    const args = JSON.parse(await readFile(log, "utf8"));
    assert.equal(args[1], "description:" + description);
    assert.ok(args.includes("+工作"));
    assert.deepEqual(await (await fetch(s.url + "api/tasks")).json(), {
      tasks: [],
      projects: [],
    });
  } finally {
    await s.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("signed Access tokens require valid signature, audience and expiry", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  const certs = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  certs.listen(0, "127.0.0.1");
  await once(certs, "listening");
  const issuer = `http://127.0.0.1:${certs.address().port}`;
  const dir = await mkdtemp(tmpdir() + "/aster-auth-");
  const command = dir + "/task";
  await writeFile(
    command,
    `#!${process.execPath}\nconsole.log(process.argv.includes('--version')?'3.5.0':process.argv.includes('export')?'[]':'');`,
    { mode: 0o755 },
  );
  const s = await start({
    NODE_ENV: "production",
    CF_ACCESS_TEAM_DOMAIN: issuer,
    CF_ACCESS_AUD: "aster",
    TASK_COMMAND: command,
  });
  const token = (overrides) => {
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "test-key" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: issuer,
        aud: ["aster"],
        exp: Math.floor(Date.now() / 1000) + 60,
        ...overrides,
      }),
    ).toString("base64url");
    const data = header + "." + payload;
    return (
      data +
      "." +
      sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")
    );
  };
  const get = (jwt) =>
    fetch(s.url + "api/tasks", {
      headers: { "cf-access-jwt-assertion": jwt },
    });
  try {
    assert.equal((await get(token({}))).status, 200);
    assert.equal((await get(token({ aud: ["other"] }))).status, 401);
    assert.equal((await get(token({ exp: 1 }))).status, 401);
    assert.equal(
      (await get(token({ nbf: Date.now() / 1000 + 3600 }))).status,
      401,
    );
    const parts = token({}).split(".");
    const signature = Buffer.from(parts[2], "base64url");
    signature[0] ^= 1;
    parts[2] = signature.toString("base64url");
    assert.equal((await get(parts.join("."))).status, 401);
  } finally {
    await s.close();
    await new Promise((resolve) => certs.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("organization HTTP API persists filters, runs native queries, and renames or removes only tags", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-organization-http-");
  const command = dir + "/task";
  const tasksFile = dir + "/tasks.json";
  const log = dir + "/calls.jsonl";
  await writeFile(
    tasksFile,
    JSON.stringify([
      {
        uuid: "123e4567-e89b-42d3-a456-426614174000",
        description: "保留这个任务",
        status: "pending",
        tags: ["Todo"],
      },
    ]),
  );
  await writeFile(
    command,
    `#!${process.execPath}
const fs=require('node:fs');const a=process.argv.slice(2);const file=${JSON.stringify(tasksFile)};
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
let tasks=JSON.parse(fs.readFileSync(file,'utf8'));
if(a[0]==='--version')console.log('3.5.0');
else if(a.includes('_projects'))console.log('');
else if(a.includes('_tags'))console.log([...new Set([...tasks.flatMap(t=>t.tags),'nonag','nocal'])].join('\\n'));
else if(a.includes('export'))console.log(JSON.stringify(tasks));
else if(a.includes('modify')){const index=a.indexOf('modify'),old=a.slice(0,index).find(s=>s.startsWith('+')).slice(1),next=a.slice(index+1).find(s=>s.startsWith('+'))?.slice(1);for(const t of tasks)if(t.tags.includes(old)){t.tags=t.tags.filter(n=>n!==old);if(next)t.tags.push(next)}fs.writeFileSync(file,JSON.stringify(tasks));console.log('OK')}
else process.exit(1);
`,
    { mode: 0o755 },
  );
  const s = await start({
    NODE_ENV: "test",
    TASK_COMMAND: command,
    ORGANIZATION_FILE: dir + "/organization.json",
    PUBLIC_ORIGIN: "https://aster.example",
  });
  const get = async (route) => (await fetch(s.url + "api/" + route)).json();
  const post = (data) =>
    fetch(s.url + "api/organization", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://aster.example",
      },
      body: JSON.stringify(data),
    });
  try {
    const first = await get("organization");
    assert.deepEqual(
      first.tags.map((tag) => tag.name),
      ["Todo"],
    );
    assert.equal(first.tags[0].count, 1);
    const filter = {
      id: "",
      name: "Todo",
      description: "",
      expression: "status:pending @Todo",
      color: "green",
      favorite: true,
    };
    const savedResponse = await post({
      revision: 0,
      kind: "filter",
      action: "save",
      item: filter,
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.filters[0].favorite, true);
    assert.equal(
      (
        await post({
          revision: 0,
          kind: "filter",
          action: "save",
          item: filter,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post({
          revision: 1,
          kind: "filter",
          action: "save",
          item: { ...filter, expression: "delete" },
        })
      ).status,
      400,
    );
    await get("tasks?filter=" + encodeURIComponent("status:pending @Todo"));
    const renamedResponse = await post({
      revision: 1,
      kind: "tag",
      action: "save",
      item: {
        ...saved.tags[0],
        name: "Doing",
        color: "blue",
        favorite: true,
      },
    });
    assert.equal(renamedResponse.status, 200);
    const renamed = await renamedResponse.json();
    assert.equal(renamed.filters[0].expression, "status:pending +Doing");
    assert.equal(renamed.tags[0].name, "Doing");
    assert.equal((await get("tasks")).tasks[0].description, "保留这个任务");
    assert.deepEqual((await get("tasks")).tasks[0].tags, ["Doing"]);
    const deleted = await post({
      revision: 2,
      kind: "tag",
      action: "delete",
      item: renamed.tags[0],
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual((await get("tasks")).tasks[0].tags, []);
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.ok(
      calls.some(
        (a) =>
          a.includes("export") &&
          a.includes("+Todo") &&
          a.includes("status.not:deleted"),
      ),
    );
    assert.equal(
      calls.some(
        (a) =>
          a.includes("delete") || a.includes("purge") || a.includes("execute"),
      ),
      false,
    );
    const taskData = await readFile(tasksFile, "utf8");
    const project = {
      name: "Release",
      description: "Ship a useful first version.\nAvoid extra scope.",
    };
    const projectResponse = await post({
      revision: 3,
      kind: "project",
      action: "save",
      item: project,
    });
    assert.equal(projectResponse.status, 200);
    assert.deepEqual((await projectResponse.json()).projects, [project]);
    assert.deepEqual((await get("organization")).projects, [project]);
    assert.deepEqual((await get("tasks")).projects, [project.name]);
    assert.equal(await readFile(tasksFile, "utf8"), taskData);
    assert.equal(
      (
        await post({
          revision: 3,
          kind: "project",
          action: "save",
          item: project,
        })
      ).status,
      409,
    );
    assert.equal(
      JSON.parse(await readFile(dir + "/organization.json", "utf8")).revision,
      4,
    );
  } finally {
    await s.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("board moves and column edits persist without Taskwarrior writes", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-board-http-");
  const command = dir + "/task";
  const log = dir + "/writes.jsonl";
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  await writeFile(
    command,
    `#!${process.execPath}
const fs=require('node:fs');const a=process.argv.slice(2);
if(a[0]==='--version')console.log('3.5.0');
else if(a.includes('_projects'))console.log('Studio');
else if(a.includes('export')){const row=(completed)=>({uuid:completed?'123e4567-e89b-42d3-a456-426614174001':'${uuid}',description:'Keep my content',status:completed?'completed':'pending',project:'Studio',tags:['Work'],due:'20261020T100000Z'});console.log(JSON.stringify(a.includes('status.not:deleted')?[row(false),row(true)]:[row(a.includes('status:completed'))]))}
else {fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');console.log('OK');}
`,
    { mode: 0o755 },
  );
  const server = await start({
    NODE_ENV: "test",
    TASK_COMMAND: command,
    ORGANIZATION_FILE: dir + "/organization.json",
    PUBLIC_ORIGIN: "https://aster.example",
  });
  const post = (data) =>
    fetch(server.url + "api/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://aster.example",
      },
      body: JSON.stringify(data),
    });
  try {
    const board = await (
      await fetch(server.url + "api/tasks?scope=board")
    ).json();
    const launcher = createWorkspaceClient(server.url, {
      kind: "local",
      taskCommand: command,
      key: "launcher",
      label: "Launcher",
    });
    assert.equal((await launcher.load()).revision, 0);
    assert.deepEqual(
      board.tasks.map((task) => task.status),
      ["pending", "completed"],
    );
    assert.deepEqual(board.projects, ["Studio"]);
    const postBoard = (data) =>
      fetch(server.url + "api/organization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://aster.example",
        },
        body: JSON.stringify({ kind: "board", ...data }),
      });
    let revision = 0;
    const ids = [];
    for (const name of ["Todo", "Done"]) {
      const response = await postBoard({
        revision,
        action: "column.save",
        column: { id: "", name },
      });
      assert.equal(response.status, 200);
      const saved = await response.json();
      revision = saved.revision;
      ids.push(saved.board.columns.at(-1).id);
    }
    const completedUuid = "123e4567-e89b-42d3-a456-426614174001";
    for (const [taskUuid, columnId] of [
      [completedUuid, ids[1]],
      [completedUuid, ids[0]],
      [uuid, ids[1]],
    ]) {
      const response = await postBoard({
        revision,
        action: "task.move",
        uuid: taskUuid,
        columnId,
        beforeUuid: null,
      });
      assert.equal(response.status, 200);
      revision = (await response.json()).revision;
    }
    const refreshed = await (
      await fetch(server.url + "api/tasks?scope=board")
    ).json();
    assert.deepEqual(refreshed.tasks, board.tasks);
    assert.equal(
      (await post({ uuid, action: "move", stage: "done" })).status,
      400,
    );
    await assert.rejects(readFile(log), { code: "ENOENT" });
    const saved = JSON.parse(
      await readFile(dir + "/organization.json", "utf8"),
    );
    assert.equal(
      saved.board.placements.find((item) => item.uuid === completedUuid)
        .columnId,
      ids[0],
    );
    assert.equal(
      saved.board.placements.find((item) => item.uuid === uuid).columnId,
      ids[1],
    );
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("web and private SSH workspace share a three-slot queue, enforce source identity, and restart safely", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-focus-ipc-");
  const socketPath = dir + "/workspace.sock";
  const file = dir + "/organization.json";
  const command = dir + "/task";
  await writeFile(
    file,
    JSON.stringify({
      revision: 0,
      filters: [],
      tags: [],
      projects: ["A", "B", "C", "D"].map((name) => ({
        name,
        description: "",
        outcome: "Deliver " + name,
      })),
    }),
  );
  await writeFile(
    command,
    `#!${process.execPath}\nconst a=process.argv.slice(2);if(a[0]==='--version')console.log('3.5.0');else if(a.includes('export'))console.log('[]');else if(a.includes('_projects'))console.log('A\\nB\\nC\\nD');else process.exit(2)`,
    { mode: 0o755 },
  );
  const env = {
    NODE_ENV: "test",
    TASK_COMMAND: command,
    ORGANIZATION_FILE: file,
    WORKSPACE_SOCKET: socketPath,
    PUBLIC_ORIGIN: "https://aster.example",
  };
  let server = await start(env);
  const ipc = (identity, change) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          socketPath,
          path: change ? "/api/organization" : "/api/workspace",
          method: change ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Aster-Source": identity,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              data: JSON.parse(body),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(change ? JSON.stringify(change) : undefined);
    });
  try {
    assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
    const snapshot = (await ipc("")).data;
    const post = async (change) =>
      fetch(server.url + "api/organization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://aster.example",
        },
        body: JSON.stringify(change),
      });
    for (const [revision, name] of ["A", "B", "C"].entries())
      assert.equal(
        (
          await post({
            revision,
            kind: "project",
            action: "status",
            name,
            status: "active",
          })
        ).status,
        200,
      );
    const fourth = {
      revision: 3,
      kind: "project",
      action: "status",
      name: "D",
      status: "active",
    };
    assert.equal((await ipc("wrong-source", fourth)).status, 409);
    assert.equal((await ipc(snapshot.identity, fourth)).status, 400);
    assert.equal(
      (await ipc(snapshot.identity, { ...fourth, replaceProject: "B" })).status,
      200,
    );
    const current = await (await fetch(server.url + "api/organization")).json();
    assert.equal(
      current.projects.filter((p) => p.status === "active").length,
      3,
    );
    assert.equal(current.projects.find((p) => p.name === "B").status, "later");
    await server.close();
    server = await start(env);
    assert.equal((await ipc("")).data.organization.revision, 4);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("energy integrates Taskwarrior start/stop and Timewarrior intervals, blocks at 0, and restores +30 with Elixir", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-energy-http-");
  const command = dir + "/task";
  const timew = dir + "/timew";
  const stateFile = dir + "/tasks.json";
  const intervalsFile = dir + "/intervals.json";
  const uuid1 = "123e4567-e89b-42d3-a456-426614174000";
  const uuid2 = "123e4567-e89b-42d3-a456-426614174001";
  const nowIso = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  await writeFile(
    stateFile,
    JSON.stringify([
      {
        uuid: uuid1,
        description: "Deep work",
        status: "pending",
        tags: [],
      },
      {
        uuid: uuid2,
        description: "Second task",
        status: "pending",
        tags: [],
      },
    ]),
  );
  await writeFile(intervalsFile, JSON.stringify([]));
  await writeFile(
    command,
    `#!${process.execPath}
const fs=require('node:fs');const a=process.argv.slice(2);const file=${JSON.stringify(stateFile)};
let tasks=JSON.parse(fs.readFileSync(file,'utf8'));
if(a[0]==='--version')console.log('3.5.0');
else if(a.includes('_projects')||a.includes('_tags'))console.log('');
else if(a.includes('export'))console.log(JSON.stringify(tasks));
else if(a[1]==='start'){const t=tasks.find(x=>x.uuid===a[0]);if(t)t.start=${JSON.stringify(nowIso)};fs.writeFileSync(file,JSON.stringify(tasks));console.log('OK')}
else if(a[1]==='stop'){const t=tasks.find(x=>x.uuid===a[0]);if(t)delete t.start;fs.writeFileSync(file,JSON.stringify(tasks));console.log('OK')}
else process.exit(1);`,
    { mode: 0o755 },
  );
  await writeFile(
    timew,
    `#!${process.execPath}
const fs=require('node:fs');console.log(fs.readFileSync(${JSON.stringify(intervalsFile)},'utf8'));`,
    { mode: 0o755 },
  );
  const server = await start({
    NODE_ENV: "test",
    TASK_COMMAND: command,
    ORGANIZATION_FILE: dir + "/organization.json",
    PUBLIC_ORIGIN: "https://aster.example",
  });
  const post = (route, data) =>
    fetch(server.url + "api/" + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://aster.example",
      },
      body: JSON.stringify(data),
    });
  try {
    const initial = await (await fetch(server.url + "api/organization")).json();
    assert.equal(initial.energy.remaining, 100);

    // Start task 1 -> -5 entry fee = 95 remaining
    assert.equal(
      (await post("action", { uuid: uuid1, action: "start" })).status,
      200,
    );
    const afterStart = await (
      await fetch(server.url + "api/organization")
    ).json();
    assert.equal(afterStart.energy.remaining, 95);

    // Stop task 1 -> refunds 5 entry fee = 100 remaining
    assert.equal(
      (await post("action", { uuid: uuid1, action: "stop" })).status,
      200,
    );
    const afterStop = await (
      await fetch(server.url + "api/organization")
    ).json();
    assert.equal(afterStop.energy.remaining, 100);

    // Record 5 hours + 1m of Timewarrior focus today -> 0 remaining
    const fiveHoursAgo = new Date(Date.now() - (5 * 3600 + 60) * 1000)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    await writeFile(
      intervalsFile,
      JSON.stringify([
        {
          id: 1,
          start: fiveHoursAgo,
          end: nowIso,
          tags: ["uuid:" + uuid1, "Deep work"],
        },
      ]),
    );
    const exhausted = await (
      await fetch(server.url + "api/organization")
    ).json();
    assert.equal(exhausted.energy.remaining, 0);

    // Starting task 2 is blocked at 0 energy
    const blocked = await post("action", { uuid: uuid2, action: "start" });
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).error, /Daily energy exhausted/);

    // Restore +30 energy via Elixir -> allows starting task 2
    const elixir = await post("organization", {
      revision: 0,
      kind: "energy",
      action: "elixir",
    });
    assert.equal(elixir.status, 200);
    const restored = await elixir.json();
    assert.equal(restored.energy.remaining, 30);
    assert.equal(
      (await post("action", { uuid: uuid2, action: "start" })).status,
      200,
    );
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
