import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { TaskCheckbox } from "./task-checkbox";

type TaskDetailSubtasksProps = {
  subtasks: Task[];
  project?: string;
  disabled: boolean;
  onAddSubtask?: (input: TaskInput) => Promise<boolean>;
  onToggleSubtask?: (subtask: Task, completed: boolean) => void;
  onDeleteSubtask?: (subtaskUuid: string) => void;
  onUnlinkSubtask?: (subtaskUuid: string) => void;
  onOpenSubtask?: (subtask: Task) => void;
};

/** Interactive subtask list and inline subtask creator inside the task detail modal. */
export function TaskDetailSubtasks({
  subtasks,
  project,
  disabled,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onUnlinkSubtask,
  onOpenSubtask,
}: TaskDetailSubtasksProps) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const doneCount = subtasks.filter(
    (item) => item.status === "completed",
  ).length;

  async function submit(event?: FormEvent) {
    if (event) event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !onAddSubtask || adding) return;
    setAdding(true);
    try {
      const ok = await onAddSubtask({
        description: trimmed,
        project,
        tags: [],
      });
      if (ok) {
        setTitle("");
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="task-detail-subtasks mt-6 space-y-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">
          子任务{" "}
          {subtasks.length > 0 && (
            <span className="tabular-nums font-normal">
              ({doneCount}/{subtasks.length})
            </span>
          )}
        </Label>
      </div>

      {subtasks.length > 0 && (
        <div className="divide-y divide-border/70 border-t border-border/70">
          {subtasks.map((subtask) => {
            const done = subtask.status === "completed";
            return (
              <div
                key={subtask.uuid}
                className="group/subtask flex items-center justify-between gap-3 py-2.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <TaskCheckbox
                    id={`form-sub-${subtask.uuid}`}
                    size="sm"
                    checked={done}
                    completed={done}
                    priority={subtask.priority}
                    description={subtask.description}
                    disabled={disabled}
                    onComplete={() => onToggleSubtask?.(subtask, done)}
                  />
                  {onOpenSubtask ? (
                    <button
                      type="button"
                      onClick={() => onOpenSubtask(subtask)}
                      className={cn(
                        "flex-1 cursor-pointer truncate text-left text-sm font-normal hover:underline",
                        done && "line-through text-muted-foreground/60",
                      )}
                      title={`打开子任务: ${subtask.description}`}
                    >
                      {subtask.description}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "truncate text-sm font-normal",
                        done && "line-through text-muted-foreground/60",
                      )}
                    >
                      {subtask.description}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-80 transition-opacity md:opacity-0 md:group-hover/subtask:opacity-100">
                  {onUnlinkSubtask && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      title="转为主任务"
                      aria-label="转为主任务"
                      disabled={disabled}
                      onClick={() => onUnlinkSubtask(subtask.uuid)}
                    >
                      <ArrowUpRight className="size-3.5" />
                    </Button>
                  )}
                  {onDeleteSubtask && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      title="删除子任务"
                      aria-label="删除子任务"
                      disabled={disabled}
                      onClick={() => onDeleteSubtask(subtask.uuid)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {onAddSubtask && !inputOpen && (
        <button
          type="button"
          onClick={() => setInputOpen(true)}
          disabled={disabled}
          className="task-detail-add flex h-8 cursor-pointer items-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:text-primary/85"
        >
          <Plus className="size-3.5" />
          添加子任务
        </button>
      )}

      {onAddSubtask && inputOpen && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-transparent p-2">
          <input
            type="text"
            autoFocus
            placeholder="子任务名称…"
            value={title}
            disabled={disabled || adding}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setInputOpen(false);
              }
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault();
                void submit();
              }
            }}
            className="h-7 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setInputOpen(false);
              setTitle("");
            }}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 px-3 text-xs font-medium shadow-none"
            disabled={!title.trim() || disabled || adding}
            onClick={() => void submit()}
          >
            {adding ? <Spinner className="size-3.5" /> : "添加"}
          </Button>
        </div>
      )}
    </div>
  );
}
