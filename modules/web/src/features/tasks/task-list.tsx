import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { Task } from "@shared/tasks";
import { ChevronRight, Ellipsis, Plus } from "lucide-react";
import type { ReactNode } from "react";

type TaskListProps = {
  visible: Task[];
  projects: string[];
  loading: boolean;
  loaded: boolean;
  inbox: boolean;
  disabled: boolean;
  emptyTitle: string;
  hasFilters: boolean;
  renderTask: (task: Task) => ReactNode;
  onAdd: () => void;
  onOpenProject: (project: string) => void;
  onEditProject: (project: string) => void;
  onDeleteProject: (project: string) => void;
  onClearFilters: () => void;
  expandedProjects: string[];
  onProjectExpand: (project: string, expanded: boolean) => void;
};

export function TaskList({
  visible,
  projects,
  loading,
  loaded,
  inbox,
  disabled,
  emptyTitle,
  hasFilters,
  renderTask,
  onAdd,
  onOpenProject,
  onEditProject,
  onDeleteProject,
  onClearFilters,
  expandedProjects,
  onProjectExpand,
}: TaskListProps) {
  return (
    <section aria-label="Tasks" aria-busy={loading}>
      {loading && !loaded && (
        <div className="flex h-12 items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-4" aria-label="Connecting to dmit" />
          Loading…
        </div>
      )}
      {inbox ? (
        <>
          {visible.filter((task) => !task.project).map(renderTask)}
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={onAdd}
            className="task-add-button mt-2"
          >
            <Plus className="size-[18px] text-primary" strokeWidth={1.5} />
            Add task
          </Button>
          <div className="mt-6 space-y-6">
            {projects.map((name) => {
              const items = visible.filter((task) => task.project === name);
              return (
                <Collapsible
                  key={name}
                  open={expandedProjects.includes(name)}
                  onOpenChange={(expanded) => onProjectExpand(name, expanded)}
                >
                  <div className="flex h-11 items-center border-b border-border md:h-10">
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="group h-full min-w-0 flex-1 justify-start gap-2 rounded-none px-0 text-sm font-semibold hover:bg-transparent has-[>svg]:px-0"
                      >
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-90" />
                        <span className="truncate">{name}</span>
                        <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                          {items.length}
                        </span>
                      </Button>
                    </CollapsibleTrigger>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Project options: ${name}`}
                          className="text-muted-foreground"
                        >
                          <Ellipsis className="size-[18px]" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-36 p-1">
                        <Button
                          variant="ghost"
                          className="h-8 w-full justify-start text-xs font-normal"
                          onClick={() => {
                            onOpenProject(name);
                          }}
                        >
                          Open project
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          className="h-8 w-full justify-start text-xs font-normal"
                          onClick={() => {
                            onOpenProject(name);
                            onEditProject(name);
                          }}
                        >
                          Edit project
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          className="h-8 w-full justify-start text-xs font-normal text-destructive"
                          onClick={() => onDeleteProject(name)}
                        >
                          Delete project
                        </Button>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <CollapsibleContent>
                    {items.map(renderTask)}
                    {!items.length && (
                      <p className="py-3 text-xs text-muted-foreground">
                        No tasks
                      </p>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {!visible.length && loaded && (
            <Empty className="border-0 py-12">
              <EmptyHeader>
                <EmptyTitle className="text-sm font-normal">
                  {emptyTitle}
                </EmptyTitle>
              </EmptyHeader>
              {hasFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onClearFilters();
                  }}
                >
                  Clear filters
                </Button>
              )}
            </Empty>
          )}
          {visible.map(renderTask)}
          <Button
            variant="ghost"
            onClick={onAdd}
            disabled={disabled}
            className="task-add-button mt-2"
          >
            <Plus className="size-[18px] text-primary" strokeWidth={1.5} />
            Add task
          </Button>
        </>
      )}
    </section>
  );
}
