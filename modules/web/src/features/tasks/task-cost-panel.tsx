import type { LocatedSegment, TaskCostSummary } from "@core/time/model";
import { localDateOf, zonedDateTimeToUtcMs } from "@core/time/zone";
import type { Task } from "@shared/tasks";
import { Check, Clock, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
    BillLinkDialog,
    LinkedBillsList,
} from "@/features/time/bill-link-dialog";
import {
    confirmTimeActivity,
    createTimingPlan,
    fetchTaskCostDetail,
    setTaskBudget,
    startTimingPlan,
    unlinkBillLink,
    updateTimeActivity,
    type TaskCostDetailResponse,
} from "@/features/time/time-api";
import {
    computeContinuationCostPreview,
    computeDurationCostCents,
    formatClockInZone,
    formatCurrencyCny,
    formatDurationChinese,
    formatDurationCompact,
    normalizeHourlyRateCents,
} from "@/features/time/time-format";

export type TaskBudgetDraft = {
    minutes: string;
    plannedStartTime: string;
    hardStopTime: string;
};

export function createEmptyTaskBudgetDraft(): TaskBudgetDraft {
    return {
        minutes: "",
        plannedStartTime: "",
        hardStopTime: "",
    };
}

export function NewTaskBudgetSection({
    draft,
    onChange,
    hourlyRateCents,
    disabled,
}: {
    draft: TaskBudgetDraft;
    onChange: (next: TaskBudgetDraft) => void;
    hourlyRateCents: number;
    disabled?: boolean;
}) {
    const rateCents = normalizeHourlyRateCents(hourlyRateCents);
    const minsNum = Number(draft.minutes.trim());
    const validMins = Number.isFinite(minsNum) && minsNum > 0 ? minsNum : 0;
    const estSeconds = Math.round(validMins * 60);
    const estCostCents = computeDurationCostCents(estSeconds, rateCents);

    return (
        <div className="mt-4 space-y-2.5 rounded-lg border border-border/55 bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Clock className="size-3.5 text-muted-foreground" />
                    <span>投入预算（填预计时长自动折算）</span>
                </div>
                <div className="flex items-center gap-1 text-[11px]">
                    {[30, 60, 120].map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                                onChange({ ...draft, minutes: String(preset) })
                            }
                            className="rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                        >
                            {preset === 60
                                ? "1h"
                                : preset === 120
                                  ? "2h"
                                  : `${preset}m`}
                        </button>
                    ))}
                    {draft.minutes && (
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                                onChange(createEmptyTaskBudgetDraft())
                            }
                            className="px-1 text-muted-foreground hover:text-foreground"
                        >
                            清除
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                        预计时长（分钟）
                    </span>
                    <Input
                        type="number"
                        min={1}
                        max={14400}
                        disabled={disabled}
                        placeholder="例如 60"
                        className="h-7 text-xs tabular-nums"
                        value={draft.minutes}
                        onChange={(e) =>
                            onChange({ ...draft, minutes: e.target.value })
                        }
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                        计划开始（可选）
                    </span>
                    <Input
                        type="time"
                        disabled={disabled}
                        className="h-7 text-xs tabular-nums"
                        value={draft.plannedStartTime}
                        onChange={(e) =>
                            onChange({
                                ...draft,
                                plannedStartTime: e.target.value,
                            })
                        }
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                        最晚结束（可选）
                    </span>
                    <Input
                        type="time"
                        disabled={disabled}
                        className="h-7 text-xs tabular-nums"
                        value={draft.hardStopTime}
                        onChange={(e) =>
                            onChange({ ...draft, hardStopTime: e.target.value })
                        }
                    />
                </label>
            </div>

            {estSeconds > 0 && (
                <div className="text-xs text-muted-foreground tabular-nums">
                    预计投入{" "}
                    <strong className="font-medium text-foreground">
                        {formatDurationChinese(estSeconds)} ·{" "}
                        {formatCurrencyCny(estCostCents)}
                    </strong>
                    {(draft.plannedStartTime || draft.hardStopTime) && (
                        <span>
                            {" "}
                            ·{" "}
                            {draft.plannedStartTime
                                ? `计划 ${draft.plannedStartTime} 开始`
                                : ""}
                            {draft.plannedStartTime && draft.hardStopTime
                                ? "，"
                                : ""}
                            {draft.hardStopTime
                                ? `最晚 ${draft.hardStopTime} 结束`
                                : ""}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

export function TaskCostDetailSection({
    task,
    hourlyRateCents,
    initialSummary,
    disabled,
    onRefreshTimeSnapshot,
}: {
    task: Task;
    hourlyRateCents: number;
    initialSummary?: TaskCostSummary;
    disabled?: boolean;
    onRefreshTimeSnapshot?: () => Promise<unknown>;
}) {
    const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
    const todayStr = localDateOf(Date.now(), timeZone);

    const [detail, setDetail] = useState<TaskCostDetailResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [budgetOpen, setBudgetOpen] = useState(false);
    const [budgetMode, setBudgetMode] = useState<"set" | "add">("set");
    const [budgetMin, setBudgetMin] = useState("60");
    const [budgetHardStop, setBudgetHardStop] = useState("");
    const [continueMin, setContinueMin] = useState("30");
    const [editingSeg, setEditingSeg] = useState<{
        seg: LocatedSegment;
        endTime: string;
    } | null>(null);
    const [billOpen, setBillOpen] = useState(false);

    const loadDetail = useCallback(async () => {
        setLoading(true);
        try {
            const next = await fetchTaskCostDetail(task.uuid);
            setDetail(next);
            setError("");
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "加载任务成本明细失败",
            );
        } finally {
            setLoading(false);
        }
    }, [task.uuid]);

    useEffect(() => {
        void loadDetail();
    }, [loadDetail]);

    const summary = detail?.summary ?? initialSummary;
    const activeRateCents =
        summary?.currentHourlyRateCents ??
        normalizeHourlyRateCents(hourlyRateCents);

    async function runAction(fn: () => Promise<unknown>) {
        setBusy(true);
        setError("");
        try {
            await fn();
            await loadDetail();
            await onRefreshTimeSnapshot?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : "操作失败，请重试");
        } finally {
            setBusy(false);
        }
    }

    async function handleSaveBudget(e: React.FormEvent) {
        e.preventDefault();
        const mins = Number(budgetMin.trim());
        if (!Number.isFinite(mins) || mins <= 0) {
            setError("预计时长须大于 0 分钟。");
            return;
        }
        const seconds = Math.round(mins * 60);
        await runAction(() =>
            setTaskBudget({
                taskUuid: task.uuid,
                mode: budgetMode,
                ...(budgetMode === "add"
                    ? { addAllowanceSeconds: seconds }
                    : { allowanceSeconds: seconds }),
                ...(budgetHardStop.trim()
                    ? {
                          hardStopDate: todayStr,
                          hardStopTime: budgetHardStop.trim(),
                      }
                    : {}),
            }),
        );
        setBudgetOpen(false);
    }

    async function handleContinueTimer(effectiveSeconds: number) {
        await runAction(async () => {
            const created = await createTimingPlan({
                title: task.description,
                taskUuid: task.uuid,
                projectSnapshot: task.project || undefined,
                tags: task.tags?.length ? task.tags : undefined,
                allowanceSeconds: effectiveSeconds,
                ...(summary?.hardStopAtMs
                    ? { hardStopAtMs: summary.hardStopAtMs }
                    : {}),
            });
            await startTimingPlan({ planId: created.plan.id });
        });
    }

    const reqContinueMin = Number(continueMin.trim()) || 0;
    const continuationPreview =
        reqContinueMin > 0
            ? computeContinuationCostPreview({
                  requestedSeconds: Math.round(reqContinueMin * 60),
                  hourlyRateCents: activeRateCents,
                  hardStopAtMs: summary?.hardStopAtMs,
                  nowMs: Date.now(),
              })
            : null;

    const reviewSegments = (detail?.segments || []).filter(
        (s) => s.reviewState === "review_required" && !s.running,
    );

    return (
        <div className="mt-5 space-y-3 rounded-lg border border-border/55 bg-muted/20 p-3.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Clock className="size-3.5 text-muted-foreground" />
                    <span>投入成本与计时明细</span>
                </div>
                <div className="flex items-center gap-1.5">
                    {summary?.hasBudget ? (
                        <>
                            <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                disabled={busy || disabled}
                                onClick={() => {
                                    setBudgetMode("add");
                                    setBudgetMin("30");
                                    setBudgetHardStop(
                                        summary.hardStopAtMs
                                            ? formatClockInZone(
                                                  summary.hardStopAtMs,
                                                  timeZone,
                                              )
                                            : "",
                                    );
                                    setBudgetOpen((v) => !v);
                                }}
                            >
                                <Plus className="size-3" />
                                追加预算
                            </Button>
                            <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                className="text-muted-foreground"
                                disabled={busy || disabled}
                                onClick={() =>
                                    void runAction(() =>
                                        setTaskBudget({
                                            taskUuid: task.uuid,
                                            mode: "clear",
                                        }),
                                    )
                                }
                            >
                                清空
                            </Button>
                        </>
                    ) : (
                        <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busy || disabled}
                            onClick={() => {
                                setBudgetMode("set");
                                setBudgetMin("60");
                                setBudgetHardStop("");
                                setBudgetOpen((v) => !v);
                            }}
                        >
                            设置预计投入
                        </Button>
                    )}
                </div>
            </div>

            {summary ? (
                <div className="space-y-2 tabular-nums">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <div>
                            <span className="text-lg font-semibold text-foreground">
                                {formatCurrencyCny(summary.confirmedCostCents)}
                            </span>
                            <span className="ml-2 text-muted-foreground">
                                已确认投入{" "}
                                {formatDurationChinese(
                                    summary.confirmedSeconds,
                                )}
                            </span>
                        </div>
                        <div>
                            {!summary.hasBudget ? (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                    未设预算
                                </span>
                            ) : summary.overInitialBudgetCents > 0 ? (
                                <span className="font-medium text-amber-600 dark:text-amber-400">
                                    超出最初预估{" "}
                                    {formatCurrencyCny(
                                        summary.overInitialBudgetCents,
                                    )}
                                </span>
                            ) : (
                                <span className="text-muted-foreground">
                                    预算内
                                </span>
                            )}
                        </div>
                    </div>

                    {summary.hasBudget && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            {summary.initialBudgetCents !== undefined && (
                                <span>
                                    最初预估{" "}
                                    {formatCurrencyCny(
                                        summary.initialBudgetCents,
                                    )}
                                    （
                                    {formatDurationCompact(
                                        summary.initialAllowanceSeconds ?? 0,
                                    )}
                                    ）
                                </span>
                            )}
                            {summary.addedBudgetCents > 0 && (
                                <span>
                                    + 追加{" "}
                                    {formatCurrencyCny(
                                        summary.addedBudgetCents,
                                    )}
                                </span>
                            )}
                            {summary.currentBudgetCents !== undefined && (
                                <span>
                                    = 当前预算{" "}
                                    {formatCurrencyCny(
                                        summary.currentBudgetCents,
                                    )}
                                    （
                                    {formatDurationCompact(
                                        summary.currentAllowanceSeconds ?? 0,
                                    )}
                                    ）
                                </span>
                            )}
                            {summary.hardStopAtMs !== undefined && (
                                <span>
                                    · 最晚{" "}
                                    {formatClockInZone(
                                        summary.hardStopAtMs,
                                        timeZone,
                                    )}{" "}
                                    结束
                                </span>
                            )}
                        </div>
                    )}

                    {summary.linkedCashCents > 0 && (
                        <div className="flex flex-wrap items-center gap-3 rounded bg-background/60 px-2.5 py-1.5 text-[11px]">
                            <span>
                                时间成本{" "}
                                <strong className="text-foreground">
                                    {formatCurrencyCny(
                                        summary.confirmedCostCents,
                                    )}
                                </strong>
                            </span>
                            <span>
                                + 现金支出{" "}
                                <strong className="text-foreground">
                                    {formatCurrencyCny(summary.linkedCashCents)}
                                </strong>
                            </span>
                            <span>
                                = 综合投入{" "}
                                <strong className="text-foreground">
                                    {formatCurrencyCny(
                                        summary.combinedCostCents,
                                    )}
                                </strong>
                            </span>
                        </div>
                    )}
                </div>
            ) : null}

            {/* Provisional / Review Required Alert Box (strictly separate from confirmed cost!) */}
            {(reviewSegments.length > 0 ||
                (summary?.provisionalCostCents ?? 0) > 0) && (
                <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 tabular-nums">
                    <div className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        待核对金额{" "}
                        {formatCurrencyCny(summary?.provisionalCostCents ?? 0)}
                        （
                        {formatDurationChinese(
                            summary?.provisionalSeconds ?? 0,
                        )}
                        ）— 仅待核对，未计入正式成本合计
                    </div>
                    {reviewSegments.map((seg) => (
                        <div
                            key={`${seg.activityId}-${seg.startMs}`}
                            className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-500/20 pt-1.5 text-[11px]"
                        >
                            <span>
                                本段记录{" "}
                                {formatDurationChinese(seg.durationSeconds)}
                                ，暂计{" "}
                                <strong>
                                    {formatCurrencyCny(
                                        seg.provisionalCostCents,
                                    )}
                                </strong>
                                （{formatClockInZone(seg.startMs, timeZone)}–
                                {formatClockInZone(seg.endMs, timeZone)}）
                            </span>
                            <div className="flex items-center gap-1.5">
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    className="h-6 px-2 text-[11px]"
                                    disabled={busy || disabled}
                                    onClick={() =>
                                        void runAction(() =>
                                            confirmTimeActivity({
                                                activityId: seg.activityId,
                                                expectedVersion: seg.version,
                                            }),
                                        )
                                    }
                                >
                                    <Check className="size-3" />
                                    确认时间
                                </Button>
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    className="h-6 px-2 text-[11px]"
                                    disabled={busy || disabled}
                                    onClick={() =>
                                        setEditingSeg({
                                            seg,
                                            endTime: formatClockInZone(
                                                seg.endMs,
                                                timeZone,
                                            ),
                                        })
                                    }
                                >
                                    修正时间
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Inline segment end-time correction */}
            {editingSeg && (
                <div className="flex flex-wrap items-center gap-2 rounded border border-border/60 bg-background/80 p-2 text-xs">
                    <span>
                        修正结束时间（开始{" "}
                        {formatClockInZone(editingSeg.seg.startMs, timeZone)}
                        ）：
                    </span>
                    <Input
                        type="time"
                        className="h-7 w-28 text-xs tabular-nums"
                        value={editingSeg.endTime}
                        onChange={(e) =>
                            setEditingSeg({
                                ...editingSeg,
                                endTime: e.target.value,
                            })
                        }
                    />
                    <Button
                        type="button"
                        size="xs"
                        disabled={busy}
                        onClick={() => {
                            const seg = editingSeg.seg;
                            const segDate = localDateOf(seg.startMs, timeZone);
                            const nextEndMs = zonedDateTimeToUtcMs(
                                segDate,
                                editingSeg.endTime,
                                timeZone,
                            );
                            if (nextEndMs <= seg.startMs) {
                                setError("结束时间必须晚于开始时间。");
                                return;
                            }
                            void runAction(async () => {
                                await updateTimeActivity({
                                    activityId: seg.activityId,
                                    expectedVersion: seg.version,
                                    patch: {
                                        endMs: nextEndMs,
                                        confirmReview: true,
                                    },
                                });
                                setEditingSeg(null);
                            });
                        }}
                    >
                        保存并确认
                    </Button>
                    <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => setEditingSeg(null)}
                    >
                        取消
                    </Button>
                </div>
            )}

            {/* Set / Add Budget Inline Form */}
            {budgetOpen && (
                <form
                    onSubmit={(e) => void handleSaveBudget(e)}
                    className="space-y-2 rounded border border-border/60 bg-background/70 p-2.5"
                >
                    <div className="flex flex-wrap items-center gap-2.5">
                        <label className="flex items-center gap-1.5">
                            <span>
                                {budgetMode === "add" ? "追加分钟" : "预计分钟"}
                            </span>
                            <Input
                                type="number"
                                min={1}
                                max={14400}
                                className="h-7 w-20 text-xs tabular-nums"
                                value={budgetMin}
                                onChange={(e) => setBudgetMin(e.target.value)}
                            />
                        </label>
                        <label className="flex items-center gap-1.5">
                            <span>最晚结束</span>
                            <Input
                                type="time"
                                className="h-7 w-28 text-xs tabular-nums"
                                value={budgetHardStop}
                                onChange={(e) =>
                                    setBudgetHardStop(e.target.value)
                                }
                            />
                        </label>
                        <span className="text-muted-foreground tabular-nums">
                            ≈{" "}
                            {formatCurrencyCny(
                                computeDurationCostCents(
                                    Math.max(0, Number(budgetMin) || 0) * 60,
                                    activeRateCents,
                                ),
                            )}
                        </span>
                        <Button type="submit" size="xs" disabled={busy}>
                            保存预算
                        </Button>
                    </div>
                    {budgetMode === "add" && (
                        <p className="text-[11px] text-muted-foreground">
                            追加仅提高当前预算上限，保留最初预估不变以便回看偏差。
                        </p>
                    )}
                </form>
            )}

            {/* Continuation decision preview */}
            {task.status === "pending" && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2.5">
                    <div className="flex flex-wrap items-center gap-2 tabular-nums">
                        <span className="text-muted-foreground">继续投入</span>
                        {[15, 30, 60].map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setContinueMin(String(m))}
                                className={
                                    continueMin === String(m)
                                        ? "rounded bg-foreground px-1.5 py-0.5 text-[11px] text-background"
                                        : "rounded border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                                }
                            >
                                {m}m
                            </button>
                        ))}
                        {continuationPreview && (
                            <span className="text-[11px] text-muted-foreground">
                                {continuationPreview.expired ? (
                                    <span className="text-destructive">
                                        最晚结束已过
                                    </span>
                                ) : continuationPreview.cappedByHardStop ? (
                                    <span className="text-amber-600 dark:text-amber-400">
                                        最多可继续{" "}
                                        {formatDurationChinese(
                                            continuationPreview.effectiveSeconds,
                                        )}{" "}
                                        · 预计{" "}
                                        {formatCurrencyCny(
                                            continuationPreview.additionalCostCents,
                                        )}
                                    </span>
                                ) : (
                                    <span>
                                        再投入{" "}
                                        {formatDurationChinese(
                                            continuationPreview.effectiveSeconds,
                                        )}
                                        ，预计增加{" "}
                                        <strong className="font-medium text-foreground">
                                            {formatCurrencyCny(
                                                continuationPreview.additionalCostCents,
                                            )}
                                        </strong>
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                    <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={
                            busy ||
                            disabled ||
                            !continuationPreview ||
                            continuationPreview.expired ||
                            continuationPreview.effectiveSeconds <= 0
                        }
                        onClick={() =>
                            continuationPreview &&
                            void handleContinueTimer(
                                continuationPreview.effectiveSeconds,
                            )
                        }
                    >
                        <Play className="size-3" />
                        开始这段
                    </Button>
                </div>
            )}

            {error && <p className="text-[11px] text-destructive">{error}</p>}

            {loading && !detail ? (
                <div className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
                    <Spinner className="size-3" />
                    正在读取记录…
                </div>
            ) : detail ? (
                <>
                    {detail.segments.length > 0 && (
                        <div className="space-y-1 border-t border-border/40 pt-2.5">
                            <div className="text-[11px] text-muted-foreground">
                                时间记录（{detail.segments.length} 段）
                            </div>
                            <div className="max-h-36 divide-y divide-border/30 overflow-y-auto rounded border border-border/40 bg-background/50">
                                {detail.segments.map((seg) => (
                                    <div
                                        key={`${seg.activityId}-${seg.startMs}`}
                                        className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] tabular-nums"
                                    >
                                        <span className="font-mono text-muted-foreground">
                                            {localDateOf(seg.startMs, timeZone)}{" "}
                                            {formatClockInZone(
                                                seg.startMs,
                                                timeZone,
                                            )}
                                            –
                                            {seg.running
                                                ? "进行中"
                                                : formatClockInZone(
                                                      seg.endMs,
                                                      timeZone,
                                                  )}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground">
                                                {formatDurationCompact(
                                                    seg.durationSeconds,
                                                )}
                                                {seg.hourlyRateCents !==
                                                undefined
                                                    ? ` · ¥${Math.round(seg.hourlyRateCents / 100)}/h`
                                                    : ""}
                                            </span>
                                            {seg.confirmedCostCents > 0 && (
                                                <span className="font-medium text-foreground">
                                                    {formatCurrencyCny(
                                                        seg.confirmedCostCents,
                                                    )}
                                                </span>
                                            )}
                                            {seg.provisionalCostCents > 0 && (
                                                <span className="text-amber-600 dark:text-amber-400">
                                                    暂计{" "}
                                                    {formatCurrencyCny(
                                                        seg.provisionalCostCents,
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="border-t border-border/40 pt-2.5">
                        <LinkedBillsList
                            links={detail.billLinks}
                            busy={busy || disabled}
                            onUnlink={(linkId) =>
                                runAction(() => unlinkBillLink(linkId))
                            }
                            onOpenPicker={() => setBillOpen(true)}
                        />
                    </div>

                    <BillLinkDialog
                        open={billOpen}
                        onOpenChange={setBillOpen}
                        targetLabel={task.description}
                        taskUuid={task.uuid}
                        existingLinks={detail.billLinks}
                        onLinked={async () => {
                            await loadDetail();
                            await onRefreshTimeSnapshot?.();
                        }}
                    />
                </>
            ) : null}
        </div>
    );
}
