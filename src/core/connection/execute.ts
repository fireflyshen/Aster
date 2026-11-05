import { execFile } from "node:child_process";
import { buildCommand, type Command } from "./command.ts";
import { executionError } from "./errors.ts";
import type { Connection } from "./settings.ts";

export type Executor = (command: Command) => Promise<{ stdout: string; stderr: string }>;

export const executeProcess: Executor = (command) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command.executable,
      command.args,
      {
        env: command.env,
        timeout: command.timeout,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }));
        else resolve({ stdout, stderr });
      },
    );
    child.stdin?.end();
  });

export async function runTaskwarrior(
  connection: Connection,
  args: string[],
  write = false,
  executor = executeProcess,
): Promise<string> {
  const command = buildCommand(connection, args);
  try {
    const result = await executor(command);
    return result.stdout.trim();
  } catch (error) {
    throw executionError(error, connection, write);
  }
}

const writes = new Map<string, Promise<unknown>>();

// Serialize complete user operations, including switch-task's multiple commands.
// This queue is per running extension process; other clients still require fresh reads.
export async function serializeWrite<T>(connection: Connection, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(connection.key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  writes.set(connection.key, current);
  try {
    return await current;
  } finally {
    if (writes.get(connection.key) === current) writes.delete(connection.key);
  }
}
