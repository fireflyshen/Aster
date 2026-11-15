import {
  DEFAULT_HOURLY_RATE_CENTS,
  UNASSIGNED_PROJECT_KEY,
  UNTAGGED_KEY,
  type Activity,
  type BillLink,
  type CostReportGranularity,
  type CostReportProjectRow,
  type CostReportSegmentRef,
  type CostReportSortBy,
  type CostReportSummary,
  type CostReportTaskRow,
  type TaskBudget,
  type TaskCostSummary,
  type TimePolicy,
  type TimingPlan,
} from "./model.ts";
import {
  addLocalDays,
  dayBoundsMs,
  formatCalendarDate,
  localDateOf,
  mondayOfWeek,
  parseLocalDate,
} from "./zone.ts";

export function normalizeHourlyRateCents(
  value: number | undefined | null,
  fallback = DEFAULT_HOURLY_RATE_CENTS,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.round(value);
}

/** Sleep has duration, but never incurs time cost, even with legacy rate data. */
export function resolveActivityHourlyRateCents(
  activity: Pick<Activity, "categoryId" | "hourlyRateCents">,
  policy: TimePolicy,
): number {
  if (
    activity.categoryId === "sleep" ||
    policy.categories.some(
      (category) => category.id === activity.categoryId && category.isSleep,
    )
  )
    return 0;
  return normalizeHourlyRateCents(
    activity.hourlyRateCents,
    normalizeHourlyRateCents(policy.hourlyRateCents),
  );
}

export function yuanToHourlyRateCents(yuan: number): number {
  if (typeof yuan !== "number" || !Number.isFinite(yuan) || yuan < 0) {
    return 0;
  }
  return Math.round(yuan * 100);
}

