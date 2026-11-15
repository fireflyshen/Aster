export type BackupCounts = {
  tasks: number;
  projects: number;
  labels: number;
  filters: number;
  columns: number;
  intervals: number;
};

export type RestoreTimeImpact = {
  timeEpoch: number;
  taskDataEpoch: number;
  sessionVersion: number;
  pendingOperationsCount: number;
  activeTaskActivity?: {
    id: string;
    title: string;
    taskUuid: string;
    startedAt: string;
  };
};

export type RestorePreview = {
  token: string;
  exportedAt: string;
  current: BackupCounts;
  incoming: BackupCounts;
  activeTimers: boolean;
  stoppedOccurrences: number;
  warnings: string[];
  timeImpact?: RestoreTimeImpact;
};

export type RestorePoint = {
  id: string;
  createdAt: string;
  state: "committed" | "rolledBack" | "prepared";
};
