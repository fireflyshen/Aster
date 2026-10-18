import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { buildCommand, quoteRemoteArgument } from "../src/core/connection/command.ts";
import { TaskExecutionError } from "../src/core/connection/errors.ts";
import { runTaskwarrior } from "../src/core/connection/execute.ts";
import { resolveConnection } from "../src/core/connection/settings.ts";

const remote = resolveConnection({ connectionMode: "ssh", sshTarget: "rn" });

test("SSH quotes preserve each argument through a real POSIX shell", () => {
  const args = [
    "中文 空格",
    "O'Reilly",
    '"double"',
    "$(exit 99)",
    "`exit 99`",
    "a;exit 99",
    "line\nbreak",
    "",
    "project:work",
    "\\",
  ];
  const command = [process.execPath, "-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", "--", ...args]
    .map(quoteRemoteArgument)
    .join(" ");
  assert.deepEqual(JSON.parse(execFileSync("/bin/sh", ["-c", command], { encoding: "utf8" })), args);
  assert.throws(() => quoteRemoteArgument("a\0b"), /null character/);
});

test("remote uses native SSH on Windows and no local Taskwarrior or WSL", () => {
  const command = buildCommand(remote, ["export"], "win32");
  assert.match(command.executable, /OpenSSH\\ssh.exe$/);
  assert.ok(command.args.includes("BatchMode=yes"));
  assert.ok(command.args.includes("StrictHostKeyChecking=yes"));
  assert.ok(!command.args.includes("wsl.exe"));
  assert.match(command.args.at(-1)!, /TASKRC=\/etc\/taskwarrior\/taskrc/);
});

test("local macOS and WSL routes remain independent of remote settings", () => {
  const mac = resolveConnection({ connectionMode: "local" }, "darwin");
  assert.equal(buildCommand(mac, ["export"]).executable, "/opt/homebrew/bin/task");
  const windows = resolveConnection({ connectionMode: "local", wslDistribution: "Ubuntu-24.04" }, "win32");
  assert.deepEqual(buildCommand(windows, ["export"]).args, ["-d", "Ubuntu-24.04", "--", "/usr/bin/task", "export"]);
});

test("rejects SSH option injection and separates storage keys by connection", () => {
  for (const sshTarget of ["-oProxyCommand=bad", "rn;bad", "rn bad", "rn\nother"]) {
    assert.throws(() => resolveConnection({ sshTarget }), /SSH Target/);
  }
  assert.throws(() => resolveConnection({ remoteTaskCommand: "task" }), /absolute/);
  assert.notEqual(remote.key, resolveConnection({ sshTarget: "other" }).key);
  assert.notEqual(remote.key, resolveConnection({ remoteTaskrc: "/etc/other.rc" }).key);
});

test("keeps SSH stderr out of successful JSON reads", async () => {
  assert.equal(
    await runTaskwarrior(remote, ["export"], false, async () => ({ stdout: "[]\n", stderr: "warning" })),
    "[]",
  );
});

test("a lost reply after a write is unknown and never automatically retried", async () => {
  let calls = 0;
  await assert.rejects(
    runTaskwarrior(remote, ["add"], true, async () => {
      calls++;
      throw Object.assign(new Error("Connection reset"), { code: 255 });
    }),
    (error: unknown) => error instanceof TaskExecutionError && error.outcome === "unknown",
  );
  assert.equal(calls, 1);
});
