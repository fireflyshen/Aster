import { useI18n } from "@/app/language";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ChevronDown } from "lucide-react";
import type {
  CostReportGranularity,
  CostReportSegmentRef,
  CostReportSummary,
  TimePolicy,
} from "@core/time/model";
import { addLocalDays, localDateOf, mondayOfWeek } from "@core/time/zone";
import { Button } from "@/components/ui/button";
import {
  LedgerAttribution,
  LedgerPeriodPicker,
  LedgerSummary,
} from "./ledger-ui";
import { LinkedBillsList } from "./bill-link-dialog";
import { fetchCostReport, unlinkBillLink } from "./time-api";
import {
  formatClockInZone,
  formatCurrencyCny,
  formatLedgerDuration,
} from "./time-format";
import {
  costStatisticRows,
  costTagGroups,
  nonProjectGroups,
} from "./time-statistics";

function shiftPeriodDate(
  date: string,
  period: CostReportGranularity,
  delta: number,
) {
  if (period === "week") return addLocalDays(date, delta * 7);
  const [year, month] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function reportDateLabel(date: string, period: CostReportGranularity) {
  if (period === "month") return date.slice(0, 7).replace("-", "/");
  const start = mondayOfWeek(date);
  const end = addLocalDays(start, 6);
  return [start, end].map((day) => day.slice(5).replace("-", "/")).join("–");
}

function SegmentTraceList({
  segments,
  timeZone,
  onOpenDay,
}: {
  segments: readonly CostReportSegmentRef[];
  timeZone: string;
  onOpenDay: (date: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="ledger-stat-traces">
      {[...segments]
        .sort((a, b) => b.startMs - a.startMs)
        .map((segment) => (
          <button
            key={`${segment.activityId}:${segment.startMs}`}
            onClick={() => onOpenDay(segment.date)}
            type="button"
          >
            <span>
              <time>
                {segment.date.slice(5)} ·{" "}
                {formatClockInZone(segment.startMs, timeZone)}–
                {formatClockInZone(segment.endMs, timeZone)}
              </time>
              <strong>{segment.title}</strong>
              {!!segment.tags?.length && (
                <small>
                  <LedgerAttribution tags={segment.tags} />
                </small>
              )}
              {segment.provisionalSeconds > 0 && (
                <small className="ledger-pending-label">
                  {t("待核对")}{" "}
                  {formatLedgerDuration(segment.provisionalSeconds, locale)}
                </small>
              )}
            </span>
            <span>
              {formatLedgerDuration(segment.confirmedSeconds, locale)}
              <small>{formatCurrencyCny(segment.confirmedCostCents)}</small>
            </span>
          </button>
        ))}
    </div>
  );
}

export function TimeCostReportPage({
  policy,
  selectedDate,
  onSelectDate,
  onOpenDay,
  onMutated,
  initialMetric = "seconds",
  refreshKey,
}: {
  policy: TimePolicy;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onOpenDay: (date: string) => void;
  onMutated?: () => void;
  initialMetric?: "seconds" | "cost";
  refreshKey?: string;
}) {
  const { t, locale } = useI18n();
  const timeZone = policy.timezone || "UTC";
  const [period, setPeriod] = useState<CostReportGranularity>("week");
  const [metric, setMetric] = useState(initialMetric);
  const [groupBy, setGroupBy] = useState<"project" | "tag">("project");
  const [report, setReport] = useState<CostReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const queryRef = useRef({ selectedDate, period });
  queryRef.current = { selectedDate, period };
  const loadReport = useCallback(async () => {
    const { selectedDate, period } = queryRef.current;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    setExpanded(undefined);
    try {
      const next = await fetchCostReport({
        date: selectedDate,
        granularity: period,
        sortBy: "highest_cost",
      });
      if (request === generation.current) setReport(next);
    } catch (error) {
      if (request === generation.current)
        setError(error instanceof Error ? error.message : t("加载统计失败"));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadReport();
    return () => {
      generation.current++;
    };
  }, [loadReport, selectedDate, period, refreshKey, policy.policyVersion]);
  async function unlink(id: string) {
    setBusy(true);
    setError("");
    try {
      await unlinkBillLink(id);
      await loadReport();
      onMutated?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("解除关联失败"));
    } finally {
      setBusy(false);
    }
  }
  const rows = report
    ? [...(groupBy === "project" ? report.byProject : costTagGroups(report))]
        .filter((row) => row.periodSeconds > 0)
        .sort(
          (a, b) =>
            (metric === "seconds"
              ? b.periodSeconds - a.periodSeconds
              : b.periodCostCents - a.periodCostCents) ||
            a.projectName.localeCompare(b.projectName, "zh-CN"),
        )
    : [];
  const days = report ? costStatisticRows(report, "day", timeZone) : [];
  const maxDay = Math.max(
    1,
    ...days.map((day) => (metric === "seconds" ? day.seconds : day.cost)),
  );
  const total = report
    ? metric === "seconds"
      ? report.totalPeriodConfirmedSeconds
      : report.totalPeriodConfirmedCostCents
    : 0;
  const nonProjects = report ? nonProjectGroups(report) : undefined;
  const tagOverlap =
    groupBy === "tag" &&
    report &&
    rows.reduce((sum, row) => sum + row.periodSeconds, 0) >
      report.totalPeriodConfirmedSeconds;
  const dateLabel = reportDateLabel(selectedDate, period);
  const bills = report
    ? [
        ...new Map(
          [
            ...report.byTask.flatMap((task) => task.billLinks),
            ...report.unassignedBillLinks,
          ].map((link) => [link.id, link]),
        ).values(),
      ]
    : [];
  return (
    <div className="ledger-page ledger-statistics-page">
      <LedgerPeriodPicker
        date={selectedDate}
        dateLabel={dateLabel}
        label={t("选择统计日期：{0}（{1}）", dateLabel, selectedDate)}
        onDate={onSelectDate}
        onPrevious={() =>
          onSelectDate(shiftPeriodDate(selectedDate, period, -1))
        }
        onNext={() => onSelectDate(shiftPeriodDate(selectedDate, period, 1))}
        onToday={() => onSelectDate(localDateOf(Date.now(), timeZone))}
        todayLabel={period === "week" ? t("本周") : t("本月")}
      >
        <div
          className="ledger-segments"
          role="group"
          aria-label={t("统计周期")}
        >
          {(
            [
              ["week", t("周")],
              ["month", t("月")],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </LedgerPeriodPicker>
      {error && (
        <div role="alert" className="ledger-error-row">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void loadReport()}>
            {t("重试")}
          </Button>
        </div>
      )}
      {loading ? (
        <p role="status" className="ledger-empty">
          {t("加载中…")}
        </p>
      ) : !error && report ? (
        <>
          <LedgerSummary
            items={[
              {
                label: t("已确认时长"),
                value: formatLedgerDuration(
                  report.totalPeriodConfirmedSeconds,
                  locale,
                ),
              },
              {
                label: t("时间折算"),
                value: formatCurrencyCny(report.totalPeriodConfirmedCostCents),
              },
              ...(report.totalPeriodProvisionalSeconds > 0
                ? [
                    {
                      label: t("待核对"),
                      value: formatLedgerDuration(
                        report.totalPeriodProvisionalSeconds,
                        locale,
                      ),
                      attention: true,
                    },
                  ]
                : []),
            ]}
          />
          <section className="ledger-distribution" aria-label={t("时间分布")}>
            <h2 className="sr-only">{t("时间花在哪里")}</h2>
            <div className="ledger-distribution-columns">
              <div
                className="ledger-segments"
                role="group"
                aria-label={t("统计分组")}
              >
                {(
                  [
                    ["project", t("项目")],
                    ["tag", t("标签")],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={groupBy === value}
                    aria-label={t("按{0}", label)}
                    onClick={() => {
                      setGroupBy(value);
                      setExpanded(undefined);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(
                [
                  ["seconds", t("时长")],
                  ["cost", t("折算金额")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={t("按{0}降序", label)}
                  aria-pressed={metric === value}
                  onClick={() => setMetric(value)}
                >
                  {metric === value && <ArrowDown className="size-3" />}
                  {value === "cost" ? t("折算") : label}
                </button>
              ))}
            </div>
            {rows.length === 0 &&
              !(
                groupBy === "project" &&
                (nonProjects?.tagged.length || nonProjects?.legacy.length)
              ) && <p className="ledger-empty">{t("无记录")}</p>}
            {rows.length > 0 &&
              rows.map((row) => {
                const key = `${groupBy}:${row.projectKey}`;
                const value =
                  metric === "seconds"
                    ? row.periodSeconds
                    : row.periodCostCents;
                return (
                  <div className="ledger-distribution-item" key={key}>
                    <button
                      type="button"
                      className="ledger-distribution-row"
                      aria-expanded={expanded === key}
                      onClick={() =>
                        setExpanded(expanded === key ? undefined : key)
                      }
                    >
                      <span className="ledger-distribution-label">
                        <span>
                          <ChevronDown
                            className="size-3.5"
                            data-open={expanded === key}
                          />
                          <strong>
                            {groupBy === "tag" &&
                            row.projectKey === "__untagged__"
                              ? t("未设标签")
                              : row.projectName}
                          </strong>
                        </span>
                        <span className="ledger-share-track">
                          <i
                            style={{
                              width: `${total ? Math.min(100, (value / total) * 100) : 0}%`,
                            }}
                          />
                        </span>
                      </span>
                      <span>
                        {formatLedgerDuration(row.periodSeconds, locale)}
                      </span>
                      <span>{formatCurrencyCny(row.periodCostCents)}</span>
                    </button>
                    {expanded === key && (
                      <div className="ledger-distribution-details">
                        {groupBy === "project" &&
                          (row.overInitialBudgetCents > 0 ||
                            row.cashExpenseCents > 0) && (
                            <p className="ledger-muted-note flex flex-wrap gap-x-3">
                              {row.overInitialBudgetCents > 0 && (
                                <span>
                                  {t("超预算")}{" "}
                                  {formatCurrencyCny(
                                    row.overInitialBudgetCents,
                                  )}
                                </span>
                              )}
                              {row.cashExpenseCents > 0 && (
                                <span>
                                  {t("现金")}{" "}
                                  {formatCurrencyCny(row.cashExpenseCents)}
                                </span>
                              )}
                            </p>
                          )}
                        <SegmentTraceList
                          segments={row.segments}
                          timeZone={timeZone}
                          onOpenDay={onOpenDay}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            {groupBy === "project" &&
              nonProjects &&
              (
                [
                  [t("仅标签"), nonProjects.tagged],
                  [t("待补归属"), nonProjects.legacy],
                ] as const
              ).map(
                ([label, segments]) =>
                  segments.length > 0 && (
                    <details
                      className="ledger-section-disclosure ledger-non-project"
                      key={label}
                    >
                      <summary>
                        <span>{label}</span>
                        <small>
                          {formatLedgerDuration(
                            segments.reduce(
                              (sum, segment) => sum + segment.confirmedSeconds,
                              0,
                            ),
                            locale,
                          )}
                          {" · "}
                          {formatCurrencyCny(
                            segments.reduce(
                              (sum, segment) =>
                                sum + segment.confirmedCostCents,
                              0,
                            ),
                          )}
                        </small>
                      </summary>
                      <SegmentTraceList
                        segments={segments}
                        timeZone={timeZone}
                        onOpenDay={onOpenDay}
                      />
                    </details>
                  ),
              )}
            {tagOverlap && (
              <p className="ledger-muted-note">{t("标签可重叠")}</p>
            )}
          </section>
          <details className="ledger-section-disclosure ledger-daily-trend">
            <summary>
              <span>{t("每日趋势")}</span>
              <small>{metric === "seconds" ? t("时长") : t("折算")}</small>
            </summary>
            <div className="ledger-trend-bars" data-period={period}>
              {days.map((day, index) => {
                const value = metric === "seconds" ? day.seconds : day.cost;
                return (
                  <button
                    key={day.key}
                    type="button"
                    aria-label={t(
                      "{0} {1}，查看记录",
                      day.date,
                      metric === "seconds"
                        ? formatLedgerDuration(value, locale)
                        : formatCurrencyCny(value),
                    )}
                    title={`${day.date} · ${metric === "seconds" ? formatLedgerDuration(value, locale) : formatCurrencyCny(value)}`}
                    onClick={() => day.date && onOpenDay(day.date!)}
                  >
                    <span className="ledger-trend-value">
                      {metric === "seconds"
                        ? formatLedgerDuration(value, locale)
                        : formatCurrencyCny(value)}
                    </span>
                    <span className="ledger-trend-track">
                      <i
                        style={{
                          height: `${value ? Math.max(3, (value / maxDay) * 100) : 0}%`,
                        }}
                      />
                    </span>
                    <time>
                      {period === "week"
                        ? day.label
                        : index % 5 === 0 || index === days.length - 1
                          ? Number(day.date?.slice(-2))
                          : ""}
                    </time>
                  </button>
                );
              })}
            </div>
          </details>
          {(bills.length > 0 || report.totalCashExpenseCents > 0) && (
            <details className="ledger-section-disclosure">
              <summary>
                <span>{t("现金支出")}</span>
                <small>{formatCurrencyCny(report.totalCashExpenseCents)}</small>
              </summary>
              <p className="ledger-muted-note">
                {t("综合投入")}{" "}
                {formatCurrencyCny(report.totalCombinedCostCents)}。
              </p>
              <LinkedBillsList links={bills} busy={busy} onUnlink={unlink} />
            </details>
          )}
        </>
      ) : null}
    </div>
  );
}
