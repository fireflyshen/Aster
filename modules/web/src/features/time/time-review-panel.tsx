import { useI18n } from "@/app/language";
import type {
  Activity,
  DailyLedgerSummary,
  LocatedSegment,
  TimeEvent,
  TimingPlan,
} from "@core/time/model";
import { localDateOf } from "@core/time/zone";
import { Button } from "@/components/ui/button";
import { LedgerAttribution } from "./ledger-ui";
import {
  confirmSleepCandidate,
  confirmTimeActivity,
  dismissSleepCandidate,
  resolveTimeOperation,
} from "./time-api";
import {
  formatLedgerDuration,
  formatTimeRangeInZone,
  formatEstimateWindow,
} from "./time-format";
import type { LedgerMutation } from "./time-ledger-types";
import type { PendingOperationDetail } from "./use-time-ledger";

export function TimeReviewPanel({
  daily,
  events,
  pending,
  plans,
  timeZone,
  busy,
  runMutation,
  onAckEvents,
  onEdit,
  onLocate,
  onAdjustPlan,
  onOpenDay,
}: {
  daily: DailyLedgerSummary;
  events: TimeEvent[];
  pending: PendingOperationDetail[];
  plans: TimingPlan[];
  timeZone: string;
  busy: boolean;
  runMutation: LedgerMutation;
  onAckEvents: (ids: string[]) => Promise<void> | void;
  onEdit: (segment: LocatedSegment) => void;
  onLocate: (activity: Activity) => void;
  onAdjustPlan: (id: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const { t, locale } = useI18n();
  const reviews = daily.locatedSegments.filter(
    (segment) =>
      !segment.running &&
      (segment.reviewState === "review_required" ||
        (segment.provisionalSeconds ?? 0) > 0),
  );
  const reviewedIds = new Set(reviews.map((segment) => segment.activityId));
  const otherEvents = events.filter(
    (event) => !event.activityId || !reviewedIds.has(event.activityId),
  );
  const count =
    reviews.length +
    daily.unlocatedEstimates.length +
    daily.sleepCandidates.length +
    pending.length +
    otherEvents.length;
  if (count === 0) return null;
  return (
    <details
      className="ledger-section-disclosure ledger-review"
      data-needs-attention={reviews.length + pending.length > 0 || undefined}
    >
      <summary>
        <span>{t("待处理")}</span>
        <small>{count}</small>
      </summary>
      <div className="ledger-review-items">
        {reviews.map((segment) => (
          <div
            key={`review:${segment.activityId}`}
            className="ledger-review-item"
          >
            <div>
              <strong>{segment.title}</strong>
              <p>
                {formatTimeRangeInZone(
                  segment.startMs,
                  segment.endMs,
                  timeZone,
                )}{" "}
                · {formatLedgerDuration(segment.durationSeconds, locale)}
              </p>
            </div>
            <div className="ledger-button-row">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onEdit(segment)}
              >
                {t("编辑")}
              </Button>
              {segment.timingPlanId &&
                plans.some((plan) => plan.id === segment.timingPlanId) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onAdjustPlan(segment.timingPlanId!)}
                  >
                    {t("调整计划")}
                  </Button>
                )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void runMutation(
                    t("确认：{0}", segment.title),
                    async () => {
                      const result = await confirmTimeActivity({
                        activityId: segment.activityId,
                        expectedVersion: segment.version,
                      });
                      const ids = events
                        .filter(
                          (event) => event.activityId === segment.activityId,
                        )
                        .map((event) => event.id);
                      if (ids.length) await onAckEvents(ids);
                      return result;
                    },
                    { undoable: true },
                  )
                }
              >
                {t("入账")}
              </Button>
            </div>
          </div>
        ))}
        {daily.unlocatedEstimates.map((activity) => (
          <div key={activity.id} className="ledger-review-item">
            <div>
              <strong>{activity.title}</strong>
              <p>
                {t("约")}{" "}
                {formatLedgerDuration(activity.estimatedSeconds || 0, locale)}
                {formatEstimateWindow(activity, timeZone)
                  ? ` · ${formatEstimateWindow(activity, timeZone)}`
                  : ""}
              </p>
              <div className="ledger-entry-meta">
                <LedgerAttribution
                  project={activity.projectSnapshot}
                  tags={activity.tags}
                />
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onLocate(activity)}
            >
              {t("定位")}
            </Button>
          </div>
        ))}
        {daily.sleepCandidates.map((candidate) => (
          <div key={candidate.key} className="ledger-review-item">
            <div>
              <span className="ledger-item-kind">{t("作息候选")}</span>
              <strong>
                {candidate.tag ? `#${candidate.tag}` : t("作息是否照常？")}
              </strong>
              <p>
                {formatTimeRangeInZone(
                  candidate.startMs,
                  candidate.endMs,
                  timeZone,
                )}{" "}
                ·{" "}
                {formatLedgerDuration(
                  (candidate.endMs - candidate.startMs) / 1000,
                  locale,
                )}
              </p>
              {candidate.hasConflict && (
                <p className="ledger-pending-label">{t("与记录重叠")}</p>
              )}
            </div>
            <div className="ledger-button-row">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void runMutation(t("跳过作息候选"), () =>
                    dismissSleepCandidate(candidate.date),
                  )
                }
              >
                {t("跳过")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || candidate.hasConflict}
                onClick={() =>
                  void runMutation(
                    t("确认作息"),
                    () => confirmSleepCandidate(candidate.date),
                    { undoable: true },
                  )
                }
              >
                {t("确认照常")}
              </Button>
            </div>
          </div>
        ))}
        {pending.map((operation) => (
          <div key={operation.operationId} className="ledger-review-item">
            <div>
              <strong>
                {operation.kind === "task_start"
                  ? t("任务是否已开始？")
                  : t("关联计时是否已结束？")}
              </strong>
            </div>
            <div className="ledger-button-row">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void runMutation(t("忽略待核对操作"), () =>
                    resolveTimeOperation({
                      operationId: operation.operationId,
                      action: "dismiss",
                    }),
                  )
                }
              >
                {t("忽略")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void runMutation(t("确认操作结果"), () =>
                    resolveTimeOperation({
                      operationId: operation.operationId,
                      action:
                        operation.kind === "task_start"
                          ? "accept_started"
                          : "stop_active",
                    }),
                  )
                }
              >
                {operation.kind === "task_start"
                  ? t("已开始")
                  : t("结束关联计时")}
              </Button>
            </div>
          </div>
        ))}
        {otherEvents.map((event) => (
          <div key={event.id} className="ledger-review-item">
            <div>
              <strong>{event.title}</strong>
            </div>
            <div className="ledger-button-row">
              {event.kind === "auto_stopped" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onOpenDay(localDateOf(event.occurredAtMs, timeZone))
                  }
                >
                  {t("查看当天")}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void onAckEvents([event.id])}
              >
                {t("知道了")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
