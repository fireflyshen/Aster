import { prependExecutableDirectories } from "./environment.ts";
import type { Connection } from "./settings.ts";

export interface Command {
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  timeout: number;
}

export function quoteRemoteArgument(value: string): string {
  if (value.includes("\0")) throw new Error("Task arguments cannot contain a null character.");
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildCommand(connection: Connection, args: string[], platform = process.platform): Command {
  if (connection.kind === "ssh") {
    const remote = [
      "env",
      "LC_ALL=C",
      ...(connection.taskrc ? [`TASKRC=${connection.taskrc}`] : []),
      connection.taskCommand,
      ...args,
    ]
      .map(quoteRemoteArgument)
      .join(" ");
    return {
      executable:
        platform === "win32"
          ? `${process.env.SystemRoot || "C:\\Windows"}\\System32\\OpenSSH\\ssh.exe`
          : "/usr/bin/ssh",
      args: [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=2",
        connection.sshTarget!,
        remote,
      ],
      env: process.env,
      timeout: 30_000,
    };
  }
  return {
    executable: connection.kind === "wsl" ? "wsl.exe" : connection.taskCommand,
    args: connection.kind === "wsl" ? ["-d", connection.distribution!, "--", connection.taskCommand, ...args] : args,
    env:
      connection.kind === "local"
        ? { ...process.env, PATH: prependExecutableDirectories(process.env.PATH, [connection.taskCommand]) }
        : process.env,
    timeout: 10_000,
  };
}
