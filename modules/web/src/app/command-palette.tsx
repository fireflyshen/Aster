import { FilterIcon, LabelIcon, OrganizationIcon } from "@/components/icons";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { ProjectIcon } from "@/features/projects/project-icon";
import { focusProject, type ProjectStatus } from "@core/workspace/focus";
import {
  itemColor,
  type Organization,
  type SavedFilter,
  type SavedTag,
} from "@core/workspace/organization";
import { projectTaskCount } from "@core/workspace/projects";
import type { Task, View } from "@shared/tasks";
import {
  Archive,
  CalendarDays,
  CircleCheck,
  Clock3,
  Columns3,
  DatabaseBackup,
  FolderPlus,
  Inbox,
  List,
  Pause,
  Pencil,
  Play,
  Plus,
  Target,
} from "lucide-react";
import { views } from "./workspace-sidebar";

const viewIcons = {
  focus: Target,
  later: Archive,
  pending: Inbox,
  today: CalendarDays,
  waiting: Clock3,
  completed: CircleCheck,
};

export function CommandPalette({
  open,
  onOpenChange,
  tasks,
  projects,
  organization,
  currentProject,
  layout,
  onAddTask,
  onAddProject,
  onFocusPicker,
  onToggleLayout,
  onView,
  onProject,
  onEditProject,
  onProjectStatus,
  onEntry,
  onOrganization,
  onRecovery,
  onEditTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  projects: string[];
  organization: Organization;
  currentProject: string;
  layout: "list" | "board";
  onAddTask: () => void;
  onAddProject: () => void;
  onFocusPicker: () => void;
  onToggleLayout: () => void;
  onView: (view: View) => void;
  onProject: (project: string) => void;
  onEditProject: (project: string) => void;
  onProjectStatus: (project: string, status: ProjectStatus) => void;
  onEntry: (entry: {
    kind: "filter" | "tag";
    item: SavedFilter | SavedTag;
  }) => void;
  onOrganization: () => void;
  onRecovery: () => void;
  onEditTask: (task: Task) => void;
}) {
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const pendingTasks = tasks
    .filter((task) => task.status !== "completed")
    .slice(0, 40);
  const currentInFocus = currentProject
    ? focusProject(currentProject, organization.projects)
    : undefined;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="Jump to a view, project, label, or run an action."
      showCloseButton={false}
      className="top-[max(4rem,14vh)] translate-y-0 rounded-xl border-border/80 shadow-modal sm:max-w-[540px]"
    >
      <CommandInput placeholder="Type a command, project, or task…" />
      <CommandList className="max-h-[min(420px,65dvh)] p-1.5">
        <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
          No matching commands, projects, or tasks.
        </CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            value="Add task create new todo"
            onSelect={() => run(onAddTask)}
          >
            <Plus className="size-4" />
            <span>Add task</span>
            <CommandShortcut>Q</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="New project create folder"
            onSelect={() => run(onAddProject)}
          >
            <FolderPlus className="size-4" />
            <span>New project…</span>
          </CommandItem>
          <CommandItem
            value="Choose Focus project activate goal"
            onSelect={() => run(onFocusPicker)}
          >
            <Target className="size-4" />
            <span>Focus a project…</span>
          </CommandItem>
          <CommandItem
            value={`Switch to ${layout === "list" ? "Board" : "List"} view toggle layout`}
            onSelect={() => run(onToggleLayout)}
          >
            {layout === "list" ? (
              <Columns3 className="size-4" />
            ) : (
              <List className="size-4" />
            )}
            <span>Switch to {layout === "list" ? "Board" : "List"} view</span>
            <CommandShortcut>B</CommandShortcut>
          </CommandItem>
          {currentProject && (
            <>
              <CommandItem
                value={`${currentInFocus ? "Pause" : "Focus"} current project ${currentProject}`}
                onSelect={() =>
                  run(() =>
                    onProjectStatus(
                      currentInFocus?.name || currentProject,
                      currentInFocus ? "later" : "active",
                    ),
                  )
                }
              >
                {currentInFocus ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
                <span>
                  {currentInFocus
                    ? `Move “${currentProject}” to Later`
                    : `Add “${currentProject}” to Focus`}
                </span>
              </CommandItem>
              <CommandItem
                value={`Edit project ${currentProject}`}
                onSelect={() => run(() => onEditProject(currentProject))}
              >
                <Pencil className="size-4" />
                <span>Edit project “{currentProject}”…</span>
              </CommandItem>
            </>
          )}
        </CommandGroup>

        <CommandSeparator className="my-1" />

        <CommandGroup heading="Views">
          {(Object.entries(views) as [View, string][]).map(([value, label]) => {
            const Icon = viewIcons[value];
            return (
              <CommandItem
                key={value}
                value={`Go to ${label} view ${value}`}
                onSelect={() => run(() => onView(value))}
              >
                <Icon className="size-4" />
                <span>{label}</span>
              </CommandItem>
            );
          })}
          <CommandItem
            value="Go to Filters and labels organization"
            onSelect={() => run(onOrganization)}
          >
            <OrganizationIcon className="size-4" />
            <span>Filters &amp; labels</span>
          </CommandItem>
          <CommandItem
            value="Open Data and recovery backups restore"
            onSelect={() => run(onRecovery)}
          >
            <DatabaseBackup className="size-4" />
            <span>Data &amp; recovery</span>
          </CommandItem>
        </CommandGroup>

        {projects.length > 0 && (
          <>
            <CommandSeparator className="my-1" />
            <CommandGroup heading="Projects">
              {projects.map((name) => {
                const count = projectTaskCount(
                  name,
                  organization.projectCounts,
                );
                const inFocus = Boolean(
                  focusProject(name, organization.projects),
                );
                return (
                  <CommandItem
                    key={name}
                    value={`Project ${name} ${inFocus ? "focus" : "later"}`}
                    onSelect={() => run(() => onProject(name))}
                  >
                    <ProjectIcon name={name} className="size-4 shrink-0" />
                    <span className="truncate">{name}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      {inFocus && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                          Focus
                        </span>
                      )}
                      {count > 0 && (
                        <span className="tabular-nums">{count}</span>
                      )}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {(organization.filters.length > 0 || organization.tags.length > 0) && (
          <>
            <CommandSeparator className="my-1" />
            <CommandGroup heading="Filters & Labels">
              {organization.filters.map((item) => (
                <CommandItem
                  key={`filter-${item.id}`}
                  value={`Filter ${item.name} ${item.expression}`}
                  onSelect={() => run(() => onEntry({ kind: "filter", item }))}
                >
                  <FilterIcon
                    className="size-4"
                    style={{ color: itemColor(item.color) }}
                  />
                  <span className="truncate">{item.name}</span>
                </CommandItem>
              ))}
              {organization.tags.map((item) => (
                <CommandItem
                  key={`tag-${item.id}`}
                  value={`Label tag @${item.name}`}
                  onSelect={() => run(() => onEntry({ kind: "tag", item }))}
                >
                  <LabelIcon
                    className="size-4"
                    style={{ color: itemColor(item.color) }}
                  />
                  <span className="truncate">{item.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {pendingTasks.length > 0 && (
          <>
            <CommandSeparator className="my-1" />
            <CommandGroup heading="Tasks">
              {pendingTasks.map((task) => (
                <CommandItem
                  key={task.uuid}
                  value={`Task ${task.description} ${task.project || ""} ${task.tags.join(" ")}`}
                  onSelect={() => run(() => onEditTask(task))}
                >
                  <CircleCheck className="size-4 text-muted-foreground/70" />
                  <span className="truncate">{task.description}</span>
                  {task.project && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {task.project}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
