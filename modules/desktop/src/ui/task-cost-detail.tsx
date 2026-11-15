import {
    Action,
    ActionPanel,
    Color,
    Form,
    Icon,
    List,
    Toast,
    confirmAlert,
    showToast,
    useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import type { TaskwarriorTask } from "../../../core/tasks/model.ts";
import type {
    ActivityPrecision,
    BillExpenseItem,
    LocatedSegment,
    TaskCostSummary,
    TimingPlan,
} from "../../../core/time/model.ts";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import { toneColor } from "../lib/palette";
import {
    computeContinuationCostPreview,
    computeDurationCostCents,
    DEFAULT_HOURLY_RATE_CENTS,
    formatClockRange,
    formatClockTime,
    formatCurrencyCny,
    formatDateAndClock,
    formatDurationCn,
    formatDurationShort,
    formatProjectAndTags,
    formatTaskBudgetLine,
    formatTimeActionError,
    localTimeDate,
    normalizeClockInput,
    normalizeHourlyRateCents,
    parsePositiveMinutes,
    timingPlanStatusLabel,
} from "../lib/time-format";

function mergeTags(selected: string[], extraRaw: string): string[] {
    const extras = extraRaw
        .split(/[,\s#]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    return [...new Set([...selected, ...extras])];
}

function parseLocalDateClockToMs(dateStr: string, clockStr: string): number {
    const normalized = normalizeClockInput(clockStr);
    if (!normalized || normalized === "INVALID") {
        throw new Error("请输入 24 小时制时间（如 14:30）");
    }
    const iso = `${dateStr.trim()}T${normalized}:00`;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) {
        throw new Error(`无效日期或时间：${dateStr} ${normalized}`);
    }
    return ms;
}

export function TaskBudgetForm({
    taskUuid,
    taskTitle,
    workspace,
    initialSummary,
    onSaved,
}: {
    taskUuid: string;
    taskTitle: string;
    workspace: WorkspaceClient;
    initialSummary?: TaskCostSummary;
    onSaved?: () => unknown;
}) {
    const { pop } = useNavigation();
    const rate = normalizeHourlyRateCents(
        initialSummary?.currentHourlyRateCents,
        DEFAULT_HOURLY_RATE_CENTS,
    );
    const [mode, setMode] = useState<"set" | "add">("set");
    const [minutesText, setMinutesText] = useState(
        initialSummary?.currentAllowanceSeconds
            ? String(Math.round(initialSummary.currentAllowanceSeconds / 60))
            : "60",
    );
    const [plannedStart, setPlannedStart] = useState(
        initialSummary?.plannedStartAtMs
            ? formatClockTime(initialSummary.plannedStartAtMs)
            : "",
    );
    const [hardStop, setHardStop] = useState(
        initialSummary?.hardStopAtMs
            ? formatClockTime(initialSummary.hardStopAtMs)
            : "",
    );
    const [saving, setSaving] = useState(false);

    const parsedMin = parsePositiveMinutes(minutesText);
    const previewBudgetText = useMemo(() => {
        if (parsedMin === "INVALID" || parsedMin === undefined) {
            return "填写预计用时（分钟）后自动按时间单价换算成本预算";
        }
        const addCents = computeDurationCostCents(parsedMin * 60, rate);
        if (mode === "add") {
            return `本次追加 ${formatDurationCn(parsedMin * 60)} · ${formatCurrencyCny(addCents)}（单价 ${formatCurrencyCny(rate)}/小时，最初预算保持不变）`;
        }
        return `预计投入 ${formatDurationCn(parsedMin * 60)} · ${formatCurrencyCny(addCents)}（单价 ${formatCurrencyCny(rate)}/小时）`;
    }, [mode, parsedMin, rate]);

    async function handleSubmit() {
        if (!workspace.time || saving) return;
        const mins = parsePositiveMinutes(minutesText);
        if (mins === "INVALID" || mins === undefined) {
            await showToast({
                style: Toast.Style.Failure,
                title: "请输入正整数分钟数",
            });
            return;
        }
        const startNorm = normalizeClockInput(plannedStart);
        const stopNorm = normalizeClockInput(hardStop);
        if (startNorm === "INVALID" || stopNorm === "INVALID") {
            await showToast({
                style: Toast.Style.Failure,
                title: "时间格式无效",
                message: "请使用 HH:MM（如 14:00）",
            });
            return;
        }
        setSaving(true);
        try {
            await workspace.time.setTaskBudget({
                taskUuid,
                mode,
                ...(mode === "add"
                    ? { addAllowanceSeconds: mins * 60 }
                    : { allowanceSeconds: mins * 60 }),
                plannedStartTime: startNorm ?? null,
                hardStopTime: stopNorm ?? null,
            });
            await showToast({
                style: Toast.Style.Success,
                title: mode === "add" ? "已追加任务预算" : "已更新任务预算",
            });
            await onSaved?.();
            pop();
        } catch (error) {
            await showToast({
                style: Toast.Style.Failure,
                title: "保存失败",
                message: formatTimeActionError(error),
            });
        } finally {
            setSaving(false);
        }
    }

    async function handleClear() {
        if (!workspace.time || saving) return;
        setSaving(true);
        try {
            await workspace.time.setTaskBudget({ taskUuid, mode: "clear" });
            await showToast({
                style: Toast.Style.Success,
                title: "已清除任务预算（转为未设预算）",
            });
            await onSaved?.();
            pop();
        } catch (error) {
            await showToast({
                style: Toast.Style.Failure,
                title: "清除失败",
                message: formatTimeActionError(error),
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <Form
            isLoading={saving}
            navigationTitle={`任务预算 · ${taskTitle}`}
            actions={
                <ActionPanel>
                    <Action.SubmitForm
                        title="保存预算"
                        icon={Icon.Check}
                        onSubmit={handleSubmit}
                    />
                    {initialSummary?.hasBudget ? (
                        <Action
                            title="清除预算（恢复未设预算）"
                            icon={Icon.Trash}
                            style={Action.Style.Destructive}
                            onAction={handleClear}
                        />
                    ) : null}
                </ActionPanel>
            }
        >
            <Form.Dropdown
                id="budget-mode"
                title="操作方式"
                value={mode}
                onChange={(v) => setMode(v === "add" ? "add" : "set")}
            >
                <Form.Dropdown.Item
                    value="set"
                    title="设定预算（无初值时记录最初预估）"
                />
                <Form.Dropdown.Item
                    value="add"
                    title="追加时间（保留最初预估并增加当前预算）"
                />
            </Form.Dropdown>
            <Form.TextField
                id="budget-minutes"
                title={mode === "add" ? "追加分钟数" : "预计用时（分钟）"}
                value={minutesText}
                onChange={setMinutesText}
                placeholder="例如 60"
            />
            <Form.Description title="成本折算" text={previewBudgetText} />
            <Form.TextField
                id="planned-start"
                title="计划开始（可选）"
                value={plannedStart}
                onChange={setPlannedStart}
                placeholder="HH:MM，仅用于展示与提醒"
            />
            <Form.TextField
                id="hard-stop"
                title="最晚停止（可选）"
                value={hardStop}
                onChange={setHardStop}
                placeholder="HH:MM，限制本次计时边界"
            />
        </Form>
    );
}

export function CreateBoundedPlanForm({
    workspace,
    task,
    knownProjects = [],
    knownTags = [],
    hourlyRateCents = DEFAULT_HOURLY_RATE_CENTS,
    onSaved,
}: {
    workspace: WorkspaceClient;
    task?: TaskwarriorTask;
    knownProjects?: string[];
    knownTags?: string[];
    hourlyRateCents?: number;
    onSaved?: () => unknown;
}) {
    const { pop } = useNavigation();
    const rate = normalizeHourlyRateCents(hourlyRateCents);
    const [title, setTitle] = useState(task?.description || "");
    const [minutesText, setMinutesText] = useState("60");
    const [plannedStart, setPlannedStart] = useState("");
    const [hardStop, setHardStop] = useState("");
    const [project, setProject] = useState(task?.project || "");
    const [selectedTags, setSelectedTags] = useState<string[]>(
        task?.tags || [],
    );
    const [extraTags, setExtraTags] = useState("");
    const [isSleep, setIsSleep] = useState(false);
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    const parsedMin = parsePositiveMinutes(minutesText);
    const costHint =
        parsedMin && parsedMin !== "INVALID"
            ? isSleep
                ? "睡眠时段按 ¥0 计入时间成本"
                : `预计投入 ${formatDurationCn(parsedMin * 60)} · ${formatCurrencyCny(computeDurationCostCents(parsedMin * 60, rate))}（手动开始后到限自动停止）`
            : "输入预计用时（分钟）后显示预算成本";

    async function handleSubmit() {
        if (!workspace.time || saving) return;
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            await showToast({
                style: Toast.Style.Failure,
                title: "请填写计时内容",
            });
            return;
        }
        const mins = parsePositiveMinutes(minutesText);
        if (mins === "INVALID" || mins === undefined) {
            await showToast({
                style: Toast.Style.Failure,
                title: "请输入正整数预计用时（分钟）",
            });
            return;
        }
        const startNorm = normalizeClockInput(plannedStart);
        const stopNorm = normalizeClockInput(hardStop);
        if (startNorm === "INVALID" || stopNorm === "INVALID") {
            await showToast({
                style: Toast.Style.Failure,
                title: "时间格式无效（应为 HH:MM）",
            });
            return;
        }
        setSaving(true);
        try {
            const tags = mergeTags(selectedTags, extraTags);
            await workspace.time.createPlan({
                title: trimmedTitle,
                ...(task ? { taskUuid: task.uuid } : {}),
                ...(project ? { projectSnapshot: project } : {}),
                ...(tags.length ? { tags } : {}),
                ...(isSleep ? { categoryId: "sleep" } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
                allowanceMinutes: mins,
                ...(startNorm ? { plannedStartTime: startNorm } : {}),
                ...(stopNorm ? { hardStopTime: stopNorm } : {}),
            });
            await showToast({
                style: Toast.Style.Success,
                title: "已创建限时安排（需手动开始）",
            });
            await onSaved?.();
            pop();
        } catch (error) {
            await showToast({
                style: Toast.Style.Failure,
                title: "创建失败",
                message: formatTimeActionError(error),
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <Form
            isLoading={saving}
            navigationTitle="新建限时计时安排"
            actions={
                <ActionPanel>
                    <Action.SubmitForm
                        title="创建安排"
                        icon={Icon.Plus}
                        onSubmit={handleSubmit}
                    />
                </ActionPanel>
            }
        >
            <Form.TextField
                id="plan-title"
                title="内容"
                value={title}
                onChange={setTitle}
                placeholder="准备投入什么事情"
            />
            <Form.TextField
                id="plan-minutes"
                title="预计用时（分钟）"
                value={minutesText}
                onChange={setMinutesText}
                placeholder="例如 60"
            />
            <Form.Description title="成本预估" text={costHint} />
            <Form.TextField
                id="plan-start"
                title="计划开始（可选）"
                value={plannedStart}
                onChange={setPlannedStart}
                placeholder="HH:MM，仅用于提醒，不自动启动"
            />
            <Form.TextField
                id="plan-hard-stop"
                title="最晚停止（可选）"
                value={hardStop}
                onChange={setHardStop}
                placeholder="HH:MM，例如 15:00"
            />
            <Form.Dropdown
                id="plan-project"
                title="Taskwarrior 项目"
                value={project}
                onChange={setProject}
            >
                <Form.Dropdown.Item value="" title="未关联项目" />
                {[...new Set([project, ...knownProjects].filter(Boolean))].map(
                    (p) => (
                        <Form.Dropdown.Item key={p} value={p} title={p} />
                    ),
                )}
            </Form.Dropdown>
            <Form.TagPicker
                id="plan-tags"
                title="标签"
                value={selectedTags}
                onChange={setSelectedTags}
            >
                {[...new Set([...selectedTags, ...knownTags])].map((t) => (
                    <Form.TagPicker.Item key={t} value={t} title={`#${t}`} />
                ))}
            </Form.TagPicker>
            <Form.TextField
                id="plan-extra-tags"
                title="补充标签"
                value={extraTags}
                onChange={setExtraTags}
                placeholder="逗号分隔，如 专注, C++"
            />
            <Form.Checkbox
                id="plan-sleep"
                label="标记为睡眠（¥0 · 免除 6h 检查点）"
                value={isSleep}
                onChange={setIsSleep}
            />
            <Form.TextArea
                id="plan-note"
                title="备注（可选）"
                value={note}
                onChange={setNote}
            />
        </Form>
    );
}

export function ExtendPlanForm({
    workspace,
    plan,
    hourlyRateCents = DEFAULT_HOURLY_RATE_CENTS,
    resumeAfterExtend = false,
    onSaved,
}: {
    workspace: WorkspaceClient;
    plan: TimingPlan;
    hourlyRateCents?: number;
    resumeAfterExtend?: boolean;
    onSaved?: () => unknown;
}) {
    const { pop } = useNavigation();
    const rate = normalizeHourlyRateCents(
        plan.hourlyRateCents ?? hourlyRateCents,
    );
    const [addMinutes, setAddMinutes] = useState("30");
    const [hardStopText, setHardStopText] = useState(
        plan.hardStopAtMs ? formatClockTime(plan.hardStopAtMs) : "",
    );
    const [saving, setSaving] = useState(false);

    const preview = useMemo(() => {
        const mins = parsePositiveMinutes(addMinutes);
        if (mins === "INVALID" || mins === undefined) return undefined;
        let stopMs = plan.hardStopAtMs;
        const stopNorm = normalizeClockInput(hardStopText);
        if (stopNorm && stopNorm !== "INVALID") {
            try {
                stopMs = parseLocalDateClockToMs(
                    localTimeDate(Date.now()),
                    stopNorm,
                );
            } catch {
                // Keep previous stopMs while typing
            }
        } else if (!hardStopText.trim()) {
            stopMs = undefined;
        }
        return computeContinuationCostPreview({
            requestedSeconds: mins * 60,
            hourlyRateCents: plan.categoryId === "sleep" ? 0 : rate,
            hardStopAtMs: stopMs,
            nowMs: Date.now(),
        });
    }, [addMinutes, hardStopText, plan, rate]);

    const previewCopy = (() => {
        if (!preview) return "请输入要追加的分钟数（例如 30）";
        if (preview.expired) {
            return "当前已超过原定最晚停止时刻，请先向后调整最晚停止时刻再继续。";
        }
        const costText = formatCurrencyCny(preview.additionalCostCents);
        const effMin = Math.round(preview.effectiveSeconds / 60);
        if (preview.cappedByHardStop) {
            return `受最晚停止限制，最多可继续 ${effMin} 分钟 · 预计增加 ${costText}（需超出请改最晚停止）`;
        }
        return `再投入 ${effMin} 分钟 · 预计增加 ${costText}`;
    })();

    async function handleSubmit() {
        if (!workspace.time || saving) return;
        const mins = parsePositiveMinutes(addMinutes);
        if (mins === "INVALID" || mins === undefined) {
            await showToast({
                style: Toast.Style.Failure,
                title: "请输入正整数分钟数",
            });
            return;
        }
        const stopNorm = normalizeClockInput(hardStopText);
        if (stopNorm === "INVALID") {
            await showToast({
                style: Toast.Style.Failure,
                title: "最晚停止格式无效（应为 HH:MM）",
            });
            return;
        }
        setSaving(true);
        try {
            await workspace.time.updatePlan({
                planId: plan.id,
                expectedVersion: plan.version,
                addAllowanceMinutes: mins,
                ...(stopNorm !== undefined
                    ? { hardStopTime: stopNorm }
                    : hardStopText.trim() === "" && plan.hardStopAtMs
                      ? { hardStopAtMs: null }
                      : {}),
            });
            if (resumeAfterExtend) {
                await workspace.time.startPlan({ planId: plan.id });
            }
            await showToast({
                style: Toast.Style.Success,
                title: resumeAfterExtend
                    ? `已追加 ${mins} 分钟并继续计时`
                    : `已追加 ${mins} 分钟额度`,
            });
            await onSaved?.();
            pop();
        } catch (error) {
            await showToast({
                style: Toast.Style.Failure,
                title: "操作失败",
                message: formatTimeActionError(error),
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <Form
            isLoading={saving}
            navigationTitle={`增加时间 · ${plan.title}`}
            actions={
                <ActionPanel>
                    <Action.SubmitForm
                        title={resumeAfterExtend ? "确认追加并继续" : "追加时长"}
                        icon={Icon.Plus}
                        onSubmit={handleSubmit}
                    />
                </ActionPanel>
            }
        >
            <Form.TextField
                id="extend-minutes"
                title="追加时长（分钟）"
                value={addMinutes}
                onChange={setAddMinutes}
            />
            <Form.Description title="继续代价" text={previewCopy} />
            <Form.TextField
                id="extend-hard-stop"
                title="最晚停止（可选）"
                value={hardStopText}
                onChange={setHardStopText}
                placeholder="HH:MM，留空取消最晚限制"
            />
        </Form>
    );
}

export function TimeSegmentForm({
    workspace,
    mode,
    segment,
    defaultTask,
    defaultDate,
    knownProjects = [],
    knownTags = [],
    onSaved,
}: {
    workspace: WorkspaceClient;
    mode: "log" | "edit";
    segment?: LocatedSegment;
    defaultTask?: TaskwarriorTask;
    defaultDate?: string;
    knownProjects?: string[];
    knownTags?: string[];
    onSaved?: () => unknown;
}) {
    const { pop } = useNavigation();
    const initialDate = segment
        ? localTimeDate(segment.startMs)
        : defaultDate || localTimeDate(Date.now());
    const [title, setTitle] = useState(
        segment?.title || defaultTask?.description || "",
    );
    const [dateStr, setDateStr] = useState(initialDate);
    const [startClock, setStartClock] = useState(
        segment ? formatClockTime(segment.startMs) : "09:00",
    );
    const [endClock, setEndClock] = useState(
        segment ? formatClockTime(segment.endMs) : formatClockTime(Date.now()),
    );
    const [project, setProject] = useState(
        segment?.projectSnapshot || defaultTask?.project || "",
    );
    const [selectedTags, setSelectedTags] = useState<string[]>(
        segment?.tags || defaultTask?.tags || [],
    );
    const [extraTags, setExtraTags] = useState("");
    const [isSleep, setIsSleep] = useState(segment?.categoryId === "sleep");
    const [precision, setPrecision] = useState<ActivityPrecision>(
        segment?.precision || "exact",
    );
    const [confirmReview, setConfirmReview] = useState(
        segment ? segment.reviewState !== "ok" : false,
    );
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    async function handleSubmit() {
        if (!workspace.time || saving) return;
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            await showToast({
                style: Toast.Style.Failure,
                title: "请填写活动内容",
            });
            return;
        }
        let startMs: number;
        let endMs: number;
        try {
            startMs = parseLocalDateClockToMs(dateStr, startClock);
            endMs = parseLocalDateClockToMs(dateStr, endClock);
        } catch (error) {
            await showToast({
                style: Toast.Style.Failure,
                title: "时间无效",
                message: (error as Error).message,
            });
            return;
        }
        if (endMs <= startMs) {
            await showToast({
                style: Toast.Style.Failure,
                title: "结束时刻必须晚于开始时刻",
            });
            return;
        }
        const tags = mergeTags(selectedTags, extraTags);
        setSaving(true);
        try {
            if (mode === "log") {
                await workspace.time.log({
                    title: trimmedTitle,
                    startMs,
                    endMs,
                    ...(defaultTask ? { taskUuid: defaultTask.uuid } : {}),
                    ...(project ? { projectSnapshot: project } : {}),
                    ...(tags.length ? { tags } : {}),
                    ...(isSleep ? { explicitCategoryId: "sleep" } : {}),
                    precision,
                    ...(note.trim() ? { note: note.trim() } : {}),
                });
                await showToast({
                    style: Toast.Style.Success,
                    title: "已补记时段",
                });
            } else if (segment) {
                await workspace.time.updateActivity({
                    activityId: segment.activityId,
                    expectedVersion: segment.version,
                    patch: {
                        title: trimmedTitle,
                        startMs,
                        endMs,
                        projectSnapshot: project || null,
                        tags: tags.length ? tags : null,
                        categoryId: isSleep ? "sleep" : "work",
                        precision,
                        confirmReview,
                        ...(note.trim() ? { note: note.trim() } : {}),
                    },
                });
                await showToast({
                    style: Toast.Style.Success,
                    title: confirmReview ? "已修正并核对入账" : "已更新记录",
                });
            }
            await onSaved?.();
            pop();
        } catch (error) {
            await showToast({
                style: Toast.Style.Failure,
                title: "保存失败",
                message: formatTimeActionError(error),
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <Form
            isLoading={saving}
            navigationTitle={
                mode === "log" ? "补记已发生时段" : "修正记录 / 结束时刻"
            }
            actions={
                <ActionPanel>
                    <Action.SubmitForm
                        title="保存记录"
                        icon={Icon.Check}
                        onSubmit={handleSubmit}
                    />
                </ActionPanel>
            }
        >
            <Form.TextField
                id="seg-title"
                title="活动内容"
                value={title}
                onChange={setTitle}
            />
            <Form.TextField
                id="seg-date"
                title="日期"
                value={dateStr}
                onChange={setDateStr}
                placeholder="YYYY-MM-DD"
            />
            <Form.TextField
                id="seg-start"
                title="开始时刻"
                value={startClock}
                onChange={setStartClock}
                placeholder="HH:MM"
            />
            <Form.TextField
                id="seg-end"
                title="结束时刻"
                value={endClock}
                onChange={setEndClock}
                placeholder="HH:MM"
            />
            <Form.Dropdown
                id="seg-project"
                title="Taskwarrior 项目"
                value={project}
                onChange={setProject}
            >
                <Form.Dropdown.Item value="" title="未关联项目" />
                {[...new Set([project, ...knownProjects].filter(Boolean))].map(
                    (p) => (
                        <Form.Dropdown.Item key={p} value={p} title={p} />
                    ),
                )}
            </Form.Dropdown>
            <Form.TagPicker
                id="seg-tags"
                title="标签"
                value={selectedTags}
                onChange={setSelectedTags}
            >
                {[...new Set([...selectedTags, ...knownTags])].map((t) => (
                    <Form.TagPicker.Item key={t} value={t} title={`#${t}`} />
                ))}
            </Form.TagPicker>
            <Form.TextField
                id="seg-extra-tags"
                title="补充标签"
                value={extraTags}
                onChange={setExtraTags}
                placeholder="逗号分隔"
            />
            <Form.Checkbox
                id="seg-sleep"
                label="睡眠时段（¥0 · 免除 6h 检查点）"
                value={isSleep}
                onChange={setIsSleep}
            />
            <Form.Dropdown
                id="seg-precision"
                title="边界精度"
                value={precision}
                onChange={(v) => setPrecision(v as ActivityPrecision)}
            >
                <Form.Dropdown.Item value="exact" title="精确起止" />
                <Form.Dropdown.Item
                    value="estimated_bounds"
                    title="起止为回忆估算（大约）"
                />
            </Form.Dropdown>
            {mode === "edit" ? (
                <Form.Checkbox
                    id="seg-confirm"
                    label="同步确认这段并入账（清除待核对状态）"
                    value={confirmReview}
                    onChange={setConfirmReview}
                />
            ) : null}
            <Form.TextArea
                id="seg-note"
                title="备注（可选）"
                value={note}
                onChange={setNote}
            />
        </Form>
    );
}

export function LinkBillExpenseList({
    workspace,
    taskUuid,
    taskTitle,
    linkedTxKeys,
    onLinked,
}: {
    workspace: WorkspaceClient;
    taskUuid: string;
    taskTitle: string;
    linkedTxKeys?: string[];
    onLinked?: () => unknown;
}) {
    const { pop } = useNavigation();
    const [searchText, setSearchText] = useState("");
    const [linkingKey, setLinkingKey] = useState<string>();
    const linkedSet = useMemo(() => new Set(linkedTxKeys || []), [linkedTxKeys]);

    const { data, isLoading, error } = usePromise(
        async (q: string) => {
            if (!workspace.time) return { available: false, expenses: [] };
            return workspace.time.billsExpenses({ q: q.trim(), limit: 60 });
        },
        [searchText],
    );

    async function handleLink(item: BillExpenseItem) {
        if (!workspace.time || linkingKey) return;
        setLinkingKey(item.txKey);
        try {
            await workspace.time.linkBill({
                txKey: item.txKey,
                taskUuid,
                source: item.source,
                txId: item.txId,
                payTime: item.payTime,
                payee: item.payee,
                narration: item.narration,
                account: item.account,
                currency: item.currency,
                amount: item.amount,
                cnyAmountCents: item.cnyAmountCents,
            });
            await showToast({
                style: Toast.Style.Success,
                title: "已关联账单支出",
                message: formatCurrencyCny(item.cnyAmountCents),
            });
            await onLinked?.();
            pop();
        } catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: "关联失败",
                message: formatTimeActionError(err),
            });
        } finally {
            setLinkingKey(undefined);
        }
    }

    return (
        <List
            isLoading={isLoading || Boolean(linkingKey)}
            searchText={searchText}
            onSearchTextChange={setSearchText}
            throttle
            navigationTitle={`关联 Bill 账单 · ${taskTitle}`}
            searchBarPlaceholder="搜索商户、摘要、账户或日期…"
        >
            {error ? (
                <List.EmptyView
                    icon={Icon.Warning}
                    title="无法读取 Bills 账单"
                    description={formatTimeActionError(error)}
                />
            ) : data && !data.available ? (
                <List.EmptyView
                    icon={Icon.BankNote}
                    title="未配置只读 Bills 账本"
                    description="可在服务端设置 ASTER_BILLS_DIR 指向 Beancount 账本目录。"
                />
            ) : (
                (data?.expenses || []).map((item) => {
                    const alreadyLinked = linkedSet.has(item.txKey);
                    return (
                        <List.Item
                            key={item.txKey}
                            title={item.payee || item.narration || item.account}
                            subtitle={[item.date, item.narration, item.account]
                                .filter(Boolean)
                                .join(" · ")}
                            icon={
                                alreadyLinked ? Icon.CheckCircle : Icon.BankNote
                            }
                            accessories={[
                                {
                                    text: formatCurrencyCny(
                                        item.cnyAmountCents,
                                    ),
                                },
                                ...(alreadyLinked ? [{ tag: "已关联" }] : []),
                            ]}
                            actions={
                                <ActionPanel>
                                    {!alreadyLinked ? (
                                        <Action
                                            title="关联到此任务"
                                            icon={Icon.Link}
                                            onAction={() => handleLink(item)}
                                        />
                                    ) : null}
                                </ActionPanel>
                            }
                        />
                    );
                })
            )}
        </List>
    );
}

export function TaskCostDetailScreen({
    workspace,
    task,
    knownProjects = [],
    knownTags = [],
    onChanged,
}: {
    workspace: WorkspaceClient;
    task: TaskwarriorTask;
    knownProjects?: string[];
    knownTags?: string[];
    onChanged?: () => unknown;
}) {
    const { data, isLoading, error, revalidate } = usePromise(async () => {
        if (!workspace.time) {
            throw new Error("Time client is unavailable.");
        }
        return workspace.time.taskDetail(task.uuid);
    });

    async function refreshAll() {
        await Promise.all([revalidate(), onChanged?.()]);
    }

    async function handleConfirmSegment(seg: LocatedSegment) {
        if (!workspace.time) return;
        try {
            await workspace.time.confirm({
                activityId: seg.activityId,
                expectedVersion: seg.version,
                throughMs: seg.endMs,
            });
            await showToast({
                style: Toast.Style.Success,
                title: "已确认入账",
            });
            await refreshAll();
        } catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: "确认失败",
                message: formatTimeActionError(err),
            });
        }
    }

    async function handleStartPlan(plan: TimingPlan) {
        if (!workspace.time) return;
        try {
            await workspace.time.startPlan({ planId: plan.id });
            await showToast({
                style: Toast.Style.Success,
                title: "计时已开始",
            });
            await refreshAll();
        } catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: "无法开始安排",
                message: formatTimeActionError(err),
            });
        }
    }

    async function handlePauseOrStop(pause: boolean) {
        if (!workspace.time) return;
        try {
            await workspace.time.stop({ pause });
            await showToast({
                style: Toast.Style.Success,
                title: pause ? "已暂停计时" : "已停止计时",
            });
            await refreshAll();
        } catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: "停止失败",
                message: formatTimeActionError(err),
            });
        }
    }

    async function handleUnlinkBill(linkId: string) {
        if (!workspace.time) return;
        if (
            !(await confirmAlert({
                title: "取消关联此账单？",
                message: "仅移除任务与账单的关联，不会改动 Bills 原文件。",
            }))
        ) {
            return;
        }
        try {
            await workspace.time.unlinkBill(linkId);
            await showToast({
                style: Toast.Style.Success,
                title: "已取消关联",
            });
            await refreshAll();
        } catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: "操作失败",
                message: formatTimeActionError(err),
            });
        }
    }

    const summary = data?.summary;
    const rate = summary?.currentHourlyRateCents ?? DEFAULT_HOURLY_RATE_CENTS;
    const linkedTxKeys = (data?.billLinks || []).map((l) => l.txKey);

    const commonActions = (
        <ActionPanel.Section title="预算与成本操作">
            <Action.Push
                title={summary?.hasBudget ? "调整 / 追加任务预算" : "设定任务预算"}
                icon={Icon.Coins}
                target={
                    <TaskBudgetForm
                        taskUuid={task.uuid}
                        taskTitle={task.description}
                        workspace={workspace}
                        initialSummary={summary}
                        onSaved={refreshAll}
                    />
                }
            />
            <Action.Push
                title="创建限时计时安排"
                icon={Icon.Stopwatch}
                target={
                    <CreateBoundedPlanForm
                        workspace={workspace}
                        task={task}
                        knownProjects={knownProjects}
                        knownTags={knownTags}
                        hourlyRateCents={rate}
                        onSaved={refreshAll}
                    />
                }
            />
            <Action.Push
                title="补记此任务时段"
                icon={Icon.PlusCircle}
                target={
                    <TimeSegmentForm
                        workspace={workspace}
                        mode="log"
                        defaultTask={task}
                        knownProjects={knownProjects}
                        knownTags={knownTags}
                        onSaved={refreshAll}
                    />
                }
            />
            <Action.Push
                title="关联 Bill 现金支出…"
                icon={Icon.BankNote}
                target={
                    <LinkBillExpenseList
                        workspace={workspace}
                        taskUuid={task.uuid}
                        taskTitle={task.description}
                        linkedTxKeys={linkedTxKeys}
                        onLinked={refreshAll}
                    />
                }
            />
        </ActionPanel.Section>
    );

    return (
        <List
            isLoading={isLoading}
            navigationTitle={`投入成本 · ${task.description}`}
            searchBarPlaceholder="筛选时间段、计划或账单…"
        >
            {error ? (
                <List.EmptyView
                    icon={Icon.Warning}
                    title="无法加载成本明细"
                    description={formatTimeActionError(error)}
                />
            ) : null}

            {summary ? (
                <List.Section title="成本总览">
                    <List.Item
                        title={`已确认时间成本 ${formatCurrencyCny(summary.confirmedCostCents)}`}
                        subtitle={`累计 ${formatDurationCn(summary.confirmedSeconds)} · ${formatTaskBudgetLine(summary)}`}
                        icon={Icon.Coins}
                        accessories={[
                            ...(summary.provisionalCostCents > 0
                                ? [
                                      {
                                          tag: {
                                              value: `待核对 暂计 ${formatCurrencyCny(summary.provisionalCostCents)}`,
                                              color: Color.Yellow,
                                          },
                                      },
                                  ]
                                : []),
                            ...(summary.overInitialBudgetCents > 0
                                ? [
                                      {
                                          tag: {
                                              value: `超出最初预估 ${formatCurrencyCny(summary.overInitialBudgetCents)}`,
                                              color: toneColor("overdue"),
                                          },
                                      },
                                  ]
                                : []),
                        ]}
                        actions={<ActionPanel>{commonActions}</ActionPanel>}
                    />
                    {summary.linkedCashCents > 0 ? (
                        <List.Item
                            title={`综合投入 ${formatCurrencyCny(summary.combinedCostCents)}`}
                            subtitle={`时间成本 ${formatCurrencyCny(summary.confirmedCostCents)} + 现金支出 ${formatCurrencyCny(summary.linkedCashCents)}`}
                            icon={Icon.Wallet}
                            actions={<ActionPanel>{commonActions}</ActionPanel>}
                        />
                    ) : null}
                </List.Section>
            ) : null}

            {(data?.plans || []).length > 0 ? (
                <List.Section title={`限时安排 (${data?.plans.length})`}>
                    {(data?.plans || []).map((plan) => (
                        <List.Item
                            key={plan.id}
                            title={plan.title}
                            subtitle={[
                                timingPlanStatusLabel(plan),
                                plan.allowanceSeconds
                                    ? `额定 ${formatDurationShort(plan.allowanceSeconds)}`
                                    : undefined,
                                plan.remainingSeconds !== undefined
                                    ? `剩余 ${formatDurationShort(plan.remainingSeconds)}`
                                    : undefined,
                                plan.hardStopAtMs
                                    ? `最晚 ${formatClockTime(plan.hardStopAtMs)}`
                                    : undefined,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                            icon={
                                plan.status === "active"
                                    ? {
                                          source: Icon.Play,
                                          tintColor: toneColor("timer"),
                                      }
                                    : Icon.Clock
                            }
                            accessories={[
                                ...(plan.initialBudgetCents !== undefined
                                    ? [
                                          {
                                              text: formatCurrencyCny(
                                                  plan.currentBudgetCents ??
                                                      plan.initialBudgetCents,
                                              ),
                                          },
                                      ]
                                    : []),
                                { tag: timingPlanStatusLabel(plan) },
                            ]}
                            actions={
                                <ActionPanel>
                                    {plan.status === "scheduled" ||
                                    plan.status === "paused" ? (
                                        <Action
                                            title={
                                                plan.status === "paused"
                                                    ? "继续计时"
                                                    : "手动开始"
                                            }
                                            icon={Icon.Play}
                                            onAction={() =>
                                                handleStartPlan(plan)
                                            }
                                        />
                                    ) : null}
                                    {plan.status === "active" ? (
                                        <>
                                            <Action
                                                title="暂停（保留剩余额度）"
                                                icon={Icon.Pause}
                                                onAction={() =>
                                                    handlePauseOrStop(true)
                                                }
                                            />
                                            <Action
                                                title="停止计时"
                                                icon={Icon.Stop}
                                                onAction={() =>
                                                    handlePauseOrStop(false)
                                                }
                                            />
                                        </>
                                    ) : null}
                                    {plan.status !== "archived" ? (
                                        <Action.Push
                                            title="增加时间并继续…"
                                            icon={Icon.Plus}
                                            target={
                                                <ExtendPlanForm
                                                    workspace={workspace}
                                                    plan={plan}
                                                    hourlyRateCents={rate}
                                                    resumeAfterExtend={
                                                        plan.status ===
                                                            "stopped" ||
                                                        plan.status ===
                                                            "paused"
                                                    }
                                                    onSaved={refreshAll}
                                                />
                                            }
                                        />
                                    ) : null}
                                    {commonActions}
                                </ActionPanel>
                            }
                        />
                    ))}
                </List.Section>
            ) : null}

            <List.Section title={`时间记录 (${(data?.segments || []).length})`}>
                {(data?.segments || []).map((seg) => {
                    const needsReview = seg.reviewState !== "ok";
                    const costValue = needsReview
                        ? `暂计 ${formatCurrencyCny(seg.provisionalCostCents)}`
                        : formatCurrencyCny(seg.confirmedCostCents);
                    return (
                        <List.Item
                            key={seg.activityId}
                            title={`${formatDateAndClock(seg.startMs)} · ${formatClockRange(seg.startMs, seg.endMs)}`}
                            subtitle={`${formatDurationCn(seg.durationSeconds)} · ${formatProjectAndTags(seg.projectSnapshot, seg.tags, seg.categoryId)}`}
                            icon={
                                needsReview
                                    ? {
                                          source: Icon.QuestionMarkCircle,
                                          tintColor: Color.Yellow,
                                      }
                                    : {
                                          source: Icon.CheckCircle,
                                          tintColor: toneColor("completed"),
                                      }
                            }
                            accessories={[
                                { text: costValue },
                                ...(needsReview
                                    ? [
                                          {
                                              tag: {
                                                  value: "待核对",
                                                  color: Color.Yellow,
                                              },
                                          },
                                      ]
                                    : []),
                            ]}
                            actions={
                                <ActionPanel>
                                    {needsReview ? (
                                        <Action
                                            title="确认这段并入账"
                                            icon={Icon.CheckCircle}
                                            onAction={() =>
                                                handleConfirmSegment(seg)
                                            }
                                        />
                                    ) : null}
                                    <Action.Push
                                        title="修正结束时间 / 编辑"
                                        icon={Icon.Pencil}
                                        target={
                                            <TimeSegmentForm
                                                workspace={workspace}
                                                mode="edit"
                                                segment={seg}
                                                knownProjects={knownProjects}
                                                knownTags={knownTags}
                                                onSaved={refreshAll}
                                            />
                                        }
                                    />
                                    {commonActions}
                                </ActionPanel>
                            }
                        />
                    );
                })}
            </List.Section>

            {(data?.billLinks || []).length > 0 ? (
                <List.Section
                    title={`关联现金支出 (${data?.billLinks.length})`}
                >
                    {(data?.billLinks || []).map((link) => (
                        <List.Item
                            key={link.id}
                            title={
                                link.payee || link.narration || link.account
                            }
                            subtitle={`${link.payTime} · ${link.account}`}
                            icon={Icon.BankNote}
                            accessories={[
                                { text: formatCurrencyCny(link.cnyAmountCents) },
                            ]}
                            actions={
                                <ActionPanel>
                                    <Action
                                        title="取消关联此账单"
                                        icon={Icon.Trash}
                                        style={Action.Style.Destructive}
                                        onAction={() =>
                                            handleUnlinkBill(link.id)
                                        }
                                    />
                                    {commonActions}
                                </ActionPanel>
                            }
                        />
                    ))}
                </List.Section>
            ) : null}
        </List>
    );
}
