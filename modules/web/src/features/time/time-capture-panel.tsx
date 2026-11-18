import { useRef, useState, type FormEvent } from "react";
import { Clock3, Pause, Play, Square } from "lucide-react";
import { hasTimeAssignment } from "@core/time/assignment";
import type { TimerSnapshot } from "@core/time/model";
import { snapshotLiveStatus } from "@core/time/snapshot";
import { localDateOf, zonedDateTimeToUtcMs } from "@core/time/zone";
import type { Task } from "@shared/tasks";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectTagFields } from "./project-tag-fields";
import {
  confirmTimeActivity,
  createTimingPlan,
  startTimeActivity,
  startTimingPlan,
  stopTimeActivity,
  type TimeStatusResponse,
} from "./time-api";
import { formatClockInZone, formatLedgerDuration } from "./time-format";
import type { LedgerMutation } from "./time-ledger-types";

export function TimeCapturePanel({
  status,
  composing,
  onCloseComposer,
  timeZone,
  selectedDate,
  tasks,
  projects,
  tags: tagOptions,
  elapsedSeconds,
  timerSnapshot,
  timerLiveStatus,
  busy,
  runMutation,
}: {
  status: TimeStatusResponse | null;
  composing: boolean;
  onCloseComposer: () => void;
  timeZone: string;
  selectedDate: string;
  tasks: Task[];
  projects: readonly string[];
  tags: readonly string[];
  elapsedSeconds?: number;
  timerSnapshot?: TimerSnapshot | null;
  timerLiveStatus?: ReturnType<typeof snapshotLiveStatus> | null;
  busy: boolean;
  runMutation: LedgerMutation;
}) {
  const active = status?.activeActivity;
  const today = localDateOf(Date.now(), timeZone);
  const [switching, setSwitching] = useState(false);
  const preparedPlan = useRef<
    | {
        fingerprint: string;
        result: Awaited<ReturnType<typeof createTimingPlan>>;
      }
    | undefined
  >(undefined);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [taskUuid, setTaskUuid] = useState("none");
  const [limited, setLimited] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const [planDate, setPlanDate] = useState(
    selectedDate > today ? selectedDate : today,
  );
  const [plannedTime, setPlannedTime] = useState("");
  const [stopTime, setStopTime] = useState("");
  const [error, setError] = useState("");
  const stale =
    timerLiveStatus?.expired ||
    (timerSnapshot && timerSnapshot.state !== "ready");
  const seconds = stale
    ? undefined
    : (elapsedSeconds ??
      (active?.startMs !== undefined && !stale
        ? Math.max(
            0,
            (Math.min(Date.now(), active.autoStopAtMs ?? Date.now()) -
              active.startMs) /
              1000,
          )
        : undefined));
  const ready =
    Boolean(title.trim() || taskUuid !== "none") &&
    hasTimeAssignment(project, tags);

  function selectTask(uuid: string) {
    setTaskUuid(uuid);
    const task = tasks.find((task) => task.uuid === uuid);
    if (!task) return;
    if (!title.trim()) setTitle(task.description);
    if (!hasTimeAssignment(project, tags)) {
      setProject(task.project || "");
      setTags([...task.tags]);
    }
  }

  async function submit(event: FormEvent, savePlan = false) {
    event.preventDefault();
    if (busy || !ready) return;
    setError("");
    const task = tasks.find((task) => task.uuid === taskUuid);
    const finalTitle = title.trim() || task?.description || "";
    let allowanceSeconds: number | undefined,
      plannedStartAtMs: number | undefined,
      hardStopAtMs: number | undefined;
    if (limited) {
      const value = minutes.trim() ? Number(minutes) : undefined;
      if (
        value !== undefined &&
        (!Number.isFinite(value) || value <= 0 || value > 1440)
      )
        return setError("预计用时须为 1–1440 分钟。");
      allowanceSeconds =
        value === undefined ? undefined : Math.round(value * 60);
      try {
        plannedStartAtMs = plannedTime
          ? zonedDateTimeToUtcMs(planDate, plannedTime, timeZone)
          : undefined;
        hardStopAtMs = stopTime
          ? zonedDateTimeToUtcMs(planDate, stopTime, timeZone)
          : undefined;
      } catch {
        return setError("请选择有效的日期和时间。");
      }
      if (hardStopAtMs !== undefined && hardStopAtMs <= Date.now())
        return setError("最晚结束时间已经过去，请调整。");
      if (
        plannedStartAtMs !== undefined &&
        hardStopAtMs !== undefined &&
        plannedStartAtMs >= hardStopAtMs
      )
        return setError("最晚结束时间须晚于计划开始时间。");
      if (
        allowanceSeconds === undefined &&
        plannedStartAtMs === undefined &&
        hardStopAtMs === undefined
      )
        return setError("请填写预计用时或计划时间。");
    }
    const result = await runMutation(
      savePlan ? `保存计划：${finalTitle}` : `开始：${finalTitle}`,
      async () => {
        const assignment = {
          title: finalTitle,
          taskUuid: task?.uuid,
          projectSnapshot: project.trim(),
          tags,
        };
        if (limited) {
          const planInput = {
            ...assignment,
            allowanceSeconds,
            plannedStartAtMs,
            hardStopAtMs,
          };
          const fingerprint = JSON.stringify(planInput);
          const created =
            preparedPlan.current?.fingerprint === fingerprint
              ? preparedPlan.current.result
              : await createTimingPlan(planInput);
          preparedPlan.current = { fingerprint, result: created };
          if (savePlan) return created;
          return startTimingPlan({
            planId: created.plan.id,
            expectedSessionVersion: status?.sessionVersion,
          });
        }
        return startTimeActivity({
          ...assignment,
          expectedSessionVersion: status?.sessionVersion,
        });
      },
      {
        undoable: !savePlan,
        onError: (message) =>
          setError(
            preparedPlan.current
              ? `计划已保存，尚未确认开始。可在下方「已保存计划」检查或开始。${message}`
              : message,
          ),
      },
    );
    if (result) {
      preparedPlan.current = undefined;
      setTitle("");
      setProject("");
      setTags([]);
      setTaskUuid("none");
      setLimited(false);
      setSwitching(false);
      onCloseComposer();
    }
  }

  if (!active && !composing) return null;
  return (
    <section className="ledger-capture-panel" id="ledger-capture" aria-label="当前计时">
      {active && (
        <div className="ledger-active">
          <div className="ledger-active-heading">
            <span className="ledger-live-label" data-stale={Boolean(stale)}>
              <i />
              {stale ? "等待刷新" : "正在计时"}
            </span>
            <span>
              {active.startMs !== undefined
                ? `${formatClockInZone(active.startMs, timeZone)} 开始`
                : ""}
            </span>
          </div>
          <div className="ledger-active-main">
            <div className="ledger-active-description">
              <h2>{active.title}</h2>
              <div className="ledger-entry-meta">
                {active.projectSnapshot && (
                  <span>{active.projectSnapshot}</span>
                )}
                {active.tags?.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            </div>
            <strong className="ledger-live-duration">
              {seconds === undefined ? "—" : formatLedgerDuration(seconds)}
            </strong>
          </div>
          <div className="ledger-active-footer">
            <span>
              {active.autoStopAtMs
                ? `最晚 ${formatClockInZone(active.autoStopAtMs, timeZone)} 自动结束`
                : "手动结束计时"}
              {active.hourlyRateCents === 0 ? " · 不折算金额" : ""}
            </span>
            <div className="ledger-button-row">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setSwitching((value) => !value)}
              >
                {switching ? "收起" : "切换活动"}
              </Button>
              {active.timingPlanId && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void runMutation(
                      `暂停：${active.title}`,
                      () =>
                        stopTimeActivity({
                          expectedActivityId: active.id,
                          expectedVersion: active.version,
                          expectedSessionVersion: status?.sessionVersion,
                          pause: true,
                        }),
                      { undoable: true },
                    )
                  }
                >
                  <Pause className="size-3.5" />
                  暂停
                </Button>
              )}
              <Button
                size="sm"
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
                <Square className="size-3 fill-current" />
                结束
              </Button>
            </div>
          </div>
          {active.reviewDueAtMs && Date.now() >= active.reviewDueAtMs && (
            <div className="ledger-inline-review">
              <span>计时已持续较长时间，请确认是否仍在进行。</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void runMutation("确认仍在进行", () =>
                    confirmTimeActivity({
                      activityId: active.id,
                      expectedVersion: active.version,
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
      {((!active && composing) || (active && switching)) && (
        <form
          className="ledger-composer"
          onSubmit={(event) => void submit(event)}
        >
          <fieldset disabled={busy}>
            <div className="time-quick-main">
              <input
                id="ledger-activity-title"
                className="time-quick-title"
                aria-label="活动名称"
                placeholder={active ? "切换到…" : "现在做什么？"}
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <ProjectTagFields
              compact
              project={project}
              onProjectChange={setProject}
              tags={tags}
              onTagsChange={setTags}
              availableProjects={projects}
              availableTags={tagOptions}
            />
            <details className="ledger-composer-options">
              <summary>任务与计划{limited ? " · 已设置" : taskUuid !== "none" ? " · 已关联" : ""}</summary>
              <div className="ledger-composer-options-body">
                <label className="ledger-field">
                  <span>关联任务</span>
                  <Select value={taskUuid} onValueChange={selectTask}>
                    <SelectTrigger aria-label="关联任务">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不关联任务</SelectItem>
                      {tasks
                        .filter((task) => task.status === "pending")
                        .map((task) => (
                          <SelectItem key={task.uuid} value={task.uuid}>
                            {task.description}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="ledger-checkbox-line">
                  <input
                    type="checkbox"
                    checked={limited}
                    onChange={(event) => setLimited(event.target.checked)}
                  />
                  <Clock3 className="size-3.5" />
                  设置用时或最晚结束时间
                </label>
                {limited && (
                  <div className="ledger-plan-fields">
                    <label className="ledger-field">
                      <span>预计用时 · 分钟</span>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={minutes}
                        onChange={(event) => setMinutes(event.target.value)}
                      />
                    </label>
                    <label className="ledger-field">
                      <span>计划日期</span>
                      <DateField value={planDate} onChange={setPlanDate} />
                    </label>
                    <label className="ledger-field">
                      <span>计划开始 · 可选</span>
                      <input
                        type="time"
                        value={plannedTime}
                        onChange={(event) => setPlannedTime(event.target.value)}
                      />
                    </label>
                    <label className="ledger-field">
                      <span>最晚结束 · 可选</span>
                      <input
                        type="time"
                        value={stopTime}
                        onChange={(event) => setStopTime(event.target.value)}
                      />
                    </label>
                    <p>
                      计划不会自动开始。手动开始后，到达用时额度或最晚结束时间时自动停止。
                    </p>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={busy || !ready}
                      onClick={(event) => void submit(event, true)}
                    >
                      只保存计划
                    </Button>
                  </div>
                )}
              </div>
            </details>
            <div className="ledger-composer-actions">
              {!active && (
                <Button type="button" size="sm" variant="ghost" onClick={onCloseComposer}>收起</Button>
              )}
              <Button type="submit" size="sm" disabled={busy || !ready}>
                <Play className="size-3.5" />
                {active ? "切换并开始" : "开始计时"}
              </Button>
            </div>
          </fieldset>
          {selectedDate !== today && (
            <p className="ledger-muted-note">
              计时从当前时刻开始。记录所选日期的活动，请使用「补记」。
            </p>
          )}
          {error && (
            <p role="alert" className="ledger-form-error">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
