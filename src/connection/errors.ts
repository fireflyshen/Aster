import type { Connection } from "./settings.ts";

interface ProcessFailure extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: string;
  stdout?: string;
  stderr?: string;
}

export class TaskExecutionError extends Error {
  readonly outcome: "failed" | "unknown";
  constructor(message: string, outcome: "failed" | "unknown" = "failed", cause?: unknown) {
    super(message, { cause });
    this.name = "TaskExecutionError";
    this.outcome = outcome;
  }
}

export function executionError(error: unknown, connection: Connection, write: boolean): TaskExecutionError {
  const failure = error as ProcessFailure;
  const detail = failure.stderr?.trim() || failure.message || String(error);
  const normalized = detail.toLowerCase();
  const timeout = failure.killed || failure.signal === "SIGTERM" || normalized.includes("timed out");
  if (failure.code === "ENOENT") {
    return new TaskExecutionError(
      connection.kind === "ssh"
        ? "OpenSSH was not found. Install the system SSH client."
        : connection.kind === "wsl"
          ? "WSL is not available. Install WSL and restart Raycast."
          : `Taskwarrior was not found at “${connection.taskCommand}”.`,
    );
  }
  if (connection.kind === "ssh") {
    if (
      normalized.includes("host key verification failed") ||
      normalized.includes("remote host identification has changed")
    ) {
      return new TaskExecutionError(
        "SSH host verification failed. Verify this host in your terminal before connecting from Aster.",
      );
    }
    if (normalized.includes("permission denied (")) {
      return new TaskExecutionError("SSH authentication failed. Check your SSH key or unlock it in ssh-agent.");
    }
    if (
      normalized.includes("could not resolve hostname") ||
      normalized.includes("connection refused") ||
      normalized.includes("network is unreachable") ||
      (normalized.includes("connect to host") && normalized.includes("connection timed out"))
    ) {
      return new TaskExecutionError(`Could not connect to ${connection.sshTarget}. Check the host and network.`);
    }
    if (
      write &&
      (timeout ||
        (typeof failure.code === "number" && failure.code !== 127) ||
        failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
        failure.signal)
    ) {
      return new TaskExecutionError(
        "Operation result unconfirmed. It may have been saved remotely. Refresh and check before submitting again; Aster has not retried it.",
        "unknown",
        error,
      );
    }
  }
  if (timeout)
    return new TaskExecutionError(
      "Taskwarrior timed out. Refresh and check the task before retrying.",
      write ? "unknown" : "failed",
    );
  if (
    failure.code === 127 ||
    normalized.includes("command not found") ||
    normalized.includes("no such file or directory")
  ) {
    return new TaskExecutionError(
      `Taskwarrior or its configuration was not found. Check “${connection.taskCommand}” and the taskrc path.`,
    );
  }
  if (normalized.includes("wsl_e_distro_not_found") || normalized.includes("distribution was not found")) {
    return new TaskExecutionError(`WSL distribution “${connection.distribution}” was not found.`);
  }
  return new TaskExecutionError(detail, "failed", error);
}
