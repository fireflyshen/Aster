import {
  computeDurationCostCents,
  normalizeActivityTags,
  normalizeHourlyRateCents,
  resolveEffectiveActivityEndMs,
  resolveEffectiveConfirmedEndMs,
  secondsDelta,
  UNASSIGNED_PROJECT_KEY,
  UNTAGGED_KEY,
} from "./cost.ts";
import type {
  Activity,
  DailyLedgerSummary,
  LocatedSegment,
  SleepCandidate,
  TimePolicy,
  TimelineGap,
  WeeklyDistributionSummary,
} from "./model.ts";
import {
  addLocalDays,
  dayBoundsMs,
  parseLocalTime,
  splitIntervalByDay,
  zonedDateTimeToUtcMs,
} from "./zone.ts";

export const DEFAULT_MIN_GAP_SECONDS = 30 * 60;

/**
 * Half-open interval `[aStart, aEnd)` vs `[bStart, bEnd)` overlap check.
 * Adjacent endpoints (`aEnd === bStart`) do not overlap.
 */
export function intervalsOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

export function effectiveActivityEndMs(
  activity: Activity,
  referenceNowMs: number,
): number | undefined {
  return resolveEffectiveActivityEndMs(activity, referenceNowMs);
}

export function effectiveConfirmedEndMs(
  activity: Activity,
  effectiveEndMs: number,
): number {
  return resolveEffectiveConfirmedEndMs(activity, effectiveEndMs);
}

export function sleepCandidateKey(
  date: string,
  templateVersion: number,
): string {
  return `sleep:${date}:v${templateVersion}`;
}

export function computeSleepCandidateRange(
  date: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): { startMs: number; endMs: number } {
  const start = parseLocalTime(startTime);
  const end = parseLocalTime(endTime);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  const startDate = startMinutes >= endMinutes ? addLocalDays(date, -1) : date;
  const startMs = zonedDateTimeToUtcMs(startDate, startTime, timeZone);
  const endMs = zonedDateTimeToUtcMs(date, endTime, timeZone);
  return { startMs, endMs };
}

export function buildSleepCandidateForDate(
  date: string,
  policy: TimePolicy,
  locatedActivities: readonly Activity[],
  decisions: ReadonlyMap<
    string,
    { status: "confirmed" | "dismissed"; activityId?: string }
  >,
  referenceNowMs: number,
): SleepCandidate | null {
  if (!policy.sleepTemplate.enabled) return null;
  const { startMs, endMs } = computeSleepCandidateRange(
    date,
    policy.sleepTemplate.startTime,
    policy.sleepTemplate.endTime,
    policy.timezone,
  );
  if (endMs <= startMs) return null;

  const key = sleepCandidateKey(date, policy.sleepTemplate.version);
  const existingDecision = decisions.get(key);
  const hasConflict = locatedActivities.some((activity) => {
    if (
      activity.reviewState === "voided" ||
      activity.reviewState === "conflict" ||
      activity.startMs === undefined
    ) {
      return false;
    }
    const activityEnd = effectiveActivityEndMs(activity, referenceNowMs);
    if (activityEnd === undefined || activityEnd <= activity.startMs) {
      return false;
    }
    return intervalsOverlap(startMs, endMs, activity.startMs, activityEnd);
  });

  return {
    key,
    date,
    templateVersion: policy.sleepTemplate.version,
    startMs,
    endMs,
    status: existingDecision?.status ?? "pending",
    ...(existingDecision?.activityId
      ? { activityId: existingDecision.activityId }
      : {}),
    hasConflict,
  };
}

function unlocatedAppliesToRange(
  activity: Activity,
  rangeStartMs: number,
  rangeEndMs: number,
  rangeDates: ReadonlySet<string>,
): boolean {
  if (
    activity.kind !== "unlocated_estimate" ||
    activity.reviewState === "voided"
  ) {
    return false;
  }
  if (
    activity.windowStartMs !== undefined &&
    activity.windowEndMs !== undefined
  ) {
    return intervalsOverlap(
      activity.windowStartMs,
      activity.windowEndMs,
      rangeStartMs,
      rangeEndMs,
    );
  }
  return Boolean(activity.targetDate && rangeDates.has(activity.targetDate));
}

