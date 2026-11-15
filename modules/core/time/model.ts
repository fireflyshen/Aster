export const DEFAULT_TIMEZONE = "Asia/Shanghai";
export const UNCATEGORIZED_CATEGORY_ID = "uncategorized";
export const DEFAULT_LONG_ACTIVITY_THRESHOLD_SECONDS = 6 * 3600;
export const DEFAULT_CHECKPOINT_INTERVAL_SECONDS = 60 * 60;
export const DEFAULT_TIMER_LIVE_WINDOW_MS = 30_000;

export type TimeCategory = {
  id: string;
  name: string;
  color?: string;
  isSleep?: boolean;
};

export const DEFAULT_CATEGORIES: readonly TimeCategory[] = [
  { id: "sleep", name: "睡眠", color: "purple", isSleep: true },
  { id: "work", name: "工作/项目", color: "blue" },
  { id: "study", name: "学习", color: "teal" },
  { id: "exercise", name: "运动", color: "green" },
  { id: "life", name: "生活事务", color: "orange" },
  { id: "commute", name: "通勤", color: "yellow" },
  { id: "leisure", name: "休闲", color: "mint" },
  { id: "social", name: "社交", color: "berry" },
];

export type ProjectCategoryRule = {
  pattern: string;
  categoryId: string;
};

export type TagCategoryRule = {
  tag: string;
  categoryId: string;
  priority: number;
};

export type SleepTemplate = {
  enabled: boolean;
  /** Local wall-clock start time in HH:MM (e.g. "23:30"). */
  startTime: string;
  /** Local wall-clock end time in HH:MM (e.g. "07:30"). */
  endTime: string;
  version: number;
};

export type ReconcileReminderPolicy = {
  enabled: boolean;
  /** Local wall-clock hour (0-23). */
  hour: number;
  /** Local wall-clock minute (0-59). */
  minute: number;
};

export type TimePolicy = {
  policyVersion: number;
  timezone: string;
  categories: TimeCategory[];
  projectRules: ProjectCategoryRule[];
  tagRules: TagCategoryRule[];
  taskOverrides: Record<string, string>;
  sleepTemplate: SleepTemplate;
  longActivityThresholdSeconds: number;
  reconcileReminder: ReconcileReminderPolicy;
};

export function createDefaultTimePolicy(): TimePolicy {
  return {
    policyVersion: 1,
    timezone: DEFAULT_TIMEZONE,
    categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    projectRules: [],
    tagRules: [],
    taskOverrides: {},
    sleepTemplate: {
      enabled: true,
      startTime: "23:30",
      endTime: "07:30",
      version: 1,
    },
    longActivityThresholdSeconds: DEFAULT_LONG_ACTIVITY_THRESHOLD_SECONDS,
    reconcileReminder: {
      enabled: true,
      hour: 21,
      minute: 30,
    },
  };
}

export type ActivityKind = "located" | "unlocated_estimate";
export type ActivityPrecision =
  | "exact"
  | "estimated_bounds"
  | "estimated_duration";
export type ActivitySource =
  | "timer"
  | "manual"
  | "bot"
  | "sleep_candidate"
  | "timewarrior_import"
  | "task_bridge";
export type ActivityReviewState =
  | "ok"
  | "review_required"
  | "conflict"
  | "voided";
export type ActivityReviewReason =
  | "long_activity"
  | "checkpoint_overdue"
  | "auto_stopped"
  | "restore_freeze"
  | "import_conflict";
export type ActivityStopReason =
  | "manual_stop"
  | "manual_pause"
  | "manual_switch"
  | "duration_limit"
  | "hard_deadline"
  | "both_limits"
  | "task_stop"
  | "task_complete"
  | "task_delete"
  | "restore_freeze";
export type TimingPlanStopBasis =
  | "duration_limit"
  | "hard_deadline"
  | "both_limits";
export type TimingPlanStatus =
  | "scheduled"
  | "active"
  | "paused"
  | "stopped"
  | "expired"
  | "archived";
export type RuleSource =
  | "explicit"
  | "task_override"
  | "project_rule"
  | "tag_rule"
  | "uncategorized";

