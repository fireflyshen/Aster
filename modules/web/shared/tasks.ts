import type { TaskwarriorTask } from "../../../src/core/tasks/model.ts";
export type { TaskInput } from "../../../src/core/tasks/arguments.ts";

export type Task = {
  [K in keyof TaskwarriorTask]: NonNullable<TaskwarriorTask[K]> extends Date ? string : TaskwarriorTask[K];
};
export type View = "pending" | "today" | "waiting" | "completed";
