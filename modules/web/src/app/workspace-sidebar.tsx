import { FilterIcon, LabelIcon, OrganizationIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ProjectTree } from "@/features/projects/project-tree";
import { formatDuration, type EnergySummary } from "@core/workspace/energy";
import {
  FOCUS_LIMIT,
  focusProject,
  projectStatus,
  type ProjectStatus,
} from "@core/workspace/focus";
import {
  itemColor,
  type Organization,
  type SavedFilter,
  type SavedTag,
} from "@core/workspace/organization";
import type { View } from "@shared/tasks";
import { cn } from "cn";
import {
  Archive,
  Asterisk,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock3,
  DatabaseBackup,
  Inbox,
  PanelLeft,
  Plus,
  Target,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { WorkspaceNavigation } from "./workspace-navigation";

export const views: Record<View, string> = {
  focus: "Focus",
  later: "Later",
  pending: "Inbox",
  today: "Today",
  waiting: "Waiting",
  completed: "Completed",
};
const viewIcons = {
  focus: Target,
  later: Archive,
  pending: Inbox,
  today: CalendarDays,
  waiting: Clock3,
  completed: CircleCheck,
};

type WorkspaceSidebarProps = {
  navOpen: boolean;
  onOpenChange: (open: boolean) => void;
  view: View;
  currentProject: string;
  organizationPage: boolean;
  projectsPage: boolean;
  organization: Organization;
  hasActiveItem: boolean;
  activeEntry?: { kind: "filter" | "tag"; id: string };
  projects: string[];
  viewCounts?: Partial<Record<View, number>>;
  busy: boolean;
  needsCheck: boolean;
  organizationSaving: boolean;
  connectionLabel: string;
  energy?: EnergySummary;
  onElixir?: () => void;
  timingUnavailable?: boolean;
  onRetryTiming?: () => void;
  onAdd: () => void;
  onAddProject: () => void;
  onAddSubproject: (name: string) => void;
  onEditProject: (name: string) => void;
  onDeleteProject: (name: string) => void;
  onProjectStatus: (name: string, status: ProjectStatus) => void;
  onProjects: () => void;
  onEntry: (entry: {
    kind: "filter" | "tag";
    item: SavedFilter | SavedTag;
  }) => void;
  onView: (view: View) => void;
  onProject: (project: string) => void;
  onOrganization: () => void;
  onRecovery: () => void;
};

export function WorkspaceSidebar({
  navOpen,
  onOpenChange,
  view,
  currentProject,
  organizationPage,
  projectsPage,
  organization,
  activeEntry,
  hasActiveItem,
  projects,
  viewCounts,
  busy,
  needsCheck,
  organizationSaving,
  connectionLabel,
  energy,
  onElixir,
  timingUnavailable,
  onRetryTiming,
  onAdd,
  onAddProject,
  onAddSubproject,
  onEditProject,
  onDeleteProject,
  onProjectStatus,
  onProjects,
  onEntry,
  onView,
  onProject,
  onOrganization,
  onRecovery,
}: WorkspaceSidebarProps) {
  const [laterCollapsed, setLaterCollapsed] = useState(false);
  const activeRoots = (organization.projects || [])
    .filter((p) => projectStatus(p) === "active")
    .map((p) => p.name);
  const laterProjects = projects.filter((name) => {
    const record = organization.projects?.find((p) => p.name === name);
    const status = projectStatus(record);
    return (
      !focusProject(name, organization.projects) && status !== "completed"
    );
  });

  return (
    <WorkspaceNavigation open={navOpen} onOpenChange={onOpenChange}>
      <div className="mb-3 flex h-10 items-center gap-2 px-1 text-sm font-semibold md:px-2.5">
        <Button
          id="sidebar-close"
          variant="ghost"
          size="icon-sm"
          aria-label="Hide sidebar"
          className="text-muted-foreground md:hidden"
          onClick={() => onOpenChange(false)}
        >
          <PanelLeft className="size-4" />
        </Button>
        <Asterisk className="size-5 text-primary" strokeWidth={1.6} />
        Aster
        <span aria-hidden className="ml-auto hidden size-8 md:block" />
      </div>
      <Button
        variant="ghost"
        onClick={onAdd}
        disabled={busy || needsCheck}
        aria-keyshortcuts="Q"
        className="mb-3 h-9 w-full justify-start gap-2.5 px-2.5 font-medium text-primary hover:bg-navigation-hover has-[>svg]:px-2.5"
      >
        <Plus className="size-5" />
        Add task
        <kbd className="ml-auto rounded border border-border/80 bg-background/80 px-1.5 py-0.5 font-sans text-[11px] leading-none text-muted-foreground">
          Q
        </kbd>
      </Button>
      <nav aria-label="Task views" className="space-y-0.5">
        {(Object.entries(views) as [View, string][]).map(([value, label]) => {
          const Icon = viewIcons[value];
          const count = viewCounts?.[value];
          return (
            <Button
              key={value}
              variant="navigation"
              disabled={busy || organizationSaving}
              aria-current={
                view === value &&
                !currentProject &&
                !organizationPage &&
                !hasActiveItem
                  ? "page"
                  : undefined
              }
              onClick={() => {
                onView(value);
                if (innerWidth < 768) onOpenChange(false);
              }}
            >
              <Icon className="size-[18px]" />
              <span className="truncate">{label}</span>
              {value === "focus" ? (
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {activeRoots.length}/{FOCUS_LIMIT}
                </span>
              ) : count ? (
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {count}
                </span>
              ) : null}
            </Button>
          );
        })}
        <Button
          variant="navigation"
          aria-current={organizationPage && !projectsPage ? "page" : undefined}
          disabled={busy || organizationSaving}
          onClick={() => {
            onOrganization();
            if (innerWidth < 768) onOpenChange(false);
          }}
        >
          <OrganizationIcon className="size-[18px]" />
          Filters & labels
        </Button>
      </nav>
      {!![...organization.filters, ...organization.tags].filter(
        (item) => item.favorite,
      ).length && (
        <>
          <p className="mt-6 mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">
            Favorites
          </p>
          <nav aria-label="Favorites" className="space-y-0.5">
            {organization.filters
              .filter((item) => item.favorite)
              .map((item) => (
                <Button
                  key={item.id}
                  variant="navigation"
                  disabled={busy || organizationSaving}
                  aria-current={
                    !organizationPage && activeEntry?.id === item.id
                      ? "page"
                      : undefined
                  }
                  onClick={() => onEntry({ kind: "filter", item })}
                >
                  <FilterIcon
                    className="size-[18px]"
                    style={{ color: itemColor(item.color) }}
                  />
                  <span className="truncate">{item.name}</span>
                </Button>
              ))}
            {organization.tags
              .filter((item) => item.favorite)
              .map((item) => (
                <Button
                  key={item.id}
                  variant="navigation"
                  disabled={busy || organizationSaving}
                  aria-current={
                    !organizationPage && activeEntry?.id === item.id
                      ? "page"
                      : undefined
                  }
                  onClick={() => onEntry({ kind: "tag", item })}
                >
                  <LabelIcon
                    className="size-[18px]"
                    style={{ color: itemColor(item.color) }}
                  />
                  <span className="truncate">{item.name}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {item.count || ""}
                  </span>
                </Button>
              ))}
          </nav>
        </>
      )}
      <div className="mt-6 mb-1 flex items-center justify-between pl-0.5">
        <Button
          variant="ghost"
          onClick={() => {
            onProjects();
            if (innerWidth < 768) onOpenChange(false);
          }}
          disabled={busy || organizationSaving}
          aria-label="Manage projects"
          aria-current={organizationPage && projectsPage ? "page" : undefined}
          className="h-7 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-navigation-hover hover:text-foreground aria-[current=page]:bg-navigation-selected aria-[current=page]:text-foreground"
        >
          Projects
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add project"
          disabled={busy || organizationSaving}
          onClick={onAddProject}
          className="size-7 text-muted-foreground hover:bg-navigation-hover hover:text-foreground"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <nav aria-label="Project" className="flex-1 space-y-0.5">
        {activeRoots.length > 0 && (
          <ProjectTree
            names={projects}
            data={organization}
            roots={activeRoots}
            compact
            current={
              !organizationPage && !hasActiveItem ? currentProject : undefined
            }
            disabled={busy || organizationSaving}
            onOpen={(name) => {
              onProject(name);
              if (innerWidth < 768) onOpenChange(false);
            }}
            onAddChild={onAddSubproject}
            onStatus={onProjectStatus}
            onEdit={onEditProject}
            onDelete={onDeleteProject}
          />
        )}
        {laterProjects.length > 0 && (
          <div className={activeRoots.length > 0 ? "pt-2" : ""}>
            {activeRoots.length > 0 && (
              <button
                type="button"
                aria-expanded={!laterCollapsed}
                onClick={() => setLaterCollapsed((prev) => !prev)}
                className="mb-0.5 flex h-6 w-full items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors select-none hover:bg-navigation-hover hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform duration-150",
                    !laterCollapsed && "rotate-90",
                  )}
                />
                Later · {laterProjects.length}
              </button>
            )}
            {(!laterCollapsed || activeRoots.length === 0) && (
              <ProjectTree
                names={laterProjects}
                data={organization}
                compact
                current={
                  !organizationPage && !hasActiveItem
                    ? currentProject
                    : undefined
                }
                disabled={busy || organizationSaving}
                onOpen={(name) => {
                  onProject(name);
                  if (innerWidth < 768) onOpenChange(false);
                }}
                onAddChild={onAddSubproject}
                onStatus={onProjectStatus}
                onEdit={onEditProject}
                onDelete={onDeleteProject}
              />
            )}
          </div>
        )}
        {activeRoots.length === 0 && laterProjects.length === 0 && (
          <Button
            variant="navigation"
            disabled={busy || organizationSaving}
            onClick={onAddProject}
            className="h-8 text-xs text-muted-foreground"
          >
            <Plus className="size-3.5" />
            New project
          </Button>
        )}
      </nav>
      {timingUnavailable && (
        <div
          role="status"
          className="mt-6 space-y-1 px-2.5 text-xs leading-5 text-muted-foreground"
        >
          <p>Timer data unavailable</p>
          <p>Energy cannot be calculated.</p>
          <Button
            variant="link"
            size="sm"
            onClick={onRetryTiming}
            disabled={busy}
            className="h-7 px-0 text-xs"
          >
            Retry
          </Button>
        </div>
      )}
      {energy && (
        <div className="mt-6 space-y-1.5 px-2.5" aria-label="Daily energy">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground tabular-nums">
              <Zap
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.6}
              />
              {energy.remaining} / {energy.max}
            </span>
            <span className="tabular-nums">
              {formatDuration(energy.trackedSecondsToday)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Remaining daily energy"
            aria-valuemin={0}
            aria-valuemax={energy.max}
            aria-valuenow={energy.remaining}
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                energy.remaining === 0
                  ? "bg-destructive"
                  : energy.remaining <= 25
                    ? "bg-foreground/50"
                    : "bg-foreground/80",
              )}
              style={{
                width: `${Math.min(100, Math.round((energy.remaining / Math.max(1, energy.max)) * 100))}%`,
              }}
            />
          </div>
          {energy.remaining <= 25 && onElixir && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || organizationSaving}
              onClick={onElixir}
              className="h-6 w-full justify-start px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground has-[>svg]:px-0"
            >
              <Plus className="size-3" />
              Restore +30 energy
            </Button>
          )}
        </div>
      )}
      <Button
        variant="navigation"
        onClick={() => {
          onRecovery();
          if (innerWidth < 768) onOpenChange(false);
        }}
        disabled={busy || organizationSaving}
        className="mt-4 h-9 text-xs"
      >
        <DatabaseBackup className="size-4" />
        Data & recovery
      </Button>
      <p
        className={cn(
          "px-2.5 pb-2 text-xs text-muted-foreground",
          energy ? "mt-3" : "mt-6",
        )}
      >
        {connectionLabel}
      </p>
    </WorkspaceNavigation>
  );
}