export type Activity = {
  id: string;
  version: number;
  kind: ActivityKind;
  title: string;
  categoryId: string;
  ruleVersion: number;
  ruleSource: RuleSource;
  taskUuid?: string;
  projectSnapshot?: string;
  startMs?: number;
  endMs?: number;
  suspendMs?: number;
  confirmedThroughMs?: number;
  reviewDueAtMs?: number;
  reviewReason?: ActivityReviewReason;
  timingPlanId?: string;
  autoStopAtMs?: number;
  autoStopBasis?: TimingPlanStopBasis;
  limitVersion?: number;
  timerStoppedAtMs?: number;
  stopReason?: ActivityStopReason;
  processedAtMs?: number;
  windowStartMs?: number;
  windowEndMs?: number;
  targetDate?: string;
  estimatedSeconds?: number;
  precision: ActivityPrecision;
  source: ActivitySource;
  reviewState: ActivityReviewState;
  rawInput?: string;
  note?: string;
  timezone: string;
  importBatchId?: string;
  sourceRecordId?: string;
  candidateKey?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type TimingPlan = {
  id: string;
  version: number;
  title: string;
  categoryId?: string;
  taskUuid?: string;
  projectSnapshot?: string;
  tags?: string[];
  note?: string;
  timezone: string;
  allowanceSeconds?: number;
  plannedStartAtMs?: number;
  hardStopAtMs?: number;
  consumedSeconds: number;
  remainingSeconds?: number;
  effectiveAutoStopAtMs?: number;
  effectiveAutoStopBasis?: TimingPlanStopBasis;
  status: TimingPlanStatus;
  lastStopReason?: ActivityStopReason;
  lastStoppedAtMs?: number;
  activeActivityId?: string;
  createdAtMs: number;
  updatedAtMs: number;
  archivedAtMs?: number;
};

export type TimeEventKind = "auto_stopped" | "checkpoint_due" | "plan_reminder";

export type TimeEvent = {
  id: string;
  dedupKey: string;
  kind: TimeEventKind;
  activityId?: string;
  planId?: string;
  title: string;
  message: string;
  occurredAtMs: number;
  payload: Record<string, unknown>;
  acknowledgedAtMs?: number;
  createdAtMs: number;
};

export type TimeWarning = {
  code: "LONG_ACTIVITY_CLOSED";
  activityId: string;
  activityVersion: number;
  durationSeconds: number;
  suggestedAction: "edit_end";
};

export type ActiveActivitySnapshot = {
  id: string;
  version: number;
  taskUuid?: string;
  title: string;
  categoryId: string;
  startedAt: string;
  state: "running" | "review_required";
  suspendAt?: string;
  timingPlanId?: string;
  autoStopAt?: string;
  limitVersion?: number;
  reviewDueAt?: string;
  confirmedThrough?: string;
};

export type TimerSnapshotState =
  | "ready"
  | "pending_reconcile"
  | "restoring"
  | "unavailable";

export type TimerSnapshot = {
  backend: "time";
  contractVersion: 1;
  timeEpoch: number;
  taskDataEpoch: number;
  state: TimerSnapshotState;
  sessionVersion: number;
  snapshotAt: string;
  liveUntil: string;
  activeActivity: ActiveActivitySnapshot | null;
  taskTotalsSeconds: Record<string, number>;
  totalsComplete: boolean;
  coverageFrom?: string;
  historyComplete: boolean;
};

export type OperationState =
  | "prepared"
  | "external_acknowledged"
  | "skipped_already_satisfied"
  | "applied"
  | "failed"
  | "pending_reconcile";

export type SleepCandidateStatus = "pending" | "confirmed" | "dismissed";

export type SleepCandidate = {
  key: string;
  date: string;
  templateVersion: number;
  startMs: number;
  endMs: number;
  status: SleepCandidateStatus;
  activityId?: string;
  hasConflict: boolean;
};

export type TimelineGap = {
  startMs: number;
  endMs: number;
  durationSeconds: number;
};

export type LocatedSegment = {
  activityId: string;
  version: number;
  title: string;
  categoryId: string;
  taskUuid?: string;
  projectSnapshot?: string;
  startMs: number;
  endMs: number;
  durationSeconds: number;
  confirmedSeconds: number;
  provisionalSeconds: number;
  running: boolean;
  precision: ActivityPrecision;
  source: ActivitySource;
  reviewState: ActivityReviewState;
  suspendMs?: number;
  confirmedThroughMs?: number;
  reviewDueAtMs?: number;
  reviewReason?: ActivityReviewReason;
  timingPlanId?: string;
  autoStopAtMs?: number;
  timerStoppedAtMs?: number;
  stopReason?: ActivityStopReason;
  exceededPlanSeconds?: number;
};

export type DailyLedgerSummary = {
  date: string;
  timezone: string;
  dayStartMs: number;
  dayEndMs: number;
  asOfMs: number;
  pastCapacitySeconds: number;
  coveredSeconds: number;
  provisionalSeconds: number;
  unrecordedSeconds: number;
  estimatedBoundsSeconds: number;
  reviewRequiredSeconds: number;
  byCategorySeconds: Record<string, number>;
  locatedSegments: LocatedSegment[];
  unlocatedEstimates: Activity[];
  sleepCandidates: SleepCandidate[];
  gaps: TimelineGap[];
};

export type WeeklyDistributionSummary = {
  weekStartDate: string;
  weekEndDate: string;
  timezone: string;
  asOfMs: number;
  isPartialWeek: boolean;
  pastCapacitySeconds: number;
  coveredSeconds: number;
  provisionalSeconds: number;
  unrecordedSeconds: number;
  estimatedBoundsSeconds: number;
  reviewRequiredSeconds: number;
  byCategorySeconds: Record<string, number>;
  unlocatedEstimates: Activity[];
  daily: DailyLedgerSummary[];
};
