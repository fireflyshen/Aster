import type {
  Activity,
  DailyLedgerSummary,
  LocatedSegment,
  TimePolicy,
  TimerSnapshot,
  TimelineGap,
} from "@core/time/model";
import { snapshotLiveStatus } from "@core/time/snapshot";
import { addLocalDays, localDateOf } from "@core/time/zone";
import type { Task } from "@shared/tasks";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Moon,
  Pencil,
  Play,
  Plus,
  Square,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
  confirmSleepCandidate,
  dismissSleepCandidate,
  estimateTimeActivity,
  locateTimeEstimate,
  logTimeActivity,
  resolveTimeOperation,
  startTimeActivity,
  stopTimeActivity,
  updateTimeActivity,
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
  formatClockInZone,
  formatDurationChinese,
  formatDurationCompact,
  formatEstimateWindow,
  formatTimeRangeInZone,
  resolveCategoryLabel,
} from "./time-format";
import type { PendingOperationDetail } from "./use-time-ledger";

type TimelineItem =
  | { kind: "segment"; startMs: number; segment: LocatedSegment }
  | { kind: "gap"; startMs: number; gap: TimelineGap };

export function TimeTodayPage({
  status,
  policy,
  selectedDate,
  onSelectDate,
  daily,
  pendingDetails,
  tasks,
  timerSnapshot,
  timerLiveStatus,
  activeActivitySeconds,
  busy,
  runMutation,
}: {
  status: TimeStatusResponse | null;
  policy: TimePolicy;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  daily: DailyLedgerSummary;
  pendingDetails: PendingOperationDetail[];
  tasks: Task[];
  timerSnapshot?: TimerSnapshot | null;
  timerLiveStatus?: ReturnType<typeof snapshotLiveStatus> | null;
  activeActivitySeconds: number | undefined;
  busy: boolean;
  runMutation: <T extends TimeReceipt | Record<string, unknown>>(
    label: string,
    fn: () => Promise<T>,
    options?: { undoable?: boolean },
  ) => Promise<T | undefined>;
}) {
  const timeZone = policy.timezone || "UTC";
  const todayStr = localDateOf(Date.now(), timeZone);
  const active = status?.activeActivity || null;
  const activeElapsedSec =
    activeActivitySeconds ??
    (active?.startMs !== undefined
      ? Math.max(0, Math.floor((Date.now() - active.startMs) / 1000))
      : undefined);
  const longActivityAlert =
    active &&
    activeElapsedSec !== undefined &&
    policy.longActivityThresholdSeconds > 0 &&
    activeElapsedSec >= policy.longActivityThresholdSeconds;
  const thresholdMinutesLabel = Math.max(
    1,
    Math.round(policy.longActivityThresholdSeconds / 60),
  );
  const pendingSleepCandidates = daily.sleepCandidates.filter(
    (c) => c.status === "pending",
  );

  const [quickTitle, setQuickTitle] = useState("");
  const [quickCategoryId, setQuickCategoryId] = useState("auto");
  const [quickTaskUuid, setQuickTaskUuid] = useState("none");
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

  async function handleQuickStart(e: React.FormEvent) {
    e.preventDefault();
    const chosenTask =
      quickTaskUuid !== "none"
        ? tasks.find((t) => t.uuid === quickTaskUuid)
        : undefined;
    const title = (quickTitle.trim() || chosenTask?.description || "").trim();
    if (!title) return;
    const res = await runMutation(
      `开始：${title}`,
      () =>
        startTimeActivity({
          title,
          explicitCategoryId:
            quickCategoryId !== "auto" ? quickCategoryId : undefined,
          taskUuid: chosenTask?.uuid,
          projectSnapshot: chosenTask?.project || undefined,
          expectedSessionVersion: status?.sessionVersion,
        }),
      { undoable: true },
    );
    if (res) {
      setQuickTitle("");
      setQuickTaskUuid("none");
    }
  }

  return (
    <div className="space-y-5">
      {/* Pending reconcile banner */}
      {pendingDetails.length > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="space-y-3 text-xs">
            <div>
              <p className="font-medium text-foreground">
                有 {pendingDetails.length} 笔跨系统计时操作待人工核对
              </p>
              <p className="mt-0.5 text-muted-foreground">
                为防止误改活动时间线，系统不会自动替你决定结果；核对期间，无关任务完成不受阻塞。
              </p>
            </div>
            <div className="space-y-2">
              {pendingDetails.map((op) => (
                <div
                  key={op.operationId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/80 p-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-medium text-foreground">
                      操作 {op.kind} · {op.operationId.slice(0, 8)}
                    </div>
                    {op.suggestionHint && (
                      <p className="text-muted-foreground">
                        {op.suggestionHint}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {op.kind === "task_start" ? (
                      <Button
                        type="button"
                        size="xs"
                        disabled={busy}
                        onClick={() =>
                          void runMutation("确认任务已开始并补记计时", () =>
                            resolveTimeOperation({
                              operationId: op.operationId,
                              action: "accept_started",
                            }),
                          )
                        }
                      >
                        按实际已开始确认
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="xs"
                        disabled={busy}
                        onClick={() =>
                          void runMutation("确认结束关联活动计时", () =>
                            resolveTimeOperation({
                              operationId: op.operationId,
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
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void runMutation("已按放弃处理", () =>
                          resolveTimeOperation({
                            operationId: op.operationId,
                            action: "dismiss",
                          }),
                        )
                      }
                    >
                      {op.kind === "task_start" ? "确认未发生" : "忽略此记录"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Top Date Controls + Coverage Summary (C + U = T) */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label="前一天"
              onClick={() => onSelectDate(addLocalDays(selectedDate, -1))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Input
              type="date"
              aria-label="选择日期"
              className="h-7 w-[138px] text-xs"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) onSelectDate(e.target.value);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label="后一天"
              onClick={() => onSelectDate(addLocalDays(selectedDate, 1))}
            >
              <ChevronRight className="size-3.5" />
            </Button>
            {selectedDate !== todayStr && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onSelectDate(todayStr)}
              >
                回到今天
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
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
              补记时段
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() =>
                setLogDialogSeed({
                  mode: "estimate",
                  date: selectedDate,
                  startTime: "19:00",
                  endTime: "22:00",
                  estimatedMinutes: "60",
                })
              }
            >
              记录大约时长
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="text-[11px] text-muted-foreground">
              已定位时间 (C)
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {formatDurationChinese(daily.coveredSeconds)}
            </div>
            {daily.estimatedBoundsSeconds > 0 && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                含约边界 {formatDurationCompact(daily.estimatedBoundsSeconds)}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="text-[11px] text-muted-foreground">
              未记录空白 (U)
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-muted-foreground">
              {formatDurationChinese(daily.unrecordedSeconds)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              空白表示未记录，不等于浪费
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="text-[11px] text-muted-foreground">
              已流逝总时间 (C + U = T)
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {formatDurationChinese(daily.pastCapacitySeconds)}
            </div>
            {daily.unlocatedEstimates.length > 0 && (
              <div className="mt-0.5 text-[11px] text-primary">
                另有 {daily.unlocatedEstimates.length} 项待定位估记（不叠加到
                C）
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Active Activity & Quick Start Card */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <Clock className="size-4 text-primary" />
            当前活动
          </h2>
          {timerSnapshot?.state === "restoring" && (
            <Badge variant="outline">系统恢复中（暂停外推）</Badge>
          )}
          {timerLiveStatus?.expired && (
            <Badge variant="outline">快照已过期（停止跳表）</Badge>
          )}
        </div>

        {active ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {active.title}
                  </span>
                  <Badge variant="secondary">
                    {resolveCategoryLabel(active.categoryId, policy)}
                  </Badge>
                  {active.reviewState === "review_required" && (
                    <Badge variant="destructive">待核对</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {active.startMs !== undefined &&
                    `开始于 ${formatClockInZone(active.startMs, timeZone)}`}
                  {activeElapsedSec !== undefined &&
                    ` · 已计 ${formatDurationChinese(activeElapsedSec)}`}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void runMutation(
                    `结束：${active.title}`,
                    () =>
                      stopTimeActivity({
                        expectedActivityId: active.id,
                        expectedVersion: active.version,
                        expectedSessionVersion: status?.sessionVersion,
                      }),
                    { undoable: true },
                  )
                }
              >
                <Square className="size-3.5 fill-current" />
                结束当前计时
              </Button>
            </div>

            {longActivityAlert && (
              <Alert className="border-amber-500/40 bg-amber-500/5 py-2.5">
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-xs">
                  当前活动已持续超过 {thresholdMinutesLabel}{" "}
                  分钟，如果早已切换活动，可结束并修正实际结束时间。
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            当前没有进行中的计时。可以直接开始生活、学习、运动或任务活动（无需先建任务）。
          </p>
        )}

        <form
          onSubmit={(e) => void handleQuickStart(e)}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <Input
            className="h-8 min-w-[180px] flex-1 text-xs"
            placeholder={
              active
                ? "切换到新活动（会自动结束上一条）…"
                : "现在开始做什么？（例如：散步、看书、写周报）"
            }
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
          />
          <Select value={quickCategoryId} onValueChange={setQuickCategoryId}>
            <SelectTrigger
              className="h-8 w-[128px] text-xs"
              aria-label="活动分类"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动分类</SelectItem>
              {policy.categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
              <SelectItem value="uncategorized">未分类</SelectItem>
            </SelectContent>
          </Select>
          <Select value={quickTaskUuid} onValueChange={setQuickTaskUuid}>
            <SelectTrigger
              className="h-8 w-[160px] text-xs"
              aria-label="关联任务"
            >
              <SelectValue placeholder="关联任务" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">独立活动（不关联）</SelectItem>
              {pendingTasks.slice(0, 50).map((task) => (
                <SelectItem key={task.uuid} value={task.uuid}>
                  {task.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="submit"
            size="sm"
            disabled={busy || (!quickTitle.trim() && quickTaskUuid === "none")}
          >
            <Play className="size-3.5" />
            {active ? "切换计时" : "开始计时"}
          </Button>
        </form>
      </section>

      {/* Sleep Candidate Cards */}
      {pendingSleepCandidates.map((cand) => (
        <section
          key={cand.key}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Moon className="size-4 text-primary" />
              作息候选（{cand.date}）：
              {formatTimeRangeInZone(cand.startMs, cand.endMs, timeZone)}
            </div>
            <p className="text-xs text-muted-foreground">
              {cand.hasConflict
                ? "该睡眠窗口与已有记录存在重叠，确认前请先检查当天时段。"
                : "根据你的作息模板生成；如果昨晚正常休息，可一键确认，跳过也不会反复催促。"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void runMutation("已跳过本日作息候选", () =>
                  dismissSleepCandidate(cand.date),
                )
              }
            >
              跳过
            </Button>
            <Button
              type="button"
              size="xs"
              disabled={busy || cand.hasConflict}
              onClick={() =>
                void runMutation(
                  "已确认睡眠照常",
                  () => confirmSleepCandidate(cand.date),
                  { undoable: true },
                )
              }
            >
              睡眠照常
            </Button>
          </div>
        </section>
      ))}

      {/* In-place Unlocated Estimates */}
      {daily.unlocatedEstimates.length > 0 && (
        <section className="rounded-xl border border-border/70 bg-card/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">
              待定位估记（{daily.unlocatedEstimates.length}）
            </h2>
            <span className="text-[11px] text-muted-foreground">
              就地展示，不直接加进今日已定位总量 C
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {daily.unlocatedEstimates.map((item) => {
              const win = formatEstimateWindow(item, timeZone);
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{item.title}</span>
                      <Badge variant="outline">
                        大约 {formatDurationChinese(item.estimatedSeconds || 0)}
                      </Badge>
                      <Badge variant="secondary">
                        {resolveCategoryLabel(item.categoryId, policy)}
                      </Badge>
                    </div>
                    {win && (
                      <div className="text-xs text-muted-foreground">
                        大致窗口：{win}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    disabled={busy}
                    onClick={() => setLocatingEstimate(item)}
                  >
                    定位到时段
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Chronological Timeline & Clickable Gaps */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">当天时间线</h2>
          <span className="text-[11px] text-muted-foreground">
            共 {daily.locatedSegments.length} 段记录 · {daily.gaps.length}{" "}
            段较长空白
          </span>
        </div>

        {timelineItems.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            这一天暂时还没有已定位记录。可以从上方快速开始计时，或点击“补记时段”。
          </p>
        ) : (
          <div className="space-y-2">
            {timelineItems.map((item) =>
              item.kind === "gap" ? (
                <div
                  key={`gap-${item.gap.startMs}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <span className="font-mono tabular-nums">
                      {formatClockInZone(item.gap.startMs, timeZone)} –{" "}
                      {formatClockInZone(item.gap.endMs, timeZone)}
                    </span>
                    <span>
                      未记录空白 ·{" "}
                      {formatDurationChinese(item.gap.durationSeconds)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      const gapEndDate = localDateOf(item.gap.endMs, timeZone);
                      const endTime =
                        gapEndDate === selectedDate
                          ? formatClockInZone(item.gap.endMs, timeZone)
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
                            Math.round(item.gap.durationSeconds / 60),
                          ),
                        ),
                      });
                    }}
                  >
                    补记这段时间
                  </Button>
                </div>
              ) : (
                <div
                  key={`seg-${item.segment.activityId}-${item.segment.startMs}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2.5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {formatClockInZone(item.segment.startMs, timeZone)} –{" "}
                        {item.segment.running
                          ? "进行中"
                          : formatClockInZone(item.segment.endMs, timeZone)}
                      </span>
                      <span className="truncate text-sm font-medium">
                        {item.segment.title}
                      </span>
                      <Badge variant="secondary">
                        {resolveCategoryLabel(item.segment.categoryId, policy)}
                      </Badge>
                      {item.segment.precision === "estimated_bounds" && (
                        <Badge variant="outline">大约</Badge>
                      )}
                      {item.segment.reviewState === "review_required" && (
                        <Badge variant="destructive">待核对</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      时长 {formatDurationChinese(item.segment.durationSeconds)}
                      {item.segment.projectSnapshot
                        ? ` · 项目 ${item.segment.projectSnapshot}`
                        : ""}
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`编辑 ${item.segment.title}`}
                    disabled={busy}
                    onClick={() => setEditingSegment(item.segment)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      <TimeLogOrEstimateDialog
        open={Boolean(logDialogSeed)}
        onOpenChange={(open) => {
          if (!open) setLogDialogSeed(null);
        }}
        seed={logDialogSeed}
        timeZone={timeZone}
        policy={policy}
        tasks={tasks}
        busy={busy}
        onSubmitLog={async (input) =>
          Boolean(
            await runMutation(
              `已补记：${input.title}`,
              () => logTimeActivity(input),
              { undoable: true },
            ),
          )
        }
        onSubmitEstimate={async (input) =>
          Boolean(
            await runMutation(
              `已记录估记：${input.title}`,
              () => estimateTimeActivity(input),
              { undoable: true },
            ),
          )
        }
      />

      <LocateEstimateDialog
        activity={locatingEstimate}
        defaultDate={selectedDate}
        timeZone={timeZone}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setLocatingEstimate(null);
        }}
        onLocate={async (input) =>
          Boolean(
            await runMutation(
              "已将估记定位到具体时段",
              () => locateTimeEstimate(input),
              { undoable: true },
            ),
          )
        }
      />

      <EditSegmentDialog
        segment={editingSegment}
        date={selectedDate}
        timeZone={timeZone}
        policy={policy}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setEditingSegment(null);
        }}
        onSave={async (input) =>
          Boolean(
            await runMutation(
              "已更新活动记录",
              () => updateTimeActivity(input),
              { undoable: true },
            ),
          )
        }
      />
    </div>
  );
}
