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
  const timeZone = policy.timezone || "UTC";
  const todayStr = localDateOf(Date.now(), timeZone);

  const sortedProjects = Object.entries(weekly.byProjectSeconds)
    .filter(([, secs]) => secs > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxProjectSeconds = sortedProjects[0]?.[1] || 1;

  const sortedTags = Object.entries(weekly.byTagSeconds)
    .filter(([, secs]) => secs > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxTagSeconds = sortedTags[0]?.[1] || 1;

  return (
    <div className="space-y-10">
      {/* Minimal week switcher & single-line coverage summary */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="上一周"
            className="text-muted-foreground"
            onClick={() => onSelectDate(addLocalDays(selectedDate, -7))}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Input
            type="date"
            aria-label="选择所在周日期"
            className="h-7 w-[124px] border-0 bg-transparent px-1 text-xs font-medium shadow-none focus-visible:ring-0"
            value={selectedDate}
            onChange={(e) => {
              if (e.target.value) onSelectDate(e.target.value);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="下一周"
            className="text-muted-foreground"
            onClick={() => onSelectDate(addLocalDays(selectedDate, 7))}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <span className="ml-1 text-xs text-muted-foreground/75 tabular-nums">
            {weekly.weekStartDate.slice(5)} – {weekly.weekEndDate.slice(5)}
            {weekly.isPartialWeek ? " · 进行中" : ""}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-1 h-6 px-2 text-xs text-muted-foreground"
            onClick={() => onSelectDate(todayStr)}
          >
            本周
          </Button>
        </div>

        <div
          className="text-xs text-muted-foreground tabular-nums"
          title={`已定位 ${formatDurationChinese(weekly.coveredSeconds)} · 空白 ${formatDurationChinese(weekly.unrecordedSeconds)} · 周容量 ${formatDurationChinese(weekly.pastCapacitySeconds)}`}
        >
          已记{" "}
          <span className="text-foreground">
            {formatDurationCompact(weekly.coveredSeconds)}
          </span>
          {weekly.confirmedCostCents > 0 && (
            <span className="ml-1.5 font-medium text-foreground">
              {formatCurrencyCny(weekly.confirmedCostCents)}
            </span>
          )}
          {(weekly.provisionalSeconds ?? 0) > 0 && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              <span className="text-amber-600 dark:text-amber-400">
                待核对 {formatDurationCompact(weekly.provisionalSeconds ?? 0)}
                {weekly.provisionalCostCents > 0
                  ? ` (${formatCurrencyCny(weekly.provisionalCostCents)})`
                  : ""}
              </span>
            </>
          )}
          <span className="mx-1.5 opacity-40">·</span>
          空白 {formatDurationCompact(weekly.unrecordedSeconds)}
          {weekly.unlocatedEstimates.length > 0 && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              待定位 {weekly.unlocatedEstimates.length}
            </>
          )}
        </div>
      </div>

      {/* Project Distribution: Taskwarrior projects */}
      <section>
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <h2 className="text-xs font-medium text-muted-foreground">
            项目投入
          </h2>
          <span className="text-xs text-muted-foreground/70">
            基于 Taskwarrior 项目与已定位活动
          </span>
        </div>

        {sortedProjects.length === 0 ? (
          <p className="py-10 text-xs text-muted-foreground/65">
            这周还没有已定位记录。
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {sortedProjects.map(([projectKey, secs]) => {
              const costCents = weekly.byProjectCostCents[projectKey] ?? 0;
              const coveredShare =
                weekly.coveredSeconds > 0
                  ? Math.round((secs / weekly.coveredSeconds) * 100)
                  : 0;
              const barPct = Math.max(
                2,
                Math.round((secs / maxProjectSeconds) * 100),
              );
              return (
                <div key={projectKey} className="space-y-1.5">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-sm text-foreground">
                      {projectDisplayName(projectKey)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {costCents > 0 && (
                        <strong className="mr-2 font-medium text-foreground">
                          {formatCurrencyCny(costCents)}
                        </strong>
                      )}
                      {formatDurationChinese(secs)}
                      <span className="ml-2 text-muted-foreground/65">
                        {coveredShare}%
                      </span>
                    </span>
                  </div>
                  <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted/60">
                    <div
                      className="h-full rounded-full bg-primary/75 transition-all"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Tag Distribution: Taskwarrior tags */}
      <section>
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <h2 className="text-xs font-medium text-muted-foreground">
            标签分布
          </h2>
          <span className="text-xs text-muted-foreground/70">
            多标签活动会分别累计
          </span>
        </div>

        {sortedTags.length === 0 ? (
          <p className="py-8 text-xs text-muted-foreground/65">
            本周活动尚未关联标签。
          </p>
        ) : (
          <div className="mt-5 space-y-3.5">
            {sortedTags.map(([tagKey, secs]) => {
              const costCents = weekly.byTagCostCents[tagKey] ?? 0;
              const barPct = Math.max(
                2,
                Math.round((secs / maxTagSeconds) * 100),
              );
              return (
                <div key={tagKey} className="space-y-1.5">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-sm text-foreground">
                      {tagDisplayName(tagKey)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {costCents > 0 && (
                        <strong className="mr-2 font-medium text-foreground">
                          {formatCurrencyCny(costCents)}
                        </strong>
                      )}
                      {formatDurationChinese(secs)}
                    </span>
                  </div>
                  <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted/60">
                    <div
                      className="h-full rounded-full bg-foreground/55 transition-all"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Daily Overview Rows */}
      <section>
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <h2 className="text-xs font-medium text-muted-foreground">每日</h2>
          <span className="text-xs text-muted-foreground/70">
            点击进入当日时间线
          </span>
        </div>
        <div>
          {weekly.daily.map((day) => (
            <button
              key={day.date}
              type="button"
              onClick={() => onOpenDay(day.date)}
              className="flex w-full items-center justify-between gap-4 border-b border-border/35 py-3 px-2 -mx-2 rounded-md text-left text-xs transition-colors hover:bg-(--row-hover)"
            >
              <div className="flex items-baseline gap-2.5">
                <span className="font-mono text-sm text-foreground tabular-nums">
                  {day.date.slice(5)}
                </span>
                {day.date === todayStr && (
                  <span className="text-[11px] text-primary">今天</span>
                )}
                {day.unlocatedEstimates.length > 0 && (
                  <span className="text-[11px] text-muted-foreground/75">
                    {day.unlocatedEstimates.length} 项待定位
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-muted-foreground tabular-nums">
                {day.confirmedCostCents > 0 && (
                  <span className="font-medium text-foreground">
                    {formatCurrencyCny(day.confirmedCostCents)}
                  </span>
                )}
                <span className="text-foreground/85">
                  {formatDurationCompact(day.coveredSeconds)}
                </span>
                <span className="w-16 text-right text-muted-foreground/60">
                  空白 {formatDurationCompact(day.unrecordedSeconds)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Weekly Unlocated Estimates */}
      {weekly.unlocatedEstimates.length > 0 && (
        <section>
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
        </section>
      )}
    </div>
  );
}
