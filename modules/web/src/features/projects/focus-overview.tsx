import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { parseQuickTask } from "@core/tasks/quick-task";
import { FOCUS_LIMIT, inProject, projectStatus } from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CornerDownLeft,
  Plus,
  Target,
  X,
} from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ProjectIcon } from "./project-icon";

function NextStepMenu({
  projectName,
  currentUuid,
  candidates,
  disabled,
  label,
  className,
  onSelect,
}: {
  projectName: string;
  currentUuid?: string;
  candidates: Task[];
  disabled: boolean;
  label: string;
  className?: string;
  onSelect: (uuid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = candidates.filter((task) =>
    task.description
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`${label} for ${projectName}`}
          className={className}
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="w-72 max-w-[calc(100vw-2rem)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label={`Search tasks in ${projectName}`}
            placeholder="Switch next step…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching tasks</CommandEmpty>
            <CommandGroup>
              {filtered.map((item) => (
                <CommandItem
                  key={item.uuid}
                  value={item.uuid}
                  onSelect={() => {
                    onSelect(item.uuid);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      item.uuid !== currentUuid && "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {item.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FocusTaskComposer({
  projectName,
  disabled,
  onCreateTask,
  onFallbackAdd,
}: {
  projectName: string;
  disabled: boolean;
  onCreateTask?: (task: TaskInput, projectName: string) => Promise<boolean>;
  onFallbackAdd: (projectName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!editing) {
    return (
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          if (!onCreateTask) {
            onFallbackAdd(projectName);
            return;
          }
          setError("");
          setEditing(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="task-add-button"
      >
        <Plus className="size-[18px]" strokeWidth={1.5} />
        Add task
      </Button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || submitting || !onCreateTask) return;
    const parsed = parseQuickTask(text);
    if (parsed.errors.length) {
      setError(parsed.errors[0]);
      inputRef.current?.focus();
      return;
    }
    if (!parsed.task.description.trim()) {
      setEditing(false);
      setText("");
      setError("");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const ok = await onCreateTask(
        {
          ...parsed.task,
          project: parsed.task.project || projectName,
        },
        projectName,
      );
      if (ok) {
        setText("");
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-0.5">
      <div className="-mx-2.5 flex min-h-11 items-center gap-2 rounded-lg bg-(--row-hover) px-2.5 md:-mx-3 md:min-h-9 md:px-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-8 shrink-0 items-center justify-start md:h-8 md:w-7"
        >
          <span className="size-[18px] rounded-full border border-muted-foreground/45 bg-background" />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={text}
          disabled={disabled || submitting}
          aria-label={`Add task to ${projectName}`}
          placeholder={`Add task to ${projectName}… (e.g. tomorrow p1 @tag)`}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              setText("");
              setError("");
            }
          }}
          onBlur={(event) => {
            if (
              !text.trim() &&
              !submitting &&
              !event.currentTarget.form?.contains(
                event.relatedTarget as Node | null,
              )
            ) {
              setEditing(false);
              setError("");
            }
          }}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm leading-5 outline-none placeholder:text-muted-foreground"
        />
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="submit"
            size="xs"
            disabled={disabled || submitting || !text.trim()}
            className="h-7 gap-1 rounded-md px-2.5 text-xs shadow-none"
          >
            {submitting ? (
              <Spinner className="size-3" />
            ) : (
              <>
                Add
                <CornerDownLeft className="size-3 opacity-70" />
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={submitting}
            aria-label="Cancel adding task"
            onClick={() => {
              setEditing(false);
              setText("");
              setError("");
            }}
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
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
  onAddTask: (name: string) => void;
  onCreateTask?: (task: TaskInput, projectName: string) => Promise<boolean>;
  onSelectNext?: (projectName: string, taskUuid: string) => void;
  renderTask: (task: Task) => ReactNode;
}) {
  const [collapsedUpNext, setCollapsedUpNext] = useState<Set<string>>(
    new Set(),
  );
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
            const upNext = candidates.filter(
              (item) => item.uuid !== nextStep?.uuid,
            );
            const isUpNextCollapsed = collapsedUpNext.has(project.name);
            return (
              <section
                key={project.name}
                className="group/focus min-w-0 border-b border-border/80 pb-6 [&_[data-task-surface]]:border-0"
                aria-label={`Focus: ${project.name}`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-3">
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
                    <ArrowRight className="size-4 text-muted-foreground opacity-60 transition-all duration-150 group-hover/focus:translate-x-0.5 group-hover/focus:opacity-100" />
                  </Button>
                  <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:transition-opacity md:group-hover/focus:opacity-100 md:group-focus-within/focus:opacity-100">
                    {onComplete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => onComplete(project.name)}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Complete
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onPause(project.name)}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Pause
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onEdit(project.name)}
                      className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit focus
                    </Button>
                  </div>
                </div>
                {project.outcome && (
                  <p className="mb-4 text-sm leading-6 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                    {project.outcome}
                  </p>
                )}
                {nextStep ? (
                  <div className="space-y-3">
                    <div className="[&_[data-task-surface]::after]:hidden">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Target
                            className="size-3 text-foreground/70"
                            strokeWidth={1.8}
                          />
                          Next step
                        </span>
                        {candidates.length > 1 && onSelectNext && (
                          <NextStepMenu
                            projectName={project.name}
                            currentUuid={nextStep.uuid}
                            candidates={candidates}
                            disabled={disabled}
                            label="Switch"
                            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground md:opacity-0 md:transition-opacity md:group-hover/focus:opacity-100 md:group-focus-within/focus:opacity-100 data-[state=open]:opacity-100"
                            onSelect={(uuid) =>
                              onSelectNext(project.name, uuid)
                            }
                          />
                        )}
                      </div>
                      {renderTask(nextStep)}
                    </div>
                    {upNext.length > 0 && (
                      <div className="pt-1">
                        <button
                          type="button"
                          aria-expanded={!isUpNextCollapsed}
                          onClick={() =>
                            setCollapsedUpNext((prev) => {
                              const next = new Set(prev);
                              if (next.has(project.name))
                                next.delete(project.name);
                              else next.add(project.name);
                              return next;
                            })
                          }
                          className="-ml-2 mb-0.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors select-none hover:bg-(--row-hover) hover:text-foreground"
                        >
                          <ChevronRight
                            className={cn(
                              "size-3.5 transition-transform duration-150",
                              !isUpNextCollapsed && "rotate-90",
                            )}
                          />
                          Up next · {upNext.length}
                        </button>
                        {!isUpNextCollapsed && (
                          <div>
                            {upNext.map((item) => (
                              <div
                                key={item.uuid}
                                className="group/upnext relative flex min-w-0 items-center"
                              >
                                <div className="min-w-0 flex-1">
                                  {renderTask(item)}
                                </div>
                                {onSelectNext && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="xs"
                                    disabled={disabled}
                                    aria-label={`Set as next step: ${item.description}`}
                                    onClick={() =>
                                      onSelectNext(project.name, item.uuid)
                                    }
                                    className="ml-1 shrink-0 text-xs text-muted-foreground hover:text-foreground md:opacity-0 md:transition-opacity md:group-hover/upnext:opacity-100 md:group-focus-within/upnext:opacity-100"
                                  >
                                    <Target className="size-3" />
                                    Set as next
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <FocusTaskComposer
                      projectName={project.name}
                      disabled={disabled}
                      onCreateTask={onCreateTask}
                      onFallbackAdd={onAddTask}
                    />
                  </div>
                ) : (
                  <FocusTaskComposer
                    projectName={project.name}
                    disabled={disabled}
                    onCreateTask={onCreateTask}
                    onFallbackAdd={onAddTask}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
