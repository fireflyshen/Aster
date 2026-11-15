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
  ChevronLeft,
  ChevronRight,
  Moon,
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

  const canStart = Boolean(quickTitle.trim() || quickTaskUuid !== "none");

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
            onClick={() => onSelectDate(addLocalDays(selectedDate, -1))}
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
            onClick={() => onSelectDate(addLocalDays(selectedDate, 1))}
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
            title={`已定位 ${formatDurationChinese(daily.coveredSeconds)} · 空白 ${formatDurationChinese(daily.unrecordedSeconds)} · 容量 ${formatDurationChinese(daily.pastCapacitySeconds)}`}
          >
            已记{" "}
            <span className="text-foreground">
              {formatDurationCompact(daily.coveredSeconds)}
            </span>
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
                  {op.suggestionHint ? ` — ${op.suggestionHint}` : ""}
                </span>
                <div className="flex items-center gap-1.5">
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
                      按已开始确认
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
                    variant="ghost"
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
                    忽略
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Now: Active Timer & Single-line Quick Capture */}
      <section className="space-y-5">
        {active && (
          <div className="space-y-2 border-l-2 border-primary/80 pl-4 py-1">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="truncate text-[15px] font-medium text-foreground">
                    {active.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {resolveCategoryLabel(active.categoryId, policy)}
                  </span>
                  {active.reviewState === "review_required" && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">
                      待核对
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  {active.startMs !== undefined && (
                    <span>
                      {formatClockInZone(active.startMs, timeZone)} 开始
                    </span>
                  )}
                  {activeElapsedSec !== undefined && (
                    <span>· {formatDurationChinese(activeElapsedSec)}</span>
                  )}
                  {timerSnapshot?.state === "restoring" && (
                    <span>· 恢复中（暂停外推）</span>
                  )}
                  {timerLiveStatus?.expired && <span>· 快照已过期</span>}
                </div>
              </div>
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
                        expectedActivityId: active.id,
                        expectedVersion: active.version,
                        expectedSessionVersion: status?.sessionVersion,
                      }),
                    { undoable: true },
                  )
                }
              >
                <Square className="size-2.5 fill-current" />
                结束
              </Button>
            </div>
            {longActivityAlert && (
              <p className="text-xs text-amber-600/90 dark:text-amber-400/90">
                已持续超过 {thresholdMinutesLabel} 分钟，若早已结束可在时间线中修正。
              </p>
            )}
          </div>
        )}

        <form
          onSubmit={(e) => void handleQuickStart(e)}
          className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2 transition-colors focus-within:border-foreground/35"
        >
          <input
            type="text"
            className="min-w-[180px] flex-1 bg-transparent py-1 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none"
            placeholder={
              active
                ? "切换到新活动（回车结束上一条）…"
                : "现在开始做什么…（回车直接计时）"
            }
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
          />
          <div className="flex items-center gap-1">
            <Select value={quickCategoryId} onValueChange={setQuickCategoryId}>
              <SelectTrigger
                className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0"
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
                className="h-7 max-w-[140px] gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0"
                aria-label="关联任务"
              >
                <SelectValue placeholder="关联任务" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">独立活动</SelectItem>
                {pendingTasks.slice(0, 50).map((task) => (
                  <SelectItem key={task.uuid} value={task.uuid}>
                    {task.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="submit"
              size="xs"
              variant={canStart ? "default" : "ghost"}
              className={canStart ? "ml-1" : "ml-1 text-muted-foreground/50"}
              disabled={busy || !canStart}
            >
              <Play className="size-3" />
              {active ? "切换" : "开始"}
            </Button>
          </div>
        </form>
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
                    {formatTimeRangeInZone(cand.startMs, cand.endMs, timeZone)}
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
                  variant="outline"
                  disabled={busy || cand.hasConflict}
                  onClick={() =>
                    void runMutation(
                      "已确认睡眠照常",
                      () => confirmSleepCandidate(cand.date),
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
          <h2 className="text-xs font-medium text-muted-foreground">时间线</h2>
          <span className="text-xs text-muted-foreground/70 tabular-nums">
            {daily.locatedSegments.length} 段记录
          </span>
        </div>

        {timelineItems.length === 0 ? (
          <p className="py-10 text-xs text-muted-foreground/65">
            这一天还没有已定位记录。可以直接在上方开始计时，或点右上角补记。
          </p>
        ) : (
          <div>
            {timelineItems.map((item) =>
              item.kind === "gap" ? (
                <div
                  key={`gap-${item.gap.startMs}`}
                  className="group flex items-center justify-between gap-4 border-b border-border/30 py-2.5 px-2 -mx-2 rounded-md text-xs text-muted-foreground/50 transition-colors hover:bg-(--row-hover) hover:text-muted-foreground"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="w-[96px] shrink-0 font-mono tabular-nums">
                      {formatClockInZone(item.gap.startMs, timeZone)} –{" "}
                      {formatClockInZone(item.gap.endMs, timeZone)}
                    </span>
                    <span className="truncate">
                      未记录空白 ·{" "}
                      {formatDurationChinese(item.gap.durationSeconds)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="h-6 px-2 text-xs md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
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
                    + 补记
                  </Button>
                </div>
              ) : (
                <div
                  key={`seg-${item.segment.activityId}-${item.segment.startMs}`}
                  className="group flex items-center justify-between gap-4 border-b border-border/35 py-3 px-2 -mx-2 rounded-md transition-colors hover:bg-(--row-hover)"
                >
                  <div className="flex min-w-0 flex-1 items-baseline gap-4">
                    <span className="w-[96px] shrink-0 font-mono text-xs text-muted-foreground/80 tabular-nums">
                      {formatClockInZone(item.segment.startMs, timeZone)} –{" "}
                      {item.segment.running
                        ? "进行中"
                        : formatClockInZone(item.segment.endMs, timeZone)}
                    </span>
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      <span className="truncate text-[14px] text-foreground">
                        {item.segment.title}
                      </span>
                      <span className="text-xs text-muted-foreground/75">
                        {resolveCategoryLabel(item.segment.categoryId, policy)}
                      </span>
                      {item.segment.precision === "estimated_bounds" && (
                        <span className="text-[11px] text-muted-foreground/65">
                          约
                        </span>
                      )}
                      {item.segment.reviewState === "review_required" && (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">
                          待核对
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground/80 tabular-nums">
                      {formatDurationCompact(item.segment.durationSeconds)}
                    </span>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`编辑 ${item.segment.title}`}
                      className="size-6 text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                      disabled={busy}
                      onClick={() => setEditingSegment(item.segment)}
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
              {daily.unlocatedEstimates.length} 项（不计入已定位总量）
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
                      约 {formatDurationChinese(item.estimatedSeconds || 0)}
                    </span>
                    <span className="text-muted-foreground/70">
                      {resolveCategoryLabel(item.categoryId, policy)}
                    </span>
                    {win && (
                      <span className="text-muted-foreground/60">{win}</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setLocatingEstimate(item)}
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