export function normalizeActivityTags(tags?: readonly string[]): string[] {
  if (!tags || tags.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function secondsDelta(startMs: number, endMs: number): number {
  const s = Math.floor(startMs / 1000);
  const e = Math.floor(endMs / 1000);
  return Math.max(0, e - s);
}

export function resolveEffectiveActivityEndMs(
  activity: Activity,
  referenceNowMs: number,
): number | undefined {
  if (activity.kind !== "located" || activity.startMs === undefined) {
    return undefined;
  }
  if (activity.endMs !== undefined) {
    return activity.endMs;
  }
  let upper = referenceNowMs;
  if (activity.suspendMs !== undefined) {
    upper = Math.min(upper, activity.suspendMs);
  }
  if (activity.autoStopAtMs !== undefined) {
    upper = Math.min(upper, activity.autoStopAtMs);
  }
  return upper;
}

export function resolveEffectiveConfirmedEndMs(
  activity: Activity,
  effectiveEndMs: number,
): number {
  if (activity.startMs === undefined || effectiveEndMs <= activity.startMs) {
    return activity.startMs ?? 0;
  }
  if (activity.confirmedThroughMs !== undefined) {
    return Math.max(
      activity.startMs,
      Math.min(effectiveEndMs, activity.confirmedThroughMs),
    );
  }
  return activity.reviewState === "ok" ? effectiveEndMs : activity.startMs;
}

export function computeDurationCostCents(
  durationSeconds: number,
  hourlyRateCents: number,
): number {
  if (
    !Number.isFinite(durationSeconds) ||
    !Number.isFinite(hourlyRateCents) ||
    durationSeconds <= 0 ||
    hourlyRateCents <= 0
  ) {
    return 0;
  }
  return Math.max(0, Math.round((durationSeconds * hourlyRateCents) / 3600));
}

export function formatCurrencyCny(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  if (abs % 100 === 0) {
    return `${sign}¥${abs / 100}`;
  }
  if (abs % 10 === 0) {
    return `${sign}¥${(abs / 100).toFixed(1)}`;
  }
  return `${sign}¥${(abs / 100).toFixed(2)}`;
}

export function formatRateConversionHint(hourlyRateCents: number): string {
  const rate = normalizeHourlyRateCents(hourlyRateCents);
  const thirtyMin = formatCurrencyCny(computeDurationCostCents(1800, rate));
  const twoHours = formatCurrencyCny(computeDurationCostCents(7200, rate));
  return `30 分钟 ≈ ${thirtyMin}，2 小时 ≈ ${twoHours}`;
}

export function computeMaxSecondsBeforeHardStop(
  nowMs: number,
  hardStopAtMs?: number,
): number | undefined {
  if (hardStopAtMs === undefined || !Number.isFinite(hardStopAtMs)) {
    return undefined;
  }
  return Math.max(0, Math.floor((hardStopAtMs - nowMs) / 1000));
}

export type ContinuationCostPreview = {
  requestedSeconds: number;
  hardStopRemainingSeconds?: number;
  effectiveSeconds: number;
  additionalCostCents: number;
  cappedByHardStop: boolean;
  expired: boolean;
};

export function computeContinuationCostPreview(options: {
  requestedSeconds: number;
  hourlyRateCents: number;
  hardStopAtMs?: number;
  nowMs: number;
}): ContinuationCostPreview {
  const requestedSeconds = Math.max(0, Math.round(options.requestedSeconds));
  const rate = normalizeHourlyRateCents(options.hourlyRateCents);
  const hardStopRemainingSeconds = computeMaxSecondsBeforeHardStop(
    options.nowMs,
    options.hardStopAtMs,
  );
  const expired =
    hardStopRemainingSeconds !== undefined && hardStopRemainingSeconds <= 0;
  const effectiveSeconds =
    hardStopRemainingSeconds !== undefined
      ? Math.min(requestedSeconds, hardStopRemainingSeconds)
      : requestedSeconds;
  const cappedByHardStop =
    hardStopRemainingSeconds !== undefined &&
    requestedSeconds > hardStopRemainingSeconds;
  return {
    requestedSeconds,
    ...(hardStopRemainingSeconds !== undefined
      ? { hardStopRemainingSeconds }
      : {}),
    effectiveSeconds,
    additionalCostCents: computeDurationCostCents(effectiveSeconds, rate),
    cappedByHardStop,
    expired,
  };
}

export function deriveBudgetFromPlans(
  taskUuid: string,
  plans: readonly TimingPlan[],
  fallbackRateCents: number,
): TaskBudget | undefined {
  const key = taskUuid.toLowerCase();
  const matching = plans
    .filter(
      (p) =>
        p.taskUuid?.toLowerCase() === key && p.allowanceSeconds !== undefined,
    )
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  if (matching.length === 0) return undefined;
  const first = matching[0];
  const latest = matching[matching.length - 1];
  const initialRate = normalizeHourlyRateCents(
    first.hourlyRateCents,
    fallbackRateCents,
  );
  const initialAllowance =
    first.initialAllowanceSeconds ?? first.allowanceSeconds;
  const initialBudgetCents =
    first.initialBudgetCents ??
    (initialAllowance !== undefined
      ? computeDurationCostCents(initialAllowance, initialRate)
      : undefined);
  const latestRate = normalizeHourlyRateCents(
    latest.hourlyRateCents,
    initialRate,
  );
  const currentAllowance = latest.allowanceSeconds;
  const currentBudgetCents =
    latest.currentBudgetCents ??
    (currentAllowance !== undefined
      ? computeDurationCostCents(currentAllowance, latestRate)
      : undefined);
  return {
    taskUuid: key,
    hourlyRateCents: latestRate,
    ...(initialAllowance !== undefined
      ? { initialAllowanceSeconds: initialAllowance }
      : {}),
    ...(initialBudgetCents !== undefined ? { initialBudgetCents } : {}),
    ...(currentAllowance !== undefined
      ? { currentAllowanceSeconds: currentAllowance }
      : {}),
    ...(currentBudgetCents !== undefined ? { currentBudgetCents } : {}),
    ...(latest.plannedStartAtMs !== undefined
      ? { plannedStartAtMs: latest.plannedStartAtMs }
      : {}),
    ...(latest.hardStopAtMs !== undefined
      ? { hardStopAtMs: latest.hardStopAtMs }
      : {}),
    createdAtMs: first.createdAtMs,
    updatedAtMs: latest.updatedAtMs,
  };
}

export function computeTaskCostSummary(options: {
  taskUuid: string;
  activities: readonly Activity[];
  budget?: TaskBudget;
  plans?: readonly TimingPlan[];
  billLinks?: readonly BillLink[];
  policy: TimePolicy;
  asOfMs: number;
}): TaskCostSummary {
  const key = options.taskUuid.toLowerCase();
  const policyRate = normalizeHourlyRateCents(options.policy.hourlyRateCents);
  let confirmedSeconds = 0;
  let confirmedCostCents = 0;
  let provisionalSeconds = 0;
  let provisionalCostCents = 0;
  const matchedActivityIds = new Set<string>();

  for (const activity of options.activities) {
    if (
      activity.kind !== "located" ||
      activity.reviewState === "voided" ||
      activity.reviewState === "conflict" ||
      activity.taskUuid?.toLowerCase() !== key ||
      activity.startMs === undefined
    ) {
      continue;
    }
    matchedActivityIds.add(activity.id);
    const rawEnd = resolveEffectiveActivityEndMs(activity, options.asOfMs);
    if (rawEnd === undefined || rawEnd <= activity.startMs) continue;
    const endMs = Math.min(rawEnd, options.asOfMs);
    if (endMs <= activity.startMs) continue;

    const totalSec = secondsDelta(activity.startMs, endMs);
    const confirmedEndMs = resolveEffectiveConfirmedEndMs(activity, endMs);
    const confSec = secondsDelta(activity.startMs, confirmedEndMs);
    const provSec = Math.max(0, totalSec - confSec);
    const rate = resolveActivityHourlyRateCents(activity, options.policy);

    confirmedSeconds += confSec;
    confirmedCostCents += computeDurationCostCents(confSec, rate);
    provisionalSeconds += provSec;
    provisionalCostCents += computeDurationCostCents(provSec, rate);
  }

  const effectiveBudget =
    options.budget ??
    (options.plans
      ? deriveBudgetFromPlans(key, options.plans, policyRate)
      : undefined);

  const initialAllowanceSeconds = effectiveBudget?.initialAllowanceSeconds;
  const currentAllowanceSeconds = effectiveBudget?.currentAllowanceSeconds;
  const initialBudgetCents =
    effectiveBudget?.initialBudgetCents ??
    (initialAllowanceSeconds !== undefined
      ? computeDurationCostCents(
          initialAllowanceSeconds,
          effectiveBudget?.hourlyRateCents ?? policyRate,
        )
      : undefined);
  const currentBudgetCents =
    effectiveBudget?.currentBudgetCents ??
    (currentAllowanceSeconds !== undefined
      ? computeDurationCostCents(
          currentAllowanceSeconds,
          effectiveBudget?.hourlyRateCents ?? policyRate,
        )
      : undefined);

  const hasBudget =
    initialBudgetCents !== undefined || currentBudgetCents !== undefined;
  const addedBudgetCents =
    hasBudget &&
    initialBudgetCents !== undefined &&
    currentBudgetCents !== undefined
      ? Math.max(0, currentBudgetCents - initialBudgetCents)
      : 0;
  // Unbudgeted tasks are NEVER counted as over-budget; provisional cost NEVER enters formal confirmed totals.
  const overInitialBudgetCents =
    hasBudget && initialBudgetCents !== undefined
      ? Math.max(0, confirmedCostCents - initialBudgetCents)
      : 0;
  const overCurrentBudgetCents =
    hasBudget && currentBudgetCents !== undefined
      ? Math.max(0, confirmedCostCents - currentBudgetCents)
      : 0;

  let linkedCashCents = 0;
  if (options.billLinks && options.billLinks.length > 0) {
    const seenLinkIds = new Set<string>();
    for (const link of options.billLinks) {
      if (seenLinkIds.has(link.id)) continue;
      const matchesTask = link.taskUuid?.toLowerCase() === key;
      const matchesActivity =
        link.activityId !== undefined &&
        matchedActivityIds.has(link.activityId);
      if (!matchesTask && !matchesActivity) continue;
      seenLinkIds.add(link.id);
      linkedCashCents += Math.max(0, link.cnyAmountCents);
    }
  }

  return {
    taskUuid: key,
    confirmedSeconds,
    confirmedCostCents,
    provisionalSeconds,
    provisionalCostCents,
    hasBudget,
    ...(initialAllowanceSeconds !== undefined
      ? { initialAllowanceSeconds }
      : {}),
    ...(initialBudgetCents !== undefined ? { initialBudgetCents } : {}),
    ...(currentAllowanceSeconds !== undefined
      ? { currentAllowanceSeconds }
      : {}),
    ...(currentBudgetCents !== undefined ? { currentBudgetCents } : {}),
    addedBudgetCents,
    overInitialBudgetCents,
    overCurrentBudgetCents,
    ...(effectiveBudget?.plannedStartAtMs !== undefined
      ? { plannedStartAtMs: effectiveBudget.plannedStartAtMs }
      : {}),
    ...(effectiveBudget?.hardStopAtMs !== undefined
      ? { hardStopAtMs: effectiveBudget.hardStopAtMs }
      : {}),
    linkedCashCents,
    combinedCostCents: confirmedCostCents + linkedCashCents,
    currentHourlyRateCents: policyRate,
  };
}

export function computePeriodBounds(
  granularity: CostReportGranularity,
  anchorDate: string,
  timeZone: string,
): {
  periodStartDate: string;
  periodEndDate: string;
  rangeStartMs: number;
  rangeEndMs: number;
} {
  if (granularity === "week") {
    const periodStartDate = mondayOfWeek(anchorDate);
    const periodEndDate = addLocalDays(periodStartDate, 6);
    return {
      periodStartDate,
      periodEndDate,
      rangeStartMs: dayBoundsMs(periodStartDate, timeZone).dayStartMs,
      rangeEndMs: dayBoundsMs(periodEndDate, timeZone).dayEndMs,
    };
  }
  const { year, month } = parseLocalDate(anchorDate);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodStartDate = formatCalendarDate(year, month, 1);
  const periodEndDate = formatCalendarDate(year, month, lastDay);
  return {
    periodStartDate,
    periodEndDate,
    rangeStartMs: dayBoundsMs(periodStartDate, timeZone).dayStartMs,
    rangeEndMs: dayBoundsMs(periodEndDate, timeZone).dayEndMs,
  };
}

export type CostReportTaskMeta = {
  title: string;
  project?: string;
  tags?: string[];
};

export function computeCostReport(options: {
  granularity: CostReportGranularity;
  anchorDate: string;
  sortBy: CostReportSortBy;
  activities: readonly Activity[];
  budgetsByTaskUuid: ReadonlyMap<string, TaskBudget>;
  plans?: readonly TimingPlan[];
  taskMetaByUuid?: ReadonlyMap<string, CostReportTaskMeta>;
  billLinks?: readonly BillLink[];
  policy: TimePolicy;
  nowMs: number;
}): CostReportSummary {
  const tz = options.policy.timezone;
  const policyRate = normalizeHourlyRateCents(options.policy.hourlyRateCents);
  const { periodStartDate, periodEndDate, rangeStartMs, rangeEndMs } =
    computePeriodBounds(options.granularity, options.anchorDate, tz);
  const effectiveUpperMs = Math.min(options.nowMs, rangeEndMs);

  let totalPeriodConfirmedSeconds = 0;
  let totalPeriodConfirmedCostCents = 0;
  let totalPeriodProvisionalSeconds = 0;
  let totalPeriodProvisionalCostCents = 0;

  type PeriodTaskAccum = {
    taskUuid: string;
    title: string;
    projectSnapshot?: string;
    tags: Set<string>;
    periodSeconds: number;
    periodCostCents: number;
    periodProvisionalCostCents: number;
    segments: CostReportSegmentRef[];
  };
  const taskAccums = new Map<string, PeriodTaskAccum>();
  const unassignedSegments: CostReportSegmentRef[] = [];
  const periodActivityMap = new Map<string, CostReportSegmentRef>();

  type ProjectAccum = {
    projectKey: string;
    projectName: string;
    periodSeconds: number;
    periodCostCents: number;
    periodProvisionalCostCents: number;
    taskUuids: Set<string>;
    segments: CostReportSegmentRef[];
    billLinkIds: Set<string>;
    cashExpenseCents: number;
  };
  const projectAccums = new Map<string, ProjectAccum>();
  const ensureProject = (projectSnapshot?: string): ProjectAccum => {
    const trimmed = projectSnapshot?.trim();
    const projectKey = trimmed || UNASSIGNED_PROJECT_KEY;
    const existing = projectAccums.get(projectKey);
    if (existing) return existing;
    const created: ProjectAccum = {
      projectKey,
      projectName: trimmed || "未指定项目",
      periodSeconds: 0,
      periodCostCents: 0,
      periodProvisionalCostCents: 0,
      taskUuids: new Set(),
      segments: [],
      billLinkIds: new Set(),
      cashExpenseCents: 0,
    };
    projectAccums.set(projectKey, created);
    return created;
  };

  for (const activity of options.activities) {
    if (
      activity.kind !== "located" ||
      activity.reviewState === "voided" ||
      activity.reviewState === "conflict" ||
      activity.startMs === undefined
    ) {
      continue;
    }
    const rawEnd = resolveEffectiveActivityEndMs(activity, options.nowMs);
    if (rawEnd === undefined || rawEnd <= activity.startMs) continue;
    const clippedStartMs = Math.max(activity.startMs, rangeStartMs);
    const clippedEndMs = Math.min(rawEnd, effectiveUpperMs);
    if (clippedEndMs <= clippedStartMs) continue;

    const totalSec = secondsDelta(clippedStartMs, clippedEndMs);
    if (totalSec <= 0) continue;

    const confirmedEndMs = resolveEffectiveConfirmedEndMs(activity, rawEnd);
    const clippedConfirmedEndMs = Math.max(
      clippedStartMs,
      Math.min(confirmedEndMs, clippedEndMs),
    );
    const confirmedSeconds = secondsDelta(
      clippedStartMs,
      clippedConfirmedEndMs,
    );
    const provisionalSeconds = Math.max(0, totalSec - confirmedSeconds);
    const rate = resolveActivityHourlyRateCents(activity, options.policy);
    const confirmedCostCents = computeDurationCostCents(confirmedSeconds, rate);
    const provisionalCostCents = computeDurationCostCents(
      provisionalSeconds,
      rate,
    );

    totalPeriodConfirmedSeconds += confirmedSeconds;
    totalPeriodConfirmedCostCents += confirmedCostCents;
    totalPeriodProvisionalSeconds += provisionalSeconds;
    totalPeriodProvisionalCostCents += provisionalCostCents;

    const tags = normalizeActivityTags(activity.tags);
    const segRef: CostReportSegmentRef = {
      activityId: activity.id,
      title: activity.title,
      date: localDateOf(clippedStartMs, tz),
      startMs: clippedStartMs,
      endMs: clippedEndMs,
      confirmedSeconds,
      confirmedCostCents,
      provisionalSeconds,
      provisionalCostCents,
      hourlyRateCents: rate,
      ...(activity.projectSnapshot
        ? { projectSnapshot: activity.projectSnapshot }
        : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(activity.taskUuid ? { taskUuid: activity.taskUuid } : {}),
      reviewState: activity.reviewState,
    };
    periodActivityMap.set(activity.id, segRef);

    const taskKey = activity.taskUuid?.toLowerCase();
    const taskMeta = taskKey ? options.taskMetaByUuid?.get(taskKey) : undefined;
    const projectName =
      activity.projectSnapshot?.trim() || taskMeta?.project?.trim();
    const projectRow = ensureProject(projectName);
    projectRow.periodSeconds += confirmedSeconds;
    projectRow.periodCostCents += confirmedCostCents;
    projectRow.periodProvisionalCostCents += provisionalCostCents;
    projectRow.segments.push(segRef);

    if (taskKey) {
      projectRow.taskUuids.add(taskKey);
      let taskRow = taskAccums.get(taskKey);
      if (!taskRow) {
        taskRow = {
          taskUuid: taskKey,
          title: taskMeta?.title || activity.title,
          ...(projectName ? { projectSnapshot: projectName } : {}),
          tags: new Set(taskMeta?.tags ?? []),
          periodSeconds: 0,
          periodCostCents: 0,
          periodProvisionalCostCents: 0,
          segments: [],
        };
        taskAccums.set(taskKey, taskRow);
      }
      for (const t of tags) taskRow.tags.add(t);
      taskRow.periodSeconds += confirmedSeconds;
      taskRow.periodCostCents += confirmedCostCents;
      taskRow.periodProvisionalCostCents += provisionalCostCents;
      taskRow.segments.push(segRef);
    } else {
      unassignedSegments.push(segRef);
    }
  }

  // Group linked Bills relevant to this period (pay date in range or tied to a period activity).
  const periodBillLinks: BillLink[] = [];
  const taskBillLinks = new Map<string, BillLink[]>();
  const unassignedBillLinks: BillLink[] = [];
  const seenPeriodBillIds = new Set<string>();
  const allBillLinks = options.billLinks ?? [];

  for (const link of allBillLinks) {
    if (link.taskUuid) {
      const key = link.taskUuid.toLowerCase();
      const arr = taskBillLinks.get(key) ?? [];
      arr.push(link);
      taskBillLinks.set(key, arr);
    }
    const payDate = link.payTime.slice(0, 10);
    const inPeriodByDate =
      payDate >= periodStartDate && payDate <= periodEndDate;
    const inPeriodByActivity =
      link.activityId !== undefined && periodActivityMap.has(link.activityId);
    if (
      (inPeriodByDate || inPeriodByActivity) &&
      !seenPeriodBillIds.has(link.id)
    ) {
      seenPeriodBillIds.add(link.id);
      periodBillLinks.push(link);
      if (link.taskUuid) {
        const key = link.taskUuid.toLowerCase();
        if (!taskAccums.has(key) && inPeriodByDate) {
          const meta = options.taskMetaByUuid?.get(key);
          taskAccums.set(key, {
            taskUuid: key,
            title: meta?.title || link.narration || "关联任务",
            ...(meta?.project ? { projectSnapshot: meta.project } : {}),
            tags: new Set(meta?.tags ?? []),
            periodSeconds: 0,
            periodCostCents: 0,
            periodProvisionalCostCents: 0,
            segments: [],
          });
        }
        const meta = options.taskMetaByUuid?.get(key);
        const proj = ensureProject(meta?.project);
        if (!proj.billLinkIds.has(link.id)) {
          proj.billLinkIds.add(link.id);
          proj.cashExpenseCents += Math.max(0, link.cnyAmountCents);
        }
      } else if (link.activityId && periodActivityMap.has(link.activityId)) {
        const seg = periodActivityMap.get(link.activityId)!;
        const proj = ensureProject(seg.projectSnapshot);
        if (!proj.billLinkIds.has(link.id)) {
          proj.billLinkIds.add(link.id);
          proj.cashExpenseCents += Math.max(0, link.cnyAmountCents);
        }
        unassignedBillLinks.push(link);
      } else {
        unassignedBillLinks.push(link);
      }
    }
  }

  const byTask: CostReportTaskRow[] = [];
  for (const accum of taskAccums.values()) {
    const budget = options.budgetsByTaskUuid.get(accum.taskUuid);
    const summary = computeTaskCostSummary({
      taskUuid: accum.taskUuid,
      activities: options.activities,
      budget,
      plans: options.plans,
      billLinks: allBillLinks,
      policy: options.policy,
      asOfMs: options.nowMs,
    });
    const linksForTask = taskBillLinks.get(accum.taskUuid) ?? [];
    accum.segments.sort((a, b) => b.startMs - a.startMs);
    byTask.push({
      taskUuid: accum.taskUuid,
      title: accum.title,
      ...(accum.projectSnapshot
        ? { projectSnapshot: accum.projectSnapshot }
        : {}),
      tags: [...accum.tags],
      periodSeconds: accum.periodSeconds,
      periodCostCents: accum.periodCostCents,
      periodProvisionalCostCents: accum.periodProvisionalCostCents,
      cumulativeSeconds: summary.confirmedSeconds,
      cumulativeCostCents: summary.confirmedCostCents,
      cumulativeProvisionalCostCents: summary.provisionalCostCents,
      hasBudget: summary.hasBudget,
      ...(summary.initialBudgetCents !== undefined
        ? { initialBudgetCents: summary.initialBudgetCents }
        : {}),
      ...(summary.currentBudgetCents !== undefined
        ? { currentBudgetCents: summary.currentBudgetCents }
        : {}),
      overInitialBudgetCents: summary.overInitialBudgetCents,
      cashExpenseCents: summary.linkedCashCents,
      combinedCumulativeCostCents: summary.combinedCostCents,
      segments: accum.segments,
      billLinks: linksForTask,
    });
  }

  const taskOverMap = new Map<string, number>();
  for (const row of byTask) {
    taskOverMap.set(row.taskUuid, row.overInitialBudgetCents);
  }

  if (options.sortBy === "highest_over_budget") {
    byTask.sort(
      (a, b) =>
        b.overInitialBudgetCents - a.overInitialBudgetCents ||
        b.periodCostCents - a.periodCostCents ||
        b.cumulativeCostCents - a.cumulativeCostCents ||
        a.title.localeCompare(b.title),
    );
  } else {
    byTask.sort(
      (a, b) =>
        b.periodCostCents - a.periodCostCents ||
        b.combinedCumulativeCostCents - a.combinedCumulativeCostCents ||
        b.periodSeconds - a.periodSeconds ||
        a.title.localeCompare(b.title),
    );
  }

  const byProject: CostReportProjectRow[] = [];
  for (const proj of projectAccums.values()) {
    let overInitialBudgetCents = 0;
    for (const uuid of proj.taskUuids) {
      overInitialBudgetCents += taskOverMap.get(uuid) ?? 0;
    }
    proj.segments.sort((a, b) => b.startMs - a.startMs);
    byProject.push({
      projectKey: proj.projectKey,
      projectName: proj.projectName,
      periodSeconds: proj.periodSeconds,
      periodCostCents: proj.periodCostCents,
      periodProvisionalCostCents: proj.periodProvisionalCostCents,
      overInitialBudgetCents,
      cashExpenseCents: proj.cashExpenseCents,
      combinedPeriodCostCents: proj.periodCostCents + proj.cashExpenseCents,
      taskCount: proj.taskUuids.size,
      segments: proj.segments,
    });
  }

  if (options.sortBy === "highest_over_budget") {
    byProject.sort(
      (a, b) =>
        b.overInitialBudgetCents - a.overInitialBudgetCents ||
        b.periodCostCents - a.periodCostCents ||
        a.projectName.localeCompare(b.projectName),
    );
  } else {
    byProject.sort(
      (a, b) =>
        b.periodCostCents - a.periodCostCents ||
        b.combinedPeriodCostCents - a.combinedPeriodCostCents ||
        b.periodSeconds - a.periodSeconds ||
        a.projectName.localeCompare(b.projectName),
    );
  }

  unassignedSegments.sort((a, b) => b.startMs - a.startMs);
  const totalCashExpenseCents = periodBillLinks.reduce(
    (sum, link) => sum + Math.max(0, link.cnyAmountCents),
    0,
  );

  return {
    granularity: options.granularity,
    periodStartDate,
    periodEndDate,
    timezone: tz,
    sortBy: options.sortBy,
    hourlyRateCents: policyRate,
    totalPeriodConfirmedSeconds,
    totalPeriodConfirmedCostCents,
    totalPeriodProvisionalSeconds,
    totalPeriodProvisionalCostCents,
    totalCashExpenseCents,
    totalCombinedCostCents:
      totalPeriodConfirmedCostCents + totalCashExpenseCents,
    byProject,
    byTask,
    unassignedSegments,
    unassignedBillLinks,
  };
}

export { UNASSIGNED_PROJECT_KEY, UNTAGGED_KEY };
