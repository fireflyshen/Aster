import { useI18n } from "@/app/language";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { hasTimeAssignment } from "@core/time/assignment";
import type {
  DailyLedgerSummary,
  LocatedSegment,
  TimelineGap,
} from "@core/time/model";
import { LedgerAttribution } from "./ledger-ui";
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
  onEdit: (segment: LocatedSegment, trigger: HTMLButtonElement) => void;
  onFillGap: (gap: TimelineGap, trigger: HTMLButtonElement) => void;
}) {
  const { t, locale } = useI18n();
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
    <section className="ledger-entries" aria-label={t("时间线")}>
      <div className="ledger-block-heading">
        <div>
          <h2>{t("时间线")}</h2>
        </div>
        <label className="ledger-checkbox-line">
          <input
            type="checkbox"
            checked={showGaps}
            onChange={(event) => setShowGaps(event.target.checked)}
          />
          {t("空档")}
        </label>
      </div>
      {loading ? (
        <p role="status" className="ledger-empty">
          {t("加载中…")}
        </p>
      ) : entries.length === 0 ? (
        <div className="ledger-empty">
          <p>{t("无记录")}</p>
        </div>
      ) : (
        <div className="ledger-entry-body">
          {entries.map((item) => {
            if (item.kind === "gap") {
              const startTime = formatClockInZone(item.gap.startMs, timeZone);
              const label = t("补记 {0} 的空白", startTime);
              return (
                <button
                  type="button"
                  key={`gap:${item.start}`}
                  className="ledger-entry ledger-entry-gap"
                  aria-label={label}
                  aria-haspopup="dialog"
                  title={label}
                  disabled={busy}
                  onClick={(event) => onFillGap(item.gap, event.currentTarget)}
                >
                  <time
                    title={formatTimeRangeInZone(
                      item.gap.startMs,
                      item.gap.endMs,
                      timeZone,
                    )}
                  >
                    {startTime}
                    <small>{formatClockInZone(item.gap.endMs, timeZone)}</small>
                  </time>
                  <span className="ledger-entry-description">{t("空档")}</span>
                  <span className="ledger-entry-duration">
                    {formatLedgerDuration(item.gap.durationSeconds, locale)}
                  </span>
                  <span className="ledger-entry-cost">—</span>
                  <span className="ledger-entry-action" aria-hidden="true">
                    <Plus className="size-3.5" />
                  </span>
                </button>
              );
            }
            const segment = item.segment;
            const needsReview =
              segment.reviewState === "review_required" ||
              (segment.provisionalSeconds ?? 0) > 0;
            const approximate = segment.precision === "estimated_bounds";
            const unconfirmed = needsReview && segment.confirmedSeconds === 0;
            return (
              <button
                type="button"
                key={`${segment.activityId}:${segment.startMs}`}
                className="ledger-entry"
                data-pending={needsReview || undefined}
                aria-label={segment.title}
                aria-haspopup="dialog"
                title={t("编辑 {0}", segment.title)}
                disabled={busy}
                onClick={(event) => onEdit(segment, event.currentTarget)}
              >
                <time
                  title={formatTimeRangeInZone(
                    segment.startMs,
                    segment.endMs,
                    timeZone,
                  )}
                >
                  {approximate && <span aria-label={t("约")}>≈</span>}
                  {formatClockInZone(segment.startMs, timeZone)}
                  <small>
                    {segment.running ? (
                      <span aria-label={t("计时中")}>…</span>
                    ) : (
                      formatClockInZone(segment.endMs, timeZone)
                    )}
                  </small>
                </time>
                <span className="ledger-entry-description">
                  <span className="ledger-entry-title">{segment.title}</span>
                  <span className="ledger-entry-meta">
                    <LedgerAttribution
                      project={segment.projectSnapshot}
                      tags={segment.tags}
                    />
                    {!hasTimeAssignment(
                      segment.projectSnapshot,
                      segment.tags,
                    ) && <span>{t("待补归属")}</span>}
                    {needsReview && (
                      <span className="ledger-pending-label">
                        {t("待核对")}
                      </span>
                    )}
                  </span>
                </span>
                <span className="ledger-entry-duration">
                  {formatLedgerDuration(segment.durationSeconds, locale)}
                </span>
                <span
                  className="ledger-entry-cost"
                  data-unpriced={segment.hourlyRateCents === 0 || undefined}
                  title={
                    unconfirmed
                      ? t("金额未入账")
                      : segment.hourlyRateCents === 0
                        ? t("不折算")
                        : t("时间折算")
                  }
                >
                  {unconfirmed
                    ? "—"
                    : formatCurrencyCny(segment.confirmedCostCents)}
                </span>
                <span className="ledger-entry-action" aria-hidden="true">
                  <Pencil className="size-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
