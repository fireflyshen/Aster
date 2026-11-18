import type { TimerSnapshot } from "@core/time/model";
import { snapshotLiveStatus } from "@core/time/snapshot";
import type { SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { RotateCcw, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { TimePage } from "@/app/hooks/use-workspace-navigation";
import { TimeCostReportPage } from "./time-cost-report-page";
import { collectTagOptions } from "./project-tag-fields";
import { TimeSettingsPage } from "./time-settings-page";
import { TimeTodayPage } from "./time-today-page";
import { useTimeLedger } from "./use-time-ledger";

/** Records and statistics share the same project/tag ledger. */
export function TimeLedgerWorkspace({
  page,
  tasks,
  projects,
  availableLabels,
  timerSnapshot,
  timerLiveStatus,
  activeActivitySeconds,
  isTimeMode,
  onOpenPage,
  onTimeMutated,
}: {
  page: TimePage;
  tasks: Task[];
  projects?: readonly string[];
  availableLabels?: readonly SavedTag[];
  timerSnapshot?: TimerSnapshot | null;
  timerLiveStatus?: ReturnType<typeof snapshotLiveStatus> | null;
  activeActivitySeconds: number | undefined;
  isTimeMode: boolean;
  onOpenPage: (page: TimePage) => void;
  onTimeMutated: () => void;
}) {
  const ledger = useTimeLedger({
    page,
    timerSnapshot,
    onTimeMutated,
  });

  if (!isTimeMode) {
    return (
      <p className="py-6 text-xs leading-relaxed text-muted-foreground">
        当前服务端以兼容模式运行（`TIME_ENABLED=0`），Time
        账本暂未启用。移除该环境变量并重启服务端即可使用完整时间账本。
      </p>
    );
  }

  return (
    <div className="ledger-workspace">
      <nav aria-label="时间账本视图" className="ledger-view-nav">
        {(
          [
            ["today", "记录"],
            ["weekly", "统计"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={
              page === value || (value === "weekly" && page === "reports")
                ? "page"
                : undefined
            }
            onClick={() => onOpenPage(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {ledger.lastUndoable && (
        <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-2 text-xs text-muted-foreground">
          <span className="truncate">
            已记录：
            <span className="text-foreground">{ledger.lastUndoable.label}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-6 gap-1 px-2 text-xs text-foreground"
              disabled={ledger.busy}
              onClick={() => void ledger.handleUndoLast()}
            >
              <RotateCcw className="size-3" />
              撤销
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="收起提示"
              className="size-6 text-muted-foreground"
              onClick={ledger.clearUndoable}
            >
              <X className="size-3" />
            </Button>
          </div>
        </div>
      )}

      {ledger.error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>{ledger.error}</span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => void ledger.reload()}
            >
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {ledger.loading && !ledger.policy ? (
        <div className="flex items-center gap-2 py-12 text-xs text-muted-foreground">
          <Spinner className="size-4" />
          加载时间账本…
        </div>
      ) : ledger.policy ? (
        page === "today" && ledger.daily ? (
          <TimeTodayPage
            status={ledger.status}
            policy={ledger.policy}
            selectedDate={ledger.selectedDate}
            onSelectDate={ledger.setSelectedDate}
            daily={ledger.daily}
            plans={ledger.plans}
            events={ledger.events}
            pendingDetails={ledger.pendingDetails}
            tasks={tasks}
            projects={projects}
            availableLabels={availableLabels}
            timerSnapshot={timerSnapshot}
            timerLiveStatus={timerLiveStatus}
            activeActivitySeconds={activeActivitySeconds}
            busy={ledger.busy}
            loading={ledger.loading}
            onAckEvents={ledger.handleAckEvents}
            runMutation={ledger.runMutation}
          />
        ) : page === "weekly" || page === "reports" ? (
          <TimeCostReportPage
            initialMetric={page === "reports" ? "cost" : "seconds"}
            refreshKey={`${timerSnapshot?.timeEpoch}:${timerSnapshot?.taskDataEpoch}:${timerSnapshot?.sessionVersion}`}
            policy={ledger.policy}
            selectedDate={ledger.selectedDate}
            onSelectDate={ledger.setSelectedDate}
            onOpenDay={(date) => {
              ledger.setSelectedDate(date);
              onOpenPage("today");
            }}
            onMutated={onTimeMutated}
          />
        ) : page === "settings" ? (
          <TimeSettingsPage
            policy={ledger.policy}
            availableTags={collectTagOptions(availableLabels ?? [], tasks)}
            busy={ledger.busy}
            runMutation={ledger.runMutation}
          />
        ) : (
          <div className="flex items-center gap-2 py-12 text-xs text-muted-foreground">
            <Spinner className="size-4" />
            正在刷新数据…
          </div>
        )
      ) : null}
    </div>
  );
}
