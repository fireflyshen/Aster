import type {
  Activity,
  ActivityPrecision,
  DailyLedgerSummary,
  TimePolicy,
  TimerSnapshot,
  WeeklyDistributionSummary,
} from "@core/time/model";
import { api } from "@/lib/api";

export type TimeStatusResponse = {
  initialized?: boolean;
  enabled: boolean;
  available?: boolean;
  restoring?: boolean;
  state?: TimerSnapshot["state"];
  schemaVersion?: number;
  timeEpoch?: number;
  taskDataEpoch?: number;
  restoreBarrierAt?: number;
  sessionVersion?: number;
  pendingOperationsCount?: number;
  cutoverAtMs?: number;
  activeActivity?: Activity | null;
};

export type TimeReceipt = {
  operationId: string;
  idempotencyKey?: string;
  ok?: boolean;
  changed?: boolean;
  activity?: Activity;
  closedActivity?: Activity;
  warnings?: string[];
  undoneOperationId?: string;
};

export type UnresolvedOperationItem = {
  operationId: string;
  idempotencyKey: string;
  kind: string;
  state: string;
  targetTaskUuid?: string;
  targetActivityId?: string;
  externalDisposition?: string;
  receivedAtMs: number;
  effectiveAtMs?: number;
};

export type InspectOperationResponse = {
  found: boolean;
  operation: UnresolvedOperationItem | null;
  suggestionHint?: string;
};

export type TimeReconcileDigest = {
  date: string;
  timezone: string;
  asOfMs: number;
  policyVersion: number;
  sessionVersion: number;
  timeEpoch: number;
  coveredSeconds: number;
  unrecordedSeconds: number;
  sleepCandidates: DailyLedgerSummary["sleepCandidates"];
  gaps: DailyLedgerSummary["gaps"];
  unlocatedEstimates: Activity[];
  reviewItems: DailyLedgerSummary["locatedSegments"];
  pendingOperations: UnresolvedOperationItem[];
};

export type TimewarriorImportPreview = {
  snapshotHash: string;
  cutoverAtMs: number;
  alreadyImportedBatchId?: string;
  totalIntervals: number;
  importableCount: number;
  skippedAfterCutoverCount: number;
  conflictCount: number;
  openAtCutoverCount: number;
  rangeStartMs?: number;
  rangeEndMs?: number;
  openIntervalsAtCutover: Array<{
    batchIndex: number;
    startMs: number;
    taskUuid?: string;
    tags: string[];
    title: string;
  }>;
  conflicts: Array<{
    batchIndex: number;
    title: string;
    startMs: number;
    endMs: number;
    reason: string;
  }>;
};

export type TimeBackupPreview = {
  token: string;
  candidateSchemaVersion: number;
  candidateCounts: {
    activities: number;
    operations: number;
    importBatches: number;
    hasOpenActivity: boolean;
  };
  currentCounts: {
    activities: number;
    timeEpoch: number;
    taskDataEpoch: number;
    sessionVersion: number;
    hasOpenActivity: boolean;
  };
  warnings: string[];
};

