import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import { inProject } from "@core/workspace/focus";
import type { SavedProject, SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import {
  ArrowRight,
  ArrowUpToLine,
  Check,
  Ellipsis,
  FolderOpen,
  Pause,
  Pencil,
  Target,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { ProjectIcon } from "./project-icon";

function InlineOutcome({
  projectName,
  outcome,
  disabled,
  editing,
  onStartEdit,
  onStopEdit,
  onSave,
}: {
  projectName: string;
  outcome?: string;
  disabled: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSave?: (outcome: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(outcome || "");
  const [saving, setSaving] = useState(false);

  async function commit() {
    if (!onSave || saving) {
      onStopEdit();
      return;
    }
    const next = draft.trim();
    if (!next || next === (outcome || "").trim()) {
      setDraft(outcome || "");
      onStopEdit();
      return;
    }
    setSaving(true);
    try {
      const ok = await onSave(next);
      if (ok) onStopEdit();
    } finally {
      setSaving(false);
    }
  }

  if (editing && onSave) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
        className="-mx-2 mb-3 flex items-center gap-1.5 rounded-lg bg-(--row-hover) px-2 py-1"
      >
        <Target
          className="size-3.5 shrink-0 text-muted-foreground"
          strokeWidth={1.6}
        />
        <input
          type="text"
          autoFocus
          value={draft}
          maxLength={500}
          disabled={disabled || saving}
          aria-label={`Finish line for ${projectName}`}
          placeholder="What result makes this project complete?"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(outcome || "");
              onStopEdit();
            }
          }}
          onBlur={() => void commit()}
          className="min-w-0 flex-1 bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
        />
        {saving && <Spinner className="size-3.5 shrink-0" />}
      </form>
    );
  }

  if (!outcome) return null;

  return (
    <button
      type="button"
      disabled={disabled || !onSave}
      onClick={() => {
        setDraft(outcome || "");
        onStartEdit();
      }}
      title={onSave ? "Click to edit finish line" : undefined}
      className="group/outcome -mx-2 mb-3 flex max-w-full items-start gap-1.5 rounded-md px-2 py-0.5 text-left text-sm leading-6 text-muted-foreground transition-colors hover:bg-(--row-hover) hover:text-foreground disabled:pointer-events-none"
    >
      <Target
        className="mt-1.5 size-3.5 shrink-0 text-muted-foreground/80"
        strokeWidth={1.6}
      />
      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {outcome}
      </span>
      {onSave && (
        <Pencil className="mt-1.5 size-3 shrink-0 opacity-0 transition-opacity group-hover/outcome:opacity-60" />
      )}
    </button>
  );
}

type FocusProjectCardProps = {
  project: SavedProject;
  tasks: Task[];
  subtasks?: Record<string, string>;
  availableLabels: SavedTag[];
  disabled: boolean;
  expanded: boolean;
  menuOpen: boolean;
  editingOutcome: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onToggleExpand: () => void;
  onStartEditOutcome: () => void;
  onStopEditOutcome: () => void;
  onPause: (name: string) => void;
  onComplete?: (name: string) => void;
  onOpen: (name: string) => void;
  onEdit: (name: string) => void;
  onAddTask: (name: string, draft?: TaskInput) => void;
  onCreateTask?: (task: TaskInput, projectName: string) => Promise<boolean>;
  onSelectNext?: (name: string, nextUuid: string) => void;
  onUpdateOutcome?: (name: string, outcome: string) => Promise<boolean>;
  renderTask: (task: Task, extraActions?: ReactNode) => ReactNode;
};

