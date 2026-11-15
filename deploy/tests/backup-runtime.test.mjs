import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const deploy = readFileSync(new URL("../deploy.sh", import.meta.url), "utf8");
// Evaluate the actual remote-script assignment, without running builds or SSH.
const assignment = deploy.slice(
  deploy.indexOf('BACKUP_SCRIPT="'),
  deploy.indexOf('\nif ! ssh "$SSH_TARGET" "$BACKUP_SCRIPT"'),
);
const backupId = "test-release";
const remoteScript = execFileSync(
  "bash",
  ["-c", `${assignment}\nprintf '%s' "$BACKUP_SCRIPT"`],
  {
    env: {
      ...process.env,
      REMOTE_RELEASE: `/opt/aster/releases/${backupId}`,
      REMOTE_BACKUP: `/opt/aster/backups/before-${backupId}`,
      BACKUP_ID: backupId,
      RELEASE_ID: backupId,
    },
    encoding: "utf8",
  },
);

const candidate = `
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const staging = join(process.env.TEST_ROOT, 'data/backup-staging/test-release');
mkdirSync(staging, {recursive:true});
if (process.env.SCENARIO !== 'missing-manifest') {
  const data = 'snapshot';
  writeFileSync(join(staging, 'organization.json'), data);
  const files = {organization:{exists:true, relativePath:'organization.json', bytes:data.length, sha256:process.env.SCENARIO === 'bad-checksum' ? 'invalid' : createHash('sha256').update(data).digest('hex')}};
  if (['readonly-wal', 'corrupt-sqlite'].includes(process.env.SCENARIO)) {
    const fp = join(staging, 'snapshot.sqlite3');
    const db = new DatabaseSync(fp);
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE marker(id INTEGER); INSERT INTO marker VALUES(1);');
    db.close();
    if (process.env.SCENARIO === 'corrupt-sqlite') writeFileSync(fp, 'invalid sqlite snapshot');
    const bytes = readFileSync(fp);
    files.db = {exists:true, relativePath:'snapshot.sqlite3', bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  writeFileSync(join(staging, 'manifest.json'), JSON.stringify({complete:true, files}));
}
`;

// Model Docker's mount boundary: only compose run with explicit read-only
// candidate/backup mounts can access those paths. Real Node runs syntax checks
// and the deployed script's manifest/checksum verification inside the fixture.
const docker = `#!/usr/bin/env node
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const a = process.argv.slice(2), root = process.env.TEST_ROOT;
const log = (event) => fs.appendFileSync(root+'/events', event+'\\n');
const running = () => fs.readFileSync(root+'/running','utf8') === '1';
if(a[0] === 'ps') { if(running()) console.log('container-id'); process.exit(0); }
if(a[0] === 'compose' && a[1] === 'stop') { log('stop'); fs.writeFileSync(root+'/running','0'); process.exit(0); }
if(a[0] === 'compose' && a[1] === 'up') { log('restart'); fs.writeFileSync(root+'/running','1'); process.exit(0); }
let args;
if(a[0] === 'compose' && a[1] === 'run') {
  for(const mount of [root+'/releases/test-release', root+'/backups/before-test-release']) {
    const index = a.indexOf(mount+':'+mount+':ro');
    if(index < 0 || a[index-1] !== '-v') { console.error('Missing read-only mount: '+mount); process.exit(90); }
  }
  args = a.slice(a.indexOf('aster')+1);
} else if(a[0] === 'exec') {
  args = a.slice(a.indexOf('node')+1);
  if(args.some(v => v.startsWith(root+'/releases/') || v.startsWith(root+'/backups/'))) process.exit(91);
} else { console.error(a); process.exit(92); }
if(args[0] === '-e' && args[1].includes('socketPath: sock')) {
  log('live-backup');
  const live = spawnSync(process.execPath,[root+'/releases/test-release/server.mjs'],{env:process.env,stdio:'inherit'});
  process.exit(live.status ?? 1);
}
if(args[0] === '--check') { log('preflight'); if(process.env.SCENARIO === 'preflight-failure') process.exit(1); }
else if(args.includes('--maintenance-backup')) { log('backup'); if(args.includes('--allow-uninitialized-time')) log('legacy-migration'); if(process.env.SCENARIO === 'backup-failure') process.exit(1); }
else if(args[0] === '-e' && args[1].includes('Checksum mismatch')) log('verify');
const readonlyArchive = process.env.SCENARIO === 'readonly-wal' && args[0] === '-e' && args[1].includes('Checksum mismatch');
const archive = root+'/backups/before-test-release';
let original;
if(readonlyArchive) {
  original = fs.readFileSync(archive+'/snapshot.sqlite3');
  for(const name of fs.readdirSync(archive)) fs.chmodSync(archive+'/'+name, 0o444);
  fs.chmodSync(archive, 0o555);
}
const result = spawnSync(process.execPath,args,{env:process.env,stdio:'inherit'});
if(readonlyArchive) {
  fs.chmodSync(archive, 0o755);
  for(const name of fs.readdirSync(archive)) fs.chmodSync(archive+'/'+name, 0o644);
  if(!fs.readFileSync(archive+'/snapshot.sqlite3').equals(original) || fs.existsSync(archive+'/snapshot.sqlite3-wal') || fs.existsSync(archive+'/snapshot.sqlite3-shm')) {
    console.error('Verification modified the original archive'); process.exit(93);
  }
}
process.exit(result.status ?? 1);
`;

