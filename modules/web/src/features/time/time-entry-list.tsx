import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type {
  DailyLedgerSummary,
  LocatedSegment,
  TimelineGap,
} from "@core/time/model";
import { Button } from "@/components/ui/button";
import {
  formatClockInZone,
  formatCurrencyCny,
  formatLedgerDuration,
  formatTimeRangeInZone,
} from "./time-format";

export function TimeEntryList({
  daily,
  timeZone,
  loading,
  busy,
  onEdit,
  onFillGap,
}: {
  daily: DailyLedgerSummary;
  timeZone: string;
  loading?: boolean;
  busy: boolean;
  onEdit: (segment: LocatedSegment) => void;
  onFillGap: (gap: TimelineGap) => void;
}) {
  const [showGaps, setShowGaps] = useState(false);
  const entries = [
    ...daily.locatedSegments.map((segment) => ({
      kind: "entry" as const,
      start: segment.startMs,
      segment,
    })),
    ...(showGaps
      ? daily.gaps.map((gap) => ({
          kind: "gap" as const,
          start: gap.startMs,
          gap,
        }))
      : []),
  ].sort((a, b) => a.start - b.start);
  return (
    <section className="ledger-entries" aria-label="时间线">
      <div className="ledger-block-heading">
        <div>
          <h2>时间线</h2>
        </div>
        <label className="ledger-checkbox-line">
          <input
            type="checkbox"
            checked={showGaps}
            onChange={(event) => setShowGaps(event.target.checked)}
          />
          显示空白时段
        </label>
      </div>
      <div className="ledger-entry-columns" aria-hidden="true">
        <span>时间</span>
        <span>活动</span>
        <span>时长</span>
        <span>时间折算</span>
        <span />
      </div>
      {loading ? (
        <p role="status" className="ledger-empty">
          正在加载所选日期…
        </p>
      ) : entries.length === 0 ? (
        <div className="ledger-empty">
          <p>这一天还没有记录</p>
        </div>
      ) : (
        <div>
          {entries.map((item) => {
            if (item.kind === "gap")
              return (
                <div
                  key={`gap:${item.start}`}
                  className="ledger-entry ledger-entry-gap"
                >
                  <time
                    title={formatTimeRangeInZone(
                      item.gap.startMs,
                      item.gap.endMs,
                      timeZone,
                    )}
                  >
                    {formatClockInZone(item.gap.startMs, timeZone)}
                    <small>{formatClockInZone(item.gap.endMs, timeZone)}</small>
                  </time>
                  <div className="ledger-entry-description">
                    <span>未记录时段</span>
                    <small>尚未计入已确认时长</small>
                  </div>
                  <span className="ledger-entry-duration">
                    {formatLedgerDuration(item.gap.durationSeconds)}
                  </span>
                  <span className="ledger-entry-cost">—</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`补记 ${formatClockInZone(item.gap.startMs, timeZone)} 的空白`}
                    disabled={busy}
                    onClick={() => onFillGap(item.gap)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              );
            const segment = item.segment;
            const needsReview =
              segment.reviewState === "review_required" ||
              (segment.provisionalSeconds ?? 0) > 0;
            return (
              <article
                key={`${segment.activityId}:${segment.startMs}`}
                className="ledger-entry"
                data-pending={needsReview || undefined}
              >
                <time
                  title={formatTimeRangeInZone(
                    segment.startMs,
                    segment.endMs,
                    timeZone,
                  )}
                >
                  {formatClockInZone(segment.startMs, timeZone)}
                  <small>
                    {segment.running
                      ? "进行中"
                      : formatClockInZone(segment.endMs, timeZone)}
                  </small>
                </time>
                <div className="ledger-entry-description">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onEdit(segment)}
                  >
                    {segment.title}
                  </button>
                  <div className="ledger-entry-meta">
                    {segment.projectSnapshot && (
                      <span>{segment.projectSnapshot}</span>
                    )}
                    {segment.tags?.map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                    {segment.precision === "estimated_bounds" && (
                      <span>大约</span>
                    )}
                    {needsReview && (
                      <span className="ledger-pending-label">待核对</span>
                    )}
                  </div>
                </div>
                <span className="ledger-entry-duration">
                  {formatLedgerDuration(segment.durationSeconds)}
                </span>
                <span
                  className="ledger-entry-cost"
                  data-unpriced={segment.categoryId === "sleep" || undefined}
                >
                  {segment.categoryId === "sleep"
                    ? "不折算"
                    : needsReview && segment.confirmedSeconds === 0
                      ? "待确认"
                      : formatCurrencyCny(segment.confirmedCostCents)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`编辑 ${segment.title}`}
                  disabled={busy}
                  onClick={() => onEdit(segment)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
