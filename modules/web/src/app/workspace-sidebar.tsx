import { OrganizationIcon, TodayCalendarIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { EnergySummary } from "@core/workspace/energy";
import {
  FOCUS_LIMIT,
  focusProject,
  projectStatus,
  type ProjectStatus,
} from "@core/workspace/focus";
import type {
  Organization,
  SavedFilter,
  SavedTag,
} from "@core/workspace/organization";
import type { View } from "@shared/tasks";
import { cn } from "cn";
import {
  Archive,
  Asterisk,
  ChevronDown,
  CircleCheck,
  Clock3,
  DatabaseBackup,
  Inbox,
  PanelLeft,
  Plus,
  Search,
  Target,
} from "lucide-react";
import { useState } from "react";
import {
  SidebarEnergyMeter,
  SidebarFavorites,
  SidebarProjectsSection,
} from "./sidebar-sections";
import { WorkspaceNavigation } from "./workspace-navigation";

export const views: Record<View, string> = {
  pending: "收件箱",
  today: "今天",
  focus: "焦点",
  later: "稍后",
  waiting: "等待中",
  completed: "已完成",
};

const viewOrder: View[] = [
  "pending",
  "today",
  "focus",
  "later",
  "waiting",
  "completed",
];

const viewMeta: Record<
  View,
  {
    icon: React.ComponentType<{ className?: string }>;
    colorClass: string;
  }
> = {
  pending: {
    icon: Inbox,
    colorClass: "text-[#3f63ab] dark:text-[#7e9fe2]",
  },
  today: {
    icon: TodayCalendarIcon,
    colorClass: "text-(--due-today)",
  },
  focus: {
    icon: Target,
    colorClass: "text-(--due-tomorrow)",
  },
  later: {
    icon: Archive,
    colorClass: "text-(--due-upcoming)",
  },
  waiting: {
    icon: Clock3,
    colorClass: "text-[#a47052] dark:text-[#cf9676]",
  },
  completed: {
    icon: CircleCheck,
    colorClass: "text-muted-foreground",
  },
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
  onSearch: () => void;
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

/** Persistent navigation drawer housing views, favorites, focus/later projects, and energy meter. */
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
  onSearch,
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
  const disabled = busy || organizationSaving;
  const closeOnMobile = () => {
    if (innerWidth < 768) onOpenChange(false);
  };

  const activeRoots = (organization.projects || [])
    .filter((p) => projectStatus(p) === "active")
    .map((p) => p.name);
  const laterProjects = projects.filter((name) => {
    const record = organization.projects?.find((p) => p.name === name);
    const status = projectStatus(record);
    return !focusProject(name, organization.projects) && status !== "completed";
  });

  return (
    <WorkspaceNavigation open={navOpen} onOpenChange={onOpenChange}>
      <div className="sidebar-account flex h-14 items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Asterisk className="size-[18px]" strokeWidth={1.8} />
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Aster
          </span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </div>
        <Button
          id="sidebar-close"
          variant="ghost"
          size="icon-xs"
          aria-label="隐藏侧边栏"
          title="收起侧边栏"
          className="size-7 text-muted-foreground hover:bg-navigation-hover hover:text-foreground"
          onClick={() => onOpenChange(false)}
        >
          <PanelLeft className="size-4" strokeWidth={1.6} />
        </Button>
      </div>
      <Button
        variant="ghost"
        onClick={onAdd}
        disabled={busy || needsCheck}
        aria-keyshortcuts="Q"
        className="sidebar-add h-9 w-full justify-start gap-2.5 px-2 font-semibold text-(--navigation-selected-ink) hover:bg-navigation-hover hover:text-(--navigation-selected-ink) has-[>svg]:px-2"
      >
        <span className="flex size-[18px] items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Plus className="size-3.5" strokeWidth={2.25} />
        </span>
        添加任务
        <kbd className="ml-auto rounded border border-border/80 bg-background/80 px-1.5 py-0.5 font-sans text-[11px] leading-none text-muted-foreground">
          Q
        </kbd>
      </Button>
      <Button
        variant="navigation"
        onClick={onSearch}
        aria-keyshortcuts="Meta+K Control+K"
        className="sidebar-search"
      >
        <Search className="size-[18px]" strokeWidth={1.5} />
        搜索
        <kbd className="ml-auto text-[11px] text-muted-foreground">⌘K</kbd>
      </Button>
      <nav aria-label="任务视图" className="space-y-0.5">
        {viewOrder.map((value) => {
          const label = views[value];
          const { icon: Icon, colorClass } = viewMeta[value];
          const count = viewCounts?.[value];
          return (
            <Button
              key={value}
              variant="navigation"
              disabled={disabled}
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
                closeOnMobile();
              }}
            >
              <Icon className={cn("size-[18px] shrink-0", colorClass)} />
              <span className="truncate">{label}</span>
              {value === "focus" ? (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {activeRoots.length}/{FOCUS_LIMIT}
                </span>
              ) : count ? (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {count}
                </span>
              ) : null}
            </Button>
          );
        })}
        <Button
          variant="navigation"
          aria-current={organizationPage && !projectsPage ? "page" : undefined}
          disabled={disabled}
          onClick={() => {
            onOrganization();
            closeOnMobile();
          }}
        >
          <OrganizationIcon className="size-[18px]" />
          过滤器&标签
        </Button>
      </nav>
      <SidebarFavorites
        organization={organization}
        organizationPage={organizationPage}
        activeEntry={activeEntry}
        disabled={disabled}
        onEntry={onEntry}
      />
      <SidebarProjectsSection
        organization={organization}
        organizationPage={organizationPage}
        projectsPage={projectsPage}
        hasActiveItem={hasActiveItem}
        currentProject={currentProject}
        activeRoots={activeRoots}
        laterProjects={laterProjects}
        laterCollapsed={laterCollapsed}
        disabled={disabled}
        onToggleLater={() => setLaterCollapsed((prev) => !prev)}
        onProjects={() => {
          onProjects();
          closeOnMobile();
        }}
        onAddProject={onAddProject}
        onAddSubproject={onAddSubproject}
        onEditProject={onEditProject}
        onDeleteProject={onDeleteProject}
        onProjectStatus={onProjectStatus}
        onSelectProject={(name) => {
          onProject(name);
          closeOnMobile();
        }}
      />
      <SidebarEnergyMeter
        energy={energy}
        timingUnavailable={timingUnavailable}
        disabled={disabled}
        busy={busy}
        onRetryTiming={onRetryTiming}
        onElixir={onElixir}
      />
      <Button
        variant="navigation"
        onClick={() => {
          onRecovery();
          closeOnMobile();
        }}
        disabled={disabled}
        className="mt-4 h-9 text-xs"
      >
        <DatabaseBackup className="size-4" />
        数据与恢复
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
