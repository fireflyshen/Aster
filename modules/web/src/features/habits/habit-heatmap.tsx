import { isoWeekday } from "@core/habits/logic";
import type { HeatmapCell, HeatmapResponse } from "@core/habits/model";
import { cn } from "cn";
import { useMemo, useState } from "react";

const WEEKDAY_LABELS = ["一", "", "三", "", "五", "", "日"] as const;
const WEEKDAY_FULL = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
] as const;

function cellDescription(cell: HeatmapCell): string {
  const wd = WEEKDAY_FULL[isoWeekday(cell.date) - 1];
  if (cell.status === "future") return `${cell.date} ${wd} · 未来日期`;
  if (cell.status === "unscheduled") return `${cell.date} ${wd} · 当日无安排习惯`;
  if (cell.status === "in_progress") {
    const parts: string[] = [];
    if ((cell.inProgressPositiveTotal ?? 0) > 0) {
      parts.push(
        `打卡 ${cell.inProgressPositiveDone ?? 0}/${cell.inProgressPositiveTotal}`,
      );
    }
    if ((cell.inProgressNegativeTotal ?? 0) > 0) {
      parts.push(
        `未破例 ${cell.inProgressNegativeClean ?? 0}/${cell.inProgressNegativeTotal}`,
      );
    }
    return `${cell.date} ${wd} · 今日进行中${parts.length ? `（${parts.join(" · ")}）` : ""}`;
  }
  if (cell.status === "zero") {
    return `${cell.date} ${wd} · 安排 ${cell.scheduledCount} 项，达成 0 项`;
  }
  const pct = Math.round(cell.ratio * 100);
  return `${cell.date} ${wd} · 完成 ${cell.achievedCount} / ${cell.scheduledCount} 项 (${pct}%)`;
}

function cellStyle(cell: HeatmapCell): {
  className: string;
  style?: React.CSSProperties;
} {
  switch (cell.status) {
    case "future":
      return {
        className:
          "border border-dashed border-(--habit-unscheduled-border)/45 bg-transparent opacity-35 cursor-default",
      };
    case "unscheduled":
      return {
        className:
          "border border-(--habit-unscheduled-border) bg-transparent hover:border-foreground/35",
      };
    case "in_progress":
      return {
        className:
          "border-[1.5px] border-dashed border-(--habit-in-progress-ring) bg-(--habit-in-progress-bg) hover:brightness-95 dark:hover:brightness-110",
      };
    case "zero":
      return {
        className: "bg-(--habit-zero) hover:brightness-95 dark:hover:brightness-115",
      };
    case "level1":
      return {
        className: "bg-(--habit-level-1) hover:brightness-95 dark:hover:brightness-115",
      };
    case "level2":
      return {
        className: "bg-(--habit-level-2) hover:brightness-95 dark:hover:brightness-115",
      };
    case "level3":
      return {
        className: "bg-(--habit-level-3) hover:brightness-95 dark:hover:brightness-115",
      };
    case "level4":
      return {
        className: "bg-(--habit-level-4) hover:brightness-95 dark:hover:brightness-115",
      };
  }
}

