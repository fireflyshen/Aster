import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { TaskState } from "@core/tasks/state";
import type { Task } from "@shared/tasks";
import { addDays, format } from "date-fns";
import {
  ArrowRight,
  Clock3,
  Hourglass,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

export const STATE_ACTION_LABELS: Record<TaskState, string> = {
  planned: "放回计划中",
  doing: "移入处理中",
  waiting: "转为等待中…",
  parked: "长期搁置",
};

export const STATE_SHORT_LABELS: Record<TaskState, string> = {
  planned: "计划中",
  doing: "处理中",
  waiting: "等待中",
  parked: "长期搁置",
};

export function StateTargetIcon({
  state,
  className = "size-3.5",
}: {
  state: TaskState;
  className?: string;
}) {
  switch (state) {
    case "doing":
      return <PlayCircle className={className} />;
    case "planned":
      return <Clock3 className={className} />;
    case "waiting":
      return <Hourglass className={className} />;
    case "parked":
      return <PauseCircle className={className} />;
  }
}

export interface DoingLimitCandidate {
  uuid: string;
  description: string;
  project?: string;
}

/** Modal dialog requiring `waitReason` (1–200 chars) and `checkDate` before transitioning a task to `waiting`. */
export function WaitingReasonDialog({
  task,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  task: Task | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (waitReason: string, checkDate: string) => Promise<void> | void;
}) {
  const defaultCheckDate = format(addDays(new Date(), 3), "yyyy-MM-dd");
  const [waitReason, setWaitReason] = useState("");
  const [checkDate, setCheckDate] = useState(defaultCheckDate);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (task) {
      setWaitReason(task.waitReason || "");
      setCheckDate(defaultCheckDate);
      setLocalError("");
    }
  }, [task?.uuid, defaultCheckDate]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = waitReason.trim();
    if (!trimmed) {
      setLocalError("请填写等待原因（1–200 字）。");
      return;
    }
    if (trimmed.length > 200) {
      setLocalError("等待原因不能超过 200 个字符。");
      return;
    }
    if (!checkDate) {
      setLocalError("请选择核对日期。");
      return;
    }
    setLocalError("");
    void onSubmit(trimmed, checkDate);
  }

  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>设为等待中</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {task?.description || ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wait-reason-input">等待原因（必填）</Label>
            <Input
              id="wait-reason-input"
              placeholder="例如：等对方回复报价 / 等快递到货"
              maxLength={200}
              value={waitReason}
              disabled={busy}
              autoFocus
              onChange={(e) => {
                setWaitReason(e.target.value);
                setLocalError("");
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wait-check-date-input">
              核对日（必填，到期自动回到处理中）
            </Label>
            <Input
              id="wait-check-date-input"
              type="date"
              value={checkDate}
              disabled={busy}
              onChange={(e) => {
                setCheckDate(e.target.value);
                setLocalError("");
              }}
            />
          </div>
          {(localError || error) && (
            <Alert variant="destructive">
              <AlertDescription>{localError || error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner className="mr-1.5 size-3.5" />}
              确认转为等待中
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Interactive replacement picker shown when promoting to `doing` hits the configured limit (`409 STATE_DOING_LIMIT`). */
export function DoingLimitDialog({
  open,
  targetDescription,
  limit = 5,
  doing,
  busy,
  error,
  onClose,
  onConfirmReplace,
}: {
  open: boolean;
  targetDescription?: string;
  limit?: number;
  doing: DoingLimitCandidate[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirmReplace: (replaceUuid: string) => Promise<void> | void;
}) {
  const [selectedUuid, setSelectedUuid] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedUuid(doing[doing.length - 1]?.uuid || doing[0]?.uuid || "");
    }
  }, [open, doing]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>处理中已满 {limit} 条</DialogTitle>
          <DialogDescription>
            {targetDescription
              ? `要将「${targetDescription}」移入处理中，请先选一条现有任务放回「计划中」：`
              : `处理中已达 ${limit} 条上限，请先选一条放回「计划中」：`}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1.5 overflow-y-auto py-1">
          {doing.map((item) => {
            const active = selectedUuid === item.uuid;
            return (
              <button
                key={item.uuid}
                type="button"
                disabled={busy}
                onClick={() => setSelectedUuid(item.uuid)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary/8 text-foreground"
                    : "border-border/80 hover:bg-accent/50"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {item.description}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <ArrowRight className="size-3" />
                  计划中
                </span>
              </button>
            );
          })}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={busy || !selectedUuid}
            onClick={() => void onConfirmReplace(selectedUuid)}
          >
            {busy && <Spinner className="mr-1.5 size-3.5" />}
            放回并继续
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
