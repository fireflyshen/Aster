import { LedgerPeriodPicker, LedgerSummary } from "./ledger-ui";
import { useState } from "react";
import { TimeStatisticChart } from "./time-statistic-chart";
import type { StatisticDimension } from "./time-statistics";
import type { TimePolicy, WeeklyDistributionSummary } from "@core/time/model";
import { addLocalDays, localDateOf } from "@core/time/zone";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatCurrencyCny,
  formatDurationChinese,
  formatDurationCompact,
  formatEstimateWindow,
  projectDisplayName,
  tagDisplayName,
} from "./time-format";

export function TimeWeeklyPage({
  policy,
  selectedDate,
  onSelectDate,
  weekly,
  onOpenDay,
}: {
  policy: TimePolicy;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  weekly: WeeklyDistributionSummary;
  onOpenDay: (date: string) => void;
}) {
  const [dimension, setDimension] = useState<StatisticDimension>("project");
  const timeZone = policy.timezone || "UTC";
  const todayStr = localDateOf(Date.now(), timeZone);

  const sortedProjects = Object.entries(weekly.byProjectSeconds)
    .filter(([, secs]) => secs > 0)
    .sort((a, b) => b[1] - a[1]);

  const sortedTags = Object.entries(weekly.byTagSeconds)
    .filter(([, secs]) => secs > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="ledger-page ledger-weekly">
      <LedgerPeriodPicker
        date={selectedDate}
        label="选择所在周日期"
        onDate={onSelectDate}
        onPrevious={() => onSelectDate(addLocalDays(selectedDate, -7))}
        onNext={() => onSelectDate(addLocalDays(selectedDate, 7))}
        onToday={() => onSelectDate(todayStr)}
        todayLabel="本周"
      >
        <span className="ledger-range">
          {weekly.weekStartDate} — {weekly.weekEndDate}
          {weekly.isPartialWeek ? " · 进行中" : ""}
        </span>
      </LedgerPeriodPicker>
      <LedgerSummary
        items={[
          {
            label: "本周已记录",
            value: formatDurationCompact(weekly.coveredSeconds),
            hint: `${weekly.daily.filter((day) => day.coveredSeconds > 0).length} 天有活动记录`,
          },
          {
            label: "已确认时间成本",
            value: formatCurrencyCny(weekly.confirmedCostCents),
            hint: "按记录时的单价折算",
          },
          {
            label: "待核对",
            value: formatDurationCompact(weekly.provisionalSeconds ?? 0),
            hint: "未计入已确认成本",
            attention: (weekly.provisionalSeconds ?? 0) > 0,
          },
        ]}
      />
      <section className="ledger-week-overview" aria-label="每日投入">
        <div className="ledger-section-heading">
          <h2>每日投入</h2>
          <span>点击日期查看时间线</span>
        </div>
        <div className="ledger-week-bars">
          {weekly.daily.map((day) => (
            <button
              key={day.date}
              type="button"
              aria-label={`${day.date} ${formatDurationChinese(day.coveredSeconds)}，查看时间线`}
              onClick={() => onOpenDay(day.date)}
              data-today={day.date === todayStr || undefined}
            >
              <strong>{formatDurationCompact(day.coveredSeconds)}</strong>
              <span className="ledger-week-track">
                <i
                  style={{
                    height: `${Math.max(2, (day.coveredSeconds / Math.max(1, ...weekly.daily.map((item) => item.coveredSeconds))) * 100)}%`,
                  }}
                />
              </span>
              <span>
                {new Intl.DateTimeFormat("zh-CN", {
                  weekday: "short",
                  timeZone: "UTC",
                }).format(new Date(day.date + "T12:00:00Z"))}
              </span>
              <small>{day.date.slice(5)}</small>
            </button>
          ))}
        </div>
      </section>
      <div className="ledger-section-heading">
        <h2>时间花在哪里</h2>
        <span>按项目或标签查看投入</span>
      </div>
      <TimeStatisticChart
        dimension={dimension}
        onDimension={setDimension}
        dimensions={["project", "tag"]}
        onOpenDay={onOpenDay}
        rows={
          dimension === "day"
            ? weekly.daily.map((day) => ({
                key: day.date,
                label: day.date.slice(5),
                date: day.date,
                seconds: day.coveredSeconds,
                cost: day.confirmedCostCents,
              }))
            : (dimension === "project" ? sortedProjects : sortedTags).map(
                ([key, seconds]) => ({
                  key,
                  label:
                    dimension === "project"
                      ? projectDisplayName(key)
                      : tagDisplayName(key),
                  seconds,
                  cost:
                    (dimension === "project"
                      ? weekly.byProjectCostCents
                      : weekly.byTagCostCents)[key] ?? 0,
                }),
              )
        }
      />

      {/* Weekly Unlocated Estimates */}
      {weekly.unlocatedEstimates.length > 0 && (
        <details className="ledger-disclosure">
          <summary>
            本周待定位估记 <span>{weekly.unlocatedEstimates.length}</span>
          </summary>
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              本周待定位估记
            </h2>
            <span className="text-xs text-muted-foreground/70 tabular-nums">
              {weekly.unlocatedEstimates.length} 项
            </span>
          </div>
          <div>
            {weekly.unlocatedEstimates.map((est) => {
              const win = formatEstimateWindow(est, timeZone);
              return (
                <div
                  key={est.id}
                  className="flex items-center justify-between gap-4 border-b border-border/35 py-2.5 px-2 -mx-2 rounded-md text-xs transition-colors hover:bg-(--row-hover)"
                >
                  <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
                    <span className="text-sm text-foreground">{est.title}</span>
                    <span className="text-muted-foreground tabular-nums">
                      约 {formatDurationChinese(est.estimatedSeconds || 0)}
                    </span>
                    {est.projectSnapshot && (
                      <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {est.projectSnapshot}
                      </span>
                    )}
                    {est.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="text-[11px] text-muted-foreground/75"
                      >
                        #{tag}
                      </span>
                    ))}
                    {win && (
                      <span className="text-muted-foreground/60">{win}</span>
                    )}
                  </div>
                  {est.targetDate && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => onOpenDay(est.targetDate!)}
                    >
                      去定位
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