/** Low-saturation ash-green habit completion heatmap grouped by ISO weeks (Mon..Sun). */
export function HabitHeatmap({
  heatmap,
  selectedDate,
  onSelectDate,
  compact = false,
}: {
  heatmap: HeatmapResponse;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  compact?: boolean;
}) {
  const [hoveredCell, setHoveredCell] = useState<HeatmapCell | null>(null);

  const { weeks, monthLabels } = useMemo(() => {
    const cells = heatmap.cells;
    if (cells.length === 0) return { weeks: [], monthLabels: [] };

    const firstWeekday = isoWeekday(cells[0].date); // 1..7
    const padded: Array<HeatmapCell | null> = [
      ...Array.from({ length: firstWeekday - 1 }, () => null),
      ...cells,
    ];
    while (padded.length % 7 !== 0) {
      padded.push(null);
    }

    const weekCols: Array<Array<HeatmapCell | null>> = [];
    for (let i = 0; i < padded.length; i += 7) {
      weekCols.push(padded.slice(i, i + 7));
    }

    const labels: Array<{ colIndex: number; label: string }> = [];
    let lastMonth = "";
    let lastCol = -99;
    weekCols.forEach((col, colIndex) => {
      const firstReal = col.find((c) => c !== null);
      if (!firstReal) return;
      const ym = firstReal.date.slice(0, 7);
      const monthNum = Number(firstReal.date.slice(5, 7));
      if (ym !== lastMonth && colIndex - lastCol >= 2) {
        labels.push({ colIndex, label: `${monthNum}月` });
        lastMonth = ym;
        lastCol = colIndex;
      } else if (ym !== lastMonth) {
        lastMonth = ym;
      }
    });

    return { weeks: weekCols, monthLabels: labels };
  }, [heatmap.cells]);

  const squareSize = compact ? "size-[11px]" : "size-[13px]";
  const monthMap = new Map(monthLabels.map((m) => [m.colIndex, m.label]));

  const activeInfo = hoveredCell
    ? cellDescription(hoveredCell)
    : selectedDate
      ? (() => {
          const found = heatmap.cells.find((c) => c.date === selectedDate);
          return found ? cellDescription(found) : selectedDate;
        })()
      : "点击任意日期格子查看当日习惯明细或补记";

  return (
    <div className="space-y-2.5">
      <div className="overflow-x-auto pb-1">
        <div className="inline-block min-w-max">
          {/* Month headers */}
          <div className="mb-1 flex items-center gap-[3px] pl-6 text-[10px] text-muted-foreground">
            {weeks.map((_, colIdx) => (
              <div
                key={colIdx}
                className={cn(squareSize, "relative shrink-0 overflow-visible")}
              >
                {monthMap.get(colIdx) && (
                  <span className="absolute top-0 left-0 whitespace-nowrap leading-none">
                    {monthMap.get(colIdx)}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-start gap-1.5">
            {/* Weekday labels */}
            <div className="flex w-4.5 shrink-0 flex-col gap-[3px] pt-[1px] text-[10px] text-muted-foreground/85">
              {WEEKDAY_LABELS.map((label, idx) => (
                <div
                  key={idx}
                  className={cn(
                    squareSize,
                    "flex items-center justify-end pr-0.5 leading-none",
                  )}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Week columns */}
            <div className="flex gap-[3px]">
              {weeks.map((col, colIdx) => (
                <div key={colIdx} className="flex flex-col gap-[3px]">
                  {col.map((cell, rowIdx) => {
                    if (!cell) {
                      return (
                        <div
                          key={`empty-${colIdx}-${rowIdx}`}
                          className={squareSize}
                        />
                      );
                    }
                    const { className } = cellStyle(cell);
                    const isSelected = selectedDate === cell.date;
                    const desc = cellDescription(cell);
                    const clickable = cell.status !== "future";
                    return (
                      <button
                        key={cell.date}
                        type="button"
                        disabled={!clickable}
                        aria-label={desc}
                        title={desc}
                        onMouseEnter={() => setHoveredCell(cell)}
                        onMouseLeave={() => setHoveredCell(null)}
                        onClick={() => {
                          if (!clickable) return;
                          onSelectDate(isSelected ? null : cell.date);
                        }}
                        className={cn(
                          squareSize,
                          "rounded-[2.5px] transition-all outline-none",
                          className,
                          isSelected &&
                            "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                        )}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Info & Legend Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{activeInfo}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-[2px] border border-(--habit-unscheduled-border)" />
            未安排
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-[2px] bg-(--habit-zero)" />
            0 项
          </span>
          <span className="inline-flex items-center gap-1">
            <span>少</span>
            <span className="inline-block size-2.5 rounded-[2px] bg-(--habit-level-1)" />
            <span className="inline-block size-2.5 rounded-[2px] bg-(--habit-level-2)" />
            <span className="inline-block size-2.5 rounded-[2px] bg-(--habit-level-3)" />
            <span className="inline-block size-2.5 rounded-[2px] bg-(--habit-level-4)" />
            <span>多</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-[2px] border border-dashed border-(--habit-in-progress-ring) bg-(--habit-in-progress-bg)" />
            进行中
          </span>
        </div>
      </div>
    </div>
  );
}
