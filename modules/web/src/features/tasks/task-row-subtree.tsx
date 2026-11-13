import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

type TaskRowSubtreeProps = {
  parentTask: Task;
  variant: "list" | "card";
  completed: boolean;
  disabled: boolean;
  subtasks: Task[];
  isAddingSubtask: boolean;
  projects: string[];
  availableLabels: SavedTag[];
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onAddSubtask?: (input: TaskInput) => Promise<boolean>;
  renderSubtask?: (subtask: Task) => ReactNode;
};

/** Renders expanded child subtasks and the inline subtask composer for a parent task. */
export function TaskRowSubtree({
  parentTask,
  variant,
  completed,
  disabled,
  subtasks,
  isAddingSubtask,
  projects,
  availableLabels,
  onStartAdd,
  onCancelAdd,
  onAddSubtask,
  renderSubtask,
}: TaskRowSubtreeProps) {
  return (
    <div
      className="task-subtree"
      data-subtree-variant={variant}
      data-no-drag={variant === "card" ? "" : undefined}
    >
      {subtasks.map((child) => (
        <div key={child.uuid} className="relative">
          {renderSubtask ? renderSubtask(child) : null}
        </div>
      ))}
      {onAddSubtask && !completed && (
        <div className={variant === "card" ? "pt-1.5" : "pt-1"}>
          {isAddingSubtask ? (
            <TodoistTaskComposer
              mode="add"
              compact
              disabled={disabled}
              ariaLabel={`为“${parentTask.description}”添加子任务`}
              placeholder="子任务名称（支持 @标签, 明天, p1）"
              defaultProject={parentTask.project}
              projects={projects}
              availableLabels={availableLabels}
              onSubmitTask={(subtaskInput) =>
                onAddSubtask({
                  ...subtaskInput,
                  project: subtaskInput.project || parentTask.project,
                })
              }
              onCancel={onCancelAdd}
            />
          ) : (
            <button
              type="button"
              data-no-drag
              onClick={onStartAdd}
              className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-normal text-muted-foreground transition-colors hover:bg-muted/50 hover:text-primary"
            >
              <Plus className="size-3.5 text-primary" />
              <span>添加子任务</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