export function computeDailyLedger(
  date: string,
  activities: readonly Activity[],
  policy: TimePolicy,
  nowMs: number,
  sleepDecisions: ReadonlyMap<
    string,
    { status: "confirmed" | "dismissed"; activityId?: string }
  > = new Map(),
  minGapSeconds = DEFAULT_MIN_GAP_SECONDS,
): DailyLedgerSummary {
  const { dayStartMs, dayEndMs } = dayBoundsMs(date, policy.timezone);
  const asOfMs = Math.min(nowMs, dayEndMs);
  const pastEndMs = Math.max(dayStartMs, asOfMs);
  const pastCapacitySeconds = secondsDelta(dayStartMs, pastEndMs);

  const policyRate = normalizeHourlyRateCents(policy.hourlyRateCents);
  const byCategorySeconds: Record<string, number> = Object.create(null);
  const byProjectSeconds: Record<string, number> = Object.create(null);
  const byProjectCostCents: Record<string, number> = Object.create(null);
  const byTagSeconds: Record<string, number> = Object.create(null);
  const byTagCostCents: Record<string, number> = Object.create(null);
  const locatedSegments: LocatedSegment[] = [];
  let coveredSeconds = 0;
  let provisionalSeconds = 0;
  let confirmedCostCents = 0;
  let provisionalCostCents = 0;
  let estimatedBoundsSeconds = 0;
  let reviewRequiredSeconds = 0;

  const activeLocated = activities.filter(
    (a) =>
      a.kind === "located" &&
      a.reviewState !== "voided" &&
      a.reviewState !== "conflict" &&
      a.startMs !== undefined,
  );

  for (const activity of activeLocated) {
    const rawEndMs = effectiveActivityEndMs(activity, nowMs);
    if (rawEndMs === undefined || rawEndMs <= activity.startMs!) continue;

    // Only count past/present slices up to pastEndMs.
    const clippedStartMs = Math.max(activity.startMs!, dayStartMs);
    const clippedEndMs = Math.min(rawEndMs, pastEndMs);
    if (clippedEndMs <= clippedStartMs) continue;

    const durationSeconds = secondsDelta(clippedStartMs, clippedEndMs);
    const confirmedEndMs = effectiveConfirmedEndMs(activity, rawEndMs);
    const clippedConfirmedEndMs = Math.max(
      clippedStartMs,
      Math.min(confirmedEndMs, clippedEndMs),
    );
    const confirmedSeconds = secondsDelta(
      clippedStartMs,
      clippedConfirmedEndMs,
    );
    const segmentProvisionalSeconds = Math.max(
      0,
      durationSeconds - confirmedSeconds,
    );
    const rateCents = normalizeHourlyRateCents(
      activity.hourlyRateCents,
      policyRate,
    );
    const segConfirmedCostCents = computeDurationCostCents(
      confirmedSeconds,
      rateCents,
    );
    const segProvisionalCostCents = computeDurationCostCents(
      segmentProvisionalSeconds,
      rateCents,
    );
    const tags = normalizeActivityTags(activity.tags);
    const projectKey =
      activity.projectSnapshot?.trim() || UNASSIGNED_PROJECT_KEY;

    coveredSeconds += confirmedSeconds;
    provisionalSeconds += segmentProvisionalSeconds;
    confirmedCostCents += segConfirmedCostCents;
    provisionalCostCents += segProvisionalCostCents;
    if (confirmedSeconds > 0) {
      byCategorySeconds[activity.categoryId] =
        (byCategorySeconds[activity.categoryId] || 0) + confirmedSeconds;
      byProjectSeconds[projectKey] =
        (byProjectSeconds[projectKey] || 0) + confirmedSeconds;
      byProjectCostCents[projectKey] =
        (byProjectCostCents[projectKey] || 0) + segConfirmedCostCents;
      if (tags.length > 0) {
        for (const tag of tags) {
          byTagSeconds[tag] = (byTagSeconds[tag] || 0) + confirmedSeconds;
          byTagCostCents[tag] =
            (byTagCostCents[tag] || 0) + segConfirmedCostCents;
        }
      } else {
        byTagSeconds[UNTAGGED_KEY] =
          (byTagSeconds[UNTAGGED_KEY] || 0) + confirmedSeconds;
        byTagCostCents[UNTAGGED_KEY] =
          (byTagCostCents[UNTAGGED_KEY] || 0) + segConfirmedCostCents;
      }
    }

    if (activity.precision === "estimated_bounds") {
      estimatedBoundsSeconds += confirmedSeconds;
    }
    const checkpointOverdue =
      activity.endMs === undefined &&
      activity.suspendMs === undefined &&
      activity.autoStopAtMs === undefined &&
      activity.reviewDueAtMs !== undefined &&
      nowMs >= activity.reviewDueAtMs &&
      segmentProvisionalSeconds > 0;
    if (activity.reviewState === "review_required" || checkpointOverdue) {
      reviewRequiredSeconds +=
        segmentProvisionalSeconds > 0
          ? segmentProvisionalSeconds
          : durationSeconds;
    }

    const exceededPlanSeconds =
      activity.autoStopAtMs !== undefined &&
      activity.endMs !== undefined &&
      rawEndMs > activity.autoStopAtMs
        ? secondsDelta(activity.autoStopAtMs, rawEndMs)
        : undefined;

    locatedSegments.push({
      activityId: activity.id,
      version: activity.version,
      title: activity.title,
      categoryId: activity.categoryId,
      ...(activity.taskUuid ? { taskUuid: activity.taskUuid } : {}),
      ...(activity.projectSnapshot
        ? { projectSnapshot: activity.projectSnapshot }
        : {}),
      ...(tags.length > 0 ? { tags } : {}),
      hourlyRateCents: rateCents,
      startMs: clippedStartMs,
      endMs: clippedEndMs,
      durationSeconds,
      confirmedSeconds,
      provisionalSeconds: segmentProvisionalSeconds,
      confirmedCostCents: segConfirmedCostCents,
      provisionalCostCents: segProvisionalCostCents,
      running:
        activity.endMs === undefined &&
        activity.suspendMs === undefined &&
        (activity.autoStopAtMs === undefined || nowMs < activity.autoStopAtMs),
      precision: activity.precision,
      source: activity.source,
      reviewState: activity.reviewState,
      ...(activity.suspendMs !== undefined
        ? { suspendMs: activity.suspendMs }
        : {}),
      ...(activity.confirmedThroughMs !== undefined
        ? { confirmedThroughMs: activity.confirmedThroughMs }
        : {}),
      ...(activity.reviewDueAtMs !== undefined
        ? { reviewDueAtMs: activity.reviewDueAtMs }
        : {}),
      ...(activity.reviewReason ? { reviewReason: activity.reviewReason } : {}),
      ...(activity.timingPlanId ? { timingPlanId: activity.timingPlanId } : {}),
      ...(activity.autoStopAtMs !== undefined
        ? { autoStopAtMs: activity.autoStopAtMs }
        : {}),
      ...(activity.timerStoppedAtMs !== undefined
        ? { timerStoppedAtMs: activity.timerStoppedAtMs }
        : {}),
      ...(activity.stopReason ? { stopReason: activity.stopReason } : {}),
      ...(exceededPlanSeconds !== undefined && exceededPlanSeconds > 0
        ? { exceededPlanSeconds }
        : {}),
    });
  }

  locatedSegments.sort((a, b) => a.startMs - b.startMs);

  // Merge/scan gaps inside [dayStartMs, pastEndMs)
  const gaps: TimelineGap[] = [];
  let cursorMs = dayStartMs;
  for (const seg of locatedSegments) {
    if (seg.startMs > cursorMs) {
      const durationSeconds = secondsDelta(cursorMs, seg.startMs);
      if (durationSeconds >= minGapSeconds) {
        gaps.push({
          startMs: cursorMs,
          endMs: seg.startMs,
          durationSeconds,
        });
      }
    }
    if (seg.endMs > cursorMs) cursorMs = seg.endMs;
  }
  if (pastEndMs > cursorMs) {
    const durationSeconds = secondsDelta(cursorMs, pastEndMs);
    if (durationSeconds >= minGapSeconds) {
      gaps.push({
        startMs: cursorMs,
        endMs: pastEndMs,
        durationSeconds,
      });
    }
  }

  const unrecordedSeconds = Math.max(0, pastCapacitySeconds - coveredSeconds);

  const dateSet = new Set([date]);
  const unlocatedEstimates = activities.filter((activity) =>
    unlocatedAppliesToRange(activity, dayStartMs, dayEndMs, dateSet),
  );

  const candidate =
    pastEndMs > dayStartMs
      ? buildSleepCandidateForDate(
          date,
          policy,
          activeLocated,
          sleepDecisions,
          nowMs,
        )
      : null;

  return {
    date,
    timezone: policy.timezone,
    dayStartMs,
    dayEndMs,
    asOfMs,
    pastCapacitySeconds,
    coveredSeconds,
    provisionalSeconds,
    confirmedCostCents,
    provisionalCostCents,
    unrecordedSeconds,
    estimatedBoundsSeconds,
    reviewRequiredSeconds,
    byCategorySeconds,
    byProjectSeconds,
    byProjectCostCents,
    byTagSeconds,
    byTagCostCents,
    locatedSegments,
    unlocatedEstimates,
    sleepCandidates: candidate ? [candidate] : [],
    gaps,
  };
}