function runScenario(scenario, mode = "docker") {
  const root = mkdtempSync(join(tmpdir(), "aster-deploy-runtime-"));
  try {
    for (const dir of [
      "bin",
      "runtime",
      "data",
      "releases/test-release",
      "backups/before-test-release",
    ])
      mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "running"), "1");
    if (scenario === "live")
      writeFileSync(
        join(root, "aster.env"),
        `WORKSPACE_SOCKET=${root}/data/workspace.sock\n`,
      );
    writeFileSync(join(root, "events"), "");
    mkdirSync(join(root, "current"));
    writeFileSync(
      join(root, "current/server.mjs"),
      scenario === "legacy"
        ? "// legacy task server"
        : "// Time database: time.sqlite",
    );
    writeFileSync(join(root, "releases/test-release/server.mjs"), candidate);
    if (mode === "docker")
      writeFileSync(join(root, "compose.yml"), "services: {}");
    symlinkSync(process.execPath, join(root, "runtime/node"));
    writeFileSync(join(root, "bin/docker"), docker, { mode: 0o755 });
    writeFileSync(
      join(root, "bin/systemctl"),
      `#!/bin/sh
case "$1" in
list-unit-files|is-active) exit 0 ;;
stop) echo stop >> "$TEST_ROOT/events"; printf 0 > "$TEST_ROOT/running" ;;
start) echo restart >> "$TEST_ROOT/events"; printf 1 > "$TEST_ROOT/running" ;;
esac
`,
      { mode: 0o755 },
    );
    const script = remoteScript.replaceAll("/opt/aster", root);
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}/bin:${process.env.PATH}`,
        TEST_ROOT: root,
        SCENARIO: scenario,
      },
    });
    return {
      ...result,
      events: readFileSync(join(root, "events"), "utf8").trim().split("\n"),
      running: readFileSync(join(root, "running"), "utf8"),
      root,
      manifest: (() => {
        try {
          return JSON.parse(
            readFileSync(
              join(root, "backups/before-test-release/manifest.json"),
              "utf8",
            ),
          );
        } catch {
          return undefined;
        }
      })(),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Docker fallback mounts candidate and archive, checks before stop, and validates the backup", () => {
  const r = runScenario("success");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.events, ["preflight", "stop", "backup", "verify"]);
  assert.equal(r.manifest.complete, true);
  assert.equal(r.running, "0"); // Remains paused until the caller activates the release.
});

test("candidate preflight failure leaves the original container running", () => {
  const r = runScenario("preflight-failure");
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.events, ["preflight"]);
  assert.equal(r.running, "1");
});

for (const scenario of ["backup-failure", "missing-manifest", "bad-checksum"]) {
  test(`${scenario} aborts and restarts the previous container`, () => {
    const r = runScenario(scenario);
    assert.notEqual(r.status, 0, r.stderr);
    assert.equal(r.events.at(-1), "restart");
    assert.equal(r.events.filter((v) => v === "restart").length, 1);
    assert.equal(r.running, "1");
  });
}

test("systemd fallback continues to use the host runtime", () => {
  const r = runScenario("success", "systemd");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.events, ["stop"]);
  assert.equal(r.manifest.complete, true);
});

test("systemd checksum failure also restarts the previous service", () => {
  const r = runScenario("bad-checksum", "systemd");
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.events, ["stop", "restart"]);
  assert.equal(r.running, "1");
});

test("live backup validates the host archive without stopping the running service", () => {
  const r = runScenario("live");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.events, ["preflight", "live-backup", "verify"]);
  assert.equal(r.running, "1");
  assert.equal(r.manifest.complete, true);
});

test("only a legacy active release permits the initial Time migration", () => {
  const r = runScenario("legacy");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.events, [
    "preflight",
    "stop",
    "backup",
    "legacy-migration",
    "verify",
  ]);
});

test("WAL-mode SQLite snapshots pass integrity checks without writing to the read-only archive", () => {
  const r = runScenario("readonly-wal");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.events, ["preflight", "stop", "backup", "verify"]);
  assert.equal(r.manifest.files.db.exists, true);
});

test("corrupt SQLite snapshot with a valid file hash still aborts and restarts the service", () => {
  const r = runScenario("corrupt-sqlite");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a database|malformed/);
  assert.equal(r.events.at(-1), "restart");
  assert.equal(r.running, "1");
});
