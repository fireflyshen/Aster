import type {
    Activity,
    DailyLedgerSummary,
    LocatedSegment,
    TimeEvent,
    TimePolicy,
    TimerSnapshot,
    TimelineGap,
    TimingPlan,
} from "@core/time/model";
import { snapshotLiveStatus } from "@core/time/snapshot";
import {
    addLocalDays,
    localDateOf,
    zonedDateTimeToUtcMs,
} from "@core/time/zone";
import type { SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Clock,
    Moon,
    Pause,
    Pencil,
    Play,
    Plus,
    Square,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    collectProjectOptions,
    collectTagOptions,
    ProjectTagFields,
} from "./project-tag-fields";
import {
    confirmSleepCandidate,
    confirmTimeActivity,
    createTimingPlan,
    dismissSleepCandidate,
    estimateTimeActivity,
    locateTimeEstimate,
    logTimeActivity,
    resolveTimeOperation,
    startTimeActivity,
    startTimingPlan,
    stopTimeActivity,
    updateTimeActivity,
    updateTimingPlan,
    type TimeReceipt,
    type TimeStatusResponse,
} from "./time-api";
import {
    EditSegmentDialog,
    LocateEstimateDialog,
    TimeLogOrEstimateDialog,
    type LogDialogSeed,
} from "./time-activity-dialogs";
import {
    computeContinuationCostPreview,
    computeDurationCostCents,
    formatClockInZone,
    formatCurrencyCny,
    formatDurationChinese,
    formatDurationCompact,
    formatEstimateWindow,
    formatTimeRangeInZone,
    normalizeHourlyRateCents,
} from "./time-format";
import type { PendingOperationDetail } from "./use-time-ledger";

type TimelineItem =
    | { kind: "segment"; startMs: number; segment: LocatedSegment }
    | { kind: "gap"; startMs: number; gap: TimelineGap };

function computePredictedStopMs(
    startMs: number,
    remainingSeconds?: number,
    hardStopAtMs?: number,
): number | undefined {
    const durStop =
        remainingSeconds !== undefined && remainingSeconds > 0
            ? startMs + remainingSeconds * 1000
            : undefined;
    if (durStop !== undefined && hardStopAtMs !== undefined) {
        return Math.min(durStop, hardStopAtMs);
    }
    return durStop ?? hardStopAtMs;
}

