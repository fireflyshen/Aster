import { isoWeekday } from "@core/habits/logic";
import type { HeatmapCell, HeatmapResponse } from "@core/habits/model";
import { useEffect, useMemo, useRef, useState } from "react";
import { habitHeatmapLevel } from "./heatmap-level";

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
  if (cell.status === "unscheduled")
    return `${cell.date} ${wd} · 当日无安排习惯`;
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
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoveredCell = heatmap.cells.find((cell) => cell.date === hoveredDate);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (scroll) scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;
    });
    return () => cancelAnimationFrame(frame);
  }, [heatmap.startDate, heatmap.endDate, compact]);

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

  const monthMap = new Map(
    monthLabels.map((month) => [month.colIndex, month.label]),
  );

  const activeInfo = hoveredCell
    ? cellDescription(hoveredCell)
    : selectedDate
      ? (() => {
          const found = heatmap.cells.find((c) => c.date === selectedDate);
          return found ? cellDescription(found) : selectedDate;
        })()
      : "";

  return (
    <div
      className="habit-heatmap min-w-0 w-full space-y-2.5"
      data-compact={compact ? "true" : "false"}
    >
      <div
        ref={scrollRef}
        className="habit-heatmap-scroll"
        tabIndex={0}
        role="region"
        aria-label="习惯热力图日期，可横向滚动"
      >
        <div
          className="habit-heatmap-grid"
          style={{
            gridTemplateColumns: `20px repeat(${weeks.length}, var(--heatmap-cell-size))`,
          }}
          aria-label="按周排列的习惯热力图"
        >
          {weeks.map(
            (_, column) =>
              monthMap.has(column) && (
                <span
                  key={column}
                  className="habit-heatmap-month"
                  style={{
                    gridColumn: `${column + 2} / span ${Math.min(3, weeks.length - column)}`,
                    gridRow: 1,
                  }}
                >
                  {monthMap.get(column)}
                </span>
              ),
          )}
          {WEEKDAY_LABELS.map((label, index) => (
            <span
              key={index}
              className="habit-heatmap-weekday"
              style={{ gridColumn: 1, gridRow: index + 2 }}
            >
              {label}
            </span>
          ))}
          {weeks.map((week, column) =>
            week.map((cell, row) => {
              const position = {
                gridColumn: column + 2,
                gridRow: row + 2,
              };
              if (!cell)
                return (
                  <span
                    key={`empty-${column}-${row}`}
                    className="habit-heatmap-cell"
                    style={position}
                    aria-hidden="true"
                  />
                );
              const level = habitHeatmapLevel(cell);
              const isSelected = selectedDate === cell.date;
              const description = cellDescription(cell);
              return (
                <button
                  key={cell.date}
                  type="button"
                  disabled={cell.status === "future"}
                  aria-label={description}
                  aria-pressed={isSelected}
                  title={description}
                  style={position}
                  onMouseEnter={() => setHoveredDate(cell.date)}
                  onMouseLeave={() => setHoveredDate(null)}
                  onFocus={() => setHoveredDate(cell.date)}
                  onBlur={() => setHoveredDate(null)}
                  onClick={() => onSelectDate(isSelected ? null : cell.date)}
                  data-date={cell.date}
                  data-level={level ?? undefined}
                  data-status={cell.status}
                  data-today={cell.date === heatmap.todayDate || undefined}
                  data-selected={isSelected || undefined}
                  className="habit-heatmap-cell"
                />
              );
            }),
          )}
        </div>
      </div>

      <div className="habit-heatmap-meta">
        <span className="habit-heatmap-info" aria-live="polite">
          {activeInfo}
        </span>
        <div
          className="habit-heatmap-legend"
          aria-label="颜色越深，达成比例越高"
        >
          <span>未安排</span>
          <i data-status="unscheduled" />
          <span>低</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} data-level={level} />
          ))}
          <span>高</span>
        </div>
      </div>
    </div>
  );
}
