import type { TaskwarriorTask } from "../../core/tasks/model.ts";
export type { TaskInput } from "../../core/tasks/arguments.ts";

export type Task = {
  [K in keyof TaskwarriorTask]: NonNullable<TaskwarriorTask[K]> extends Date
    ? string
    : TaskwarriorTask[K];
};
export type View =
  | "focus"
  | "later"
  | "urgency"
  | "pending"
  | "today"
  | "waiting"
  | "completed";
