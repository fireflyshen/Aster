import type { TimerSnapshot } from "@core/time/model";
import { snapshotLiveStatus } from "@core/time/snapshot";
import type { Task } from "@shared/tasks";
import { RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { TimePage } from "@/app/hooks/use-workspace-navigation";
import { TimeSettingsPage } from "./time-settings-page";
import { TimeTodayPage } from "./time-today-page";
import { TimeWeeklyPage } from "./time-weekly-page";
import { useTimeLedger } from "./use-time-ledger";

/** Entry container for the Web "时间账本" module ("今日时间线", "本周分布", "时间设置"). */
export function TimeLedgerWorkspace({
  page,
  tasks,
  timerSnapshot,
  timerLiveStatus,
  activeActivitySeconds,
  isTimeMode,
  onOpenPage,
  onTimeMutated,
}: {
  page: TimePage;
  tasks: Task[];
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
      <Alert>
        <AlertDescription className="text-xs">
          当前服务端以兼容模式运行（`TIME_ENABLED=0`），Time
          账本写入与视图未激活。请移除 `TIME_ENABLED=0`
          环境变量并重启服务端以启用完整时间账本功能。
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {ledger.lastUndoable && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
          <span>
            最近操作：<strong>{ledger.lastUndoable.label}</strong>
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={ledger.busy}
              onClick={() => void ledger.handleUndoLast()}
            >
              <RotateCcw className="size-3" />
              撤销这笔修改
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={ledger.clearUndoable}
            >
              收起
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
        <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
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
            pendingDetails={ledger.pendingDetails}
            tasks={tasks}
            timerSnapshot={timerSnapshot}
            timerLiveStatus={timerLiveStatus}
            activeActivitySeconds={activeActivitySeconds}
            busy={ledger.busy}
            runMutation={ledger.runMutation}
          />
        ) : page === "weekly" && ledger.weekly ? (
          <TimeWeeklyPage
            policy={ledger.policy}
            selectedDate={ledger.selectedDate}
            onSelectDate={ledger.setSelectedDate}
            weekly={ledger.weekly}
            onOpenDay={(date) => {
              ledger.setSelectedDate(date);
              onOpenPage("today");
            }}
          />
        ) : page === "settings" ? (
          <TimeSettingsPage
            policy={ledger.policy}
            busy={ledger.busy}
            runMutation={ledger.runMutation}
          />
        ) : (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Spinner className="size-4" />
            正在刷新数据…
          </div>
        )
      ) : null}
    </div>
  );
}
