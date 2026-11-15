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
  enabled: boolean;
  state: TimerSnapshot["state"];
  timeEpoch: number;
  taskDataEpoch: number;
  sessionVersion: number;
  pendingOperationsCount: number;
  cutoverAtMs?: number;
  activeActivity: Activity | null;
  policy: TimePolicy;
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
  createdAtMs: number;
  updatedAtMs: number;
};

export type InspectOperationResponse = {
  found: boolean;
  operation: UnresolvedOperationItem | null;
  suggestionHint?: string;
};

export type TimeReconcileDigest = {
  date: string;
  timezone: string;
  dailySummary: DailyLedgerSummary;
  unresolvedOperations: UnresolvedOperationItem[];
  reviewRequiredSegments: DailyLedgerSummary["locatedSegments"];
  unlocatedEstimates: Activity[];
  gaps: DailyLedgerSummary["gaps"];
  sleepCandidates: DailyLedgerSummary["sleepCandidates"];
};

export type TimewarriorImportPreview = {
  alreadyImported?: boolean;
  importableCount: number;
  skippedAfterCutoverCount: number;
  conflictCount: number;
  openAtCutoverCount: number;
  cutoverAtMs: number;
  rangeStartMs?: number;
  rangeEndMs?: number;
  openIntervalsAtCutover?: Array<{
    startMs: number;
    title: string;
  }>;
  conflicts?: Array<{
    title: string;
    startMs: number;
    endMs: number;
    reason: string;
  }>;
};

export type TimeBackupPreview = {
  valid: boolean;
  token: string;
  schemaVersion: number;
  activityCount: number;
  currentTimeEpoch: number;
  nextTimeEpoch: number;
  activeFrozenWarning?: string;
};

export function makeTimeIdempotencyKey(prefix: string): string {
  const uid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uid}`;
}

export function fetchTimeStatus(): Promise<TimeStatusResponse> {
  return api<TimeStatusResponse>("api/time/status");
}

export function fetchDailySummary(date?: string): Promise<DailyLedgerSummary> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return api<DailyLedgerSummary>(`api/time/daily${qs}`);
}

export function fetchWeeklySummary(
  dateOrWeekStart?: string,
): Promise<WeeklyDistributionSummary> {
  const qs = dateOrWeekStart
    ? `?date=${encodeURIComponent(dateOrWeekStart)}`
    : "";
  return api<WeeklyDistributionSummary>(`api/time/weekly${qs}`);
}

export function fetchReconcileDigest(
  date?: string,
): Promise<TimeReconcileDigest> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return api<TimeReconcileDigest>(`api/time/reconcile-digest${qs}`);
}

export function fetchTimePolicy(): Promise<TimePolicy> {
  return api<TimePolicy>("api/time/policy");
}

export function updateTimePolicy(input: {
  expectedPolicyVersion: number;
  patch: Partial<Omit<TimePolicy, "policyVersion">>;
}): Promise<{ policy: TimePolicy; operationId: string }> {
  return api("api/time/policy", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-policy"),
      ...input,
    }),
  });
}

export function inspectTimeOperation(
  id: string,
): Promise<InspectOperationResponse> {
  return api<InspectOperationResponse>(
    `api/time/operation?id=${encodeURIComponent(id)}`,
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
  return api("api/time/operation/resolve", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function startTimeActivity(input: {
  title?: string;
  explicitCategoryId?: string;
  taskUuid?: string;
  projectSnapshot?: string;
  note?: string;
  expectedSessionVersion?: number;
}): Promise<TimeReceipt> {
  return api<TimeReceipt>("api/time/start", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-start"),
      source: "manual",
      ...input,
    }),
  });
}

export function stopTimeActivity(input?: {
  expectedActivityId?: string;
  expectedVersion?: number;
  expectedSessionVersion?: number;
}): Promise<TimeReceipt> {
  return api<TimeReceipt>("api/time/stop", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-stop"),
      ...(input || {}),
    }),
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
  return api<TimeReceipt>("api/time/log", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-log"),
      source: "manual",
      ...input,
    }),
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
  return api<TimeReceipt>("api/time/estimate", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-est"),
      source: "manual",
      ...input,
    }),
  });
}

export function locateTimeEstimate(input: {
  activityId: string;
  expectedVersion: number;
  startMs: number;
  endMs: number;
}): Promise<TimeReceipt> {
  return api<TimeReceipt>("api/time/locate", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-loc"),
      ...input,
    }),
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
  return api<TimeReceipt>("api/time/update", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-upd"),
      ...input,
    }),
  });
}

export function undoTimeOperation(
  targetOperationId: string,
): Promise<TimeReceipt> {
  return api<TimeReceipt>("api/time/undo", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-undo"),
      targetOperationId,
    }),
  });
}

export function confirmSleepCandidate(date: string): Promise<TimeReceipt> {
  return api<TimeReceipt>("api/time/sleep/confirm", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-sleep-ok"),
      date,
    }),
  });
}

export function dismissSleepCandidate(date: string): Promise<TimeReceipt> {
  return api<TimeReceipt>("api/time/sleep/dismiss", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: makeTimeIdempotencyKey("web-sleep-skip"),
      date,
    }),
  });
}

export function previewTimewarriorImport(input?: {
  cutoverAtMs?: number;
  clipOpenToCutover?: boolean;
}): Promise<TimewarriorImportPreview> {
  return api<TimewarriorImportPreview>("api/time/import/preview", {
    method: "POST",
    body: JSON.stringify(input || {}),
  });
}

export function applyTimewarriorImport(input?: {
  cutoverAtMs?: number;
  clipOpenToCutover?: boolean;
}): Promise<{
  alreadyImported?: boolean;
  batchId?: string;
  importedCount: number;
  conflictCount: number;
  skippedCount: number;
}> {
  return api("api/time/import/apply", {
    method: "POST",
    body: JSON.stringify(input || {}),
  });
}

export function exportTimeBackup(): Promise<{
  manifest: Record<string, unknown>;
  sqliteBase64: string;
}> {
  return api("api/time/backup/export");
}

export function previewTimeBackupRestore(
  sqliteBase64: string,
): Promise<TimeBackupPreview> {
  return api<TimeBackupPreview>("api/time/backup/preview", {
    method: "POST",
    body: JSON.stringify({ sqliteBase64 }),
  });
}

export function applyTimeBackupRestore(token: string): Promise<{
  ok: boolean;
  timeEpoch: number;
}> {
  return api("api/time/backup/restore", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}
