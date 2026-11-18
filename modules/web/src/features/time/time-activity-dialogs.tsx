import { useI18n } from "@/app/language";
import { hasTimeAssignment } from "@core/time/assignment";
import { resolveActivityCategory } from "@core/time/classification";
import {
  hourlyRateForTags,
  resolveActivityHourlyRateCents,
} from "@core/time/cost";
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
  const { t } = useI18n();
  const [mode, setMode] = useState<"log" | "estimate">("log");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("20:00");
  const [estimatedMinutes, setEstimatedMinutes] = useState("60");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [taskUuid, setTaskUuid] = useState("none");
  const [approximate, setApproximate] = useState(false);
  const [useWindow, setUseWindow] = useState(false);
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
    setTaskUuid("none");
    setApproximate(false);
    setUseWindow(false);
    setNote("");
    setLocalError("");
  }, [open, seed]);

  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const rateByTags = hourlyRateForTags(policy ?? {}, tags);
  const activeRateCents = policy
    ? resolveActivityHourlyRateCents(
        {
          categoryId: resolveActivityCategory(policy, {
            taskUuid: taskUuid === "none" ? undefined : taskUuid,
            project,
            tags,
          }).categoryId,
          hourlyRateCents: rateByTags,
        },
        policy,
      )
    : rateByTags;

  function handleSelectTask(nextUuid: string) {
    setTaskUuid(nextUuid);
    if (nextUuid === "none") return;
    const found = tasks.find((t) => t.uuid === nextUuid);
    if (!found) return;
    if (!title.trim()) setTitle(found.description);
    if (!hasTimeAssignment(project, tags)) {
      setProject(found.project || "");
      setTags([...found.tags]);
    }
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
      setLocalError(t("填写活动名或选择任务"));
      return;
    }
    const resolvedProject = project.trim();
    if (!hasTimeAssignment(resolvedProject, tags)) {
      setLocalError(t("选项目或标签"));
      return;
    }
    const resolvedTags = tags;

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
          setLocalError(t("结束时间必须晚于开始时间。"));
          return;
        }
        const startMs = useSeededStart
          ? rawStartMs
          : snapMinuteStartToSegments(rawStartMs, endMs, segments);
        const err = await onSubmitLog({
          title: finalTitle,
          startMs,
          endMs,
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
        setLocalError(err instanceof Error ? err.message : t("时间格式无效"));
      }
      return;
    }

    const mins = Number(estimatedMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      setLocalError(t("估计时长必须大于 0 分钟。"));
      return;
    }
    let windowStartMs: number | undefined;
    let windowEndMs: number | undefined;
    if (useWindow) {
      try {
        windowStartMs = zonedDateTimeToUtcMs(date, startTime, timeZone);
        windowEndMs = zonedDateTimeToUtcMs(date, endTime, timeZone);
        if (windowEndMs <= windowStartMs) {
          setLocalError(t("窗口结束时间必须晚于开始时间。"));
          return;
        }
      } catch (err) {
        setLocalError(
          err instanceof Error ? err.message : t("窗口时间格式无效"),
        );
        return;
      }
    }
    const err = await onSubmitEstimate({
      title: finalTitle,
      estimatedSeconds: Math.round(mins * 60),
      targetDate: date,
      windowStartMs,
      windowEndMs,
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
      <DialogContent
        className="ledger-activity-dialog sm:max-w-md"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("补记")}</DialogTitle>
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
              {t("起止")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant={mode === "estimate" ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setMode("estimate")}
            >
              {t("时长")}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="time-log-title" className="sr-only">
              {t("活动名称")}
            </Label>
            <Input
              id="time-log-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("活动名称")}
              autoFocus
            />
          </div>

          <div className="ledger-dialog-time-grid grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="time-log-date">{t("日期")}</Label>
              <DateField id="time-log-date" value={date} onChange={setDate} />
            </div>
            {mode === "log" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="time-log-start">{t("开始")}</Label>
                  <Input
                    id="time-log-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="time-log-end">{t("结束")}</Label>
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
                <Label htmlFor="time-est-mins">{t("时长（分钟）")}</Label>
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
              {t("约略时间")}
            </label>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={useWindow}
                  onCheckedChange={(v) => setUseWindow(Boolean(v))}
                />
                {t("加时间范围")}
              </label>
              {useWindow && (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="time"
                    aria-label={t("窗口开始")}
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                  <Input
                    type="time"
                    aria-label={t("窗口结束")}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <ProjectTagFields
            idPrefix="time-log"
            project={project}
            onProjectChange={setProject}
            tags={tags}
            onTagsChange={setTags}
            availableProjects={availableProjects}
            availableTags={availableTags}
          />

          <details className="ledger-dialog-options">
            <summary>{t("任务与备注")}</summary>
            <div className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="time-log-task">{t("任务")}</Label>
                <Select value={taskUuid} onValueChange={handleSelectTask}>
                  <SelectTrigger id="time-log-task">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("无")}</SelectItem>
                    {pendingTasks.slice(0, 60).map((task) => (
                      <SelectItem key={task.uuid} value={task.uuid}>
                        {task.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="time-log-note">{t("备注")}</Label>
                <Textarea
                  id="time-log-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          </details>

          {localError && (
            <p role="alert" className="text-xs text-destructive">
              {localError}
            </p>
          )}

          {mode === "estimate" ? (
            <p className="ledger-muted-note">{t("定位后入账")}</p>
          ) : (
            previewDurationSeconds > 0 && (
              <output
                className="ledger-muted-note tabular-nums"
                title={t("{0}/小时", formatCurrencyCny(activeRateCents))}
              >
                {t("折算")} {formatCurrencyCny(previewCostCents)}
              </output>
            )
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t("取消")}
            </Button>
            <Button type="submit" disabled={busy}>
              {mode === "log" ? t("保存") : t("存为估记")}
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
  const { t } = useI18n();
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
        setLocalError(t("结束时间必须晚于开始时间。"));
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
      setLocalError(err instanceof Error ? err.message : t("时间无效"));
    }
  }

  return (
    <Dialog open={Boolean(activity)} onOpenChange={onOpenChange}>
      <DialogContent className="ledger-activity-dialog sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("定位")}</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            {activity?.title}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="loc-date">{t("日期")}</Label>
            <DateField id="loc-date" value={date} onChange={setDate} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="loc-start">{t("开始")}</Label>
              <Input
                id="loc-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-end">{t("结束")}</Label>
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
              {t("取消")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("入账")}
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
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
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
    setTags([...(segment.tags || [])]);
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
      setLocalError(t("活动标题不能为空。"));
      return;
    }
    if (!hasTimeAssignment(project, tags)) {
      setLocalError(t("请选择项目或至少一个标签。"));
      return;
    }
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
      projectSnapshot: project.trim() || null,
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
          setLocalError(t("结束时间必须晚于开始时间。"));
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
        setLocalError(err instanceof Error ? err.message : t("时间无效"));
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
      <DialogContent
        className="ledger-activity-dialog sm:max-w-md"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("编辑记录")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          {segment && (
            <div className="ledger-muted-note tabular-nums">
              <span>
                {formatCurrencyCny(
                  segment.hourlyRateCents ??
                    normalizeHourlyRateCents(policy?.hourlyRateCents),
                )}
                {t("/时 · 折算")}{" "}
                <strong className="font-medium text-foreground">
                  {formatCurrencyCny(segment.confirmedCostCents)}
                </strong>
              </span>
              {segment.provisionalCostCents > 0 && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  {t("待核对")}{" "}
                  {formatCurrencyCny(segment.provisionalCostCents)}
                </span>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="edit-seg-title" className="sr-only">
              {t("活动名称")}
            </Label>
            <Input
              id="edit-seg-title"
              value={title}
              placeholder={t("活动名称")}
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
          />
          {!segment?.running && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-seg-start">{t("开始")}</Label>
                <Input
                  id="edit-seg-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-seg-end">{t("结束")}</Label>
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
            {t("约略时间")}
          </label>
          {segment?.taskUuid && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={clearTaskLink}
                onCheckedChange={(v) => setClearTaskLink(Boolean(v))}
              />
              {t("解除任务关联")}
            </label>
          )}
          {segment?.reviewState === "review_required" && (
            <label className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <Checkbox
                checked={confirmReview}
                onCheckedChange={(v) => setConfirmReview(Boolean(v))}
              />
              {t("确认入账")}
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
              {t("取消")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("保存")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