export function computeWeeklyDistribution(
  weekStartDate: string,
  activities: readonly Activity[],
  policy: TimePolicy,
  nowMs: number,
  sleepDecisions: ReadonlyMap<
    string,
    { status: "confirmed" | "dismissed"; activityId?: string }
  > = new Map(),
): WeeklyDistributionSummary {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dates.push(addLocalDays(weekStartDate, i));
  }
  const weekEndDate = dates[6];
  const weekStartMs = dayBoundsMs(weekStartDate, policy.timezone).dayStartMs;
  const weekEndMs = dayBoundsMs(weekEndDate, policy.timezone).dayEndMs;
  const isPartialWeek = nowMs < weekEndMs;

  const daily = dates.map((d) =>
    computeDailyLedger(d, activities, policy, nowMs, sleepDecisions),
  );

  const byCategorySeconds: Record<string, number> = Object.create(null);
  const byProjectSeconds: Record<string, number> = Object.create(null);
  const byProjectCostCents: Record<string, number> = Object.create(null);
  const byTagSeconds: Record<string, number> = Object.create(null);
  const byTagCostCents: Record<string, number> = Object.create(null);
  let pastCapacitySeconds = 0;
  let coveredSeconds = 0;
  let provisionalSeconds = 0;
  let confirmedCostCents = 0;
  let provisionalCostCents = 0;
  let unrecordedSeconds = 0;
  let estimatedBoundsSeconds = 0;
  let reviewRequiredSeconds = 0;

  for (const day of daily) {
    pastCapacitySeconds += day.pastCapacitySeconds;
    coveredSeconds += day.coveredSeconds;
    provisionalSeconds += day.provisionalSeconds;
    confirmedCostCents += day.confirmedCostCents;
    provisionalCostCents += day.provisionalCostCents;
    unrecordedSeconds += day.unrecordedSeconds;
    estimatedBoundsSeconds += day.estimatedBoundsSeconds;
    reviewRequiredSeconds += day.reviewRequiredSeconds;
    for (const [cat, secs] of Object.entries(day.byCategorySeconds)) {
      byCategorySeconds[cat] = (byCategorySeconds[cat] || 0) + secs;
    }
    for (const [proj, secs] of Object.entries(day.byProjectSeconds)) {
      byProjectSeconds[proj] = (byProjectSeconds[proj] || 0) + secs;
    }
    for (const [proj, cost] of Object.entries(day.byProjectCostCents)) {
      byProjectCostCents[proj] = (byProjectCostCents[proj] || 0) + cost;
    }
    for (const [tag, secs] of Object.entries(day.byTagSeconds)) {
      byTagSeconds[tag] = (byTagSeconds[tag] || 0) + secs;
    }
    for (const [tag, cost] of Object.entries(day.byTagCostCents)) {
      byTagCostCents[tag] = (byTagCostCents[tag] || 0) + cost;
    }
  }

  // Deduplicate unlocated estimates across all 7 days by activity UUID.
  const dateSet = new Set(dates);
  const seenIds = new Set<string>();
  const unlocatedEstimates: Activity[] = [];
  for (const activity of activities) {
    if (seenIds.has(activity.id)) continue;
    if (unlocatedAppliesToRange(activity, weekStartMs, weekEndMs, dateSet)) {
      seenIds.add(activity.id);
      unlocatedEstimates.push(activity);
    }
  }

  return {
    weekStartDate,
    weekEndDate,
    timezone: policy.timezone,
    asOfMs: Math.min(nowMs, weekEndMs),
    isPartialWeek,
    pastCapacitySeconds,
    coveredSeconds,
    provisionalSeconds,
    confirmedCostCents,
    provisionalCostCents,
    unrecordedSeconds,
    estimatedBoundsSeconds,
    reviewRequiredSeconds,
    byCategorySeconds,
    byProjectSeconds,
    byProjectCostCents,
    byTagSeconds,
    byTagCostCents,
    unlocatedEstimates,
    daily,
  };
}

