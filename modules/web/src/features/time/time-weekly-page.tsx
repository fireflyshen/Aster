import { useState } from "react";
import { TimeStatisticChart } from "./time-statistic-chart";
import type { StatisticDimension } from "./time-statistics";
import type { TimePolicy, WeeklyDistributionSummary } from "@core/time/model";
import { addLocalDays, localDateOf } from "@core/time/zone";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    formatCurrencyCny,
    formatDurationChinese,
    formatDurationCompact,
    formatEstimateWindow,
    projectDisplayName,
    tagDisplayName,
} from "./time-format";

export function TimeWeeklyPage({
    policy,
    selectedDate,
    onSelectDate,
    weekly,
    onOpenDay,
}: {
    policy: TimePolicy;
    selectedDate: string;
    onSelectDate: (date: string) => void;
    weekly: WeeklyDistributionSummary;
    onOpenDay: (date: string) => void;
}) {
    const [dimension, setDimension] = useState<StatisticDimension>("day");
    const timeZone = policy.timezone || "UTC";
    const todayStr = localDateOf(Date.now(), timeZone);

    const sortedProjects = Object.entries(weekly.byProjectSeconds)
        .filter(([, secs]) => secs > 0)
        .sort((a, b) => b[1] - a[1]);

    const sortedTags = Object.entries(weekly.byTagSeconds)
        .filter(([, secs]) => secs > 0)
        .sort((a, b) => b[1] - a[1]);

    return (
        <div className="space-y-10">
            {/* Minimal week switcher & single-line coverage summary */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="上一周"
                        className="text-muted-foreground"
                        onClick={() =>
                            onSelectDate(addLocalDays(selectedDate, -7))
                        }
                    >
                        <ChevronLeft className="size-3.5" />
                    </Button>
                    <Input
                        type="date"
                        aria-label="选择所在周日期"
                        className="h-7 w-[124px] border-0 bg-transparent px-1 text-xs font-medium shadow-none focus-visible:ring-0"
                        value={selectedDate}
                        onChange={(e) => {
                            if (e.target.value) onSelectDate(e.target.value);
                        }}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="下一周"
                        className="text-muted-foreground"
                        onClick={() =>
                            onSelectDate(addLocalDays(selectedDate, 7))
                        }
                    >
                        <ChevronRight className="size-3.5" />
                    </Button>
                    <span className="ml-1 text-xs text-muted-foreground/75 tabular-nums">
                        {weekly.weekStartDate.slice(5)} –{" "}
                        {weekly.weekEndDate.slice(5)}
                        {weekly.isPartialWeek ? " · 进行中" : ""}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="ml-1 h-6 px-2 text-xs text-muted-foreground"
                        onClick={() => onSelectDate(todayStr)}
                    >
                        本周
                    </Button>
                </div>

                <div
                    className="text-xs text-muted-foreground tabular-nums"
                    title={`已定位 ${formatDurationChinese(weekly.coveredSeconds)} · 空白 ${formatDurationChinese(weekly.unrecordedSeconds)} · 周容量 ${formatDurationChinese(weekly.pastCapacitySeconds)}`}
                >
                    已记{" "}
                    <span className="text-foreground">
                        {formatDurationCompact(weekly.coveredSeconds)}
                    </span>
                    {weekly.confirmedCostCents > 0 && (
                        <span className="ml-1.5 font-medium text-foreground">
                            {formatCurrencyCny(weekly.confirmedCostCents)}
                        </span>
                    )}
                    {(weekly.provisionalSeconds ?? 0) > 0 && (
                        <>
                            <span className="mx-1.5 opacity-40">·</span>
                            <span className="text-amber-600 dark:text-amber-400">
                                待核对{" "}
                                {formatDurationCompact(
                                    weekly.provisionalSeconds ?? 0,
                                )}
                                {weekly.provisionalCostCents > 0
                                    ? ` (${formatCurrencyCny(weekly.provisionalCostCents)})`
                                    : ""}
                            </span>
                        </>
                    )}
                    <span className="mx-1.5 opacity-40">·</span>
                    空白 {formatDurationCompact(weekly.unrecordedSeconds)}
                    {weekly.unlocatedEstimates.length > 0 && (
                        <>
                            <span className="mx-1.5 opacity-40">·</span>
                            待定位 {weekly.unlocatedEstimates.length}
                        </>
                    )}
                </div>
            </div>

            <TimeStatisticChart
                dimension={dimension}
                onDimension={setDimension}
                dimensions={["day", "project", "tag"]}
                onOpenDay={onOpenDay}
                rows={
                    dimension === "day"
                        ? weekly.daily.map((day) => ({
                              key: day.date,
                              label: day.date.slice(5),
                              date: day.date,
                              seconds: day.coveredSeconds,
                              cost: day.confirmedCostCents,
                          }))
                        : (dimension === "project"
                              ? sortedProjects
                              : sortedTags
                          ).map(([key, seconds]) => ({
                              key,
                              label:
                                  dimension === "project"
                                      ? projectDisplayName(key)
                                      : tagDisplayName(key),
                              seconds,
                              cost:
                                  (dimension === "project"
                                      ? weekly.byProjectCostCents
                                      : weekly.byTagCostCents)[key] ?? 0,
                          }))
                }
            />

            {/* Weekly Unlocated Estimates */}
            {weekly.unlocatedEstimates.length > 0 && (
                <section>
                    <div className="flex items-center justify-between border-b border-border/60 pb-2">
                        <h2 className="text-xs font-medium text-muted-foreground">
                            本周待定位估记
                        </h2>
                        <span className="text-xs text-muted-foreground/70 tabular-nums">
                            {weekly.unlocatedEstimates.length} 项
                        </span>
                    </div>
                    <div>
                        {weekly.unlocatedEstimates.map((est) => {
                            const win = formatEstimateWindow(est, timeZone);
                            return (
                                <div
                                    key={est.id}
                                    className="flex items-center justify-between gap-4 border-b border-border/35 py-2.5 px-2 -mx-2 rounded-md text-xs transition-colors hover:bg-(--row-hover)"
                                >
                                    <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
                                        <span className="text-sm text-foreground">
                                            {est.title}
                                        </span>
                                        <span className="text-muted-foreground tabular-nums">
                                            约{" "}
                                            {formatDurationChinese(
                                                est.estimatedSeconds || 0,
                                            )}
                                        </span>
                                        {est.projectSnapshot && (
                                            <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                                {est.projectSnapshot}
                                            </span>
                                        )}
                                        {est.tags?.map((tag) => (
                                            <span
                                                key={tag}
                                                className="text-[11px] text-muted-foreground/75"
                                            >
                                                #{tag}
                                            </span>
                                        ))}
                                        {win && (
                                            <span className="text-muted-foreground/60">
                                                {win}
                                            </span>
                                        )}
                                    </div>
                                    {est.targetDate && (
                                        <Button
                                            type="button"
                                            size="xs"
                                            variant="ghost"
                                            onClick={() =>
                                                onOpenDay(est.targetDate!)
                                            }
                                        >
                                            去定位
                                        </Button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