export function makeTimeIdempotencyKey(prefix: string): string {
  const uid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uid}`;
}

export function fetchTimeStatus(): Promise<TimeStatusResponse> {
  return api<TimeStatusResponse>("time/status");
}

export function fetchDailySummary(date?: string): Promise<DailyLedgerSummary> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return api<DailyLedgerSummary>(`time/daily${qs}`);
}

export function fetchWeeklySummary(
  dateOrWeekStart?: string,
): Promise<WeeklyDistributionSummary> {
  const qs = dateOrWeekStart
    ? `?date=${encodeURIComponent(dateOrWeekStart)}`
    : "";
  return api<WeeklyDistributionSummary>(`time/weekly${qs}`);
}

export function fetchReconcileDigest(
  date?: string,
): Promise<TimeReconcileDigest> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return api<TimeReconcileDigest>(`time/reconcile-digest${qs}`);
}

export function fetchTimePolicy(): Promise<TimePolicy> {
  return api<TimePolicy>("time/policy");
}

export function updateTimePolicy(input: {
  expectedPolicyVersion: number;
  patch: Partial<Omit<TimePolicy, "policyVersion">>;
}): Promise<TimePolicy> {
  return api<TimePolicy>("time/policy", {
    idempotencyKey: makeTimeIdempotencyKey("web-policy"),
    ...input,
  });
}

export function inspectTimeOperation(
  id: string,
): Promise<InspectOperationResponse> {
  return api<InspectOperationResponse>(
    `time/operation?id=${encodeURIComponent(id)}`,
  );
}

export function resolveTimeOperation(input: {
  operationId: string;
  action: "dismiss" | "accept_started" | "stop_active";
  effectiveAtMs?: number;
}): Promise<{
  applied: boolean;
  state: string;
  receipt?: TimeReceipt;
}> {
  return api("time/operation/resolve", input);
}

export function startTimeActivity(input: {
  title?: string;
  explicitCategoryId?: string;
  taskUuid?: string;
  projectSnapshot?: string;
  note?: string;
  expectedSessionVersion?: number;
}): Promise<TimeReceipt> {
  return api<TimeReceipt>("time/start", {
    idempotencyKey: makeTimeIdempotencyKey("web-start"),
    source: "manual",
    ...input,
  });
}

export function stopTimeActivity(input?: {
  expectedActivityId?: string;
  expectedVersion?: number;
  expectedSessionVersion?: number;
}): Promise<TimeReceipt> {
  return api<TimeReceipt>("time/stop", {
    idempotencyKey: makeTimeIdempotencyKey("web-stop"),
    ...(input || {}),
  });
}

export function logTimeActivity(input: {
  title: string;
  startMs: number;
  endMs: number;
  explicitCategoryId?: string;
  taskUuid?: string;
  precision?: ActivityPrecision | "approximate";
  note?: string;
}): Promise<TimeReceipt> {
  return api<TimeReceipt>("time/log", {
    idempotencyKey: makeTimeIdempotencyKey("web-log"),
    source: "manual",
    ...input,
  });
}

export function estimateTimeActivity(input: {
  title: string;
  estimatedSeconds: number;
  targetDate?: string;
  windowStartMs?: number;
  windowEndMs?: number;
  explicitCategoryId?: string;
  taskUuid?: string;
  note?: string;
}): Promise<TimeReceipt> {
  return api<TimeReceipt>("time/estimate", {
    idempotencyKey: makeTimeIdempotencyKey("web-est"),
    source: "manual",
    ...input,
  });
}

export function locateTimeEstimate(input: {
  activityId: string;
  expectedVersion: number;
  startMs: number;
  endMs: number;
}): Promise<TimeReceipt> {
  return api<TimeReceipt>("time/locate", {
    idempotencyKey: makeTimeIdempotencyKey("web-loc"),
    ...input,
  });
}

export function updateTimeActivity(input: {
  activityId: string;
  expectedVersion: number;
  patch: {
    title?: string;
    categoryId?: string;
    note?: string;
    clearTaskLink?: boolean;
    precision?: ActivityPrecision;
    startMs?: number;
    endMs?: number;
    confirmReview?: boolean;
    estimatedSeconds?: number;
    targetDate?: string;
    windowStartMs?: number | null;
    windowEndMs?: number | null;
  };
}): Promise<TimeReceipt> {
  return api<TimeReceipt>("time/update", {
    idempotencyKey: makeTimeIdempotencyKey("web-upd"),
    ...input,
  });
}

export function undoTimeOperation(
  targetOperationId: string,
): Promise<TimeReceipt> {
  return api<TimeReceipt>("time/undo", {
    idempotencyKey: makeTimeIdempotencyKey("web-undo"),
    targetOperationId,
  });
}

export function confirmSleepCandidate(date: string): Promise<TimeReceipt> {
  return api<TimeReceipt>("time/sleep/confirm", {
    idempotencyKey: makeTimeIdempotencyKey("web-sleep-ok"),
    date,
  });
}

export function dismissSleepCandidate(date: string): Promise<TimeReceipt> {
  return api<TimeReceipt>("time/sleep/dismiss", {
    idempotencyKey: makeTimeIdempotencyKey("web-sleep-skip"),
    date,
  });
}

export function previewTimewarriorImport(input?: {
  cutoverAtMs?: number;
  clipOpenToCutover?: boolean;
}): Promise<TimewarriorImportPreview> {
  return api<TimewarriorImportPreview>("time/import/preview", input || {});
}

export function applyTimewarriorImport(input?: {
  cutoverAtMs?: number;
  clipOpenToCutover?: boolean;
}): Promise<{
  batchId: string;
  snapshotHash: string;
  reusedExistingBatch: boolean;
  importedCount: number;
  conflictCount: number;
  skippedCount: number;
  createdActivityIds: string[];
}> {
  return api("time/import/apply", input || {});
}

export function exportTimeBackup(): Promise<{
  format: string;
  version: number;
  manifest: Record<string, unknown>;
  barrier: Record<string, unknown>;
  sqliteBase64: string;
}> {
  return api("time/backup/export");
}

export function previewTimeBackupRestore(
  sqliteBase64: string,
): Promise<TimeBackupPreview> {
  return api<TimeBackupPreview>("time/backup/preview", { sqliteBase64 });
}

export function applyTimeBackupRestore(token: string): Promise<{
  restoreId: string;
  preRestoreDir: string;
  timeEpoch: number;
  taskDataEpoch: number;
  restoreBarrierAt: number;
  frozenActiveActivityId: string | null;
  pendingOperationsCount: number;
}> {
  return api("time/backup/restore", { token });
}
