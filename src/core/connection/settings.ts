import { createHash } from "node:crypto";

export interface TaskwarriorPreferences {
  connectionMode?: "local" | "ssh";
  sshTarget?: string;
  remoteTaskCommand?: string;
  remoteTaskrc?: string;
  taskCommand?: string;
  wslDistribution?: string;
}

export interface Connection {
  kind: "local" | "wsl" | "ssh";
  label: string;
  key: string;
  taskCommand: string;
  sshTarget?: string;
  taskrc?: string;
  distribution?: string;
}

export function resolveConnection(preferences: TaskwarriorPreferences, platform = process.platform): Connection {
  const mode = preferences.connectionMode ?? "ssh";
  if (mode !== "local" && mode !== "ssh") throw new Error("Choose Local or SSH in extension preferences.");
  let connection: Omit<Connection, "key">;
  if (mode === "ssh") {
    const sshTarget = preferences.sshTarget?.trim() || "rn";
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.@:[\]-]*$/.test(sshTarget)) {
      throw new Error("SSH Target must be a host alias or user@host, without command options or spaces.");
    }
    const taskCommand = preferences.remoteTaskCommand?.trim() || "/usr/local/bin/task";
    const taskrc = preferences.remoteTaskrc === undefined ? "/etc/taskwarrior/taskrc" : preferences.remoteTaskrc.trim();
    for (const value of [taskCommand, taskrc]) {
      if (value && (!value.startsWith("/") || /[\0\r\n]/.test(value))) {
        throw new Error("Remote Task Command and Remote Taskrc must use absolute Linux paths.");
      }
    }
    connection = { kind: "ssh", label: `Remote · ${sshTarget}`, sshTarget, taskCommand, taskrc: taskrc || undefined };
  } else if (platform === "win32") {
    const distribution = preferences.wslDistribution?.trim() || "Ubuntu";
    connection = {
      kind: "wsl",
      label: `Local · WSL ${distribution}`,
      distribution,
      taskCommand: preferences.taskCommand?.trim() || "/usr/bin/task",
    };
  } else if (platform === "darwin") {
    connection = {
      kind: "local",
      label: "Local · macOS",
      taskCommand: preferences.taskCommand?.trim() || "/opt/homebrew/bin/task",
    };
  } else {
    throw new Error(`Unsupported local platform: ${platform}`);
  }
  const key = createHash("sha256").update(JSON.stringify(connection)).digest("hex").slice(0, 24);
  return { ...connection, key };
}
