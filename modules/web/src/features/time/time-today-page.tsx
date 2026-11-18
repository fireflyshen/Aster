import { useMemo, useState } from "react";
import { Play, Plus } from "lucide-react";
import type {
  Activity,
  DailyLedgerSummary,
  LocatedSegment,
  TimeEvent,
  TimePolicy,
  TimerSnapshot,
  TimelineGap,
  TimingPlan,
} from "@core/time/model";
import { snapshotLiveStatus } from "@core/time/snapshot";
import {
  addLocalDays,
  localDateOf,
  zonedDateTimeToUtcMs,
} from "@core/time/zone";
import type { SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { Button } from "@/components/ui/button";
import { LedgerPeriodPicker, LedgerSummary } from "./ledger-ui";
import { collectProjectOptions, collectTagOptions } from "./project-tag-fields";
import {
  estimateTimeActivity,
  locateTimeEstimate,
  logTimeActivity,
  updateTimeActivity,
  type TimeReceipt,
  type TimeStatusResponse,
} from "./time-api";
import {
  EditSegmentDialog,
  LocateEstimateDialog,
  TimeLogOrEstimateDialog,
  type LogDialogSeed,
} from "./time-activity-dialogs";
import { TimeCapturePanel } from "./time-capture-panel";
import { TimeEntryList } from "./time-entry-list";
import { TimePlansPanel } from "./time-plans-panel";
import { TimeReviewPanel } from "./time-review-panel";
import {
  formatClockInZone,
  formatCurrencyCny,
  formatLedgerDuration,
} from "./time-format";
import type { LedgerMutation } from "./time-ledger-types";
import type { PendingOperationDetail } from "./use-time-ledger";

export function TimeTodayPage({
  status,
  policy,
  selectedDate,
  onSelectDate,
  daily,
  plans,
  events,
  pendingDetails,
  tasks,
  projects,
  availableLabels,
  timerSnapshot,
  timerLiveStatus,
  activeActivitySeconds,
  busy,
  loading,
  onAckEvents,
  runMutation,
}: {
  status: TimeStatusResponse | null;
  policy: TimePolicy;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  daily: DailyLedgerSummary;
  plans: TimingPlan[];
  events: TimeEvent[];
  pendingDetails: PendingOperationDetail[];
  tasks: Task[];
  projects?: readonly string[];
  availableLabels?: readonly SavedTag[];
  timerSnapshot?: TimerSnapshot | null;
  timerLiveStatus?: ReturnType<typeof snapshotLiveStatus> | null;
  activeActivitySeconds: number | undefined;
  busy: boolean;
  loading?: boolean;
  onAckEvents: (eventIds: string[]) => Promise<void> | void;
  runMutation: LedgerMutation;
}) {
  const timeZone = policy.timezone || "UTC";
  const today = localDateOf(Date.now(), timeZone);
  const currentDateLoaded = daily.date === selectedDate;
  const [logSeed, setLogSeed] = useState<LogDialogSeed | null>(null);
  const [composing, setComposing] = useState(false);
  const [locating, setLocating] = useState<Activity | null>(null);
  const [editing, setEditing] = useState<LocatedSegment | null>(null);
  const [requestedPlanId, setRequestedPlanId] = useState<string>();
  const projectOptions = useMemo(
    () => collectProjectOptions(projects || [], tasks),
    [projects, tasks],
  );
  const tagOptions = useMemo(
    () => collectTagOptions(availableLabels || [], tasks),
    [availableLabels, tasks],
  );
  function openLog(gap?: TimelineGap) {
    const end =
      gap?.endMs ??
      (selectedDate === today
        ? Date.now()
        : zonedDateTimeToUtcMs(selectedDate, "20:00", timeZone));
    const start =
      gap?.startMs ??
      Math.max(
        zonedDateTimeToUtcMs(selectedDate, "00:00", timeZone),
        end - 30 * 60_000,
      );
    setLogSeed({
      mode: "log",
      date: selectedDate,
      startTime: formatClockInZone(start, timeZone),
      endTime: formatClockInZone(end, timeZone),
      estimatedMinutes: "30",
      ...(gap ? { exactStartMs: start, exactEndMs: end } : {}),
    });
  }
  async function submitDialog<T extends TimeReceipt | Record<string, unknown>>(
    label: string,
    action: () => Promise<T>,
  ) {
    let message = "";
    const result = await runMutation(label, action, {
      undoable: true,
      onError: (error) => {
        message = error;
      },
    });
    return result ? null : message || "保存失败，请重试。";
  }
  return (
    <div className="ledger-page ledger-record-page">
      <LedgerPeriodPicker
        date={selectedDate}
        label="选择记录日期"
        onDate={onSelectDate}
        onPrevious={() => onSelectDate(addLocalDays(selectedDate, -1))}
        onNext={() => onSelectDate(addLocalDays(selectedDate, 1))}
        onToday={() => onSelectDate(today)}
      >
        {!status?.activeActivity && (
          <Button size="sm" variant="ghost" disabled={busy} aria-expanded={composing} aria-controls={composing ? "ledger-capture" : undefined} onClick={() => setComposing((value) => !value)}>
            <Play className="size-3.5" />
            计时
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !currentDateLoaded}
          onClick={() => openLog()}
        >
          <Plus className="size-3.5" />
          补记
        </Button>
      </LedgerPeriodPicker>
      <TimeCapturePanel
        status={status}
        composing={composing}
        onCloseComposer={() => setComposing(false)}
        timeZone={timeZone}
        selectedDate={selectedDate}
        tasks={tasks}
        projects={projectOptions}
        tags={tagOptions}
        elapsedSeconds={activeActivitySeconds}
        timerSnapshot={timerSnapshot}
        timerLiveStatus={timerLiveStatus}
        busy={busy}
        runMutation={runMutation}
      />
      <LedgerSummary
        items={[
          {
            label: "已确认时长",
            value: currentDateLoaded
              ? formatLedgerDuration(daily.coveredSeconds)
              : "—",
          },
          {
            label: "时间折算",
            value: currentDateLoaded
              ? formatCurrencyCny(daily.confirmedCostCents)
              : "—",
          },
          ...(currentDateLoaded && daily.provisionalSeconds > 0 ? [{
            label: "待核对时长",
            value: formatLedgerDuration(daily.provisionalSeconds),
            attention: true,
          }] : []),
        ]}
      />
      {currentDateLoaded && (
        <TimeReviewPanel
          daily={daily}
          events={events}
          pending={pendingDetails}
          plans={plans}
          timeZone={timeZone}
          busy={busy}
          runMutation={runMutation}
          onAckEvents={onAckEvents}
          onEdit={setEditing}
          onLocate={setLocating}
          onAdjustPlan={setRequestedPlanId}
          onOpenDay={onSelectDate}
        />
      )}
      <TimeEntryList
        daily={daily}
        timeZone={timeZone}
        loading={
          !currentDateLoaded || (loading && daily.locatedSegments.length === 0)
        }
        busy={busy}
        onEdit={setEditing}
        onFillGap={openLog}
      />
      <TimePlansPanel
        plans={plans}
        availableProjects={projectOptions}
        availableTags={tagOptions}
        timeZone={timeZone}
        sessionVersion={status?.sessionVersion}
        busy={busy}
        runMutation={runMutation}
        requestedPlanId={requestedPlanId}
        onRequestConsumed={() => setRequestedPlanId(undefined)}
      />
      <TimeLogOrEstimateDialog
        open={Boolean(logSeed)}
        onOpenChange={(open) => {
          if (!open) setLogSeed(null);
        }}
        seed={logSeed}
        timeZone={timeZone}
        policy={policy}
        tasks={tasks}
        availableProjects={projectOptions}
        availableTags={tagOptions}
        segments={currentDateLoaded ? daily.locatedSegments : []}
        busy={busy}
        onSubmitLog={(input) =>
          submitDialog(`补记：${input.title}`, () => logTimeActivity(input))
        }
        onSubmitEstimate={(input) =>
          submitDialog(`估记：${input.title}`, () =>
            estimateTimeActivity(input),
          )
        }
      />
      <LocateEstimateDialog
        activity={locating}
        defaultDate={selectedDate}
        timeZone={timeZone}
        segments={currentDateLoaded ? daily.locatedSegments : []}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setLocating(null);
        }}
        onLocate={(input) =>
          submitDialog("定位估记", () => locateTimeEstimate(input))
        }
      />
      <EditSegmentDialog
        segment={editing}
        date={selectedDate}
        timeZone={timeZone}
        policy={policy}
        availableProjects={projectOptions}
        availableTags={tagOptions}
        segments={currentDateLoaded ? daily.locatedSegments : []}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSave={(input) =>
          submitDialog("修正活动", () => updateTimeActivity(input))
        }
      />
    </div>
  );
}
