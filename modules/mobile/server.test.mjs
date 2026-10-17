import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";

async function start(env) {
  const child = spawn(process.execPath, [new URL("../../dist/mobile/server.mjs", import.meta.url).pathname], {
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
