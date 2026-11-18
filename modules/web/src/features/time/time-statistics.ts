import type {
  CostReportSummary,
  CostReportProjectRow,
  CostReportSegmentRef,
} from "@core/time/model";
import { DEFAULT_TIMEZONE } from "@core/time/model";
import { addLocalDays, dayBoundsMs } from "@core/time/zone";

export type StatisticRow = {
  key: string;
  label: string;
  seconds: number;
  cost: number;
  date?: string;
};
export type StatisticDimension = "day" | "project" | "tag";

function reportSegments(report: CostReportSummary): CostReportSegmentRef[] {
  const segments = [
    ...report.byProject.flatMap((row) => row.segments),
    ...report.byTask.flatMap((row) => row.segments),
    ...report.unassignedSegments,
  ];
  return [
    ...new Map(
      segments.map((segment) => [
        `${segment.activityId}:${segment.startMs}:${segment.endMs}`,
        segment,
      ]),
    ).values(),
  ];
}

export function nonProjectGroups(report: CostReportSummary) {
  const tagged: CostReportSegmentRef[] = [];
  const legacy: CostReportSegmentRef[] = [];
  for (const segment of reportSegments(report)) {
    if (segment.projectSnapshot?.trim() || segment.confirmedSeconds <= 0)
      continue;
    (segment.tags?.some((tag) => tag.trim()) ? tagged : legacy).push(segment);
  }
  return { tagged, legacy };
}

// Aggregate segment facts once; project rows also include time without linked tasks.
export function costStatisticRows(
  report: CostReportSummary,
  dimension: StatisticDimension,
  timeZone = DEFAULT_TIMEZONE,
): StatisticRow[] {
  if (dimension === "project")
    return report.byProject.map((row) => ({
      key: row.projectKey,
      label: row.projectName,
      seconds: row.periodSeconds,
      cost: row.periodCostCents,
    }));
  const rows = new Map<string, StatisticRow>();
  if (dimension === "day") {
    for (
      let date = report.periodStartDate;
      date <= report.periodEndDate;
      date = addLocalDays(date, 1)
    ) {
      rows.set(date, {
        key: date,
        label: date.slice(5),
        date,
        seconds: 0,
        cost: 0,
      });
    }
  }
  for (const segment of reportSegments(report)) {
    if (dimension === "day") {
      const startSecond = Math.floor(segment.startMs / 1000);
      let counted = 0;
      let cost = 0;
      for (
        let date = segment.date;
        counted < segment.confirmedSeconds;
        date = addLocalDays(date, 1)
      ) {
        const row = rows.get(date);
        if (!row) break;
        const { dayEndMs } = dayBoundsMs(date, timeZone);
        const cumulative = Math.min(
          segment.confirmedSeconds,
          Math.floor(dayEndMs / 1000) - startSecond,
        );
        const cumulativeCost = Math.round(
          (segment.confirmedCostCents * cumulative) / segment.confirmedSeconds,
        );
        row.seconds += cumulative - counted;
        row.cost += cumulativeCost - cost;
        counted = cumulative;
        cost = cumulativeCost;
      }
      continue;
    }
    const keys = new Set(
      segment.tags?.length ? segment.tags : ["__untagged__"],
    );
    for (const key of keys) {
      const row = rows.get(key) ?? {
        key,
        label: key === "__untagged__" ? "未设标签" : `#${key}`,
        seconds: 0,
        cost: 0,
      };
      row.seconds += segment.confirmedSeconds;
      row.cost += segment.confirmedCostCents;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

export function costTagGroups(
  report: CostReportSummary,
): CostReportProjectRow[] {
  const groups = new Map<string, CostReportProjectRow>();
  for (const segment of reportSegments(report)) {
    for (const tag of new Set(
      segment.tags?.length ? segment.tags : ["__untagged__"],
    )) {
      const row = groups.get(tag) ?? {
        projectKey: tag,
        projectName: tag === "__untagged__" ? "未设标签" : `#${tag}`,
        periodSeconds: 0,
        periodCostCents: 0,
        periodProvisionalCostCents: 0,
        overInitialBudgetCents: 0,
        cashExpenseCents: 0,
        combinedPeriodCostCents: 0,
        taskCount: 0,
        segments: [],
      };
      row.periodSeconds += segment.confirmedSeconds;
      row.periodCostCents += segment.confirmedCostCents;
      row.periodProvisionalCostCents += segment.provisionalCostCents ?? 0;
      row.combinedPeriodCostCents = row.periodCostCents;
      row.segments.push(segment);
      groups.set(tag, row);
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.periodCostCents - a.periodCostCents ||
      a.projectKey.localeCompare(b.projectKey),
  );
}
