import {
    Action,
    ActionPanel,
    Color,
    Form,
    Icon,
    Keyboard,
    List,
    Toast,
    showToast,
    useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import type { TaskwarriorTask } from "../../../core/tasks/model.ts";
import type {
    CostReportGranularity,
    CostReportSortBy,
    LocatedSegment,
    TimePolicy,
    TimingPlan,
} from "../../../core/time/model.ts";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import { toneColor } from "../lib/palette";
import {
    addLocalDays,
    DEFAULT_HOURLY_RATE_CENTS,
    formatClockRange,
    formatClockTime,
    formatCurrencyCny,
    formatDateAndClock,
    formatDurationCn,
    formatDurationShort,
    formatProjectAndTags,
    formatRateConversionHint,
    formatTimeActionError,
    localTimeDate,
    normalizeClockInput,
    normalizeHourlyRateCents,
    timingPlanStatusLabel,
    yuanToHourlyRateCents,
} from "../lib/time-format";
import {
    CreateBoundedPlanForm,
    ExtendPlanForm,
    TaskCostDetailScreen,
    TimeSegmentForm,
} from "./task-cost-detail";

export type TimeWorkspaceTab = "today" | "weekly" | "report";

function formatClockFields(hour: number, minute: number): string {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function TimeSettingsForm({
    workspace,
    onSaved,
}: {
    workspace: WorkspaceClient;
    onSaved?: () => unknown;
}) {
    const { pop } = useNavigation();
    const { data: policy, isLoading } = usePromise(async () => {
        if (!workspace.time) throw new Error("Time client is unavailable.");
        return workspace.time.policy();
    });

    const [initialized, setInitialized] = useState(false);
    const [rateYuan, setRateYuan] = useState("100");
    const [highlightCost, setHighlightCost] = useState(true);
    const [thresholdHours, setThresholdHours] = useState("6");
    const [reminderEnabled, setReminderEnabled] = useState(true);
    const [reminderTime, setReminderTime] = useState("21:30");
    const [sleepEnabled, setSleepEnabled] = useState(true);
    const [sleepStart, setSleepStart] = useState("23:30");
    const [sleepEnd, setSleepEnd] = useState("07:30");
    const [saving, setSaving] = useState(false);

    if (policy && !initialized) {
        setInitialized(true);
        const rateCents = normalizeHourlyRateCents(
            policy.hourlyRateCents,
            DEFAULT_HOURLY_RATE_CENTS,
        );
        setRateYuan(String(Number((rateCents / 100).toFixed(2))));
        setHighlightCost(policy.taskListHighlightCost !== false);
        setThresholdHours(
            String(
                Number(
                    ((policy.longActivityThresholdSeconds || 21600) / 3600).toFixed(
                        1,
                    ),
                ),
            ),
        );
        setReminderEnabled(policy.reconcileReminder?.enabled !== false);
        setReminderTime(
            formatClockFields(
                policy.reconcileReminder?.hour ?? 21,
                policy.reconcileReminder?.minute ?? 30,
            ),
        );
        setSleepEnabled(policy.sleepTemplate?.enabled !== false);
        setSleepStart(policy.sleepTemplate?.startTime || "23:30");
        setSleepEnd(policy.sleepTemplate?.endTime || "07:30");
    }

    const previewCents = (() => {
        const parsed = Number(rateYuan.trim());
        if (!Number.isFinite(parsed) || parsed < 0) {
            return normalizeHourlyRateCents(policy?.hourlyRateCents);
        }
        return yuanToHourlyRateCents(parsed);
    })();

    async function handleSubmit() {
        if (!workspace.time || !policy || saving) return;
        const parsedRate = Number(rateYuan.trim());
        if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100000) {
            await showToast({
                style: Toast.Style.Failure,
                title: "请输入合法的时间单价（≥ 0）",
            });
            return;
        }
        const parsedThreshold = Number(thresholdHours.trim());
        if (
            !Number.isFinite(parsedThreshold) ||
            parsedThreshold <= 0 ||
            parsedThreshold > 24
        ) {
            await showToast({
                style: Toast.Style.Failure,
                title: "长时段检查阈值需在 0–24 小时之间",
            });
            return;
        }
        const remNorm = normalizeClockInput(reminderTime);
        const sleepStartNorm = normalizeClockInput(sleepStart);
        const sleepEndNorm = normalizeClockInput(sleepEnd);
        if (
            !remNorm ||
            remNorm === "INVALID" ||
            !sleepStartNorm ||
            sleepStartNorm === "INVALID" ||
            !sleepEndNorm ||
            sleepEndNorm === "INVALID"
        ) {
            await showToast({
                style: Toast.Style.Failure,
                title: "时间格式需为 HH:MM",
            });
            return;
        }
        const [remH, remM] = remNorm.split(":").map(Number);

        setSaving(true);
        try {
            const patch: Partial<Omit<TimePolicy, "policyVersion">> = {
                hourlyRateCents: yuanToHourlyRateCents(parsedRate),
                taskListHighlightCost: highlightCost,
                longActivityThresholdSeconds: Math.round(parsedThreshold * 3600),
                reconcileReminder: {
                    enabled: reminderEnabled,
                    hour: remH,
                    minute: remM,
                },
                sleepTemplate: {
                    ...(policy.sleepTemplate || { version: 1 }),
                    enabled: sleepEnabled,
                    startTime: sleepStartNorm,
                    endTime: sleepEndNorm,
                },
            };
            await workspace.time.updatePolicy({
                expectedPolicyVersion: policy.policyVersion,
                patch,
            });
            await showToast({
                style: Toast.Style.Success,
                title: "已保存时间成本设置",
                message: "新单价从下一段计时开始生效",
            });
            await onSaved?.();
            pop();
        } catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: "保存设置失败",
                message: formatTimeActionError(err),
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <Form
            isLoading={isLoading || saving}
            navigationTitle="时间单价与习惯设置"
            actions={
                <ActionPanel>
                    <Action.SubmitForm
                        title="保存设置"
                        icon={Icon.Check}
                        onSubmit={handleSubmit}
                    />
                </ActionPanel>
            }
        >
            <Form.TextField
                id="rate-yuan"
                title="我的时间单价（¥/小时）"
                value={rateYuan}
                onChange={setRateYuan}
                placeholder="例如 100"
            />
            <Form.Description
                title="即时换算"
                text={`${formatRateConversionHint(previewCents)}（修改单价后从下一段计时生效，历史保留原单价）`}
            />
            <Form.Checkbox
                id="highlight-cost"
                label="默认任务列表突出显示金额（时间作为辅助信息）"
                value={highlightCost}
                onChange={setHighlightCost}
            />
            <Form.TextField
                id="threshold-hours"
                title="长时段检查点（小时）"
                value={thresholdHours}
                onChange={setThresholdHours}
            />
            <Form.Checkbox
                id="reminder-enabled"
                label="启用每日复核提醒"
                value={reminderEnabled}
                onChange={setReminderEnabled}
            />
            <Form.TextField
                id="reminder-time"
                title="复核提醒时刻"
                value={reminderTime}
                onChange={setReminderTime}
                placeholder="21:30"
            />
            <Form.Checkbox
                id="sleep-enabled"
                label="启用默认睡眠候选（睡眠计 ¥0 · 免除 6h 检查点）"
                value={sleepEnabled}
                onChange={setSleepEnabled}
            />
            <Form.TextField
                id="sleep-start"
                title="睡眠开始"
                value={sleepStart}
                onChange={setSleepStart}
            />
            <Form.TextField
                id="sleep-end"
                title="起床时刻"
                value={sleepEnd}
                onChange={setSleepEnd}
            />
        </Form>
    );
}

export function TimeWorkspaceScreen({
    workspace,
    knownProjects = [],
    knownTags = [],
    tasks = [],
    initialTab = "today",
    onMutated,
}: {
    workspace: WorkspaceClient | undefined;
    knownProjects?: string[];
    knownTags?: string[];
    tasks?: TaskwarriorTask[];
    initialTab?: TimeWorkspaceTab;
    onMutated?: () => unknown;
}) {
    const [tab, setTab] = useState<TimeWorkspaceTab>(initialTab);
    const [dateStr, setDateStr] = useState(() => localTimeDate(Date.now()));
    const [granularity, setGranularity] =
        useState<CostReportGranularity>("week");
    const [sortBy, setSortBy] = useState<CostReportSortBy>("highest_cost");
    const [reportScope, setReportScope] = useState<"task" | "project">("task");
    const [showDetail, setShowDetail] = useState(true);

    const taskByUuid = useMemo(
        () => new Map(tasks.map((t) => [t.uuid.toLowerCase(), t])),
        [tasks],
    );

    const { data, isLoading, error, revalidate } = usePromise(
        async (
            activeTab: TimeWorkspaceTab,
            targetDate: string,
            repGran: CostReportGranularity,
            repSort: CostReportSortBy,
        ) => {
            if (!workspace?.time) {
                throw new Error("Aster Shared Workspace 未连接或版本过旧。");
            }
            const status = await workspace.time.status();
            const rate = normalizeHourlyRateCents(
                status.policy?.hourlyRateCents,
            );
            if (activeTab === "today") {
                const [daily, plansRes] = await Promise.all([
                    workspace.time.daily(targetDate),
                    workspace.time.plans({ includeArchived: false }),
                ]);
                return {
                    status,
                    rate,
                    daily,
                    plans: plansRes.plans,
                };
            }
            if (activeTab === "weekly") {
                const weekly = await workspace.time.weekly(targetDate);
                return { status, rate, weekly };
            }
            const report = await workspace.time.costReport({
                granularity: repGran,
                date: targetDate,
                sortBy: repSort,
            });
            return { status, rate, report };
        },
        [tab, dateStr, granularity, sortBy],
    );

    async function refreshAll() {
        await Promise.all([revalidate(), onMutated?.()]);
    }

    async function runMutation(title: string, fn: () => Promise<unknown>) {
        try {
            await fn();
            await showToast({ style: Toast.Style.Success, title });
            await refreshAll();
        } catch (err) {
            await showToast({
                style: Toast.Style.Failure,
                title: "操作失败",
                message: formatTimeActionError(err),
            });
        }
    }

    const rate = data?.rate ?? DEFAULT_HOURLY_RATE_CENTS;

    const commonPanelActions = workspace?.time ? (
        <ActionPanel.Section title="时间工作区">
            <Action.Push
                title="新建限时计时安排"
                icon={Icon.Stopwatch}
                shortcut={Keyboard.Shortcut.Common.New}
                target={
                    <CreateBoundedPlanForm
                        workspace={workspace}
                        knownProjects={knownProjects}
                        knownTags={knownTags}
                        hourlyRateCents={rate}
                        onSaved={refreshAll}
                    />
                }
            />
            <Action.Push
                title="补记已发生时段"
                icon={Icon.PlusCircle}
                shortcut={{
                    macOS: { modifiers: ["cmd", "shift"], key: "l" },
                    Windows: { modifiers: ["ctrl", "shift"], key: "l" },
                }}
                target={
                    <TimeSegmentForm
                        workspace={workspace}
                        mode="log"
                        defaultDate={dateStr}
                        knownProjects={knownProjects}
                        knownTags={knownTags}
                        onSaved={refreshAll}
                    />
                }
            />
            <Action
                title={showDetail ? "隐藏右侧明细" : "显示右侧明细"}
                icon={Icon.AppWindowSidebarRight}
                shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                onAction={() => setShowDetail((v) => !v)}
            />
            <Action.Push
                title="时间单价与设置…"
                icon={Icon.Gear}
                target={
                    <TimeSettingsForm
                        workspace={workspace}
                        onSaved={refreshAll}
                    />
                }
            />
            <Action
                title="前移日期 / 周期"
                icon={Icon.ChevronLeft}
                shortcut={{
                    macOS: { modifiers: ["cmd"], key: "[" },
                    Windows: { modifiers: ["ctrl"], key: "[" },
                }}
                onAction={() =>
                    setDateStr((d) =>
                        addLocalDays(
                            d,
                            tab === "today"
                                ? -1
                                : tab === "weekly" || granularity === "week"
                                  ? -7
                                  : -30,
                        ),
                    )
                }
            />
            <Action
                title="回到今天"
                icon={Icon.Calendar}
                onAction={() => setDateStr(localTimeDate(Date.now()))}
            />
            <Action
                title="后移日期 / 周期"
                icon={Icon.ChevronRight}
                shortcut={{
                    macOS: { modifiers: ["cmd"], key: "]" },
                    Windows: { modifiers: ["ctrl"], key: "]" },
                }}
                onAction={() =>
                    setDateStr((d) =>
                        addLocalDays(
                            d,
                            tab === "today"
                                ? 1
                                : tab === "weekly" || granularity === "week"
                                  ? 7
                                  : 30,
                        ),
                    )
                }
            />
            <Action
                title="刷新"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={refreshAll}
            />
        </ActionPanel.Section>
    ) : null;

    function resolveTaskForUuid(uuid: string, fallbackTitle: string): TaskwarriorTask {
        const found = taskByUuid.get(uuid.toLowerCase());
        if (found) return found;
        return {
            id: 0,
            uuid,
            description: fallbackTitle,
            status: "pending",
            tags: [],
            depends: [],
            annotations: [],
            urgency: 0,
        };
    }

    function renderSegmentRow(seg: LocatedSegment) {
        const needsReview = seg.reviewState !== "ok";
        const costText =
            seg.categoryId === "sleep"
                ? "¥0 (睡眠)"
                : needsReview
                  ? `暂计 ${formatCurrencyCny(seg.provisionalCostCents)}`
                  : formatCurrencyCny(seg.confirmedCostCents);
        const markdown = [
            `# ${seg.title}`,
            `- 时段：${formatClockRange(seg.startMs, seg.endMs)}（${formatDurationCn(seg.durationSeconds)}）`,
            `- 项目 / 标签：${formatProjectAndTags(seg.projectSnapshot, seg.tags, seg.categoryId)}`,
            `- 状态：${seg.running ? "计时中" : needsReview ? "待核对（不计入正式成本）" : "已核对入账"}`,
            `- 成本：${costText}`,
        ].join("\n\n");

        return (
            <List.Item
                key={seg.activityId}
                title={seg.title}
                subtitle={`${formatClockRange(seg.startMs, seg.endMs)} · ${formatProjectAndTags(seg.projectSnapshot, seg.tags, seg.categoryId)}`}
                icon={
                    seg.running
                        ? { source: Icon.Play, tintColor: toneColor("timer") }
                        : needsReview
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
                    { text: `${costText} · ${formatDurationShort(seg.durationSeconds)}` },
                    ...(needsReview
                        ? [{ tag: { value: "待核对", color: Color.Yellow } }]
                        : []),
                ]}
                detail={
                    showDetail ? (
                        <List.Item.Detail markdown={markdown} />
                    ) : undefined
                }
                actions={
                    <ActionPanel>
                        {seg.running && workspace?.time ? (
                            <Action
                                title="停止当前计时"
                                icon={Icon.Stop}
                                onAction={() =>
                                    runMutation("计时已停止", () =>
                                        workspace.time!.stop(),
                                    )
                                }
                            />
                        ) : null}
                        {needsReview && !seg.running && workspace?.time ? (
                            <Action
                                title="确认这段并入账"
                                icon={Icon.CheckCircle}
                                onAction={() =>
                                    runMutation("已确认入账", () =>
                                        workspace.time!.confirm({
                                            activityId: seg.activityId,
                                            expectedVersion: seg.version,
                                            throughMs: seg.endMs,
                                        }),
                                    )
                                }
                            />
                        ) : null}
                        {workspace ? (
                            <Action.Push
                                title="修正结束时间 / 项目与标签"
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
                        ) : null}
                        {commonPanelActions}
                    </ActionPanel>
                }
            />
        );
    }

    function renderPlanRow(plan: TimingPlan) {
        const allowanceText = plan.allowanceSeconds
            ? formatDurationShort(plan.allowanceSeconds)
            : "不限";
        const remainingText =
            plan.remainingSeconds !== undefined
                ? formatDurationShort(plan.remainingSeconds)
                : "--";
        const budgetText = plan.initialBudgetCents
            ? formatCurrencyCny(
                  plan.currentBudgetCents ?? plan.initialBudgetCents,
              )
            : "";
        return (
            <List.Item
                key={plan.id}
                title={plan.title}
                subtitle={`${timingPlanStatusLabel(plan)} · 剩余 ${remainingText}/${allowanceText}${plan.hardStopAtMs ? ` · 最晚 ${formatClockTime(plan.hardStopAtMs)}` : ""}`}
                icon={
                    plan.status === "active"
                        ? { source: Icon.Play, tintColor: toneColor("timer") }
                        : Icon.Clock
                }
                accessories={[
                    ...(budgetText ? [{ text: budgetText }] : []),
                    { tag: timingPlanStatusLabel(plan) },
                ]}
                detail={
                    showDetail ? (
                        <List.Item.Detail
                            markdown={[
                                `# ${plan.title}`,
                                `- 状态：**${timingPlanStatusLabel(plan)}**`,
                                `- 额度：${allowanceText}（剩余 ${remainingText}）`,
                                plan.plannedStartAtMs
                                    ? `- 计划开始：${formatDateAndClock(plan.plannedStartAtMs)}（不自动启动）`
                                    : "- 计划开始：未设",
                                plan.hardStopAtMs
                                    ? `- 最晚停止：${formatDateAndClock(plan.hardStopAtMs)}`
                                    : "- 最晚停止：未设",
                                `- 关联：${formatProjectAndTags(plan.projectSnapshot, plan.tags, plan.categoryId)}`,
                            ].join("\n\n")}
                        />
                    ) : undefined
                }
                actions={
                    <ActionPanel>
                        {(plan.status === "scheduled" ||
                            plan.status === "paused") &&
                        workspace?.time ? (
                            <Action
                                title={
                                    plan.status === "paused"
                                        ? "继续计时"
                                        : "手动开始"
                                }
                                icon={Icon.Play}
                                onAction={() =>
                                    runMutation("计时已开始", () =>
                                        workspace.time!.startPlan({
                                            planId: plan.id,
                                        }),
                                    )
                                }
                            />
                        ) : null}
                        {plan.status === "active" && workspace?.time ? (
                            <>
                                <Action
                                    title="暂停（保留额度）"
                                    icon={Icon.Pause}
                                    onAction={() =>
                                        runMutation("已暂停计时", () =>
                                            workspace.time!.stop({
                                                pause: true,
                                            }),
                                        )
                                    }
                                />
                                <Action
                                    title="停止计时"
                                    icon={Icon.Stop}
                                    onAction={() =>
                                        runMutation("已停止计时", () =>
                                            workspace.time!.stop({
                                                pause: false,
                                            }),
                                        )
                                    }
                                />
                            </>
                        ) : null}
                        {workspace && plan.status !== "archived" ? (
                            <Action.Push
                                title="增加时间并继续…"
                                icon={Icon.Plus}
                                target={
                                    <ExtendPlanForm
                                        workspace={workspace}
                                        plan={plan}
                                        hourlyRateCents={rate}
                                        resumeAfterExtend={
                                            plan.status === "stopped" ||
                                            plan.status === "paused"
                                        }
                                        onSaved={refreshAll}
                                    />
                                }
                            />
                        ) : null}
                        {workspace?.time ? (
                            <Action
                                title="归档此安排"
                                icon={Icon.Tray}
                                onAction={() =>
                                    runMutation("已归档", () =>
                                        workspace.time!.updatePlan({
                                            planId: plan.id,
                                            expectedVersion: plan.version,
                                            archived: true,
                                        }),
                                    )
                                }
                            />
                        ) : null}
                        {commonPanelActions}
                    </ActionPanel>
                }
            />
        );
    }

    const navigationTitle =
        tab === "today"
            ? `今日时间 (${dateStr}) · ¥${(rate / 100).toFixed(0)}/h`
            : tab === "weekly"
              ? `本周分布 (${dateStr})`
              : `成本报告 (${granularity === "month" ? "按月" : "按周"} · ${dateStr})`;

    return (
        <List
            isLoading={isLoading}
            isShowingDetail={showDetail}
            navigationTitle={navigationTitle}
            searchBarPlaceholder="筛选时间记录、项目、标签或任务…"
            searchBarAccessory={
                <List.Dropdown
                    tooltip="切换时间视图"
                    value={tab}
                    onChange={(v) => setTab(v as TimeWorkspaceTab)}
                >
                    <List.Dropdown.Item
                        value="today"
                        title="今日记录与限时安排"
                        icon={Icon.Clock}
                    />
                    <List.Dropdown.Item
                        value="weekly"
                        title="本周分布（项目 + 标签）"
                        icon={Icon.BarChart}
                    />
                    <List.Dropdown.Item
                        value="report"
                        title="投入成本报告"
                        icon={Icon.Coins}
                    />
                </List.Dropdown>
            }
        >
            {error ? (
                <List.EmptyView
                    icon={Icon.Warning}
                    title="无法加载时间工作区"
                    description={formatTimeActionError(error)}
                    actions={<ActionPanel>{commonPanelActions}</ActionPanel>}
                />
            ) : null}

            {tab === "today" && data?.daily ? (
                <>
                    <List.Section title={`今日概览 · ${data.daily.date}`}>
                        <List.Item
                            title={`已确认成本 ${formatCurrencyCny(data.daily.confirmedCostCents)}`}
                            subtitle={`已覆盖 ${formatDurationCn(data.daily.coveredSeconds)} · 空白 ${formatDurationCn(data.daily.unrecordedSeconds)}`}
                            icon={Icon.Coins}
                            accessories={[
                                ...(data.daily.provisionalCostCents > 0
                                    ? [
                                          {
                                              tag: {
                                                  value: `待核对 暂计 ${formatCurrencyCny(data.daily.provisionalCostCents)}`,
                                                  color: Color.Yellow,
                                              },
                                          },
                                      ]
                                    : []),
                            ]}
                            detail={
                                showDetail ? (
                                    <List.Item.Detail
                                        markdown={[
                                            `# 今日时间成本 (${data.daily.date})`,
                                            `- **已确认入账**：${formatCurrencyCny(data.daily.confirmedCostCents)}（${formatDurationCn(data.daily.coveredSeconds)}）`,
                                            `- **待核对（单列不入正式合计）**：${formatCurrencyCny(data.daily.provisionalCostCents)}（${formatDurationCn(data.daily.provisionalSeconds)}）`,
                                            `- **当前时间单价**：${formatCurrencyCny(rate)} / 小时`,
                                            `- **空白时段**：${formatDurationCn(data.daily.unrecordedSeconds)}`,
                                        ].join("\n\n")}
                                    />
                                ) : undefined
                            }
                            actions={
                                <ActionPanel>{commonPanelActions}</ActionPanel>
                            }
                        />
                        {data.daily.sleepCandidates
                            .filter((c) => c.status === "pending")
                            .map((cand) => (
                                <List.Item
                                    key={cand.key}
                                    title={`睡眠候选 ${formatClockRange(cand.startMs, cand.endMs)}`}
                                    subtitle="按 ¥0 记入时间成本，免除 6h 长时段检查点"
                                    icon={Icon.Moon}
                                    actions={
                                        <ActionPanel>
                                            {workspace?.time ? (
                                                <>
                                                    <Action
                                                        title="确认睡眠记录"
                                                        icon={Icon.Check}
                                                        onAction={() =>
                                                            runMutation(
                                                                "已确认睡眠时段",
                                                                () =>
                                                                    workspace.time!.sleepConfirm(
                                                                        cand.date,
                                                                    ),
                                                            )
                                                        }
                                                    />
                                                    <Action
                                                        title="忽略此候选"
                                                        icon={Icon.XMarkCircle}
                                                        onAction={() =>
                                                            runMutation(
                                                                "已忽略睡眠候选",
                                                                () =>
                                                                    workspace.time!.sleepDismiss(
                                                                        cand.date,
                                                                    ),
                                                            )
                                                        }
                                                    />
                                                </>
                                            ) : null}
                                            {commonPanelActions}
                                        </ActionPanel>
                                    }
                                />
                            ))}
                    </List.Section>

                    {(data.plans || []).length > 0 ? (
                        <List.Section title={`限时安排 (${data.plans?.length})`}>
                            {(data.plans || []).map(renderPlanRow)}
                        </List.Section>
                    ) : null}

                    <List.Section
                        title={`今日时间段 (${data.daily.locatedSegments.length})`}
                    >
                        {data.daily.locatedSegments.map(renderSegmentRow)}
                    </List.Section>
                </>
            ) : null}

            {tab === "weekly" && data?.weekly ? (
                <>
                    <List.Section
                        title={`本周总览 (${data.weekly.weekStartDate} – ${data.weekly.weekEndDate})`}
                    >
                        <List.Item
                            title={`本周已确认 ${formatCurrencyCny(data.weekly.confirmedCostCents)}`}
                            subtitle={`总已记 ${formatDurationCn(data.weekly.coveredSeconds)} · 待核对 ${formatCurrencyCny(data.weekly.provisionalCostCents)}`}
                            icon={Icon.BarChart}
                            detail={
                                showDetail ? (
                                    <List.Item.Detail
                                        markdown={[
                                            `# 本周投入分布`,
                                            `周期：${data.weekly.weekStartDate} 至 ${data.weekly.weekEndDate}`,
                                            `- 已确认成本：**${formatCurrencyCny(data.weekly.confirmedCostCents)}**`,
                                            `- 待核对暂计：**${formatCurrencyCny(data.weekly.provisionalCostCents)}**`,
                                            `- 覆盖时长：${formatDurationCn(data.weekly.coveredSeconds)}`,
                                        ].join("\n\n")}
                                    />
                                ) : undefined
                            }
                            actions={
                                <ActionPanel>{commonPanelActions}</ActionPanel>
                            }
                        />
                    </List.Section>
                    <List.Section title="按 Taskwarrior 项目">
                        {Object.entries(data.weekly.byProjectSeconds)
                            .sort(([, a], [, b]) => b - a)
                            .map(([key, secs]) => {
                                const cost =
                                    data.weekly!.byProjectCostCents[key] ?? 0;
                                const pct =
                                    data.weekly!.coveredSeconds > 0
                                        ? Math.round(
                                              (secs /
                                                  data.weekly!.coveredSeconds) *
                                                  100,
                                          )
                                        : 0;
                                const label =
                                    key === "__unassigned__" ? "未关联项目" : key;
                                return (
                                    <List.Item
                                        key={`proj:${key}`}
                                        title={label}
                                        subtitle={`${formatDurationCn(secs)} · 占 ${pct}%`}
                                        icon={Icon.Folder}
                                        accessories={[
                                            { text: formatCurrencyCny(cost) },
                                        ]}
                                        detail={
                                            showDetail ? (
                                                <List.Item.Detail
                                                    markdown={`# ${label}\n\n- 时长：${formatDurationCn(secs)}（占比 ${pct}%）\n- 时间成本：**${formatCurrencyCny(cost)}**`}
                                                />
                                            ) : undefined
                                        }
                                        actions={
                                            <ActionPanel>
                                                {commonPanelActions}
                                            </ActionPanel>
                                        }
                                    />
                                );
                            })}
                    </List.Section>
                    <List.Section title="按标签 (#tag)">
                        {Object.entries(data.weekly.byTagSeconds)
                            .sort(([, a], [, b]) => b - a)
                            .map(([tag, secs]) => {
                                const cost =
                                    data.weekly!.byTagCostCents[tag] ?? 0;
                                const label =
                                    tag === "__untagged__" ? "无标签" : `#${tag}`;
                                return (
                                    <List.Item
                                        key={`tag:${tag}`}
                                        title={label}
                                        subtitle={formatDurationCn(secs)}
                                        icon={Icon.Tag}
                                        accessories={[
                                            { text: formatCurrencyCny(cost) },
                                        ]}
                                        detail={
                                            showDetail ? (
                                                <List.Item.Detail
                                                    markdown={`# ${label}\n\n- 时长：${formatDurationCn(secs)}\n- 时间成本：**${formatCurrencyCny(cost)}**`}
                                                />
                                            ) : undefined
                                        }
                                        actions={
                                            <ActionPanel>
                                                {commonPanelActions}
                                            </ActionPanel>
                                        }
                                    />
                                );
                            })}
                    </List.Section>
                </>
            ) : null}

            {tab === "report" && data?.report ? (
                <>
                    <List.Section
                        title={`成本报告 (${data.report.periodStartDate} – ${data.report.periodEndDate})`}
                    >
                        <List.Item
                            title={`期间综合投入 ${formatCurrencyCny(data.report.totalCombinedCostCents)}`}
                            subtitle={`时间成本 ${formatCurrencyCny(data.report.totalPeriodConfirmedCostCents)} · 现金支出 ${formatCurrencyCny(data.report.totalCashExpenseCents)} · 排序：${sortBy === "highest_over_budget" ? "超出最初预估最多" : "时间成本最高"}`}
                            icon={Icon.Coins}
                            accessories={[
                                ...(data.report.totalPeriodProvisionalCostCents >
                                0
                                    ? [
                                          {
                                              tag: {
                                                  value: `待核对 ${formatCurrencyCny(data.report.totalPeriodProvisionalCostCents)}`,
                                                  color: Color.Yellow,
                                              },
                                          },
                                      ]
                                    : []),
                                {
                                    tag: `${granularity === "month" ? "按月" : "按周"} · ${reportScope === "project" ? "按项目" : "按任务"}`,
                                },
                            ]}
                            detail={
                                showDetail ? (
                                    <List.Item.Detail
                                        markdown={[
                                            `# 期间投入汇总 (${data.report.periodStartDate} – ${data.report.periodEndDate})`,
                                            `- **已确认时间成本**：${formatCurrencyCny(data.report.totalPeriodConfirmedCostCents)}（${formatDurationCn(data.report.totalPeriodConfirmedSeconds)}）`,
                                            `- **待核对金额（单列）**：${formatCurrencyCny(data.report.totalPeriodProvisionalCostCents)}（${formatDurationCn(data.report.totalPeriodProvisionalSeconds)}）`,
                                            `- **关联现金支出**：${formatCurrencyCny(data.report.totalCashExpenseCents)}`,
                                            `- **综合投入**：${formatCurrencyCny(data.report.totalCombinedCostCents)}`,
                                        ].join("\n\n")}
                                    />
                                ) : undefined
                            }
                            actions={
                                <ActionPanel>
                                    <Action
                                        title={
                                            sortBy === "highest_cost"
                                                ? "切换排序：超出最初预估最多"
                                                : "切换排序：时间成本最高"
                                        }
                                        icon={Icon.Switch}
                                        onAction={() =>
                                            setSortBy((s) =>
                                                s === "highest_cost"
                                                    ? "highest_over_budget"
                                                    : "highest_cost",
                                            )
                                        }
                                    />
                                    <Action
                                        title={
                                            granularity === "week"
                                                ? "切换到：按月查看"
                                                : "切换到：按周查看"
                                        }
                                        icon={Icon.Calendar}
                                        onAction={() =>
                                            setGranularity((g) =>
                                                g === "week" ? "month" : "week",
                                            )
                                        }
                                    />
                                    <Action
                                        title={
                                            reportScope === "task"
                                                ? "切换到：按项目汇总"
                                                : "切换到：按任务汇总"
                                        }
                                        icon={Icon.List}
                                        onAction={() =>
                                            setReportScope((v) =>
                                                v === "task" ? "project" : "task",
                                            )
                                        }
                                    />
                                    {commonPanelActions}
                                </ActionPanel>
                            }
                        />
                    </List.Section>

                    {reportScope === "task" ? (
                        <List.Section
                            title={`按任务明细 (${data.report.byTask.length})`}
                        >
                            {data.report.byTask.map((row) => {
                                const taskObj = resolveTaskForUuid(
                                    row.taskUuid,
                                    row.title,
                                );
                                return (
                                    <List.Item
                                        key={row.taskUuid}
                                        title={row.title}
                                        subtitle={`${formatDurationCn(row.periodSeconds)} · 累计 ${formatCurrencyCny(row.cumulativeCostCents)}${row.hasBudget ? ` / 初预 ${formatCurrencyCny(row.initialBudgetCents ?? 0)}` : " · 未设预算"}`}
                                        icon={Icon.Circle}
                                        accessories={[
                                            {
                                                text: `${formatCurrencyCny(row.periodCostCents)}${row.cashExpenseCents > 0 ? ` + 现金 ${formatCurrencyCny(row.cashExpenseCents)}` : ""}`,
                                            },
                                            ...(row.overInitialBudgetCents > 0
                                                ? [
                                                      {
                                                          tag: {
                                                              value: `超出 ${formatCurrencyCny(row.overInitialBudgetCents)}`,
                                                              color: toneColor(
                                                                  "overdue",
                                                              ),
                                                          },
                                                      },
                                                  ]
                                                : []),
                                        ]}
                                        detail={
                                            showDetail ? (
                                                <List.Item.Detail
                                                    markdown={[
                                                        `# ${row.title}`,
                                                        `- 本期投入：${formatCurrencyCny(row.periodCostCents)}（${formatDurationCn(row.periodSeconds)}）`,
                                                        `- 任务累计：${formatCurrencyCny(row.cumulativeCostCents)}（${formatDurationCn(row.cumulativeSeconds)}）`,
                                                        row.hasBudget
                                                            ? `- 最初预估：${formatCurrencyCny(row.initialBudgetCents ?? 0)} · 当前预算：${formatCurrencyCny(row.currentBudgetCents ?? 0)}`
                                                            : "- 预算：未设预算",
                                                        row.cashExpenseCents > 0
                                                            ? `- 现金支出：${formatCurrencyCny(row.cashExpenseCents)} · 综合投入：${formatCurrencyCny(row.combinedCumulativeCostCents)}`
                                                            : "",
                                                        row.segments.length > 0
                                                            ? `## 期间记录\n${row.segments
                                                                  .slice(0, 8)
                                                                  .map(
                                                                      (s) =>
                                                                          `- ${s.date} ${formatClockRange(s.startMs, s.endMs)} · ${formatCurrencyCny(s.confirmedCostCents)}${s.provisionalCostCents > 0 ? ` (暂计 ${formatCurrencyCny(s.provisionalCostCents)})` : ""}`,
                                                                  )
                                                                  .join("\n")}`
                                                            : "",
                                                    ]
                                                        .filter(Boolean)
                                                        .join("\n\n")}
                                                />
                                            ) : undefined
                                        }
                                        actions={
                                            <ActionPanel>
                                                {workspace ? (
                                                    <Action.Push
                                                        title="查看任务成本与账单明细"
                                                        icon={Icon.Coins}
                                                        target={
                                                            <TaskCostDetailScreen
                                                                workspace={
                                                                    workspace
                                                                }
                                                                task={taskObj}
                                                                knownProjects={
                                                                    knownProjects
                                                                }
                                                                knownTags={
                                                                    knownTags
                                                                }
                                                                onChanged={
                                                                    refreshAll
                                                                }
                                                            />
                                                        }
                                                    />
                                                ) : null}
                                                <Action
                                                    title={
                                                        sortBy === "highest_cost"
                                                            ? "切换排序：超出最初预估最多"
                                                            : "切换排序：时间成本最高"
                                                    }
                                                    icon={Icon.Switch}
                                                    onAction={() =>
                                                        setSortBy((s) =>
                                                            s === "highest_cost"
                                                                ? "highest_over_budget"
                                                                : "highest_cost",
                                                        )
                                                    }
                                                />
                                                <Action
                                                    title="切换到按项目汇总"
                                                    icon={Icon.List}
                                                    onAction={() =>
                                                        setReportScope("project")
                                                    }
                                                />
                                                {commonPanelActions}
                                            </ActionPanel>
                                        }
                                    />
                                );
                            })}
                        </List.Section>
                    ) : (
                        <List.Section
                            title={`按项目汇总 (${data.report.byProject.length})`}
                        >
                            {data.report.byProject.map((row) => (
                                <List.Item
                                    key={row.projectKey}
                                    title={row.projectName}
                                    subtitle={`${row.taskCount} 项任务 · ${formatDurationCn(row.periodSeconds)}`}
                                    icon={Icon.Folder}
                                    accessories={[
                                        {
                                            text: `综合 ${formatCurrencyCny(row.combinedPeriodCostCents)}`,
                                        },
                                        ...(row.overInitialBudgetCents > 0
                                            ? [
                                                  {
                                                      tag: {
                                                          value: `超出 ${formatCurrencyCny(row.overInitialBudgetCents)}`,
                                                          color: toneColor(
                                                              "overdue",
                                                          ),
                                                      },
                                                  },
                                              ]
                                            : []),
                                    ]}
                                    detail={
                                        showDetail ? (
                                            <List.Item.Detail
                                                markdown={[
                                                    `# ${row.projectName}`,
                                                    `- 本期时间成本：${formatCurrencyCny(row.periodCostCents)}（${formatDurationCn(row.periodSeconds)}）`,
                                                    row.cashExpenseCents > 0
                                                        ? `- 关联现金支出：${formatCurrencyCny(row.cashExpenseCents)}`
                                                        : "",
                                                    `- 综合投入：**${formatCurrencyCny(row.combinedPeriodCostCents)}**`,
                                                ]
                                                    .filter(Boolean)
                                                    .join("\n\n")}
                                            />
                                        ) : undefined
                                    }
                                    actions={
                                        <ActionPanel>
                                            <Action
                                                title="切换到按任务汇总"
                                                icon={Icon.List}
                                                onAction={() =>
                                                    setReportScope("task")
                                                }
                                            />
                                            {commonPanelActions}
                                        </ActionPanel>
                                    }
                                />
                            ))}
                        </List.Section>
                    )}

                    {(data.report.unassignedSegments || []).length > 0 ? (
                        <List.Section
                            title={`未关联任务时段 (${data.report.unassignedSegments.length})`}
                        >
                            {data.report.unassignedSegments.map((seg) => (
                                <List.Item
                                    key={seg.activityId}
                                    title={seg.title}
                                    subtitle={`${seg.date} ${formatClockRange(seg.startMs, seg.endMs)} · ${formatProjectAndTags(seg.projectSnapshot, seg.tags)}`}
                                    accessories={[
                                        {
                                            text: formatCurrencyCny(
                                                seg.confirmedCostCents,
                                            ),
                                        },
                                    ]}
                                    actions={
                                        <ActionPanel>
                                            {commonPanelActions}
                                        </ActionPanel>
                                    }
                                />
                            ))}
                        </List.Section>
                    ) : null}
                </>
            ) : null}
        </List>
    );
}
