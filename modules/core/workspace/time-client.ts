import type {
  Activity,
  ActivityPrecision,
  BillExpenseItem,
  BillLink,
  CostReportGranularity,
  CostReportSortBy,
  CostReportSummary,
  DailyLedgerSummary,
  LocatedSegment,
  TaskCostSummary,
  TimeEvent,
  TimePolicy,
  TimerSnapshot,
  TimingPlan,
  WeeklyDistributionSummary,
} from "../time/model.ts";

export type WorkspaceTaskAddResult = {
  ok?: boolean;
  uuid?: string;
};

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
  policy?: TimePolicy;
};

export type TimeReceipt = {
  operationId: string;
  idempotencyKey?: string;
  ok?: boolean;
  changed?: boolean;
  activity?: Activity;
  closedActivity?: Activity;
  plan?: TimingPlan;
  warnings?: string[];
  undoneOperationId?: string;
};

export type TaskCostDetailResponse = {
  summary: TaskCostSummary;
  segments: LocatedSegment[];
  plans: TimingPlan[];
  billLinks: BillLink[];
};

export type TimeBillsResponse = {
  available: boolean;
  expenses: BillExpenseItem[];
};

export type TimeInvoke = (
  route: string,
  data?: unknown,
  timeoutMs?: number,
) => Promise<unknown>;

