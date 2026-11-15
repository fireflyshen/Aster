import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prependExecutableDirectories } from "./environment.ts";
import type { Connection } from "./settings.ts";

/** Builds OpenSSH ControlMaster flags on POSIX so sequential SSH commands reuse one multiplexed connection. */
function sshControlArgs(
    platform: string,
    baseEnv: NodeJS.ProcessEnv,
): string[] {
    if (platform === "win32") return [];
    const home = baseEnv.HOME || os.homedir();
    if (!home) return [];
    const dir = path.join(home, ".cache", "aster", "ssh");
    // macOS rejects Unix socket paths over ~104 bytes; %C expands to a 40-char hash.
    if (dir.length + 42 > 100) return [];
    try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        return [
            "-o",
            "ControlMaster=auto",
            "-o",
            `ControlPath=${path.join(dir, "%C")}`,
            "-o",
            "ControlPersist=120",
        ];
    } catch {
        return [];
    }
}

export interface Command {
    executable: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    timeout: number;
    input?: string;
}

export function quoteRemoteArgument(value: string): string {
    if (value.includes("\0"))
        throw new Error("Task arguments cannot contain a null character.");
    return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildCommand(
    connection: Connection,
    args: string[],
    platform = process.platform,
): Command {
    const baseEnv: NodeJS.ProcessEnv = { ...process.env };
    if (platform === "win32") {
        baseEnv.SystemRoot = process.env.SystemRoot || "C:\\Windows";
        baseEnv.WINDIR = process.env.WINDIR || baseEnv.SystemRoot;
        baseEnv.ProgramData = process.env.ProgramData || "C:\\ProgramData";
        baseEnv.SystemDrive = process.env.SystemDrive || "C:";
        const home =
            process.env.USERPROFILE || process.env.HOME || os.homedir();
        baseEnv.USERPROFILE = home;
        baseEnv.HOME = home;
    }

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
                    ? `${baseEnv.SystemRoot}\\System32\\OpenSSH\\ssh.exe`
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
                ...sshControlArgs(platform, baseEnv),
                connection.sshTarget!,
                remote,
            ],
            env: baseEnv,
            timeout: 30_000,
        };
    }
    return {
        executable:
            connection.kind === "wsl" ? "wsl.exe" : connection.taskCommand,
        args:
            connection.kind === "wsl"
                ? [
                      "-d",
                      connection.distribution!,
                      "--",
                      connection.taskCommand,
                      ...args,
                  ]
                : args,
        env:
            connection.kind === "local"
                ? {
                      ...baseEnv,
                      PATH: prependExecutableDirectories(
                          baseEnv.PATH,
                          [connection.taskCommand],
                          platform,
                      ),
                  }
                : baseEnv,
        timeout: 10_000,
    };
}
