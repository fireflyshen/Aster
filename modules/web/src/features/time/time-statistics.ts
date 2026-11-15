import type { CostReportSummary } from "@core/time/model";
import { addLocalDays } from "@core/time/zone";

export type StatisticRow = {
  key: string;
  label: string;
  seconds: number;
  cost: number;
  date?: string;
};
export type StatisticDimension = "day" | "project" | "tag" | "task";

// Aggregate segment facts once; project rows also include time without linked tasks.
export function costStatisticRows(
  report: CostReportSummary,
  dimension: StatisticDimension,
): StatisticRow[] {
  if (dimension === "project")
    return report.byProject.map((row) => ({
      key: row.projectKey,
      label: row.projectName,
      seconds: row.periodSeconds,
      cost: row.periodCostCents,
    }));
  if (dimension === "task")
    return report.byTask.map((row) => ({
      key: row.taskUuid,
      label: row.title,
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
  const seen = new Set<string>();
  for (const segment of [
    ...report.byProject.flatMap((row) => row.segments),
    ...report.byTask.flatMap((row) => row.segments),
    ...report.unassignedSegments,
  ]) {
    const identity = `${segment.activityId}:${segment.startMs}:${segment.endMs}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const keys =
      dimension === "day"
        ? [segment.date]
        : [...new Set(segment.tags?.length ? segment.tags : ["__untagged__"])];
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
