import type { TimePolicy, WeeklyDistributionSummary } from "@core/time/model";
import { addLocalDays, localDateOf } from "@core/time/zone";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatDurationChinese,
  formatDurationCompact,
  formatEstimateWindow,
  resolveCategoryLabel,
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
  const timeZone = policy.timezone || "UTC";
  const todayStr = localDateOf(Date.now(), timeZone);

  const sortedCategories = Object.entries(weekly.byCategorySeconds)
    .filter(([, secs]) => secs > 0)
    .sort((a, b) => b[1] - a[1]);

  const maxCatSeconds = sortedCategories[0]?.[1] || 1;

  return (
    <div className="space-y-5">
      {/* Week Controls & Partial-Week Coverage Banner */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label="上一周"
              onClick={() => onSelectDate(addLocalDays(selectedDate, -7))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Input
              type="date"
              aria-label="选择所在周日期"
              className="h-7 w-[138px] text-xs"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) onSelectDate(e.target.value);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label="下一周"
              onClick={() => onSelectDate(addLocalDays(selectedDate, 7))}
            >
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onSelectDate(todayStr)}
            >
              本周
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {weekly.weekStartDate} 至 {weekly.weekEndDate}
            </span>
            {weekly.isPartialWeek && (
              <Badge variant="outline">进行中（不完整周）</Badge>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="text-[11px] text-muted-foreground">
              本周已定位时间 (C)
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {formatDurationChinese(weekly.coveredSeconds)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              占已过总时长{" "}
              {weekly.pastCapacitySeconds > 0
                ? `${Math.round((weekly.coveredSeconds / weekly.pastCapacitySeconds) * 100)}%`
                : "0%"}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="text-[11px] text-muted-foreground">
              本周未记录空白 (U)
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-muted-foreground">
              {formatDurationChinese(weekly.unrecordedSeconds)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              缺口同步展示，不代表时间价值
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="text-[11px] text-muted-foreground">
              截至目前周容量 (C + U = T)
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {formatDurationChinese(weekly.pastCapacitySeconds)}
            </div>
            {weekly.unlocatedEstimates.length > 0 && (
              <div className="mt-0.5 text-[11px] text-primary">
                另有 {weekly.unlocatedEstimates.length} 项待定位估记
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Category Distribution Bars */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <h2 className="text-sm font-medium">分类时间分布</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          仅基于已定位活动计算，保持各分类时间清晰可控；未记录空白与待定位估记单独展示。
        </p>

        {sortedCategories.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            这周还没有已定位记录。
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {sortedCategories.map(([catId, secs]) => {
              const coveredShare =
                weekly.coveredSeconds > 0
                  ? Math.round((secs / weekly.coveredSeconds) * 100)
                  : 0;
              const barPct = Math.max(
                4,
                Math.round((secs / maxCatSeconds) * 100),
              );
              return (
                <div key={catId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">
                      {resolveCategoryLabel(catId, policy)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatDurationChinese(secs)} · 占已记录 {coveredShare}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/80 transition-all"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Weekly Unlocated Estimates */}
      {weekly.unlocatedEstimates.length > 0 && (
        <section className="rounded-xl border border-border/70 bg-card/50 p-4">
          <h2 className="text-sm font-medium">本周待定位估记</h2>
          <div className="mt-3 space-y-2">
            {weekly.unlocatedEstimates.map((est) => {
              const win = formatEstimateWindow(est, timeZone);
              return (
                <div
                  key={est.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {est.title}
                    </span>
                    <Badge variant="outline">
                      大约 {formatDurationChinese(est.estimatedSeconds || 0)}
                    </Badge>
                    <Badge variant="secondary">
                      {resolveCategoryLabel(est.categoryId, policy)}
                    </Badge>
                    {win && (
                      <span className="text-muted-foreground">{win}</span>
                    )}
                  </div>
                  {est.targetDate && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => onOpenDay(est.targetDate!)}
                    >
                      去当天定位
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Daily Breakdown List */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <h2 className="mb-3 text-sm font-medium">
          每日概览（点击进入当日对账）
        </h2>
        <div className="divide-y divide-border/60">
          {weekly.daily.map((day) => (
            <button
              key={day.date}
              type="button"
              onClick={() => onOpenDay(day.date)}
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-xs transition-colors hover:bg-muted/30"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium tabular-nums">
                  {day.date}
                </span>
                {day.date === todayStr && (
                  <Badge variant="secondary">今天</Badge>
                )}
                {day.unlocatedEstimates.length > 0 && (
                  <Badge variant="outline">
                    {day.unlocatedEstimates.length} 项待定位
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-muted-foreground tabular-nums">
                <span>已记 {formatDurationCompact(day.coveredSeconds)}</span>
                <span>空白 {formatDurationCompact(day.unrecordedSeconds)}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