export function TimeTodayPage({
    status,
    policy,
    selectedDate,
    onSelectDate,
    daily,
    plans,
    events,
    pendingDetails,
    tasks,
    projects,
    availableLabels,
    timerSnapshot,
    timerLiveStatus,
    activeActivitySeconds,
    busy,
    onAckEvents,
    runMutation,
}: {
    status: TimeStatusResponse | null;
    policy: TimePolicy;
    selectedDate: string;
    onSelectDate: (date: string) => void;
    daily: DailyLedgerSummary;
    plans: TimingPlan[];
    events: TimeEvent[];
    pendingDetails: PendingOperationDetail[];
    tasks: Task[];
    projects?: readonly string[];
    availableLabels?: readonly SavedTag[];
    timerSnapshot?: TimerSnapshot | null;
    timerLiveStatus?: ReturnType<typeof snapshotLiveStatus> | null;
    activeActivitySeconds: number | undefined;
    busy: boolean;
    onAckEvents: (eventIds: string[]) => Promise<void> | void;
    runMutation: <T extends TimeReceipt | Record<string, unknown>>(
        label: string,
        fn: () => Promise<T>,
        options?: { undoable?: boolean; onError?: (message: string) => void },
    ) => Promise<T | undefined>;
}) {
    const timeZone = policy.timezone || "UTC";
    const policyRateCents = normalizeHourlyRateCents(policy.hourlyRateCents);
    const nowMs = Date.now();
    const todayStr = localDateOf(nowMs, timeZone);
    const active = status?.activeActivity || null;
    const activeElapsedSec =
        activeActivitySeconds ??
        (active?.startMs !== undefined
            ? Math.max(0, Math.floor((nowMs - active.startMs) / 1000))
            : undefined);
    const activeRateCents = active
        ? (active.hourlyRateCents ??
          (active.categoryId === "sleep" ? 0 : policyRateCents))
        : policyRateCents;
    const activeProvisionalCostCents =
        active && activeElapsedSec !== undefined
            ? computeDurationCostCents(activeElapsedSec, activeRateCents)
            : 0;
    const activeHasAutoStop = active?.autoStopAtMs !== undefined;
    const activeRemainingStopSec =
        active?.autoStopAtMs !== undefined
            ? Math.max(0, Math.ceil((active.autoStopAtMs - nowMs) / 1000))
            : undefined;
    const longActivityAlert =
        active &&
        !activeHasAutoStop &&
        ((active.reviewDueAtMs !== undefined &&
            nowMs >= active.reviewDueAtMs) ||
            (activeElapsedSec !== undefined &&
                policy.longActivityThresholdSeconds > 0 &&
                activeElapsedSec >= policy.longActivityThresholdSeconds));
    const thresholdMinutesLabel = Math.max(
        1,
        Math.round(policy.longActivityThresholdSeconds / 60),
    );
    const pendingSleepCandidates = daily.sleepCandidates.filter(
        (c) => c.status === "pending",
    );

    const [quickTitle, setQuickTitle] = useState("");
    const [quickProject, setQuickProject] = useState("");
    const [quickTags, setQuickTags] = useState<string[]>([]);
    const [quickIsSleep, setQuickIsSleep] = useState(false);
    const [quickTaskUuid, setQuickTaskUuid] = useState("none");
    const [showPlanLimit, setShowPlanLimit] = useState(false);
    const [planAllowanceMin, setPlanAllowanceMin] = useState("60");
    const [planPlannedStart, setPlanPlannedStart] = useState("");
    const [planHardStop, setPlanHardStop] = useState("");
    const [extendingPlan, setExtendingPlan] = useState<{
        planId: string;
        extraMin: string;
        hardStopTime: string;
    } | null>(null);
    const [logDialogSeed, setLogDialogSeed] = useState<LogDialogSeed | null>(
        null,
    );
    const [locatingEstimate, setLocatingEstimate] = useState<Activity | null>(
        null,
    );
    const [editingSegment, setEditingSegment] = useState<LocatedSegment | null>(
        null,
    );

    const pendingTasks = useMemo(
        () => tasks.filter((t) => t.status === "pending"),
        [tasks],
    );
    const availableProjects = useMemo(
        () =>
            collectProjectOptions(
                projects || [],
                tasks,
                daily.locatedSegments.map((s) => s.projectSnapshot),
            ),
        [projects, tasks, daily.locatedSegments],
    );
    const availableTags = useMemo(
        () =>
            collectTagOptions(
                availableLabels || [],
                tasks,
                daily.locatedSegments.flatMap((s) => s.tags || []),
            ),
        [availableLabels, tasks, daily.locatedSegments],
    );

    function handleQuickTaskChange(nextUuid: string) {
        setQuickTaskUuid(nextUuid);
        if (nextUuid === "none") return;
        const found = tasks.find((t) => t.uuid === nextUuid);
        if (!found) return;
        if (!quickTitle.trim()) setQuickTitle(found.description);
        setQuickProject(found.project || "");
        setQuickTags(found.tags ? [...found.tags] : []);
    }

    const timelineItems = useMemo<TimelineItem[]>(() => {
        const items: TimelineItem[] = [
            ...daily.locatedSegments.map((segment) => ({
                kind: "segment" as const,
                startMs: segment.startMs,
                segment,
            })),
            ...daily.gaps.map((gap) => ({
                kind: "gap" as const,
                startMs: gap.startMs,
                gap,
            })),
        ];
        items.sort((a, b) => a.startMs - b.startMs);
        return items;
    }, [daily.locatedSegments, daily.gaps]);

    const planDate = selectedDate > todayStr ? selectedDate : todayStr;
    const draftPlanEvaluation = useMemo(() => {
        if (!showPlanLimit) return { hasLimit: false as const };
        const allowNum = planAllowanceMin.trim()
            ? Number(planAllowanceMin.trim())
            : undefined;
        if (
            allowNum !== undefined &&
            (!Number.isFinite(allowNum) || allowNum <= 0)
        ) {
            return { hasLimit: true as const, error: "预计用时须大于 0 分钟" };
        }
        let plannedStartAtMs: number | undefined;
        let hardStopAtMs: number | undefined;
        try {
            if (planPlannedStart.trim()) {
                plannedStartAtMs = zonedDateTimeToUtcMs(
                    planDate,
                    planPlannedStart.trim(),
                    timeZone,
                );
            }
            if (planHardStop.trim()) {
                hardStopAtMs = zonedDateTimeToUtcMs(
                    planDate,
                    planHardStop.trim(),
                    timeZone,
                );
            }
        } catch {
            return { hasLimit: true as const, error: "时间格式无效" };
        }
        if (
            plannedStartAtMs !== undefined &&
            hardStopAtMs !== undefined &&
            plannedStartAtMs >= hardStopAtMs
        ) {
            return {
                hasLimit: true as const,
                error: "最晚停止必须晚于计划开始",
            };
        }
        const allowSec =
            allowNum !== undefined ? Math.round(allowNum * 60) : undefined;
        const hasAny =
            allowSec !== undefined ||
            plannedStartAtMs !== undefined ||
            hardStopAtMs !== undefined;
        if (!hasAny) return { hasLimit: false as const };
        const hardStopPassed =
            hardStopAtMs !== undefined && hardStopAtMs <= nowMs;
        const predictedStart =
            plannedStartAtMs !== undefined && plannedStartAtMs > nowMs
                ? plannedStartAtMs
                : nowMs;
        const predictedStopAtNow = computePredictedStopMs(
            nowMs,
            allowSec,
            hardStopAtMs,
        );
        const predictedStopAtPlan = computePredictedStopMs(
            predictedStart,
            allowSec,
            hardStopAtMs,
        );
        return {
            hasLimit: true as const,
            allowanceSeconds: allowSec,
            plannedStartAtMs,
            hardStopAtMs,
            hardStopPassed,
            predictedStopAtNow,
            predictedStopAtPlan,
        };
    }, [
        showPlanLimit,
        planAllowanceMin,
        planPlannedStart,
        planHardStop,
        planDate,
        timeZone,
        nowMs,
    ]);

    // Plans are shown only while explicitly adjusting a linked recording.
    const visiblePlans = plans.filter(
        (plan) => plan.id === extendingPlan?.planId,
    );

    async function handleQuickStart(
        e: React.FormEvent,
        mode: "start" | "save_plan" = "start",
    ) {
        e.preventDefault();
        const chosenTask =
            quickTaskUuid !== "none"
                ? tasks.find((t) => t.uuid === quickTaskUuid)
                : undefined;
        const title = (
            quickTitle.trim() ||
            chosenTask?.description ||
            ""
        ).trim();
        if (!title) return;
        const categoryId = quickIsSleep ? "sleep" : "work";
        const resolvedProject =
            quickProject.trim() || chosenTask?.project || undefined;
        const resolvedTags =
            quickTags.length > 0
                ? quickTags
                : chosenTask?.tags?.length
                  ? chosenTask.tags
                  : undefined;

        if (showPlanLimit && draftPlanEvaluation.hasLimit) {
            if ("error" in draftPlanEvaluation && draftPlanEvaluation.error)
                return;
            if (draftPlanEvaluation.hardStopPassed) return;
            const planPayload = {
                title,
                categoryId,
                taskUuid: chosenTask?.uuid,
                projectSnapshot: resolvedProject,
                tags: resolvedTags,
                allowanceSeconds: draftPlanEvaluation.allowanceSeconds,
                plannedStartAtMs: draftPlanEvaluation.plannedStartAtMs,
                hardStopAtMs: draftPlanEvaluation.hardStopAtMs,
            };
            if (mode === "save_plan") {
                const res = await runMutation(`保存安排：${title}`, () =>
                    createTimingPlan(planPayload),
                );
                if (res) {
                    setQuickTitle("");
                    setQuickTaskUuid("none");
                    setQuickProject("");
                    setQuickTags([]);
                    setQuickIsSleep(false);
                    setShowPlanLimit(false);
                }
                return;
            }
            const res = await runMutation(
                `开始：${title}`,
                async () => {
                    const created = await createTimingPlan(planPayload);
                    return startTimingPlan({
                        planId: created.plan.id,
                        expectedSessionVersion: status?.sessionVersion,
                    });
                },
                { undoable: true },
            );
            if (res) {
                setQuickTitle("");
                setQuickTaskUuid("none");
                setQuickProject("");
                setQuickTags([]);
                setQuickIsSleep(false);
                setShowPlanLimit(false);
            }
            return;
        }

        const res = await runMutation(
            `开始：${title}`,
            () =>
                startTimeActivity({
                    title,
                    explicitCategoryId: categoryId,
                    taskUuid: chosenTask?.uuid,
                    projectSnapshot: resolvedProject,
                    tags: resolvedTags,
                    expectedSessionVersion: status?.sessionVersion,
                }),
            { undoable: true },
        );
        if (res) {
            setQuickTitle("");
            setQuickTaskUuid("none");
            setQuickProject("");
            setQuickTags([]);
            setQuickIsSleep(false);
        }
    }

    function openPlanExtend(plan: TimingPlan) {
        const hasFutureHardStop =
            plan.hardStopAtMs !== undefined && plan.hardStopAtMs > Date.now();
        setExtendingPlan({
            planId: plan.id,
            extraMin: "15",
            hardStopTime:
                plan.hardStopAtMs !== undefined
                    ? formatClockInZone(
                          hasFutureHardStop
                              ? plan.hardStopAtMs
                              : Date.now() + 30 * 60_000,
                          timeZone,
                      )
                    : "",
        });
    }

    async function submitPlanExtend(plan: TimingPlan, startAfter: boolean) {
        if (!extendingPlan || extendingPlan.planId !== plan.id) return;
        const extraNum = extendingPlan.extraMin.trim()
            ? Number(extendingPlan.extraMin.trim())
            : 0;
        const nextHardStopMs = extendingPlan.hardStopTime.trim()
            ? zonedDateTimeToUtcMs(
                  todayStr,
                  extendingPlan.hardStopTime.trim(),
                  timeZone,
              )
            : undefined;
        const res = await runMutation(
            startAfter
                ? `加时并继续：${plan.title}`
                : `重新安排：${plan.title}`,
            async () => {
                const updated = await updateTimingPlan({
                    planId: plan.id,
                    expectedVersion: plan.version,
                    expectedSessionVersion: status?.sessionVersion,
                    ...(Number.isFinite(extraNum) && extraNum > 0
                        ? { addAllowanceMinutes: extraNum }
                        : {}),
                    ...(nextHardStopMs !== undefined
                        ? { hardStopAtMs: nextHardStopMs }
                        : {}),
                });
                const relatedEvents = events
                    .filter((ev) => ev.planId === plan.id)
                    .map((ev) => ev.id);
                if (relatedEvents.length > 0) {
                    await onAckEvents(relatedEvents);
                }
                if (startAfter) {
                    return startTimingPlan({
                        planId: updated.plan.id,
                        expectedSessionVersion: updated.sessionVersion,
                    });
                }
                return updated;
            },
            { undoable: startAfter },
        );
        if (res) setExtendingPlan(null);
    }

    const canStart =
        Boolean(quickTitle.trim() || quickTaskUuid !== "none") &&
        !(
            showPlanLimit &&
            draftPlanEvaluation.hasLimit &&
            ("error" in draftPlanEvaluation ||
                draftPlanEvaluation.hardStopPassed)
        );

    async function submitInDialog(
        label: string,
        fn: () => Promise<TimeReceipt>,
    ): Promise<string | null> {
        let capturedError: string | null = null;
        const ok = await runMutation(label, fn, {
            undoable: true,
            onError: (msg) => {
                capturedError = msg;
            },
        });
        if (ok) return null;
        return capturedError ?? "保存失败，请检查输入后重试。";
    }

    return (
        <div className="space-y-9">
            {/* Top quiet date & coverage bar */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="前一天"
                        className="text-muted-foreground"
                        onClick={() =>
                            onSelectDate(addLocalDays(selectedDate, -1))
                        }
                    >
                        <ChevronLeft className="size-3.5" />
                    </Button>
                    <Input
                        type="date"
                        aria-label="选择日期"
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
                        aria-label="后一天"
                        className="text-muted-foreground"
                        onClick={() =>
                            onSelectDate(addLocalDays(selectedDate, 1))
                        }
                    >
                        <ChevronRight className="size-3.5" />
                    </Button>
                    {selectedDate !== todayStr && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="ml-1 h-6 px-2 text-xs text-muted-foreground"
                            onClick={() => onSelectDate(todayStr)}
                        >
                            回到今天
                        </Button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span
                        className="tabular-nums"
                        title={`已定位 ${formatDurationChinese(daily.coveredSeconds)}${(daily.provisionalSeconds ?? 0) > 0 ? ` · 待核对 ${formatDurationChinese(daily.provisionalSeconds ?? 0)}` : ""} · 空白 ${formatDurationChinese(daily.unrecordedSeconds)} · 容量 ${formatDurationChinese(daily.pastCapacitySeconds)}`}
                    >
                        已记{" "}
                        <span className="text-foreground">
                            {formatDurationCompact(daily.coveredSeconds)}
                        </span>
                        {daily.confirmedCostCents > 0 && (
                            <span className="ml-1.5 text-foreground font-medium">
                                {formatCurrencyCny(daily.confirmedCostCents)}
                            </span>
                        )}
                        {(daily.provisionalSeconds ?? 0) > 0 && (
                            <>
                                <span className="mx-1.5 opacity-40">·</span>
                                <span className="text-amber-600 dark:text-amber-400">
                                    待核对{" "}
                                    {formatDurationCompact(
                                        daily.provisionalSeconds ?? 0,
                                    )}
                                    {daily.provisionalCostCents > 0
                                        ? ` (${formatCurrencyCny(daily.provisionalCostCents)})`
                                        : ""}
                                </span>
                            </>
                        )}
                        <span className="mx-1.5 opacity-40">·</span>
                        空白 {formatDurationCompact(daily.unrecordedSeconds)}
                        {daily.unlocatedEstimates.length > 0 && (
                            <>
                                <span className="mx-1.5 opacity-40">·</span>
                                待定位 {daily.unlocatedEstimates.length}
                            </>
                        )}
                    </span>

                    <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                        disabled={busy}
                        onClick={() =>
                            setLogDialogSeed({
                                mode: "log",
                                date: selectedDate,
                                startTime: "19:00",
                                endTime: "20:00",
                                estimatedMinutes: "60",
                            })
                        }
                    >
                        <Plus className="size-3.5" />
                        补记
                    </Button>
                </div>
            </div>

            {/* Pending reconcile notice (quiet left rule, shown only when needed) */}
            {pendingDetails.length > 0 && (
                <section className="space-y-3 border-l-2 border-amber-500/70 pl-4 py-0.5">
                    <div className="text-xs font-medium text-foreground">
                        {pendingDetails.length} 笔跨系统计时操作待确认
                    </div>
                    <div className="space-y-2">
                        {pendingDetails.map((op) => (
                            <div
                                key={op.operationId}
                                className="flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                                <span className="text-muted-foreground">
                                    {op.kind} · {op.operationId.slice(0, 8)}
                                    {op.suggestionHint
                                        ? ` — ${op.suggestionHint}`
                                        : ""}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    {op.kind === "task_start" ? (
                                        <Button
                                            type="button"
                                            size="xs"
                                            disabled={busy}
                                            onClick={() =>
                                                void runMutation(
                                                    "确认任务已开始并补记计时",
                                                    () =>
                                                        resolveTimeOperation({
                                                            operationId:
                                                                op.operationId,
                                                            action: "accept_started",
                                                        }),
                                                )
                                            }
                                        >
                                            按已开始确认
                                        </Button>
                                    ) : (
                                        <Button
                                            type="button"
                                            size="xs"
                                            disabled={busy}
                                            onClick={() =>
                                                void runMutation(
                                                    "确认结束关联活动计时",
                                                    () =>
                                                        resolveTimeOperation({
                                                            operationId:
                                                                op.operationId,
                                                            action: "stop_active",
                                                        }),
                                                )
                                            }
                                        >
                                            停止关联计时
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() =>
                                            void runMutation(
                                                "已按放弃处理",
                                                () =>
                                                    resolveTimeOperation({
                                                        operationId:
                                                            op.operationId,
                                                        action: "dismiss",
                                                    }),
                                            )
                                        }
                                    >
                                        忽略
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Unacknowledged Auto-stop / Checkpoint Events */}
            {events.length > 0 && (
                <section className="space-y-2.5 border-l-2 border-foreground/30 pl-4 py-0.5">
                    {events.map((ev) => {
                        const seg = ev.activityId
                            ? daily.locatedSegments.find(
                                  (s) => s.activityId === ev.activityId,
                              )
                            : undefined;
                        const linkedPlan =
                            plans.find(
                                (p) =>
                                    p.id === (ev.planId ?? seg?.timingPlanId),
                            ) ?? undefined;
                        const isAutoStopped = ev.kind === "auto_stopped";
                        const isCheckpointDue = ev.kind === "checkpoint_due";

                        return (
                            <div
                                key={ev.id}
                                className="flex flex-wrap items-center justify-between gap-3 text-xs"
                            >
                                <div className="min-w-0 space-y-0.5">
                                    <p className="text-foreground">
                                        {isAutoStopped && seg
                                            ? `已自动停止 · ${ev.title} · 本段记录 ${formatDurationChinese(seg.durationSeconds)}，暂计 ${formatCurrencyCny(
                                                  seg.provisionalCostCents > 0
                                                      ? seg.provisionalCostCents
                                                      : computeDurationCostCents(
                                                            seg.durationSeconds,
                                                            seg.hourlyRateCents ??
                                                                policyRateCents,
                                                        ),
                                              )}`
                                            : ev.message || ev.title}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {isAutoStopped &&
                                        seg &&
                                        seg.reviewState ===
                                            "review_required" && (
                                            <>
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="outline"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void runMutation(
                                                            `已确认：${seg.title}`,
                                                            async () => {
                                                                const receipt =
                                                                    await confirmTimeActivity(
                                                                        {
                                                                            activityId:
                                                                                seg.activityId,
                                                                            expectedVersion:
                                                                                seg.version,
                                                                        },
                                                                    );
                                                                await onAckEvents(
                                                                    [ev.id],
                                                                );
                                                                return receipt;
                                                            },
                                                            { undoable: true },
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
                                                    disabled={busy}
                                                    onClick={() =>
                                                        setEditingSegment(seg)
                                                    }
                                                >
                                                    修正时间
                                                </Button>
                                            </>
                                        )}
                                    {isAutoStopped && linkedPlan && (
                                        <Button
                                            type="button"
                                            size="xs"
                                            variant="ghost"
                                            disabled={busy}
                                            onClick={() =>
                                                openPlanExtend(linkedPlan)
                                            }
                                        >
                                            增加时间并继续
                                        </Button>
                                    )}
                                    {isCheckpointDue &&
                                        active &&
                                        active.id === ev.activityId && (
                                            <Button
                                                type="button"
                                                size="xs"
                                                variant="outline"
                                                disabled={busy}
                                                onClick={() =>
                                                    void runMutation(
                                                        `已确认此刻：${active.title}`,
                                                        async () => {
                                                            const receipt =
                                                                await confirmTimeActivity(
                                                                    {
                                                                        activityId:
                                                                            active.id,
                                                                        expectedVersion:
                                                                            active.version,
                                                                        throughMs:
                                                                            Date.now(),
                                                                    },
                                                                );
                                                            await onAckEvents([
                                                                ev.id,
                                                            ]);
                                                            return receipt;
                                                        },
                                                    )
                                                }
                                            >
                                                <Check className="size-3" />
                                                确认这段
                                            </Button>
                                        )}
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="ghost"
                                        className="text-muted-foreground"
                                        disabled={busy}
                                        onClick={() =>
                                            void onAckEvents([ev.id])
                                        }
                                    >
                                        知道了
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </section>
            )}

            {/* Now: Active Timer & Single-line Quick Capture */}
            <section className="space-y-5">
                {active && (
                    <div className="space-y-2 border-l-2 border-primary/80 pl-4 py-1">
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="truncate text-[15px] font-medium text-foreground">
                                        {active.title}
                                    </span>
                                    {active.projectSnapshot && (
                                        <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                            {active.projectSnapshot}
                                        </span>
                                    )}
                                    {active.tags?.map((tag) => (
                                        <span
                                            key={tag}
                                            className="text-[11px] text-muted-foreground/80"
                                        >
                                            #{tag}
                                        </span>
                                    ))}
                                    {active.categoryId === "sleep" && (
                                        <span className="text-[11px] text-muted-foreground">
                                            睡眠（¥0）
                                        </span>
                                    )}
                                    {active.reviewState ===
                                        "review_required" && (
                                        <span className="text-[11px] text-amber-600 dark:text-amber-400">
                                            待核对
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
                                    {active.startMs !== undefined && (
                                        <span>
                                            {formatClockInZone(
                                                active.startMs,
                                                timeZone,
                                            )}{" "}
                                            开始
                                        </span>
                                    )}
                                    {activeElapsedSec !== undefined && (
                                        <span>
                                            ·{" "}
                                            {formatDurationChinese(
                                                activeElapsedSec,
                                            )}
                                            {activeRateCents > 0
                                                ? ` · 暂计 ${formatCurrencyCny(activeProvisionalCostCents)}`
                                                : ""}
                                        </span>
                                    )}
                                    {active.autoStopAtMs !== undefined &&
                                        activeRemainingStopSec !==
                                            undefined && (
                                            <span className="text-foreground/80">
                                                ·{" "}
                                                {activeRemainingStopSec <= 0
                                                    ? "已到停止时刻"
                                                    : `剩余 ${Math.max(1, Math.ceil(activeRemainingStopSec / 60))} 分钟`}{" "}
                                                ·{" "}
                                                {formatClockInZone(
                                                    active.autoStopAtMs,
                                                    timeZone,
                                                )}{" "}
                                                停止
                                            </span>
                                        )}
                                    {timerSnapshot?.state === "restoring" && (
                                        <span>· 恢复中（暂停外推）</span>
                                    )}
                                    {timerLiveStatus?.expired && (
                                        <span>· 快照已过期</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                                {active.timingPlanId && (
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="ghost"
                                        className="gap-1 text-muted-foreground"
                                        disabled={busy}
                                        onClick={() =>
                                            void runMutation(
                                                `暂停：${active.title}`,
                                                () =>
                                                    stopTimeActivity({
                                                        expectedActivityId:
                                                            active.id,
                                                        expectedVersion:
                                                            active.version,
                                                        expectedSessionVersion:
                                                            status?.sessionVersion,
                                                        pause: true,
                                                    }),
                                                { undoable: true },
                                            )
                                        }
                                    >
                                        <Pause className="size-3" />
                                        暂停
                                    </Button>
                                )}
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    className="shrink-0 gap-1.5"
                                    disabled={busy}
                                    onClick={() =>
                                        void runMutation(
                                            `结束：${active.title}`,
                                            () =>
                                                stopTimeActivity({
                                                    expectedActivityId:
                                                        active.id,
                                                    expectedVersion:
                                                        active.version,
                                                    expectedSessionVersion:
                                                        status?.sessionVersion,
                                                }),
                                            { undoable: true },
                                        )
                                    }
                                >
                                    <Square className="size-2.5 fill-current" />
                                    结束
                                </Button>
                            </div>
                        </div>
                        {longActivityAlert && (
                            <div className="flex flex-wrap items-center gap-3 text-xs text-amber-600/90 dark:text-amber-400/90">
                                <span>
                                    已持续超过 {thresholdMinutesLabel}{" "}
                                    分钟，若早已结束请在时间线修正；如仍在进行可确认至此。
                                </span>
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs text-amber-700 hover:text-amber-800 dark:text-amber-300"
                                    disabled={busy}
                                    onClick={() =>
                                        void runMutation(
                                            `确认仍在进行：${active.title}`,
                                            () =>
                                                confirmTimeActivity({
                                                    activityId: active.id,
                                                    expectedVersion:
                                                        active.version,
                                                    throughMs: Date.now(),
                                                }),
                                        )
                                    }
                                >
                                    确认至此
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                <form
                    onSubmit={(e) => void handleQuickStart(e, "start")}
                    className="time-quick-entry space-y-2 border-b border-border/60 pb-3 transition-colors focus-within:border-foreground/35"
                >
                    <div className="time-quick-main">
                        <input
                            type="text"
                            className="time-quick-title"
                            aria-label="活动名称"
                            title="输入活动名称，按回车开始计时"
                            placeholder={
                                active
                                    ? "切换到新活动…"
                                    : "现在开始做什么…"
                            }
                            value={quickTitle}
                            onChange={(e) => setQuickTitle(e.target.value)}
                        />
                        <Button type="submit" size="sm" variant={canStart ? "default" : "ghost"}
                            className="time-quick-start" disabled={busy || !canStart}
                            title={draftPlanEvaluation.predictedStopAtNow ? `预计 ${formatClockInZone(draftPlanEvaluation.predictedStopAtNow, timeZone)} 自动停止` : undefined}>
                            <Play className="size-3.5" />{active ? "切换" : "开始"}
                        </Button>
                    </div>
                    <div className="time-quick-controls">
                            <Select
                                value={quickTaskUuid}
                                onValueChange={handleQuickTaskChange}
                            >
                                <SelectTrigger
                                    className="h-8 min-w-0 max-w-[180px] gap-1 border-0 bg-transparent dark:bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0"
                                    aria-label="关联任务"
                                >
                                    <SelectValue placeholder="关联任务" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">
                                        独立活动
                                    </SelectItem>
                                    {pendingTasks.slice(0, 50).map((task) => (
                                        <SelectItem
                                            key={task.uuid}
                                            value={task.uuid}
                                        >
                                            {task.description}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                aria-expanded={showPlanLimit}
                                className={
                                    showPlanLimit
                                        ? "gap-1 text-foreground"
                                        : "gap-1 text-muted-foreground hover:text-foreground"
                                }
                                onClick={() => setShowPlanLimit((v) => !v)}
                            >
                                <Clock className="size-3" />
                                定时限制
                            </Button>
                            {showPlanLimit && draftPlanEvaluation.hasLimit && (
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    disabled={
                                        busy ||
                                        !Boolean(
                                            quickTitle.trim() ||
                                            quickTaskUuid !== "none",
                                        ) ||
                                        Boolean(
                                            "error" in draftPlanEvaluation &&
                                            draftPlanEvaluation.error,
                                        ) ||
                                        Boolean(
                                            draftPlanEvaluation.hardStopPassed,
                                        )
                                    }
                                    onClick={(e) =>
                                        void handleQuickStart(e, "save_plan")
                                    }
                                >
                                    存为安排
                                </Button>
                            )}

                        </div>
                    <ProjectTagFields
                        compact
                        idPrefix="today-quick"
                        project={quickProject}
                        onProjectChange={setQuickProject}
                        tags={quickTags}
                        onTagsChange={setQuickTags}
                        availableProjects={availableProjects}
                        availableTags={availableTags}
                        isSleep={quickIsSleep}
                        onSleepChange={setQuickIsSleep}
                    />

                    {showPlanLimit && (
                        <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-muted-foreground">
                            <label className="flex items-center gap-1.5">
                                <span>预计用时</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={1440}
                                    className="h-6 w-14 border-b border-border/60 bg-transparent text-center text-foreground tabular-nums outline-none focus:border-foreground/50"
                                    value={planAllowanceMin}
                                    onChange={(e) =>
                                        setPlanAllowanceMin(e.target.value)
                                    }
                                />
                                <span>分钟</span>
                            </label>
                            <label className="flex items-center gap-1.5">
                                <span>计划开始</span>
                                <input
                                    type="time"
                                    className="h-6 border-b border-border/60 bg-transparent text-foreground tabular-nums outline-none focus:border-foreground/50"
                                    value={planPlannedStart}
                                    onChange={(e) =>
                                        setPlanPlannedStart(e.target.value)
                                    }
                                />
                            </label>
                            <label className="flex items-center gap-1.5">
                                <span>最晚停止</span>
                                <input
                                    type="time"
                                    className="h-6 border-b border-border/60 bg-transparent text-foreground tabular-nums outline-none focus:border-foreground/50"
                                    value={planHardStop}
                                    onChange={(e) =>
                                        setPlanHardStop(e.target.value)
                                    }
                                />
                            </label>
                            {draftPlanEvaluation.hasLimit &&
                                !("error" in draftPlanEvaluation) &&
                                draftPlanEvaluation.allowanceSeconds !==
                                    undefined && (
                                    <span className="font-medium text-foreground tabular-nums">
                                        预计投入{" "}
                                        {formatDurationChinese(
                                            draftPlanEvaluation.allowanceSeconds,
                                        )}{" "}
                                        ·{" "}
                                        {formatCurrencyCny(
                                            computeDurationCostCents(
                                                draftPlanEvaluation.allowanceSeconds,
                                                quickIsSleep
                                                    ? 0
                                                    : policyRateCents,
                                            ),
                                        )}
                                    </span>
                                )}
                            {draftPlanEvaluation.hasLimit &&
                                ("error" in draftPlanEvaluation &&
                                draftPlanEvaluation.error ? (
                                    <span className="text-destructive">
                                        {draftPlanEvaluation.error}
                                    </span>
                                ) : draftPlanEvaluation.hardStopPassed ? (
                                    <span className="text-destructive">
                                        最晚停止时刻已过
                                    </span>
                                ) : draftPlanEvaluation.predictedStopAtPlan ? (
                                    <span className="text-muted-foreground/80 tabular-nums">
                                        若按计划开始 · 预计{" "}
                                        {formatClockInZone(
                                            draftPlanEvaluation.predictedStopAtPlan,
                                            timeZone,
                                        )}{" "}
                                        自动停止
                                    </span>
                                ) : null)}
                        </div>
                    )}
                </form>

                {/* Quiet Timing Plans (Manual Start -> Auto-stop) */}
                {visiblePlans.length > 0 && (
                    <div className="space-y-1">
                        {visiblePlans.map((plan) => {
                            const predictedStop = computePredictedStopMs(
                                nowMs,
                                plan.remainingSeconds,
                                plan.hardStopAtMs,
                            );
                            const isExtending =
                                extendingPlan?.planId === plan.id;
                            const canStartPlan =
                                (plan.status === "scheduled" ||
                                    plan.status === "paused") &&
                                (plan.remainingSeconds === undefined ||
                                    plan.remainingSeconds > 0);
                            const planRateCents = normalizeHourlyRateCents(
                                plan.hourlyRateCents,
                                plan.categoryId === "sleep"
                                    ? 0
                                    : policyRateCents,
                            );
                            const planStartCostCents =
                                plan.remainingSeconds !== undefined
                                    ? computeDurationCostCents(
                                          plan.remainingSeconds,
                                          planRateCents,
                                      )
                                    : plan.currentBudgetCents;
                            let extendingHardStopMs = plan.hardStopAtMs;
                            if (
                                isExtending &&
                                extendingPlan?.hardStopTime.trim()
                            ) {
                                try {
                                    extendingHardStopMs = zonedDateTimeToUtcMs(
                                        todayStr,
                                        extendingPlan.hardStopTime.trim(),
                                        timeZone,
                                    );
                                } catch {
                                    extendingHardStopMs = plan.hardStopAtMs;
                                }
                            }
                            const extendMinutesNum =
                                isExtending && extendingPlan
                                    ? Number(extendingPlan.extraMin) || 0
                                    : 0;
                            const continuationPreview = isExtending
                                ? computeContinuationCostPreview({
                                      requestedSeconds:
                                          (plan.remainingSeconds ?? 0) +
                                          Math.max(
                                              0,
                                              Math.round(extendMinutesNum * 60),
                                          ),
                                      hourlyRateCents: planRateCents,
                                      hardStopAtMs: extendingHardStopMs,
                                      nowMs,
                                  })
                                : null;
                            return (
                                <div
                                    key={plan.id}
                                    className="border-b border-border/35 py-2.5 text-xs space-y-2"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                            <span className="truncate text-[13px] font-medium text-foreground">
                                                {plan.title}
                                            </span>
                                            {plan.projectSnapshot && (
                                                <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                                    {plan.projectSnapshot}
                                                </span>
                                            )}
                                            {plan.tags?.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="text-[11px] text-muted-foreground/75"
                                                >
                                                    #{tag}
                                                </span>
                                            ))}
                                            {plan.categoryId === "sleep" && (
                                                <span className="text-muted-foreground/75">
                                                    睡眠（¥0）
                                                </span>
                                            )}
                                            <span className="text-muted-foreground tabular-nums">
                                                {plan.allowanceSeconds !==
                                                    undefined && (
                                                    <>
                                                        {plan.consumedSeconds >
                                                        0
                                                            ? `已用 ${formatDurationCompact(plan.consumedSeconds)} / 剩 ${formatDurationCompact(plan.remainingSeconds ?? 0)}`
                                                            : `预计 ${formatDurationCompact(plan.allowanceSeconds)}`}
                                                    </>
                                                )}
                                                {plan.currentBudgetCents !==
                                                    undefined && (
                                                    <>
                                                        {" "}
                                                        · 预算{" "}
                                                        {formatCurrencyCny(
                                                            plan.currentBudgetCents,
                                                        )}
                                                    </>
                                                )}
                                                {plan.initialBudgetCents !==
                                                    undefined &&
                                                    plan.currentBudgetCents !==
                                                        undefined &&
                                                    plan.currentBudgetCents >
                                                        plan.initialBudgetCents && (
                                                        <span className="text-amber-600 dark:text-amber-400">
                                                            {" "}
                                                            (最初{" "}
                                                            {formatCurrencyCny(
                                                                plan.initialBudgetCents,
                                                            )}
                                                            )
                                                        </span>
                                                    )}
                                                {plan.plannedStartAtMs !==
                                                    undefined && (
                                                    <>
                                                        {" "}
                                                        · 计划{" "}
                                                        {formatClockInZone(
                                                            plan.plannedStartAtMs,
                                                            timeZone,
                                                        )}
                                                    </>
                                                )}
                                                {plan.hardStopAtMs !==
                                                    undefined && (
                                                    <>
                                                        {" "}
                                                        · 最晚{" "}
                                                        {formatClockInZone(
                                                            plan.hardStopAtMs,
                                                            timeZone,
                                                        )}{" "}
                                                        停止
                                                    </>
                                                )}
                                            </span>
                                            {plan.status === "expired" && (
                                                <span className="text-amber-600 dark:text-amber-400">
                                                    原安排已过期
                                                </span>
                                            )}
                                            {plan.status === "stopped" &&
                                                (plan.remainingSeconds ?? 0) ===
                                                    0 && (
                                                    <span className="text-muted-foreground">
                                                        时长已用完
                                                    </span>
                                                )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {canStartPlan && (
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="outline"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void runMutation(
                                                            `开始：${plan.title}`,
                                                            () =>
                                                                startTimingPlan(
                                                                    {
                                                                        planId: plan.id,
                                                                        expectedSessionVersion:
                                                                            status?.sessionVersion,
                                                                    },
                                                                ),
                                                            { undoable: true },
                                                        )
                                                    }
                                                >
                                                    <Play className="size-3" />
                                                    {plan.status === "paused"
                                                        ? "继续"
                                                        : "开始"}
                                                    {predictedStop !== undefined
                                                        ? ` · 预计 ${formatClockInZone(predictedStop, timeZone)} 自动停止`
                                                        : ""}
                                                    {planStartCostCents !==
                                                        undefined &&
                                                    planStartCostCents > 0
                                                        ? ` · 预计 ${formatCurrencyCny(planStartCostCents)}`
                                                        : ""}
                                                </Button>
                                            )}
                                            <Button
                                                type="button"
                                                size="xs"
                                                variant="ghost"
                                                disabled={busy}
                                                onClick={() =>
                                                    isExtending
                                                        ? setExtendingPlan(null)
                                                        : openPlanExtend(plan)
                                                }
                                            >
                                                {plan.status === "expired"
                                                    ? "重新安排"
                                                    : "调整 / 加时"}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="xs"
                                                variant="ghost"
                                                className="text-muted-foreground"
                                                disabled={busy}
                                                onClick={() =>
                                                    void runMutation(
                                                        `归档安排：${plan.title}`,
                                                        () =>
                                                            updateTimingPlan({
                                                                planId: plan.id,
                                                                expectedVersion:
                                                                    plan.version,
                                                                archived: true,
                                                            }),
                                                    )
                                                }
                                            >
                                                归档
                                            </Button>
                                        </div>
                                    </div>
                                    {isExtending && extendingPlan && (
                                        <div className="space-y-1.5 pl-1 pt-0.5 text-xs text-muted-foreground">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <label className="flex items-center gap-1">
                                                    <span>增加</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={720}
                                                        className="h-6 w-12 border-b border-border/60 bg-transparent text-center text-foreground tabular-nums outline-none"
                                                        value={
                                                            extendingPlan.extraMin
                                                        }
                                                        onChange={(e) =>
                                                            setExtendingPlan({
                                                                ...extendingPlan,
                                                                extraMin:
                                                                    e.target
                                                                        .value,
                                                            })
                                                        }
                                                    />
                                                    <span>分钟</span>
                                                </label>
                                                <label className="flex items-center gap-1">
                                                    <span>最晚停止</span>
                                                    <input
                                                        type="time"
                                                        className="h-6 border-b border-border/60 bg-transparent text-foreground tabular-nums outline-none"
                                                        value={
                                                            extendingPlan.hardStopTime
                                                        }
                                                        onChange={(e) =>
                                                            setExtendingPlan({
                                                                ...extendingPlan,
                                                                hardStopTime:
                                                                    e.target
                                                                        .value,
                                                            })
                                                        }
                                                    />
                                                </label>
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="ghost"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void submitPlanExtend(
                                                            plan,
                                                            false,
                                                        )
                                                    }
                                                >
                                                    仅保存
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="outline"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void submitPlanExtend(
                                                            plan,
                                                            true,
                                                        )
                                                    }
                                                >
                                                    加时并继续
                                                </Button>
                                            </div>
                                            {continuationPreview && (
                                                <div className="tabular-nums">
                                                    {continuationPreview.expired ? (
                                                        <span className="text-destructive">
                                                            最晚结束时刻已过，请调整最晚停止后再继续。
                                                        </span>
                                                    ) : continuationPreview.cappedByHardStop ? (
                                                        <span className="text-amber-600 dark:text-amber-400">
                                                            受最晚结束限制，最多可继续{" "}
                                                            {formatDurationChinese(
                                                                continuationPreview.effectiveSeconds,
                                                            )}
                                                            ，预计增加{" "}
                                                            {formatCurrencyCny(
                                                                continuationPreview.additionalCostCents,
                                                            )}
                                                            。
                                                        </span>
                                                    ) : continuationPreview.effectiveSeconds >
                                                      0 ? (
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
                                                            。
                                                        </span>
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Quiet Sleep Candidate Prompt */}
            {pendingSleepCandidates.length > 0 && (
                <section className="space-y-2">
                    {pendingSleepCandidates.map((cand) => (
                        <div
                            key={cand.key}
                            className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 py-2.5 text-xs"
                        >
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Moon className="size-3.5 text-muted-foreground/70" />
                                <span>
                                    作息候选 ·{" "}
                                    <span className="text-foreground">
                                        {formatTimeRangeInZone(
                                            cand.startMs,
                                            cand.endMs,
                                            timeZone,
                                        )}
                                    </span>
                                </span>
                                {cand.hasConflict && (
                                    <span className="text-amber-600 dark:text-amber-400">
                                        （与已有记录重叠）
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    className="text-muted-foreground"
                                    disabled={busy}
                                    onClick={() =>
                                        void runMutation(
                                            "已跳过本日作息候选",
                                            () =>
                                                dismissSleepCandidate(
                                                    cand.date,
                                                ),
                                        )
                                    }
                                >
                                    跳过
                                </Button>
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    disabled={busy || cand.hasConflict}
                                    onClick={() =>
                                        void runMutation(
                                            "已确认睡眠照常",
                                            () =>
                                                confirmSleepCandidate(
                                                    cand.date,
                                                ),
                                            { undoable: true },
                                        )
                                    }
                                >
                                    照常
                                </Button>
                            </div>
                        </div>
                    ))}
                </section>
            )}

            {/* Chronological Minimal Timeline */}
            <section>
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <h2 className="text-xs font-medium text-muted-foreground">
                        时间线
                    </h2>
                    <span className="text-xs text-muted-foreground/70 tabular-nums">
                        {daily.locatedSegments.length} 段记录
                    </span>
                </div>

                {timelineItems.length === 0 ? (
                    <p className="py-10 text-xs text-muted-foreground/65">
                        这一天还没有已定位记录。可以直接在上方开始计时，或点右上角补记。
                    </p>
                ) : (
                    <div className="relative mt-4 before:absolute before:inset-y-0 before:left-[104px] before:border-l before:border-border/70 max-sm:before:left-1">
                        {timelineItems.map((item) =>
                            item.kind === "gap" ? (
                                <div
                                    key={`gap-${item.gap.startMs}`}
                                    className="group relative flex flex-wrap items-center justify-between gap-3 py-3 text-xs text-muted-foreground/50 before:absolute before:left-[101px] before:top-4 before:size-[7px] before:rounded-full before:border before:border-border before:bg-background max-sm:pl-5 max-sm:before:left-px"
                                >
                                    <div className="flex min-w-0 items-center gap-6 max-sm:flex-wrap max-sm:gap-2">
                                        <span className="w-[96px] shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums max-sm:w-full">
                                            {formatClockInZone(
                                                item.gap.startMs,
                                                timeZone,
                                            )}{" "}
                                            –{" "}
                                            {formatClockInZone(
                                                item.gap.endMs,
                                                timeZone,
                                            )}
                                        </span>
                                        <span className="truncate">
                                            未记录空白 ·{" "}
                                            {formatDurationChinese(
                                                item.gap.durationSeconds,
                                            )}
                                        </span>
                                    </div>
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="ghost"
                                        className="h-6 px-2 text-xs md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                                        disabled={busy}
                                        onClick={() => {
                                            const gapEndDate = localDateOf(
                                                item.gap.endMs,
                                                timeZone,
                                            );
                                            const endIsSameDay =
                                                gapEndDate === selectedDate;
                                            const endTime = endIsSameDay
                                                ? formatClockInZone(
                                                      item.gap.endMs,
                                                      timeZone,
                                                  )
                                                : "23:59";
                                            setLogDialogSeed({
                                                mode: "log",
                                                date: selectedDate,
                                                startTime: formatClockInZone(
                                                    item.gap.startMs,
                                                    timeZone,
                                                ),
                                                endTime,
                                                estimatedMinutes: String(
                                                    Math.max(
                                                        1,
                                                        Math.round(
                                                            item.gap
                                                                .durationSeconds /
                                                                60,
                                                        ),
                                                    ),
                                                ),
                                                exactStartMs: item.gap.startMs,
                                                ...(endIsSameDay
                                                    ? {
                                                          exactEndMs:
                                                              item.gap.endMs,
                                                      }
                                                    : {}),
                                            });
                                        }}
                                    >
                                        + 补记
                                    </Button>
                                </div>
                            ) : (
                                <div
                                    key={`seg-${item.segment.activityId}-${item.segment.startMs}`}
                                    className="group relative flex flex-wrap items-center justify-between gap-3 py-4 before:absolute before:left-[101px] before:top-5 before:size-[7px] before:rounded-full before:bg-muted-foreground max-sm:pl-5 max-sm:before:left-px"
                                >
                                    <div className="flex min-w-0 flex-1 items-baseline gap-6 max-sm:basis-full max-sm:flex-wrap max-sm:gap-2">
                                        <span className="w-[96px] shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground/80 tabular-nums max-sm:w-full">
                                            {formatClockInZone(
                                                item.segment.startMs,
                                                timeZone,
                                            )}{" "}
                                            –{" "}
                                            {item.segment.running
                                                ? "进行中"
                                                : formatClockInZone(
                                                      item.segment.endMs,
                                                      timeZone,
                                                  )}
                                        </span>
                                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                            <span className="truncate text-[14px] text-foreground">
                                                {item.segment.title}
                                            </span>
                                            {item.segment.projectSnapshot && (
                                                <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                                    {
                                                        item.segment
                                                            .projectSnapshot
                                                    }
                                                </span>
                                            )}
                                            {item.segment.tags?.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="text-[11px] text-muted-foreground/75"
                                                >
                                                    #{tag}
                                                </span>
                                            ))}
                                            {item.segment.categoryId ===
                                                "sleep" && (
                                                <span className="text-[11px] text-muted-foreground/75">
                                                    睡眠（¥0）
                                                </span>
                                            )}
                                            {item.segment.precision ===
                                                "estimated_bounds" && (
                                                <span className="text-[11px] text-muted-foreground/65">
                                                    约
                                                </span>
                                            )}
                                            {(item.segment
                                                .exceededPlanSeconds ?? 0) >
                                                0 && (
                                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                                    超出 +
                                                    {formatDurationCompact(
                                                        item.segment
                                                            .exceededPlanSeconds ??
                                                            0,
                                                    )}
                                                </span>
                                            )}
                                            {item.segment.reviewState ===
                                                "review_required" && (
                                                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                                                    {item.segment
                                                        .reviewReason ===
                                                    "auto_stopped"
                                                        ? `已自动停止 · 本段记录 ${formatDurationCompact(item.segment.durationSeconds)}，暂计 ${formatCurrencyCny(item.segment.provisionalCostCents)} · 待核对`
                                                        : `待核对${item.segment.provisionalCostCents > 0 ? ` (${formatCurrencyCny(item.segment.provisionalCostCents)})` : ""}`}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        {item.segment.reviewState ===
                                            "review_required" &&
                                            !item.segment.running && (
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="ghost"
                                                    className="h-6 px-2 text-xs text-foreground"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void runMutation(
                                                            `已确认：${item.segment.title}`,
                                                            () =>
                                                                confirmTimeActivity(
                                                                    {
                                                                        activityId:
                                                                            item
                                                                                .segment
                                                                                .activityId,
                                                                        expectedVersion:
                                                                            item
                                                                                .segment
                                                                                .version,
                                                                    },
                                                                ),
                                                            { undoable: true },
                                                        )
                                                    }
                                                >
                                                    确认时间
                                                </Button>
                                            )}
                                        {item.segment.reviewReason ===
                                            "auto_stopped" &&
                                            item.segment.timingPlanId && (
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="ghost"
                                                    className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                                                    disabled={busy}
                                                    onClick={() => {
                                                        const linked =
                                                            plans.find(
                                                                (p) =>
                                                                    p.id ===
                                                                    item.segment
                                                                        .timingPlanId,
                                                            );
                                                        if (linked)
                                                            openPlanExtend(
                                                                linked,
                                                            );
                                                    }}
                                                >
                                                    加时继续
                                                </Button>
                                            )}
                                        {item.segment.confirmedCostCents >
                                            0 && (
                                            <span className="text-xs font-medium text-foreground tabular-nums">
                                                {formatCurrencyCny(
                                                    item.segment
                                                        .confirmedCostCents,
                                                )}
                                            </span>
                                        )}
                                        <span className="text-xs text-muted-foreground/80 tabular-nums">
                                            {formatDurationCompact(
                                                item.segment.durationSeconds,
                                            )}
                                        </span>
                                        <Button
                                            type="button"
                                            size="icon-xs"
                                            variant="ghost"
                                            aria-label={`编辑 ${item.segment.title}`}
                                            className="size-6 text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                                            disabled={busy}
                                            onClick={() =>
                                                setEditingSegment(item.segment)
                                            }
                                        >
                                            <Pencil className="size-3" />
                                        </Button>
                                    </div>
                                </div>
                            ),
                        )}
                    </div>
                )}
            </section>

            {/* Unlocated Estimates (Quiet Footer List, only when present) */}
            {daily.unlocatedEstimates.length > 0 && (
                <section>
                    <div className="flex items-center justify-between border-b border-border/60 pb-2">
                        <h2 className="text-xs font-medium text-muted-foreground">
                            待定位估记
                        </h2>
                        <span className="text-xs text-muted-foreground/70 tabular-nums">
                            {daily.unlocatedEstimates.length}{" "}
                            项（不计入已定位总量）
                        </span>
                    </div>
                    <div>
                        {daily.unlocatedEstimates.map((item) => {
                            const win = formatEstimateWindow(item, timeZone);
                            return (
                                <div
                                    key={item.id}
                                    className="flex items-center justify-between gap-4 border-b border-border/35 py-2.5 px-2 -mx-2 rounded-md text-xs transition-colors hover:bg-(--row-hover)"
                                >
                                    <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
                                        <span className="text-[14px] text-foreground">
                                            {item.title}
                                        </span>
                                        <span className="text-muted-foreground tabular-nums">
                                            约{" "}
                                            {formatDurationChinese(
                                                item.estimatedSeconds || 0,
                                            )}
                                            {(item.hourlyRateCents ??
                                                policyRateCents) > 0 &&
                                            item.categoryId !== "sleep"
                                                ? ` · 折算 ${formatCurrencyCny(
                                                      computeDurationCostCents(
                                                          item.estimatedSeconds ||
                                                              0,
                                                          item.hourlyRateCents ??
                                                              policyRateCents,
                                                      ),
                                                  )}`
                                                : ""}
                                        </span>
                                        {item.projectSnapshot && (
                                            <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                                {item.projectSnapshot}
                                            </span>
                                        )}
                                        {item.tags?.map((tag) => (
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
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() =>
                                            setLocatingEstimate(item)
                                        }
                                    >
                                        定位
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            <TimeLogOrEstimateDialog
                open={Boolean(logDialogSeed)}
                onOpenChange={(open) => {
                    if (!open) setLogDialogSeed(null);
                }}
                seed={logDialogSeed}
                timeZone={timeZone}
                policy={policy}
                tasks={tasks}
                availableProjects={availableProjects}
                availableTags={availableTags}
                segments={daily.locatedSegments}
                busy={busy}
                onSubmitLog={(input) =>
                    submitInDialog(`已补记：${input.title}`, () =>
                        logTimeActivity(input),
                    )
                }
                onSubmitEstimate={(input) =>
                    submitInDialog(`已记录估记：${input.title}`, () =>
                        estimateTimeActivity(input),
                    )
                }
            />

            <LocateEstimateDialog
                activity={locatingEstimate}
                defaultDate={selectedDate}
                timeZone={timeZone}
                segments={daily.locatedSegments}
                busy={busy}
                onOpenChange={(open) => {
                    if (!open) setLocatingEstimate(null);
                }}
                onLocate={(input) =>
                    submitInDialog("已将估记定位到具体时段", () =>
                        locateTimeEstimate(input),
                    )
                }
            />

            <EditSegmentDialog
                segment={editingSegment}
                date={selectedDate}
                timeZone={timeZone}
                policy={policy}
                availableProjects={availableProjects}
                availableTags={availableTags}
                segments={daily.locatedSegments}
                busy={busy}
                onOpenChange={(open) => {
                    if (!open) setEditingSegment(null);
                }}
                onSave={(input) =>
                    submitInDialog("已更新活动记录", () =>
                        updateTimeActivity(input),
                    )
                }
            />
        </div>
    );
}
