export type BackupCounts = {
  tasks: number;
  projects: number;
  labels: number;
  filters: number;
  columns: number;
  intervals: number;
};

export type RestorePreview = {
  token: string;
  exportedAt: string;
  current: BackupCounts;
  incoming: BackupCounts;
  activeTimers: boolean;
  stoppedOccurrences: number;
  warnings: string[];
};

export type RestorePoint = {
  id: string;
  createdAt: string;
  state: "committed" | "rolledBack" | "prepared";
};
