import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FOCUS_LIMIT, projectStatus } from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { ArrowRight, Plus, Target } from "lucide-react";
import { useState, type ReactNode } from "react";
import { FocusProjectCard } from "./focus-project-card";

/** Displays up to 3 active Focus projects, their finish lines, and next steps. */
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
  onSelectNext?: (name: string, nextUuid: string) => void;
  onUpdateOutcome?: (name: string, outcome: string) => Promise<boolean>;
  renderTask: (task: Task, extraActions?: ReactNode) => ReactNode;
}) {
  const [editingOutcome, setEditingOutcome] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const projects = (data.projects || []).filter(
    (project) => projectStatus(project) === "active",
  );

  return (
    <section aria-label="焦点项目">
      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="mb-6 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {projects.length} / {FOCUS_LIMIT} 个活跃项目
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onChooseProject}
          className="h-8 gap-1.5 text-xs font-medium text-foreground"
        >
          <Plus className="size-3.5" />
          加入焦点
        </Button>
      </div>
      {loading ? (
        <div
          role="status"
          className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
        >
          <Spinner className="size-4" />
          正在加载焦点…
        </div>
      ) : !projects.length ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6 md:p-8">
          <Target className="size-6 text-muted-foreground" strokeWidth={1.4} />
          <p className="font-medium">选择当下最重要的事情。</p>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            最多同时保持三个活跃焦点项目，其余事务可暂存在“稍后”中。
          </p>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={onChooseProject}
          >
            选择一个项目
            <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {projects.map((project) => (
            <FocusProjectCard
              key={project.name}
              project={project}
              tasks={tasks}
              subtasks={data.subtasks}
              availableLabels={data.tags || []}
              disabled={disabled}
              expanded={expandedProjects.has(project.name)}
              menuOpen={openMenu === project.name}
              editingOutcome={editingOutcome === project.name}
              onMenuOpenChange={(next) =>
                setOpenMenu(next ? project.name : null)
              }
              onToggleExpand={() =>
                setExpandedProjects((prev) => {
                  const next = new Set(prev);
                  next.add(project.name);
                  return next;
                })
              }
              onStartEditOutcome={() => setEditingOutcome(project.name)}
              onStopEditOutcome={() => setEditingOutcome(null)}
              onPause={onPause}
              onComplete={onComplete}
              onOpen={onOpen}
              onEdit={onEdit}
              onAddTask={onAddTask}
              onCreateTask={onCreateTask}
              onSelectNext={onSelectNext}
              onUpdateOutcome={onUpdateOutcome}
              renderTask={renderTask}
            />
          ))}
        </div>
      )}
    </section>
  );
}
