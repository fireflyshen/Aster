import { useI18n } from "@/app/language";
import { useEffect, useState } from "react";
import { Archive, Play, SlidersHorizontal } from "lucide-react";
import type { TimingPlan } from "@core/time/model";
import { localDateOf, zonedDateTimeToUtcMs } from "@core/time/zone";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { startTimingPlan, updateTimingPlan } from "./time-api";
import { formatClockInZone, formatLedgerDuration } from "./time-format";
import type { LedgerMutation } from "./time-ledger-types";
import { hasTimeAssignment } from "@core/time/assignment";
import { ProjectTagFields } from "./project-tag-fields";
import { LedgerAttribution, LedgerIconButton } from "./ledger-ui";

export function TimePlansPanel({
  plans,
  timeZone,
  sessionVersion,
  busy,
  runMutation,
  requestedPlanId,
  onRequestConsumed,
  availableProjects,
  availableTags,
}: {
  plans: TimingPlan[];
  timeZone: string;
  sessionVersion?: number;
  busy: boolean;
  runMutation: LedgerMutation;
  requestedPlanId?: string;
  onRequestConsumed?: () => void;
  availableProjects: readonly string[];
  availableTags: readonly string[];
}) {
  const { t, locale } = useI18n();
  const visible = plans.filter(
    (plan) =>
      plan.status !== "archived" &&
      plan.archivedAtMs === undefined &&
      plan.status !== "active",
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [extra, setExtra] = useState("0");
  const [date, setDate] = useState(localDateOf(Date.now(), timeZone));
  const [stop, setStop] = useState("");
  const [error, setError] = useState("");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  function edit(plan: TimingPlan) {
    setOpen(true);
    setEditing(plan.id);
    setExtra("0");
    setError("");
    setProject(plan.projectSnapshot || "");
    setTags([...(plan.tags || [])]);
    const next = plan.hardStopAtMs ?? Date.now();
    setDate(localDateOf(next, timeZone));
    setStop(plan.hardStopAtMs ? formatClockInZone(next, timeZone) : "");
  }
  useEffect(() => {
    const plan = plans.find((plan) => plan.id === requestedPlanId);
    if (plan) {
      edit(plan);
      onRequestConsumed?.();
    }
  }, [requestedPlanId]);
  async function save(plan: TimingPlan) {
    const minutes = Number(extra || 0);
    setError("");
    if (!hasTimeAssignment(project, tags))
      return setError(t("请选择项目或至少一个标签。"));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440)
      return setError(t("增加用时须为 0–1440 分钟。"));
    let hardStopAtMs: number | undefined;
    try {
      hardStopAtMs = stop
        ? zonedDateTimeToUtcMs(date, stop, timeZone)
        : undefined;
    } catch {
      return setError(t("请选择有效的结束时间。"));
    }
    if (hardStopAtMs !== undefined && hardStopAtMs <= Date.now())
      return setError(t("最晚结束时间已经过去。"));
    const result = await runMutation(
      t("调整计划：{0}", plan.title),
      () =>
        updateTimingPlan({
          planId: plan.id,
          expectedVersion: plan.version,
          expectedSessionVersion: sessionVersion,
          projectSnapshot: project.trim() || null,
          tags,
          ...(minutes > 0 ? { addAllowanceMinutes: minutes } : {}),
          hardStopAtMs: hardStopAtMs ?? null,
        }),
      { onError: setError },
    );
    if (result) setEditing(undefined);
  }
  if (visible.length === 0) return null;
  return (
    <details
      className="ledger-section-disclosure ledger-saved-plans"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{t("计划")}</span>
        <small>{visible.length}</small>
      </summary>
      <div>
        {visible.map((plan) => {
          const expired =
            plan.hardStopAtMs !== undefined && plan.hardStopAtMs <= Date.now();
          const exhausted =
            plan.remainingSeconds !== undefined && plan.remainingSeconds <= 0;
          const startable =
            !expired &&
            !exhausted &&
            hasTimeAssignment(plan.projectSnapshot, plan.tags) &&
            (plan.status === "scheduled" || plan.status === "paused");
          return (
            <div key={plan.id} className="ledger-plan-item">
              <div className="ledger-plan-item-main">
                <div>
                  <strong>{plan.title}</strong>
                  <div className="ledger-entry-meta">
                    <LedgerAttribution
                      project={plan.projectSnapshot}
                      tags={plan.tags}
                    />
                    {plan.remainingSeconds !== undefined && (
                      <span>
                        {t("剩余")}{" "}
                        {formatLedgerDuration(plan.remainingSeconds, locale)}
                      </span>
                    )}
                    {plan.plannedStartAtMs && (
                      <span>
                        {localDateOf(plan.plannedStartAtMs, timeZone).slice(5)}{" "}
                        {formatClockInZone(plan.plannedStartAtMs, timeZone)}{" "}
                        {t("计划开始")}
                      </span>
                    )}
                    {plan.hardStopAtMs && (
                      <span>
                        {formatClockInZone(plan.hardStopAtMs, timeZone)}{" "}
                        {t("最晚结束")}
                      </span>
                    )}
                    {(expired || exhausted) && <span>{t("需要调整")}</span>}
                    {!hasTimeAssignment(plan.projectSnapshot, plan.tags) && (
                      <span>{t("待补归属")}</span>
                    )}
                  </div>
                </div>
                <div className="ledger-button-row">
                  <LedgerIconButton
                    label={t("调整")}
                    disabled={busy}
                    onClick={() => edit(plan)}
                  >
                    <SlidersHorizontal className="size-4" />
                  </LedgerIconButton>
                  <LedgerIconButton
                    label={t("归档")}
                    disabled={busy}
                    onClick={() =>
                      void runMutation(t("归档计划：{0}", plan.title), () =>
                        updateTimingPlan({
                          planId: plan.id,
                          expectedVersion: plan.version,
                          archived: true,
                        }),
                      )
                    }
                  >
                    <Archive className="size-4" />
                  </LedgerIconButton>
                  <LedgerIconButton
                    label={plan.status === "paused" ? t("继续计时") : t("开始")}
                    variant="outline"
                    disabled={busy || !startable}
                    onClick={() =>
                      void runMutation(
                        t("开始：{0}", plan.title),
                        () =>
                          startTimingPlan({
                            planId: plan.id,
                            expectedSessionVersion: sessionVersion,
                          }),
                        { undoable: true },
                      )
                    }
                  >
                    <Play className="size-4" />
                  </LedgerIconButton>
                </div>
              </div>
              {editing === plan.id && (
                <div className="ledger-plan-editor">
                  <div className="ledger-plan-fields">
                    <label className="ledger-field">
                      <span>{t("增加用时 · 分钟")}</span>
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        value={extra}
                        onChange={(event) => setExtra(event.target.value)}
                      />
                    </label>
                    <label className="ledger-field">
                      <span>{t("结束日期")}</span>
                      <DateField value={date} onChange={setDate} />
                    </label>
                    <label className="ledger-field">
                      <span>{t("最晚结束 · 可选")}</span>
                      <input
                        type="time"
                        value={stop}
                        onChange={(event) => setStop(event.target.value)}
                      />
                    </label>
                  </div>
                  <ProjectTagFields
                    idPrefix="time-plan-edit"
                    project={project}
                    onProjectChange={setProject}
                    tags={tags}
                    onTagsChange={setTags}
                    availableProjects={availableProjects}
                    availableTags={availableTags}
                  />
                  <p className="ledger-muted-note">{t("加时不延后截止。")}</p>
                  {error && (
                    <p role="alert" className="ledger-form-error">
                      {error}
                    </p>
                  )}
                  <div className="ledger-button-row">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(undefined)}
                    >
                      {t("取消")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void save(plan)}
                    >
                      {t("保存调整")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
