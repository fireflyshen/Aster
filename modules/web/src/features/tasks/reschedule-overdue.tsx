import { Button } from "@/components/ui/button";
import type { Task } from "@shared/tasks";
import { CalendarClock, Loader2 } from "lucide-react";
import { useState } from "react";
import { DatePicker } from "./date-picker";

/** Selecting a date is explicit authorization to move this visible overdue set. */
export function RescheduleOverdue({
  tasks,
  disabled,
  onReschedule,
}: {
  tasks: Task[];
  disabled?: boolean;
  onReschedule: (tasks: Task[], day: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <DatePicker
        value=""
        ariaLabel="重新安排逾期任务"
        allowClear={false}
        align="end"
        hint={`调整这 ${tasks.length} 项逾期任务，保留各自原有的截止时间。`}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled || pending || !tasks.length}
            aria-label={`重新安排 ${tasks.length} 项逾期任务`}
            className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            {pending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <CalendarClock className="size-3.5" />
            )}
            {pending ? "调整中…" : "重新安排"}
          </Button>
        }
        onChange={(day) => {
          if (!day || pending || disabled) return;
          setPending(true);
          setError("");
          void onReschedule(tasks, day)
            .catch((err: unknown) =>
              setError(
                err instanceof Error ? err.message : "调整失败，请重试。",
              ),
            )
            .finally(() => setPending(false));
        }}
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
