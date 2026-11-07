import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import { FOCUS_LIMIT, inProject, projectStatus } from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import {
  ArrowRight,
  ArrowUpToLine,
  Check,
  Ellipsis,
  FolderOpen,
  Pause,
  Pencil,
  Plus,
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

export function FocusOverview({
  data,
  tasks,
  loading,
  disabled,
  error,
  onChooseProject,
  onPause,
  onComplete,
  onOpen,
  onEdit,
  onAddTask,
  onCreateTask,
  onSelectNext,
  onUpdateOutcome,
  renderTask,
}: {
  data: Organization;
  tasks: Task[];
  loading: boolean;
  disabled: boolean;
  error: string;
  onChooseProject: () => void;
  onPause: (name: string) => void;
  onComplete?: (name: string) => void;
  onOpen: (name: string) => void;
  onEdit: (name: string) => void;
  onAddTask: (name: string, draft?: TaskInput) => void;
  onCreateTask?: (task: TaskInput, projectName: string) => Promise<boolean>;
  onSelectNext?: (projectName: string, taskUuid: string) => void;
  onUpdateOutcome?: (projectName: string, outcome: string) => Promise<boolean>;
  renderTask: (task: Task, extraActions?: ReactNode) => ReactNode;
}) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(),
  );
  const [editingOutcome, setEditingOutcome] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const projects = (data.projects || []).filter(
    (project) => projectStatus(project) === "active",
  );
  return (
    <section aria-label="Focus projects">
      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="mb-6 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {projects.length} / {FOCUS_LIMIT} active projects
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onChooseProject}
          className="h-8 gap-1.5 text-xs font-medium text-foreground"
        >
          <Plus className="size-3.5" />
          Add to Focus
        </Button>
      </div>
      {loading ? (
        <div
          role="status"
          className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
        >
          <Spinner className="size-4" />
          Loading Focus…
        </div>
      ) : !projects.length ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6 md:p-8">
          <Target className="size-6 text-muted-foreground" strokeWidth={1.4} />
          <p className="font-medium">Choose what matters now.</p>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            Keep up to three projects active. Everything else can wait in Later.
          </p>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={onChooseProject}
          >
            Choose a project
            <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {projects.map((project) => {
            const candidates = tasks.filter(
              (item) =>
                inProject(item.project, project.name) &&
                ["pending", "waiting"].includes(item.status),
            );
            const pinned = candidates.find(
              (item) => item.uuid === project.nextTask,
            );
            const nextStep = pinned || candidates[0];
            const orderedTasks = nextStep
              ? [
                  nextStep,
                  ...candidates.filter((item) => item.uuid !== nextStep.uuid),
                ]
              : [];
            const isExpanded = expandedProjects.has(project.name);
            const visibleTasks = isExpanded
              ? orderedTasks
              : orderedTasks.slice(0, 5);
            const hiddenCount = orderedTasks.length - visibleTasks.length;

            return (
              <section
                key={project.name}
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
                      <span className="text-xs font-normal tabular-nums text-muted-foreground">
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
                    <Popover
                      open={openMenu === project.name}
                      onOpenChange={(next) =>
                        setOpenMenu(next ? project.name : null)
                      }
                    >
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
                            setOpenMenu(null);
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
                              setOpenMenu(null);
                              setEditingOutcome(project.name);
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
                            setOpenMenu(null);
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
                            setOpenMenu(null);
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
                              setOpenMenu(null);
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
                  editing={editingOutcome === project.name}
                  onStartEdit={() => setEditingOutcome(project.name)}
                  onStopEdit={() => setEditingOutcome(null)}
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
                            title="Pin as top next step"
                            aria-label={`Set as next step: ${item.description}`}
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
                      onClick={() =>
                        setExpandedProjects((prev) => {
                          const next = new Set(prev);
                          next.add(project.name);
                          return next;
                        })
                      }
                      className="-mx-2.5 mt-0.5 h-8 px-2.5 text-xs font-normal text-muted-foreground hover:bg-(--row-hover) hover:text-foreground md:-mx-3 md:px-3"
                    >
                      Show {hiddenCount} more task{hiddenCount === 1 ? "" : "s"}
                    </Button>
                  )}
                  <TodoistTaskComposer
                    mode="add"
                    compact
                    disabled={disabled}
                    ariaLabel={`Add task to ${project.name}`}
                    placeholder="Task name (try @label, tomorrow, p1)"
                    defaultProject={project.name}
                    availableLabels={data.tags || []}
                    onSubmitTask={
                      onCreateTask
                        ? (task) => onCreateTask(task, project.name)
                        : undefined
                    }
                    onOpenFullEditor={(draft) =>
                      onAddTask(project.name, draft)
                    }
                  />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
