import { DateField } from "@/components/ui/date-field";
import type { Activity, LocatedSegment, TimePolicy } from "@core/time/model";
import { zonedDateTimeToUtcMs } from "@core/time/zone";
import type { Task } from "@shared/tasks";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProjectTagFields } from "./project-tag-fields";
import {
  computeDurationCostCents,
  formatClockInZone,
  formatCurrencyCny,
  normalizeHourlyRateCents,
  snapMinuteStartToSegments,
} from "./time-format";

export type LogDialogSeed = {
  mode: "log" | "estimate";
  date: string;
  startTime: string;
  endTime: string;
  estimatedMinutes: string;
  exactStartMs?: number;
  exactEndMs?: number;
};

export function TimeLogOrEstimateDialog({
  open,
  onOpenChange,
  seed,
  timeZone,
  policy,
  tasks,
  availableProjects,
  availableTags,
  segments,
  busy,
  onSubmitLog,
  onSubmitEstimate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed: LogDialogSeed | null;
  timeZone: string;
  policy: TimePolicy | null;
  tasks: Task[];
  availableProjects: readonly string[];
  availableTags: readonly string[];
  segments?: readonly LocatedSegment[];
  busy: boolean;
  onSubmitLog: (input: {
    title: string;
    startMs: number;
    endMs: number;
    explicitCategoryId?: string;
    taskUuid?: string;
    projectSnapshot?: string;
    tags?: string[];
    precision: "exact" | "estimated_bounds";
    note?: string;
  }) => Promise<string | null>;
  onSubmitEstimate: (input: {
    title: string;
    estimatedSeconds: number;
    targetDate: string;
    windowStartMs?: number;
    windowEndMs?: number;
    explicitCategoryId?: string;
    taskUuid?: string;
    projectSnapshot?: string;
    tags?: string[];
    note?: string;
  }) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<"log" | "estimate">("log");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("20:00");
  const [estimatedMinutes, setEstimatedMinutes] = useState("60");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSleep, setIsSleep] = useState(false);
  const [taskUuid, setTaskUuid] = useState("none");
  const [approximate, setApproximate] = useState(false);
  const [useWindow, setUseWindow] = useState(true);
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open || !seed) return;
    setMode(seed.mode);
    setDate(seed.date);
    setStartTime(seed.startTime);
    setEndTime(seed.endTime);
    setEstimatedMinutes(seed.estimatedMinutes);
    setTitle("");
    setProject("");
    setTags([]);
    setIsSleep(false);
    setTaskUuid("none");
    setApproximate(false);
    setUseWindow(true);
    setNote("");
    setLocalError("");
  }, [open, seed]);

  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const activeRateCents = isSleep
    ? 0
    : normalizeHourlyRateCents(policy?.hourlyRateCents);

  function handleSelectTask(nextUuid: string) {
    setTaskUuid(nextUuid);
    if (nextUuid === "none") return;
    const found = tasks.find((t) => t.uuid === nextUuid);
    if (!found) return;
    if (!title.trim()) setTitle(found.description);
    setProject(found.project || "");
    setTags(found.tags ? [...found.tags] : []);
  }

  let previewDurationSeconds = 0;
  if (mode === "log") {
    try {
      const s =
        seed &&
        seed.exactStartMs !== undefined &&
        date === seed.date &&
        startTime === seed.startTime
          ? seed.exactStartMs
          : zonedDateTimeToUtcMs(date, startTime, timeZone);
      const e =
        seed &&
        seed.exactEndMs !== undefined &&
        date === seed.date &&
        endTime === seed.endTime
          ? seed.exactEndMs
          : zonedDateTimeToUtcMs(date, endTime, timeZone);
      if (e > s) previewDurationSeconds = Math.round((e - s) / 1000);
    } catch {
      previewDurationSeconds = 0;
    }
  } else {
    const mins = Number(estimatedMinutes);
    if (Number.isFinite(mins) && mins > 0) {
      previewDurationSeconds = Math.round(mins * 60);
    }
  }
  const previewCostCents = computeDurationCostCents(
    previewDurationSeconds,
    activeRateCents,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError("");
    const selectedTask =
      taskUuid !== "none" ? tasks.find((t) => t.uuid === taskUuid) : undefined;
    const finalTitle = (title.trim() || selectedTask?.description || "").trim();
    if (!finalTitle) {
      setLocalError("请输入活动名称或关联一个任务。");
      return;
    }
    const explicitCategoryId = isSleep ? "sleep" : "work";
    const resolvedProject =
      project.trim() || selectedTask?.project || (isSleep ? "睡眠" : undefined);
    if (!resolvedProject) {
      setLocalError("请选择时间记录所属的项目。");
      return;
    }
    const resolvedTags =
      tags.length > 0
        ? tags
        : selectedTask?.tags?.length
          ? selectedTask.tags
          : undefined;

    if (mode === "log") {
      try {
        const useSeededStart = Boolean(
          seed &&
          seed.exactStartMs !== undefined &&
          date === seed.date &&
          startTime === seed.startTime,
        );
        const useSeededEnd = Boolean(
          seed &&
          seed.exactEndMs !== undefined &&
          date === seed.date &&
          endTime === seed.endTime,
        );
        const rawStartMs = useSeededStart
          ? seed!.exactStartMs!
          : zonedDateTimeToUtcMs(date, startTime, timeZone);
        const endMs = useSeededEnd
          ? seed!.exactEndMs!
          : zonedDateTimeToUtcMs(date, endTime, timeZone);
        if (endMs <= rawStartMs) {
          setLocalError("结束时间必须晚于开始时间。");
          return;
        }
        const startMs = useSeededStart
          ? rawStartMs
          : snapMinuteStartToSegments(rawStartMs, endMs, segments);
        const err = await onSubmitLog({
          title: finalTitle,
          startMs,
          endMs,
          explicitCategoryId,
          taskUuid: selectedTask?.uuid,
          projectSnapshot: resolvedProject,
          tags: resolvedTags,
          precision: approximate ? "estimated_bounds" : "exact",
          note: note.trim() || undefined,
        });
        if (err === null) {
          onOpenChange(false);
        } else {
          setLocalError(err);
        }
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "时间格式无效");
      }
      return;
    }

    const mins = Number(estimatedMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      setLocalError("估计时长必须大于 0 分钟。");
      return;
    }
    let windowStartMs: number | undefined;
    let windowEndMs: number | undefined;
    if (useWindow) {
      try {
        windowStartMs = zonedDateTimeToUtcMs(date, startTime, timeZone);
        windowEndMs = zonedDateTimeToUtcMs(date, endTime, timeZone);
        if (windowEndMs <= windowStartMs) {
          setLocalError("窗口结束时间必须晚于开始时间。");
          return;
        }
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "窗口时间格式无效");
        return;
      }
    }
    const err = await onSubmitEstimate({
      title: finalTitle,
      estimatedSeconds: Math.round(mins * 60),
      targetDate: date,
      windowStartMs,
      windowEndMs,
      explicitCategoryId,
      taskUuid: selectedTask?.uuid,
      projectSnapshot: resolvedProject,
      tags: resolvedTags,
      note: note.trim() || undefined,
    });
    if (err === null) {
      onOpenChange(false);
    } else {
      setLocalError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "log" ? "补记已发生时段" : "记录待定位估记"}
          </DialogTitle>
          <DialogDescription>
            {mode === "log"
              ? "明确知道起止时段时可直接记入当天时间线（不确定边界可勾选“大约”）。"
              : "只记得大概花了一段时间时先保留为估记，不直接计入已定位总量，稍后再定位。"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div className="flex gap-1.5 rounded-lg bg-muted/60 p-1">
            <Button
              type="button"
              size="xs"
              variant={mode === "log" ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setMode("log")}
            >
              固定时段补记
            </Button>
            <Button
              type="button"
              size="xs"
              variant={mode === "estimate" ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setMode("estimate")}
            >
              模糊时长估记
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="time-log-title">活动内容</Label>
            <Input
              id="time-log-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：看书、散步、沟通需求…"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="time-log-task">关联任务（可选）</Label>
            <Select value={taskUuid} onValueChange={handleSelectTask}>
              <SelectTrigger id="time-log-task">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不关联任务</SelectItem>
                {pendingTasks.slice(0, 60).map((task) => (
                  <SelectItem key={task.uuid} value={task.uuid}>
                    {task.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ProjectTagFields
            idPrefix="time-log"
            project={project}
            onProjectChange={setProject}
            tags={tags}
            onTagsChange={setTags}
            availableProjects={availableProjects}
            availableTags={availableTags}
            isSleep={isSleep}
            onSleepChange={setIsSleep}
          />

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="time-log-date">日期</Label>
              <DateField id="time-log-date" value={date} onChange={setDate} />
            </div>
            {mode === "log" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="time-log-start">开始</Label>
                  <Input
                    id="time-log-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="time-log-end">结束</Label>
                  <Input
                    id="time-log-end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="time-est-mins">估计分钟数</Label>
                <Input
                  id="time-est-mins"
                  type="number"
                  min={1}
                  max={1440}
                  value={estimatedMinutes}
                  onChange={(e) => setEstimatedMinutes(e.target.value)}
                />
              </div>
            )}
          </div>

          {mode === "log" ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={approximate}
                onCheckedChange={(v) => setApproximate(Boolean(v))}
              />
              起止时刻是回忆估算（标记为“大约”，避免制造精确假象）
            </label>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={useWindow}
                  onCheckedChange={(v) => setUseWindow(Boolean(v))}
                />
                大概发生在一个时间窗口内（可选）
              </label>
              {useWindow && (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="time"
                    aria-label="窗口开始"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                  <Input
                    type="time"
                    aria-label="窗口结束"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {previewDurationSeconds > 0 && (
            <div className="rounded-md bg-muted/45 px-2.5 py-1.5 text-xs text-muted-foreground tabular-nums">
              {isSleep ? (
                <span>睡眠时段：单价 ¥0，折算成本 ¥0</span>
              ) : (
                <span>
                  按当前单价（
                  {formatCurrencyCny(activeRateCents)}
                  /小时）折算：
                  <strong className="font-medium text-foreground">
                    {formatCurrencyCny(previewCostCents)}
                  </strong>
                </span>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="time-log-note">备注（可选）</Label>
            <Textarea
              id="time-log-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="补充说明…"
            />
          </div>

          {localError && (
            <p className="text-xs text-destructive">{localError}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {mode === "log" ? "保存记录" : "保存估记"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LocateEstimateDialog({
  activity,
  defaultDate,
  timeZone,
  segments,
  busy,
  onOpenChange,
  onLocate,
}: {
  activity: Activity | null;
  defaultDate: string;
  timeZone: string;
  segments?: readonly LocatedSegment[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onLocate: (input: {
    activityId: string;
    expectedVersion: number;
    startMs: number;
    endMs: number;
  }) => Promise<string | null>;
}) {
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("20:00");
  const [endTime, setEndTime] = useState("21:00");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!activity) return;
    const baseDate = activity.targetDate || defaultDate;
    setDate(baseDate);
    const startMs =
      activity.windowStartMs ??
      zonedDateTimeToUtcMs(baseDate, "20:00", timeZone);
    const durMs = (activity.estimatedSeconds || 3600) * 1000;
    const suggestedEndMs = startMs + durMs;
    setStartTime(formatClockInZone(startMs, timeZone));
    setEndTime(formatClockInZone(suggestedEndMs, timeZone));
    setLocalError("");
  }, [activity, defaultDate, timeZone]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activity) return;
    setLocalError("");
    try {
      const rawStartMs = zonedDateTimeToUtcMs(date, startTime, timeZone);
      const endMs = zonedDateTimeToUtcMs(date, endTime, timeZone);
      if (endMs <= rawStartMs) {
        setLocalError("结束时间必须晚于开始时间。");
        return;
      }
      const startMs = snapMinuteStartToSegments(rawStartMs, endMs, segments);
      const err = await onLocate({
        activityId: activity.id,
        expectedVersion: activity.version,
        startMs,
        endMs,
      });
      if (err === null) {
        onOpenChange(false);
      } else {
        setLocalError(err);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "时间无效");
    }
  }

  return (
    <Dialog open={Boolean(activity)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>将估记定位到具体时段</DialogTitle>
          <DialogDescription>
            定位后将把「{activity?.title}
            」从待定位估记转为已定位时间（C 增加，U 减少）。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="loc-date">日期</Label>
            <DateField id="loc-date" value={date} onChange={setDate} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="loc-start">开始</Label>
              <Input
                id="loc-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-end">结束</Label>
              <Input
                id="loc-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          {localError && (
            <p className="text-xs text-destructive">{localError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              确认定位
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditSegmentDialog({
  segment,
  date,
  timeZone,
  policy,
  availableProjects,
  availableTags,
  segments,
  busy,
  onOpenChange,
  onSave,
}: {
  segment: LocatedSegment | null;
  date: string;
  timeZone: string;
  policy: TimePolicy | null;
  availableProjects: readonly string[];
  availableTags: readonly string[];
  segments?: readonly LocatedSegment[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    activityId: string;
    expectedVersion: number;
    patch: {
      title?: string;
      categoryId?: string;
      projectSnapshot?: string | null;
      tags?: string[] | null;
      precision?: "exact" | "estimated_bounds";
      startMs?: number;
      endMs?: number;
      clearTaskLink?: boolean;
      confirmReview?: boolean;
    };
  }) => Promise<string | null>;
}) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSleep, setIsSleep] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [origStartTime, setOrigStartTime] = useState("");
  const [origEndTime, setOrigEndTime] = useState("");
  const [approximate, setApproximate] = useState(false);
  const [clearTaskLink, setClearTaskLink] = useState(false);
  const [confirmReview, setConfirmReview] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!segment) return;
    const initStart = formatClockInZone(segment.startMs, timeZone);
    const initEnd = formatClockInZone(segment.endMs, timeZone);
    setTitle(segment.title);
    setProject(segment.projectSnapshot || "");
    setTags(segment.tags ? [...segment.tags] : []);
    setIsSleep(segment.categoryId === "sleep");
    setStartTime(initStart);
    setEndTime(initEnd);
    setOrigStartTime(initStart);
    setOrigEndTime(initEnd);
    setApproximate(segment.precision === "estimated_bounds");
    setClearTaskLink(false);
    setConfirmReview(segment.reviewState === "review_required");
    setLocalError("");
  }, [segment, timeZone]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!segment) return;
    setLocalError("");
    if (!title.trim()) {
      setLocalError("活动标题不能为空。");
      return;
    }
    if (!project.trim() && !isSleep) {
      setLocalError("请选择时间记录所属的项目。");
      return;
    }
    const nextCategoryId = isSleep
      ? "sleep"
      : segment.categoryId === "sleep"
        ? "work"
        : segment.categoryId || "work";
    const patch: {
      title?: string;
      categoryId?: string;
      projectSnapshot?: string | null;
      tags?: string[] | null;
      precision?: "exact" | "estimated_bounds";
      startMs?: number;
      endMs?: number;
      clearTaskLink?: boolean;
      confirmReview?: boolean;
    } = {
      title: title.trim(),
      categoryId: nextCategoryId,
      projectSnapshot: project.trim() || (isSleep ? "睡眠" : null),
      tags,
      precision: approximate ? "estimated_bounds" : "exact",
      ...(clearTaskLink ? { clearTaskLink: true } : {}),
      ...(confirmReview ? { confirmReview: true } : {}),
    };
    const startChanged = startTime !== origStartTime;
    const endChanged = endTime !== origEndTime;
    if (!segment.running && (startChanged || endChanged)) {
      try {
        const endMs = endChanged
          ? zonedDateTimeToUtcMs(date, endTime, timeZone)
          : segment.endMs;
        const rawStartMs = startChanged
          ? zonedDateTimeToUtcMs(date, startTime, timeZone)
          : segment.startMs;
        if (endMs <= rawStartMs) {
          setLocalError("结束时间必须晚于开始时间。");
          return;
        }
        const startMs = startChanged
          ? snapMinuteStartToSegments(
              rawStartMs,
              endMs,
              segments,
              segment.activityId,
            )
          : rawStartMs;
        if (startChanged) patch.startMs = startMs;
        if (endChanged) patch.endMs = endMs;
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "时间无效");
        return;
      }
    }
    const err = await onSave({
      activityId: segment.activityId,
      expectedVersion: segment.version,
      patch,
    });
    if (err === null) {
      onOpenChange(false);
    } else {
      setLocalError(err);
    }
  }

  return (
    <Dialog open={Boolean(segment)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>修改时间记录</DialogTitle>
          <DialogDescription>
            支持修改标题、关联项目/标签、精确度或时段；提交将按版本号校验，并保留当时单价。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          {segment && (
            <div className="rounded-md bg-muted/45 px-2.5 py-1.5 text-xs text-muted-foreground tabular-nums">
              <span>
                时段单价：
                {formatCurrencyCny(
                  segment.hourlyRateCents ??
                    normalizeHourlyRateCents(policy?.hourlyRateCents),
                )}
                /小时 · 已确认成本{" "}
                <strong className="font-medium text-foreground">
                  {formatCurrencyCny(segment.confirmedCostCents)}
                </strong>
              </span>
              {segment.provisionalCostCents > 0 && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  待核对 {formatCurrencyCny(segment.provisionalCostCents)}
                </span>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="edit-seg-title">活动内容</Label>
            <Input
              id="edit-seg-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <ProjectTagFields
            idPrefix="edit-seg"
            project={project}
            onProjectChange={setProject}
            tags={tags}
            onTagsChange={setTags}
            availableProjects={availableProjects}
            availableTags={availableTags}
            isSleep={isSleep}
            onSleepChange={setIsSleep}
          />
          {!segment?.running && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-seg-start">开始</Label>
                <Input
                  id="edit-seg-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-seg-end">结束</Label>
                <Input
                  id="edit-seg-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={approximate}
              onCheckedChange={(v) => setApproximate(Boolean(v))}
            />
            起止时间为估计（显示“大约”）
          </label>
          {segment?.taskUuid && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={clearTaskLink}
                onCheckedChange={(v) => setClearTaskLink(Boolean(v))}
              />
              解除与任务 UUID 的关联
            </label>
          )}
          {segment?.reviewState === "review_required" && (
            <label className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <Checkbox
                checked={confirmReview}
                onCheckedChange={(v) => setConfirmReview(Boolean(v))}
              />
              核对无误，清除“待核对”标记
            </label>
          )}
          {localError && (
            <p className="text-xs text-destructive">{localError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              保存修改
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
