import type { HeatmapCell } from "../../../../core/habits/model.ts";

/** Today uses confirmed completions too; unrecorded negative habits stay pending. */
export function habitHeatmapLevel(cell: HeatmapCell): number | null {
  if (cell.status === "future" || cell.status === "unscheduled") return null;
  if (cell.achievedCount === 0) return 0;
  if (cell.ratio >= 1) return 4;
  if (cell.ratio > 0.67) return 3;
  if (cell.ratio > 0.34) return 2;
  return 1;
}
