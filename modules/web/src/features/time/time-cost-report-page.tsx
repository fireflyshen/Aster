import { TimeStatisticChart } from "./time-statistic-chart";
import {
    costStatisticRows,
    costTagGroups,
    type StatisticDimension,
} from "./time-statistics";
import type {
    CostReportGranularity,
    CostReportProjectRow,
    CostReportSegmentRef,
    CostReportSortBy,
    CostReportSummary,
    TimePolicy,
} from "@core/time/model";
import { addLocalDays, localDateOf } from "@core/time/zone";
import { ChevronDown, ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { LinkedBillsList } from "./bill-link-dialog";
import { fetchCostReport, unlinkBillLink } from "./time-api";
import {
    formatClockInZone,
    formatCurrencyCny,
    formatDurationChinese,
    formatDurationCompact,
} from "./time-format";

function shiftPeriodDate(
    dateStr: string,
    granularity: CostReportGranularity,
    delta: number,
): string {
    if (granularity === "week") {
        return addLocalDays(dateStr, delta * 7);
    }
    const [yStr, mStr] = dateStr.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return dateStr;
    const target = new Date(Date.UTC(y, m - 1 + delta, 1));
    const ty = target.getUTCFullYear();
    const tm = String(target.getUTCMonth() + 1).padStart(2, "0");
    return `${ty}-${tm}-01`;
}

function SegmentTraceList({
    segments,
    timeZone,
    onOpenDay,
}: {
    segments: readonly CostReportSegmentRef[];
    timeZone: string;
    onOpenDay: (date: string) => void;
}) {
    if (segments.length === 0) {
        return (
            <p className="py-2 text-xs text-muted-foreground/70">
                本期间暂无时间明细记录。
            </p>
        );
    }
    return (
        <div className="divide-y divide-border/30 rounded-md border border-border/40 bg-background/50">
            {segments.map((seg) => (
                <button
                    key={`${seg.activityId}-${seg.startMs}`}
                    type="button"
                    onClick={() => onOpenDay(seg.date)}
                    className="flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-(--row-hover)"
                >
                    <div className="flex min-w-0 items-center gap-2.5">
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                            {seg.date}{" "}
                            {formatClockInZone(seg.startMs, timeZone)}–
                            {formatClockInZone(seg.endMs, timeZone)}
                        </span>
                        <span className="truncate text-foreground">
                            {seg.title}
                        </span>
                        {seg.reviewState === "review_required" && (
                            <span className="text-[11px] text-amber-600 dark:text-amber-400">
                                待核对
                            </span>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 tabular-nums">
                        <span className="text-muted-foreground">
                            {formatDurationCompact(seg.confirmedSeconds)}
                        </span>
                        <span className="font-medium text-foreground">
                            {formatCurrencyCny(seg.confirmedCostCents)}
                        </span>
                        {seg.provisionalCostCents > 0 && (
                            <span className="text-amber-600 dark:text-amber-400">
                                +{formatCurrencyCny(seg.provisionalCostCents)}{" "}
                                暂计
                            </span>
                        )}
                    </div>
                </button>
            ))}
        </div>
    );
}

export function TimeCostReportPage({
    policy,
    selectedDate,
    onSelectDate,
    onOpenDay,
    onMutated,
}: {
    policy: TimePolicy;
    selectedDate: string;
    onSelectDate: (date: string) => void;
    onOpenDay: (date: string) => void;
    onMutated?: () => void;
}) {
    const timeZone = policy.timezone || "UTC";
    const todayStr = localDateOf(Date.now(), timeZone);

    const [granularity, setGranularity] =
        useState<CostReportGranularity>("week");
    const [sortBy, setSortBy] = useState<CostReportSortBy>("highest_cost");
    const [groupBy, setGroupBy] = useState<"project" | "tag">("project");
    const [report, setReport] = useState<CostReportSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const loadReport = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const next = await fetchCostReport({
                granularity,
                date: selectedDate,
                sortBy,
            });
            setReport(next);
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载成本报告失败");
        } finally {
            setLoading(false);
        }
    }, [granularity, selectedDate, sortBy]);

    useEffect(() => {
        void loadReport();
    }, [loadReport]);

    async function handleUnlinkBill(linkId: string) {
        setBusy(true);
        setError("");
        try {
            await unlinkBillLink(linkId);
            await loadReport();
            onMutated?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : "解除账单关联失败");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-8">
            {/* Period & Sort Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                    <div className="inline-flex rounded-md bg-muted/60 p-0.5 text-xs">
                        <button
                            type="button"
                            onClick={() => setGranularity("week")}
                            className={
                                granularity === "week"
                                    ? "rounded px-2.5 py-1 font-medium text-foreground bg-background shadow-xs"
                                    : "px-2.5 py-1 text-muted-foreground hover:text-foreground"
                            }
                        >
                            按周
                        </button>
                        <button
                            type="button"
                            onClick={() => setGranularity("month")}
                            className={
                                granularity === "month"
                                    ? "rounded px-2.5 py-1 font-medium text-foreground bg-background shadow-xs"
                                    : "px-2.5 py-1 text-muted-foreground hover:text-foreground"
                            }
                        >
                            按月
                        </button>
                    </div>

                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="上一周期"
                        className="text-muted-foreground"
                        onClick={() =>
                            onSelectDate(
                                shiftPeriodDate(selectedDate, granularity, -1),
                            )
                        }
                    >
                        <ChevronLeft className="size-3.5" />
                    </Button>
                    <Input
                        type="date"
                        aria-label="选择统计周期日期"
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
                        aria-label="下一周期"
                        className="text-muted-foreground"
                        onClick={() =>
                            onSelectDate(
                                shiftPeriodDate(selectedDate, granularity, 1),
                            )
                        }
                    >
                        <ChevronRight className="size-3.5" />
                    </Button>
                    {report && (
                        <span className="text-xs text-muted-foreground/80 tabular-nums">
                            {report.periodStartDate.slice(5)} –{" "}
                            {report.periodEndDate.slice(5)}
                        </span>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-6 px-2 text-xs text-muted-foreground"
                        onClick={() => onSelectDate(todayStr)}
                    >
                        {granularity === "week" ? "本周" : "本月"}
                    </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="inline-flex rounded-md bg-muted/60 p-0.5">
                        <button
                            type="button"
                            onClick={() => setSortBy("highest_cost")}
                            className={
                                sortBy === "highest_cost"
                                    ? "rounded px-2.5 py-1 font-medium text-foreground bg-background shadow-xs"
                                    : "px-2.5 py-1 text-muted-foreground hover:text-foreground"
                            }
                        >
                            时间成本最高
                        </button>
                        <button
                            type="button"
                            disabled={groupBy === "tag"}
                            onClick={() => setSortBy("highest_over_budget")}
                            className={
                                sortBy === "highest_over_budget"
                                    ? "rounded px-2.5 py-1 font-medium text-foreground bg-background shadow-xs"
                                    : "px-2.5 py-1 text-muted-foreground hover:text-foreground"
                            }
                        >
                            超出预估最多
                        </button>
                    </div>
                </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            {loading && !report ? (
                <div className="flex items-center gap-2 py-12 text-xs text-muted-foreground">
                    <Spinner className="size-4" />
                    正在生成成本报告…
                </div>
            ) : report ? (
                <>
                    {/* Summary Strip */}
                    <div className="grid grid-cols-1 gap-3 border-y border-border/60 py-4 sm:grid-cols-3">
                        <div>
                            <div className="text-xs text-muted-foreground">
                                期间时间成本（已确认）
                            </div>
                            <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                                <span className="text-xl font-semibold text-foreground">
                                    {formatCurrencyCny(
                                        report.totalPeriodConfirmedCostCents,
                                    )}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {formatDurationChinese(
                                        report.totalPeriodConfirmedSeconds,
                                    )}
                                </span>
                            </div>
                            {report.totalPeriodProvisionalCostCents > 0 && (
                                <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 tabular-nums">
                                    另含待核对{" "}
                                    {formatCurrencyCny(
                                        report.totalPeriodProvisionalCostCents,
                                    )}
                                    （
                                    {formatDurationCompact(
                                        report.totalPeriodProvisionalSeconds,
                                    )}
                                    ，未计入合计）
                                </div>
                            )}
                        </div>

                        <div>
                            <div className="text-xs text-muted-foreground">
                                关联现金支出（Bills 只读）
                            </div>
                            <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                                <span className="text-xl font-semibold text-foreground">
                                    {formatCurrencyCny(
                                        report.totalCashExpenseCents,
                                    )}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    实付现金单独列示
                                </span>
                            </div>
                        </div>

                        <div>
                            <div className="text-xs text-muted-foreground">
                                综合投入（含时间折算）
                            </div>
                            <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                                <span className="text-xl font-semibold text-foreground">
                                    {formatCurrencyCny(
                                        report.totalCombinedCostCents,
                                    )}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    当前单价{" "}
                                    {formatCurrencyCny(report.hourlyRateCents)}
                                    /h
                                </span>
                            </div>
                        </div>
                    </div>

                    <TimeStatisticChart
                        rows={costStatisticRows(report, groupBy)}
                        dimension={groupBy}
                        onDimension={(value: StatisticDimension) => {
                            if (value === "project" || value === "tag") {
                                setGroupBy(value);
                                setExpandedKey(null);
                                if (value === "tag") setSortBy("highest_cost");
                            }
                        }}
                        dimensions={["project", "tag"]}
                        onOpenDay={onOpenDay}
                    />

                    {
                        <section className="space-y-2">
                            <div className="flex items-center justify-between border-b border-border/60 pb-2 text-xs text-muted-foreground">
                                <span>
                                    {groupBy === "project"
                                        ? "项目成本汇总"
                                        : "标签成本汇总"}
                                </span>
                                <span>点击展开时间记录</span>
                            </div>

                            {(groupBy === "project"
                                ? report.byProject
                                : costTagGroups(report)
                            ).length === 0 ? (
                                <p className="py-10 text-xs text-muted-foreground/70">
                                    所选期间暂无已确认的时间成本记录。
                                </p>
                            ) : (
                                <div className="divide-y divide-border/35">
                                    {(groupBy === "project"
                                        ? report.byProject
                                        : costTagGroups(report)
                                    ).map((row: CostReportProjectRow) => {
                                        const key = `${groupBy}:${row.projectKey}`;
                                        const open = expandedKey === key;
                                        return (
                                            <div key={key} className="py-3">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setExpandedKey(
                                                            open ? null : key,
                                                        )
                                                    }
                                                    className="flex w-full items-start justify-between gap-4 text-left"
                                                >
                                                    <div className="min-w-0 space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <ChevronDown
                                                                className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                                                            />
                                                            <span className="text-sm font-medium text-foreground">
                                                                {
                                                                    row.projectName
                                                                }
                                                            </span>
                                                            <span className="text-[11px] text-muted-foreground">
                                                                {
                                                                    row.segments
                                                                        .length
                                                                }{" "}
                                                                条记录
                                                            </span>
                                                        </div>
                                                        <div className="pl-5 text-xs text-muted-foreground tabular-nums">
                                                            {formatDurationChinese(
                                                                row.periodSeconds,
                                                            )}
                                                            {row.periodProvisionalCostCents >
                                                                0 && (
                                                                <span className="ml-2 text-amber-600 dark:text-amber-400">
                                                                    · 待核对{" "}
                                                                    {formatCurrencyCny(
                                                                        row.periodProvisionalCostCents,
                                                                    )}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="shrink-0 text-right tabular-nums">
                                                        <div className="text-sm font-semibold text-foreground">
                                                            {formatCurrencyCny(
                                                                row.periodCostCents,
                                                            )}
                                                        </div>
                                                        {row.overInitialBudgetCents >
                                                            0 && (
                                                            <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                                                项目超预估{" "}
                                                                {formatCurrencyCny(
                                                                    row.overInitialBudgetCents,
                                                                )}
                                                            </div>
                                                        )}
                                                        {row.cashExpenseCents >
                                                            0 && (
                                                            <div className="text-[11px] text-muted-foreground">
                                                                现金{" "}
                                                                {formatCurrencyCny(
                                                                    row.cashExpenseCents,
                                                                )}{" "}
                                                                · 综合{" "}
                                                                {formatCurrencyCny(
                                                                    row.combinedPeriodCostCents,
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </button>

                                                {open && (
                                                    <div className="mt-3 pl-5">
                                                        <SegmentTraceList
                                                            segments={
                                                                row.segments
                                                            }
                                                            timeZone={timeZone}
                                                            onOpenDay={
                                                                onOpenDay
                                                            }
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    }

                    {groupBy === "tag" && (
                        <p className="text-xs text-muted-foreground">
                            多标签记录分别计入各标签，标签金额不可相加作为总额。现金支出仅在顶部汇总和项目维度列示。
                        </p>
                    )}
                    {/* Standalone bill links */}
                    {report.unassignedBillLinks.length > 0 && (
                        <section className="space-y-3 pt-2">
                            <div className="flex items-center justify-between border-b border-border/60 pb-2 text-xs text-muted-foreground">
                                <span>独立账单</span>
                                <span className="inline-flex items-center gap-1">
                                    <Receipt className="size-3" />
                                    仅作溯源展示
                                </span>
                            </div>
                            {report.unassignedBillLinks.length > 0 && (
                                <LinkedBillsList
                                    links={report.unassignedBillLinks}
                                    busy={busy}
                                    onUnlink={handleUnlinkBill}
                                />
                            )}
                        </section>
                    )}
                </>
            ) : null}
        </div>
    );
}
