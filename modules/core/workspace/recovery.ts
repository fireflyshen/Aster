import type { TaskInput } from "../tasks/arguments.ts";
export type DeletedTask = {
  uuid: string;
  description: string;
  project?: string;
  deletedAt?: string;
  restoreStatus: string;
  tracked: boolean;
  finishing: boolean;
};
export type RecoveryList = { tasks: DeletedTask[] };
export type SeriesSnapshot = {
  uuid: string;
  description: string;
  recur: string;
  until: string;
  due: string;
};
export type TaskAction = { uuid: string } & (
  | {
      action: "complete" | "reopen" | "start" | "stop" | "delete" | "restore";
    }
  | { action: "edit"; task: TaskInput }
  | { action: "wait"; wait: string }
  | { action: "note.remove"; entry: string; description: string }
  | { action: "recurrence.edit"; recur: string; until: string }
);
