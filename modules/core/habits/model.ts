export type HabitKind = "positive" | "negative";

export type HabitCompletionMode = "simple" | "checklist";

export type HabitStatus = "active" | "paused" | "archived";

export type HabitSchedule =
  | { type: "daily" }
  | { type: "weekly"; weekdays: number[] } // ISO weekday: 1 (Mon) .. 7 (Sun)
  | { type: "interval"; intervalDays: number; anchorDate: string }; // YYYY-MM-DD

export type HabitChecklistItem = {
  id: string;
  title: string;
  required: boolean;
};

export type HabitPlan = {
  id: string;
  name: string;
  items: HabitChecklistItem[];
};

export type HabitChecklistEntryProgress = {
  done: boolean;
  sets?: string;
  reps?: string;
  weight?: string;
  note?: string;
};

export type HabitNegativeEvent = {
  id: string;
  habitId: string;
  date: string; // YYYY-MM-DD
  occurredAtMs: number;
  note: string;
  createdAtMs: number;
};

export type HabitDailyLog = {
  id: string;
  habitId: string;
  date: string; // YYYY-MM-DD
  completed: boolean;
  completedAtMs?: number;
  planId?: string;
  checklistSnapshot?: HabitChecklistItem[];
  checklistProgress?: Record<string, HabitChecklistEntryProgress>;
  note: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type HabitRevision = {
  id: string;
  habitId: string;
  effectiveFromDate: string; // YYYY-MM-DD (inclusive)
  status: HabitStatus;
  completionMode: HabitCompletionMode;
  abEnabled: boolean;
  schedule: HabitSchedule;
  plans: HabitPlan[];
  createdAtMs: number;
};

export type Habit = {
  id: string;
  taskUuid?: string;
  title: string;
  kind: HabitKind;
  completionMode: HabitCompletionMode;
  description: string;
  project?: string;
  tags: string[];
  status: HabitStatus;
  abEnabled: boolean;
  subtaskPlans?: Record<string, "A" | "B">;
  schedule: HabitSchedule;
  plans: HabitPlan[];
  sortOrder: number;
  createdDate: string; // YYYY-MM-DD
  createdAtMs: number;
  updatedAtMs: number;
};

export type HabitDayStatus =
  | "unscheduled"
  | "paused"
  | "achieved"
  | "missed"
  | "partial"
  | "in_progress"
  | "broken";

export type HabitDayEvaluation = {
  date: string;
  scheduled: boolean;
  paused: boolean;
  archived: boolean;
  inProgress: boolean;
  achieved: boolean;
  status: HabitDayStatus;
  completionMode: HabitCompletionMode;
  abEnabled: boolean;
  planId?: string;
  planName?: string;
  checklistItems: HabitChecklistItem[];
  checklistProgress: Record<string, HabitChecklistEntryProgress>;
  requiredDoneCount: number;
  requiredTotalCount: number;
  events: HabitNegativeEvent[];
  note: string;
  hasLog: boolean;
};

export type HabitStreakSummary = {
  currentStreak: number;
  longestStreak: number;
  unit: "天" | "次";
  recent30Scheduled: number;
  recent30Achieved: number;
  recent30Events: number;
};

export type HabitListItem = Habit & {
  streak: HabitStreakSummary;
  todayEvaluation?: HabitDayEvaluation;
  hasLogToday?: boolean;
};

export type HeatmapCellStatus =
  | "unscheduled"
  | "in_progress"
  | "zero"
  | "level1"
  | "level2"
  | "level3"
  | "level4"
  | "future";

export type HeatmapCell = {
  date: string;
  status: HeatmapCellStatus;
  scheduledCount: number;
  achievedCount: number;
  ratio: number;
  inProgressPositiveDone?: number;
  inProgressPositiveTotal?: number;
  inProgressNegativeClean?: number;
  inProgressNegativeTotal?: number;
};

export type HeatmapResponse = {
  startDate: string;
  endDate: string;
  todayDate: string;
  cells: HeatmapCell[];
  summary: {
    totalScheduledDays: number;
    perfectDays: number;
    achievedTotal: number;
    scheduledTotal: number;
  };
};

export type DayDetailItem = {
  habit: Habit;
  evaluation: HabitDayEvaluation;
  availablePlans: HabitPlan[];
};

export type DayDetailResponse = {
  date: string;
  todayDate: string;
  isToday: boolean;
  isFuture: boolean;
  scheduledCount: number;
  achievedCount: number;
  items: DayDetailItem[];
};

export type TodayHabitsResponse = {
  todayDate: string;
  timezone: string;
  items: Array<{
    habit: Habit;
    streak: HabitStreakSummary;
    evaluation: HabitDayEvaluation;
    availablePlans: HabitPlan[];
  }>;
  summary: {
    total: number;
    positiveTotal: number;
    positiveDone: number;
    negativeTotal: number;
    negativeClean: number;
  };
};

export type HabitDetailResponse = {
  habit: Habit;
  streak: HabitStreakSummary;
  heatmap: HeatmapResponse;
  recentDays: DayDetailItem[];
  revisions: HabitRevision[];
};

export type CreateHabitInput = {
  taskUuid?: string;
  title: string;
  kind: HabitKind;
  completionMode?: HabitCompletionMode;
  description?: string;
  project?: string;
  tags?: string[];
  abEnabled?: boolean;
  subtaskPlans?: Record<string, "A" | "B">;
  schedule: HabitSchedule;
  plans?: HabitPlan[];
  createdDate?: string;
};

export type UpdateHabitInput = {
  title?: string;
  description?: string;
  project?: string | null;
  tags?: string[];
  completionMode?: HabitCompletionMode;
  abEnabled?: boolean;
  subtaskPlans?: Record<string, "A" | "B">;
  schedule?: HabitSchedule;
  plans?: HabitPlan[];
  effectiveFromDate?: string;
};

export type BindTaskHabitInput = {
  taskUuid: string;
  kind: HabitKind;
  schedule: HabitSchedule;
  status?: HabitStatus;
  abEnabled?: boolean;
  subtaskPlans?: Record<string, "A" | "B">;
  effectiveFromDate?: string;
  title?: string;
  description?: string;
  project?: string | null;
  tags?: string[];
};

export type HabitBackupPayload = {
  version: 1;
  habits: Habit[];
  revisions: HabitRevision[];
  dailyLogs: HabitDailyLog[];
  negativeEvents: HabitNegativeEvent[];
};
