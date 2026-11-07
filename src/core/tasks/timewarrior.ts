import { isCompactTaskDate } from "./model.ts";
import { buildCommand } from "../connection/command.ts";
import { executeProcess, type Executor } from "../connection/execute.ts";
import type { Connection } from "../connection/settings.ts";
import {
  parseTimewarriorIntervals,
  type TimewarriorInterval,
} from "../workspace/energy.ts";

export function resolveTimewarriorCommand(
  taskCommand: string,
  envCommand = process.env.TIMEW_COMMAND,
): string {
  if (envCommand?.trim()) return envCommand.trim();
  if (taskCommand.endsWith("/task")) return taskCommand.slice(0, -5) + "/timew";
  return "timew";
}

export async function loadTimewarriorIntervals(
  connection: Connection,
  executor: Executor = executeProcess,
): Promise<TimewarriorInterval[]> {
  const timewCommand = resolveTimewarriorCommand(connection.taskCommand);
  const command = buildCommand(
    {
      ...connection,
      taskCommand: timewCommand,
      taskrc: undefined,
    },
    ["export", ":yes"],
  );
  const result = await executor(command);
  const value: unknown = JSON.parse(result.stdout);
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item ||
        !isCompactTaskDate(item.start) ||
        (item.end !== undefined && !isCompactTaskDate(item.end)),
    )
  )
    throw new Error("Invalid timer history.");
  return parseTimewarriorIntervals(result.stdout);
}

// Unlike the energy summary loader, backups must distinguish unavailable from empty.
export async function exportTimewarrior(
  connection: Connection,
  executor: Executor = executeProcess,
): Promise<unknown[]> {
  const result = await executor(
    buildCommand(
      {
        ...connection,
        taskCommand: resolveTimewarriorCommand(connection.taskCommand),
        taskrc: undefined,
      },
      ["export", ":yes"],
    ),
  );
  const value: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(value)) throw new Error("Invalid Timewarrior export.");
  return value;
}