/**
 * Computes per-task cumulative seconds across located, non-voided, non-conflict
 * activities up to `asOfMs` (clipping active running activities to `suspendMs ?? asOfMs`).
 */
export function computeTaskTotalsSeconds(
  activities: readonly Activity[],
  taskUuids: readonly string[],
  asOfMs: number,
): Record<string, number> {
  const totals: Record<string, number> = Object.create(null);
  const requested = new Set(taskUuids.map((u) => u.toLowerCase()));
  for (const uuid of requested) {
    totals[uuid] = 0;
  }

  for (const activity of activities) {
    if (
      activity.kind !== "located" ||
      activity.reviewState === "voided" ||
      activity.reviewState === "conflict" ||
      !activity.taskUuid ||
      activity.startMs === undefined
    ) {
      continue;
    }
    const key = activity.taskUuid.toLowerCase();
    if (requested.size > 0 && !requested.has(key)) continue;

    const rawEnd = effectiveActivityEndMs(activity, asOfMs);
    if (rawEnd === undefined || rawEnd <= activity.startMs) continue;
    const endMs = Math.min(rawEnd, asOfMs);
    if (endMs <= activity.startMs) continue;

    totals[key] = (totals[key] || 0) + secondsDelta(activity.startMs, endMs);
  }
  return totals;
}

export { splitIntervalByDay };
