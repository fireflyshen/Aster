import type {
  Activity,
  DailyLedgerSummary,
  LocatedSegment,
  TimeEvent,
  TimingPlan,
} from "@core/time/model";
import { localDateOf } from "@core/time/zone";
import { Button } from "@/components/ui/button";
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
        <span>核对与待定位</span>
        <small>{count} 项</small>
      </summary>
      <p className="ledger-muted-note">
        待确认部分、作息候选和待定位估记处理后才入账。
      </p>
      <div className="ledger-review-items">
        {reviews.map((segment) => (
          <div
            key={`review:${segment.activityId}`}
            className="ledger-review-item"
          >
            <div>
              <span className="ledger-item-kind">待核对</span>
              <strong>{segment.title}</strong>
              <p>
                {formatTimeRangeInZone(
                  segment.startMs,
                  segment.endMs,
                  timeZone,
                )}{" "}
                · {formatLedgerDuration(segment.durationSeconds)}
              </p>
            </div>
            <div className="ledger-button-row">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onEdit(segment)}
              >
                修正时间
              </Button>
              {segment.timingPlanId &&
                plans.some((plan) => plan.id === segment.timingPlanId) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onAdjustPlan(segment.timingPlanId!)}
                  >
                    调整计划
                  </Button>
                )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void runMutation(
                    `确认：${segment.title}`,
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
                确认这段
              </Button>
            </div>
          </div>
        ))}
        {daily.unlocatedEstimates.map((activity) => (
          <div key={activity.id} className="ledger-review-item">
            <div>
              <span className="ledger-item-kind">待定位估记</span>
              <strong>{activity.title}</strong>
              <p>
                约 {formatLedgerDuration(activity.estimatedSeconds || 0)}
                {formatEstimateWindow(activity, timeZone)
                  ? ` · ${formatEstimateWindow(activity, timeZone)}`
                  : ""}
              </p>
              <div className="ledger-entry-meta">
                {activity.projectSnapshot && (
                  <span>{activity.projectSnapshot}</span>
                )}
                {activity.tags?.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onLocate(activity)}
            >
              定位时间
            </Button>
          </div>
        ))}
        {daily.sleepCandidates.map((candidate) => (
          <div key={candidate.key} className="ledger-review-item">
            <div>
              <span className="ledger-item-kind">作息候选</span>
              <strong>
                {candidate.tag ? `#${candidate.tag}` : "作息是否照常？"}
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
                )}
              </p>
              {candidate.hasConflict && (
                <p className="ledger-pending-label">
                  与已有记录重叠，请先修正时间线。
                </p>
              )}
            </div>
            <div className="ledger-button-row">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void runMutation("跳过作息候选", () =>
                    dismissSleepCandidate(candidate.date),
                  )
                }
              >
                跳过
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || candidate.hasConflict}
                onClick={() =>
                  void runMutation(
                    "确认作息",
                    () => confirmSleepCandidate(candidate.date),
                    { undoable: true },
                  )
                }
              >
                确认照常
              </Button>
            </div>
          </div>
        ))}
        {pending.map((operation) => (
          <div key={operation.operationId} className="ledger-review-item">
            <div>
              <span className="ledger-item-kind">操作结果待确认</span>
              <strong>
                {operation.kind === "task_start"
                  ? "任务是否已开始？"
                  : "关联计时是否已结束？"}
              </strong>
              <p>请核实实际状态，再确认这次操作。</p>
            </div>
            <div className="ledger-button-row">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void runMutation("忽略待核对操作", () =>
                    resolveTimeOperation({
                      operationId: operation.operationId,
                      action: "dismiss",
                    }),
                  )
                }
              >
                忽略
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void runMutation("确认操作结果", () =>
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
                {operation.kind === "task_start" ? "已开始" : "结束关联计时"}
              </Button>
            </div>
          </div>
        ))}
        {otherEvents.map((event) => (
          <div key={event.id} className="ledger-review-item">
            <div>
              <span className="ledger-item-kind">
                {event.kind === "plan_reminder" ? "计划提醒" : "计时提醒"}
              </span>
              <strong>{event.title}</strong>
              <p>
                {event.kind === "plan_reminder"
                  ? "计划时间已到，需要手动开始。"
                  : event.kind === "auto_stopped"
                    ? "计时已自动结束，请核对对应日期的记录。"
                    : "请检查计时是否仍在进行。"}
              </p>
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
                  查看当天
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void onAckEvents([event.id])}
              >
                知道了
              </Button>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