export function generateTimeIdempotencyKey(prefix: string): string {
  const uid =
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uid}`;
}

/** Creates typed Time Ledger, Cost, TimingPlan, and Bills methods over HTTP or SSH IPC. */
export function createWorkspaceTimeClient(invoke: TimeInvoke) {
  const get = <T>(route: string, query?: URLSearchParams) => {
    const qs = query?.toString();
    return invoke(qs ? `${route}?${qs}` : route) as Promise<T>;
  };

  const post = <T>(route: string, body: Record<string, unknown>) =>
    invoke(route, body) as Promise<T>;

  return {
    status: () => get<TimeStatusResponse>("/api/time/status"),

    daily: (date?: string) => {
      const q = new URLSearchParams();
      if (date) q.set("date", date);
      return get<DailyLedgerSummary>("/api/time/daily", q);
    },

    weekly: (dateOrWeekStart?: string) => {
      const q = new URLSearchParams();
      if (dateOrWeekStart) q.set("date", dateOrWeekStart);
      return get<WeeklyDistributionSummary>("/api/time/weekly", q);
    },

    taskDetail: (taskUuid: string) => {
      const q = new URLSearchParams({ taskUuid });
      return get<TaskCostDetailResponse>("/api/time/task-detail", q);
    },

    setTaskBudget: (input: {
      taskUuid: string;
      mode?: "set" | "add" | "clear";
      allowanceSeconds?: number | null;
      addAllowanceSeconds?: number;
      plannedStartAtMs?: number | null;
      plannedStartDate?: string;
      plannedStartTime?: string | null;
      hardStopAtMs?: number | null;
      hardStopDate?: string;
      hardStopTime?: string | null;
    }) => post<{ summary: TaskCostSummary }>("/api/time/task-budget", input),

    costReport: (input?: {
      granularity?: CostReportGranularity;
      date?: string;
      sortBy?: CostReportSortBy;
    }) => {
      const q = new URLSearchParams();
      if (input?.granularity) q.set("granularity", input.granularity);
      if (input?.date) q.set("date", input.date);
      if (input?.sortBy) q.set("sortBy", input.sortBy);
      return get<CostReportSummary>("/api/time/cost-report", q);
    },

    billsExpenses: (input?: {
      q?: string;
      fromDate?: string;
      toDate?: string;
      limit?: number;
    }) => {
      const q = new URLSearchParams();
      if (input?.q) q.set("q", input.q);
      if (input?.fromDate) q.set("fromDate", input.fromDate);
      if (input?.toDate) q.set("toDate", input.toDate);
      if (input?.limit !== undefined) q.set("limit", String(input.limit));
      return get<TimeBillsResponse>("/api/time/bills/expenses", q);
    },

    linkBill: (input: {
      txKey: string;
      taskUuid?: string;
      activityId?: string;
      source: string;
      txId: string;
      payTime: string;
      payee?: string;
      narration?: string;
      account: string;
      currency?: string;
      amount: number;
      cnyAmountCents: number;
      note?: string;
    }) => post<{ link: BillLink }>("/api/time/bills/link", input),

    unlinkBill: (linkId: string) =>
      post<{ unlinked: boolean }>("/api/time/bills/unlink", { linkId }),

    policy: () => get<TimePolicy>("/api/time/policy"),

    updatePolicy: (input: {
      expectedPolicyVersion: number;
      patch: Partial<Omit<TimePolicy, "policyVersion">>;
    }) =>
      post<TimePolicy>("/api/time/policy", {
        idempotencyKey: generateTimeIdempotencyKey("desk-policy"),
        ...input,
      }),

    start: (input: {
      title?: string;
      timingPlanId?: string;
      explicitCategoryId?: string;
      taskUuid?: string;
      projectSnapshot?: string;
      tags?: string[];
      note?: string;
      sameTaskNoop?: boolean;
      expectedSessionVersion?: number;
    }) =>
      post<TimeReceipt>("/api/time/start", {
        idempotencyKey: generateTimeIdempotencyKey("desk-start"),
        source: "manual",
        ...input,
      }),

    stop: (input?: {
      expectedActivityId?: string;
      expectedVersion?: number;
      expectedSessionVersion?: number;
      pause?: boolean;
    }) =>
      post<TimeReceipt>("/api/time/stop", {
        idempotencyKey: generateTimeIdempotencyKey("desk-stop"),
        ...(input || {}),
      }),

    confirm: (input: {
      activityId: string;
      expectedVersion: number;
      throughMs?: number;
      nextCheckpointSeconds?: number;
    }) =>
      post<TimeReceipt>("/api/time/confirm", {
        idempotencyKey: generateTimeIdempotencyKey("desk-confirm"),
        ...input,
      }),

    log: (input: {
      title: string;
      startMs: number;
      endMs: number;
      explicitCategoryId?: string;
      taskUuid?: string;
      projectSnapshot?: string;
      tags?: string[];
      precision?: ActivityPrecision;
      note?: string;
    }) =>
      post<TimeReceipt>("/api/time/log", {
        idempotencyKey: generateTimeIdempotencyKey("desk-log"),
        source: "manual",
        ...input,
      }),

    updateActivity: (input: {
      activityId: string;
      expectedVersion: number;
      patch: {
        title?: string;
        categoryId?: string;
        projectSnapshot?: string | null;
        tags?: string[] | null;
        note?: string | null;
        clearTaskLink?: boolean;
        precision?: ActivityPrecision;
        startMs?: number;
        endMs?: number;
        confirmReview?: boolean;
      };
    }) =>
      post<TimeReceipt>("/api/time/update", {
        idempotencyKey: generateTimeIdempotencyKey("desk-upd"),
        ...input,
      }),

    plans: (input?: { includeArchived?: boolean; taskUuid?: string }) => {
      const q = new URLSearchParams();
      if (input?.includeArchived) q.set("includeArchived", "1");
      if (input?.taskUuid) q.set("taskUuid", input.taskUuid);
      return get<{ plans: TimingPlan[] }>("/api/time/plans", q);
    },

    createPlan: (input: {
      title?: string;
      categoryId?: string;
      taskUuid?: string;
      projectSnapshot?: string;
      tags?: string[];
      note?: string;
      allowanceSeconds?: number;
      allowanceMinutes?: number;
      plannedStartAtMs?: number;
      plannedStartDate?: string;
      plannedStartTime?: string;
      hardStopAtMs?: number;
      hardStopDate?: string;
      hardStopTime?: string;
    }) =>
      post<{ operationId?: string; plan: TimingPlan }>(
        "/api/time/plans/create",
        {
          idempotencyKey: generateTimeIdempotencyKey("desk-plan"),
          ...input,
        },
      ),

    updatePlan: (input: {
      planId: string;
      expectedVersion: number;
      expectedSessionVersion?: number;
      expectedActivityId?: string;
      expectedActivityVersion?: number;
      title?: string;
      categoryId?: string | null;
      taskUuid?: string | null;
      projectSnapshot?: string | null;
      tags?: string[] | null;
      note?: string | null;
      allowanceSeconds?: number | null;
      allowanceMinutes?: number | null;
      addAllowanceSeconds?: number;
      addAllowanceMinutes?: number;
      plannedStartAtMs?: number | null;
      plannedStartDate?: string;
      plannedStartTime?: string | null;
      hardStopAtMs?: number | null;
      hardStopDate?: string;
      hardStopTime?: string | null;
      archived?: boolean;
    }) =>
      post<{ operationId?: string; plan: TimingPlan }>(
        "/api/time/plans/update",
        {
          idempotencyKey: generateTimeIdempotencyKey("desk-plan-upd"),
          ...input,
        },
      ),

    startPlan: (input: {
      planId: string;
      sameTaskNoop?: boolean;
      expectedSessionVersion?: number;
    }) =>
      post<TimeReceipt>("/api/time/plans/start", {
        idempotencyKey: generateTimeIdempotencyKey("desk-plan-start"),
        ...input,
      }),

    events: (input?: { includeAcknowledged?: boolean; limit?: number }) => {
      const q = new URLSearchParams();
      if (input?.includeAcknowledged) q.set("includeAcknowledged", "1");
      if (input?.limit !== undefined) q.set("limit", String(input.limit));
      return get<{ events: TimeEvent[] }>("/api/time/events", q);
    },

    ackEvents: (eventIds: string[]) =>
      post<{ acknowledged?: number }>("/api/time/events/ack", {
        eventIds,
      }),

    sleepConfirm: (date: string) =>
      post<TimeReceipt>("/api/time/sleep/confirm", {
        idempotencyKey: generateTimeIdempotencyKey("desk-sleep-ok"),
        date,
      }),

    sleepDismiss: (date: string) =>
      post<TimeReceipt>("/api/time/sleep/dismiss", {
        idempotencyKey: generateTimeIdempotencyKey("desk-sleep-skip"),
        date,
      }),

    undo: (targetOperationId: string) =>
      post<TimeReceipt>("/api/time/undo", {
        idempotencyKey: generateTimeIdempotencyKey("desk-undo"),
        targetOperationId,
      }),
  };
}

export type WorkspaceTimeClient = ReturnType<typeof createWorkspaceTimeClient>;
