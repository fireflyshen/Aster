import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { ChevronRight, Ellipsis, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { Task } from "@shared/tasks";

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
  onClearFilters: () => void;
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
  onClearFilters,
}: TaskListProps) {
  return (
    <section aria-label="Tasks" aria-busy={loading}>
      {loading && !loaded && (
        <div className="flex h-12 items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-4" aria-label="Connecting to RN" />
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
            className="mt-1 h-8 justify-start gap-2.5 px-0 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-primary has-[>svg]:px-0"
          >
            <Plus className="size-[18px] text-primary" strokeWidth={1.5} />
            Add task
          </Button>
          <div className="mt-8 space-y-8">
            {projects.map((name) => {
              const items = visible.filter((task) => task.project === name);
              return (
                <Collapsible key={name}>
                  <div className="flex items-center border-b border-border">
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="group relative h-10 min-w-0 flex-1 justify-start gap-1.5 rounded-none px-0 text-sm font-semibold hover:bg-transparent has-[>svg]:px-0"
                      >
                        <ChevronRight className="absolute -left-5 size-3 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-90" />
                        <span className="truncate">{name}</span>
                        <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
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
                      </PopoverContent>
                    </Popover>
                  </div>
                  <CollapsibleContent>
                    {items.map(renderTask)}
                    {!items.length && <p className="py-3 text-xs text-muted-foreground">No tasks</p>}
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
                <EmptyTitle className="text-sm font-normal">{emptyTitle}</EmptyTitle>
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
            className="mt-2 h-8 gap-2.5 px-0 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-primary has-[>svg]:px-0"
          >
            <Plus className="size-[18px] text-primary" strokeWidth={1.5} />
            Add task
          </Button>
        </>
      )}
    </section>
  );
}
