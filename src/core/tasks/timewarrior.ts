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
    if (taskCommand.endsWith("/task"))
        return taskCommand.slice(0, -5) + "/timew";
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
    try {
        const result = await executor(command);
        return parseTimewarriorIntervals(result.stdout);
    } catch {
        return [];
    }
}