/** Renders a single active Focus project card with finish line, next-step tasks, and quick add. */
export function FocusProjectCard({
  project,
  tasks,
  subtasks,
  availableLabels,
  disabled,
  expanded,
  menuOpen,
  editingOutcome,
  onMenuOpenChange,
  onToggleExpand,
  onStartEditOutcome,
  onStopEditOutcome,
  onPause,
  onComplete,
  onOpen,
  onEdit,
  onAddTask,
  onCreateTask,
  onSelectNext,
  onUpdateOutcome,
  renderTask,
}: FocusProjectCardProps) {
  const activeInProject = tasks.filter(
    (item) =>
      inProject(item.project, project.name) &&
      ["pending", "waiting"].includes(item.status),
  );
  const projectUuids = new Set(activeInProject.map((item) => item.uuid));
  // Keep child subtasks folded under their visible parent rather than duplicating flat rows.
  const candidates = activeInProject.filter((item) => {
    const parentUuid = subtasks?.[item.uuid];
    return !parentUuid || !projectUuids.has(parentUuid);
  });
  const pinned = candidates.find((item) => item.uuid === project.nextTask);
  const nextStep = pinned || candidates[0];
  const orderedTasks = nextStep
    ? [nextStep, ...candidates.filter((item) => item.uuid !== nextStep.uuid)]
    : [];
  const visibleTasks = expanded ? orderedTasks : orderedTasks.slice(0, 5);
  const hiddenCount = orderedTasks.length - visibleTasks.length;

  return (
    <section
      className="group/focus min-w-0 border-b border-border/80 pb-6"
      aria-label={`Focus: ${project.name}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          disabled={disabled}
          onClick={() => onOpen(project.name)}
          className="-ml-2.5 h-auto min-w-0 justify-start gap-2 rounded-lg px-2.5 py-1 text-base font-semibold hover:bg-(--row-hover) has-[>svg]:px-2.5"
        >
          <ProjectIcon name={project.name} />
          <span className="truncate">{project.name}</span>
          {candidates.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {candidates.length}
            </span>
          )}
          <ArrowRight className="size-4 text-muted-foreground opacity-50 transition-all duration-150 group-hover/focus:translate-x-0.5 group-hover/focus:opacity-100" />
        </Button>
        <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:transition-opacity md:group-hover/focus:opacity-100 md:group-focus-within/focus:opacity-100 [&:has([data-state=open])]:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onPause(project.name)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Pause
          </Button>
          <Popover open={menuOpen} onOpenChange={onMenuOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={`Project options: ${project.name}`}
                className="size-7 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent"
              >
                <Ellipsis className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <Button
                variant="navigation"
                className="h-8 text-xs"
                onClick={() => {
                  onMenuOpenChange(false);
                  onOpen(project.name);
                }}
              >
                <FolderOpen className="size-3.5" />
                Open project
              </Button>
              {onUpdateOutcome && (
                <Button
                  variant="navigation"
                  className="h-8 text-xs"
                  onClick={() => {
                    onMenuOpenChange(false);
                    onStartEditOutcome();
                  }}
                >
                  <Target className="size-3.5" />
                  Edit finish line
                </Button>
              )}
              <Button
                variant="navigation"
                className="h-8 text-xs"
                onClick={() => {
                  onMenuOpenChange(false);
                  onEdit(project.name);
                }}
              >
                <Pencil className="size-3.5" />
                Edit project
              </Button>
              <Button
                variant="navigation"
                className="h-8 text-xs"
                onClick={() => {
                  onMenuOpenChange(false);
                  onPause(project.name);
                }}
              >
                <Pause className="size-3.5" />
                Pause for later
              </Button>
              {onComplete && (
                <Button
                  variant="navigation"
                  className="h-8 text-xs"
                  onClick={() => {
                    onMenuOpenChange(false);
                    onComplete(project.name);
                  }}
                >
                  <Check className="size-3.5" />
                  Complete project
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <InlineOutcome
        projectName={project.name}
        outcome={project.outcome}
        disabled={disabled}
        editing={editingOutcome}
        onStartEdit={onStartEditOutcome}
        onStopEdit={onStopEditOutcome}
        onSave={
          onUpdateOutcome
            ? (outcome) => onUpdateOutcome(project.name, outcome)
            : undefined
        }
      />

      <div>
        {visibleTasks.map((item, index) => (
          <div key={item.uuid}>
            {renderTask(
              item,
              index > 0 && onSelectNext ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  title="置顶为下一步"
                  aria-label={`设为下一步: ${item.description}`}
                  onClick={() => onSelectNext(project.name, item.uuid)}
                  className="size-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100"
                >
                  <ArrowUpToLine className="size-3.5" />
                </Button>
              ) : undefined,
            )}
          </div>
        ))}
        {hiddenCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleExpand}
            className="-mx-2.5 mt-0.5 h-8 px-2.5 text-xs font-normal text-muted-foreground hover:bg-(--row-hover) hover:text-foreground md:-mx-3 md:px-3"
          >
            展开其余 {hiddenCount} 个任务
          </Button>
        )}
        <TodoistTaskComposer
          mode="add"
          compact
          disabled={disabled}
          ariaLabel={`在 ${project.name} 中添加任务`}
          placeholder="添加任务（支持 @标签, 明天, p1）"
          defaultProject={project.name}
          availableLabels={availableLabels}
          onSubmitTask={
            onCreateTask
              ? (task) => onCreateTask(task, project.name)
              : undefined
          }
          onOpenFullEditor={(draft) => onAddTask(project.name, draft)}
        />
      </div>
    </section>
  );
}
