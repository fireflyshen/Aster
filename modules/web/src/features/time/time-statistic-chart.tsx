import { useState } from "react";
import { formatCurrencyCny, formatDurationCompact } from "./time-format";
import type { StatisticDimension, StatisticRow } from "./time-statistics";

export function TimeStatisticChart({
    rows,
    dimension,
    onDimension,
    dimensions,
    onOpenDay,
    initialMetric = "seconds",
}: {
    rows: StatisticRow[];
    initialMetric?: "seconds" | "cost";
    dimension: StatisticDimension;
    onDimension: (dimension: StatisticDimension) => void;
    dimensions: StatisticDimension[];
    onOpenDay: (date: string) => void;
}) {
    const [metric, setMetric] = useState<"seconds" | "cost">(initialMetric);
    const labels = { day: "每日", project: "项目", tag: "标签" };
    const ordered =
        dimension === "day"
            ? rows
            : [...rows].sort((a, b) => b[metric] - a[metric]);
    const maximum = Math.max(1, ...ordered.map((row) => row[metric]));
    const format = (value: number) =>
        metric === "seconds"
            ? formatDurationCompact(value)
            : formatCurrencyCny(value);
    return (
        <section aria-label="投入统计" className="ledger-statistic space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-2 text-xs">
                <div className="flex gap-4" role="group" aria-label="统计维度">
                    {dimensions.map((value) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={dimension === value}
                            onClick={() => onDimension(value)}
                            className={
                                dimension === value
                                    ? "font-medium text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }
                        >
                            {labels[value]}
                        </button>
                    ))}
                </div>
                <div className="flex gap-3" role="group" aria-label="统计指标">
                    {(["seconds", "cost"] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={metric === value}
                            onClick={() => setMetric(value)}
                            className={
                                metric === value
                                    ? "font-medium text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }
                        >
                            {value === "seconds" ? "时长" : "时间成本"}
                        </button>
                    ))}
                </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
                {dimension === "tag"
                    ? "多标签记录分别累计，标签之间有重叠。"
                    : "已确认记录 · 待核对时间未计入"}
            </p>
            {ordered.length === 0 ? (
                <p className="py-6 text-xs text-muted-foreground">
                    所选期间暂无记录。
                </p>
            ) : (
                <div className="space-y-3">
                    {ordered.map((row) => {
                        const content = (
                            <>
                                <span
                                    className="w-24 shrink-0 truncate sm:w-40"
                                    title={row.label}
                                >
                                    {row.label}
                                </span>
                                <span
                                    className="relative h-1 min-w-4 flex-1 bg-muted/50"
                                    aria-hidden="true"
                                >
                                    <span
                                        className="ledger-statistic-bar absolute inset-y-0 left-0"
                                        style={{
                                            width: `${(Math.max(0, row[metric]) / maximum) * 100}%`,
                                        }}
                                    />
                                </span>
                                <span className="w-20 shrink-0 text-right tabular-nums">
                                    {format(row[metric])}
                                </span>
                            </>
                        );
                        return row.date ? (
                            <button
                                key={row.key}
                                type="button"
                                onClick={() => onOpenDay(row.date!)}
                                className="flex w-full items-center gap-3 py-1 text-left text-xs hover:text-primary"
                                aria-label={`${row.label} ${format(row[metric])}，查看时间线`}
                            >
                                {content}
                            </button>
                        ) : (
                            <div
                                key={row.key}
                                className="flex items-center gap-3 py-1 text-xs"
                            >
                                {content}
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
