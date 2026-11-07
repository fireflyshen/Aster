import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FOCUS_LIMIT, inProject, projectStatus } from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { ArrowRight, Plus, Target } from "lucide-react";
import type { ReactNode } from "react";
import { ProjectIcon } from "./project-icon";

export function FocusOverview({
  data,
  tasks,
  loading,
  disabled,
  error,
  onLater,
  onOpen,
  onEdit,
  onAddTask,
  renderTask,
}: {
  data: Organization;
  tasks: Task[];
  loading: boolean;
  disabled: boolean;
  error: string;
  onLater: () => void;
  onOpen: (name: string) => void;
  onEdit: (name: string) => void;
  onAddTask: (name: string) => void;
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
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onLater}>
          <Plus className="size-4" />
          Choose project
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
          <Button variant="outline" disabled={disabled} onClick={onLater}>
            Choose from Later
            <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {projects.map((project) => {
            const task = tasks.find(
              (task) =>
                task.uuid === project.nextTask &&
                inProject(task.project, project.name) &&
                ["pending", "waiting"].includes(task.status),
            );
            return (
              <section
                key={project.name}
                className="min-w-0 border-b pb-6 [&_[data-task-surface]]:border-0"
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
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onEdit(project.name)}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    Edit goal
                  </Button>
                </div>
                <p className="mb-5 text-sm leading-6 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                  {project.outcome}
                </p>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Next step
                </p>
                {task ? (
                  renderTask(task)
                ) : (
                  <div className="flex min-h-12 flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onEdit(project.name)}
                    >
                      Choose a task
                    </Button>
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
