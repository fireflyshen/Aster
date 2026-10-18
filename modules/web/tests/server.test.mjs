import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";

async function start(env) {
  const child = spawn(process.execPath, [new URL("../../../dist/web/server.mjs", import.meta.url).pathname], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", SSH_TARGET: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
    for (const headers of [{}, { "cf-access-jwt-assertion": "eyJhbGciOiJub25lIn0.e30." }])
      assert.equal((await fetch(s.url + "api/tasks", { headers })).status, 401);
    const response = await fetch(s.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
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
  const s = await start({ NODE_ENV: "test", TASK_COMMAND: command, PUBLIC_ORIGIN: "https://aster.example" });
  const post = (route, data, origin = "https://aster.example") =>
    fetch(s.url + "api/" + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(data),
    });
  try {
    assert.equal((await post("tasks", { description: "test", tags: [] }, "https://evil.example")).status, 403);
    assert.equal((await post("action", { uuid: "all", action: "delete" })).status, 400);
    assert.equal((await post("tasks", { description: "test", tags: ["x rc.confirmation=off"] })).status, 400);
    assert.equal((await post("tasks", { description: "test", tags: [], due: "tomorrow or all" })).status, 400);
    const description = '中文 "quotes" $(touch /tmp/should-not-exist) <script>';
    assert.equal((await post("tasks", { description, tags: ["工作"], due: "20261017T000000Z" })).status, 200);
    const args = JSON.parse(await readFile(log, "utf8"));
    assert.equal(args[1], "description:" + description);
    assert.ok(args.includes("+工作"));
    assert.deepEqual(await (await fetch(s.url + "api/tasks")).json(), { tasks: [], projects: [] });
  } finally {
    await s.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("signed Access tokens require valid signature, audience and expiry", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
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
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ iss: issuer, aud: ["aster"], exp: Math.floor(Date.now() / 1000) + 60, ...overrides }),
    ).toString("base64url");
    const data = header + "." + payload;
    return data + "." + sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url");
  };
  const get = (jwt) => fetch(s.url + "api/tasks", { headers: { "cf-access-jwt-assertion": jwt } });
  try {
    assert.equal((await get(token({}))).status, 200);
    assert.equal((await get(token({ aud: ["other"] }))).status, 401);
    assert.equal((await get(token({ exp: 1 }))).status, 401);
    assert.equal((await get(token({ nbf: Date.now() / 1000 + 3600 }))).status, 401);
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
      { uuid: "123e4567-e89b-42d3-a456-426614174000", description: "保留这个任务", status: "pending", tags: ["Todo"] },
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
else if(a.includes('_tags'))console.log([...new Set(tasks.flatMap(t=>t.tags))].join('\\n'));
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
      headers: { "Content-Type": "application/json", Origin: "https://aster.example" },
      body: JSON.stringify(data),
    });
  try {
    const first = await get("organization");
    assert.equal(first.tags[0].name, "Todo");
    assert.equal(first.tags[0].count, 1);
    const filter = {
      id: "",
      name: "Todo",
      description: "",
      expression: "status:pending @Todo",
      color: "green",
      favorite: true,
    };
    const savedResponse = await post({ revision: 0, kind: "filter", action: "save", item: filter });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.filters[0].favorite, true);
    assert.equal((await post({ revision: 0, kind: "filter", action: "save", item: filter })).status, 409);
    assert.equal(
      (await post({ revision: 1, kind: "filter", action: "save", item: { ...filter, expression: "delete" } })).status,
      400,
    );
    await get("tasks?filter=" + encodeURIComponent("status:pending @Todo"));
    const renamedResponse = await post({
      revision: 1,
      kind: "tag",
      action: "save",
      item: { ...saved.tags[0], name: "Doing", color: "blue", favorite: true },
    });
    assert.equal(renamedResponse.status, 200);
    const renamed = await renamedResponse.json();
    assert.equal(renamed.filters[0].expression, "status:pending +Doing");
    assert.equal(renamed.tags[0].name, "Doing");
    assert.equal((await get("tasks")).tasks[0].description, "保留这个任务");
    assert.deepEqual((await get("tasks")).tasks[0].tags, ["Doing"]);
    const deleted = await post({ revision: 2, kind: "tag", action: "delete", item: renamed.tags[0] });
    assert.equal(deleted.status, 200);
    assert.deepEqual((await get("tasks")).tasks[0].tags, []);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(calls.some((a) => a.includes("export") && a.includes("+Todo") && a.includes("status.not:deleted")));
    assert.equal(
      calls.some((a) => a.includes("delete") || a.includes("purge") || a.includes("execute")),
      false,
    );
    assert.equal(JSON.parse(await readFile(dir + "/organization.json", "utf8")).revision, 3);
  } finally {
    await s.close();
    await rm(dir, { recursive: true, force: true });
  }
});
