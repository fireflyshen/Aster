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
import { FOCUS_LIMIT, inProject, projectStatus } from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import { ArrowRight, Check, Plus, Target } from "lucide-react";
import { useState, type ReactNode } from "react";
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
        align="start"
        collisionPadding={16}
        className="w-72 max-w-[calc(100vw-2rem)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label={`Search tasks in ${projectName}`}
            placeholder="Choose next step…"
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

export function FocusOverview({
  data,
  tasks,
  loading,
  disabled,
  error,
  onChooseProject,
  onPause,
  onOpen,
  onEdit,
  onAddTask,
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
  onOpen: (name: string) => void;
  onEdit: (name: string) => void;
  onAddTask: (name: string) => void;
  onSelectNext?: (projectName: string, taskUuid: string) => void;
  renderTask: (task: Task) => ReactNode;
}) {
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
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onChooseProject}
        >
          <Plus className="size-4" />
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
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6 md:p-8">
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
            const task = candidates.find(
              (item) => item.uuid === project.nextTask,
            );
            return (
              <section
                key={project.name}
                className="group/focus min-w-0 border-b pb-6 [&_[data-task-surface]]:border-0"
                aria-label={`Focus: ${project.name}`}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => onOpen(project.name)}
                    className="h-auto min-w-0 justify-start px-0 text-base font-semibold hover:bg-transparent has-[>svg]:px-0"
                  >
                    <ProjectIcon name={project.name} />
                    <span className="truncate">{project.name}</span>
                    <ArrowRight className="size-4 text-muted-foreground transition-transform duration-150 group-hover/focus:translate-x-0.5" />
                  </Button>
                  <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:transition-opacity md:group-hover/focus:opacity-100 md:group-focus-within/focus:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onPause(project.name)}
                      className="text-xs text-muted-foreground"
                    >
                      Pause
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onEdit(project.name)}
                      className="shrink-0 text-xs text-muted-foreground"
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
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Next step
                  </p>
                  {task && candidates.length > 1 && onSelectNext && (
                    <NextStepMenu
                      projectName={project.name}
                      currentUuid={task.uuid}
                      candidates={candidates}
                      disabled={disabled}
                      label="Change"
                      className="h-6 px-1.5 text-xs text-muted-foreground md:opacity-0 md:transition-opacity md:group-hover/focus:opacity-100 md:group-focus-within/focus:opacity-100 data-[state=open]:opacity-100"
                      onSelect={(uuid) => onSelectNext(project.name, uuid)}
                    />
                  )}
                </div>
                {task ? (
                  renderTask(task)
                ) : (
                  <div className="flex min-h-11 flex-wrap items-center gap-2">
                    {candidates.length > 0 && onSelectNext ? (
                      <NextStepMenu
                        projectName={project.name}
                        candidates={candidates}
                        disabled={disabled}
                        label="Choose a task"
                        onSelect={(uuid) => onSelectNext(project.name, uuid)}
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => onEdit(project.name)}
                      >
                        Choose a task
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onAddTask(project.name)}
                      className="text-muted-foreground"
                    >
                      <Plus className="size-4" />
                      Add task
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
