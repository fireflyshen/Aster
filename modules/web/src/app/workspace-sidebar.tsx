import {
  FilterIcon,
  LabelIcon,
  OrganizationIcon,
  TodayCalendarIcon,
} from "@/components/icons";
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
  ChevronDown,
  ChevronRight,
  Search,
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
    colorClass: "text-blue-500/90 dark:text-blue-400",
  },
  today: {
    icon: TodayCalendarIcon,
    colorClass: "text-emerald-600 dark:text-emerald-500",
  },
  focus: {
    icon: Target,
    colorClass: "text-amber-500/90 dark:text-amber-400",
  },
  later: {
    icon: Archive,
    colorClass: "text-purple-500/80 dark:text-purple-400",
  },
  waiting: {
    icon: Clock3,
    colorClass: "text-orange-500/80 dark:text-orange-400",
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
        className="sidebar-add h-9 w-full justify-start gap-2.5 px-2 font-semibold text-[#dc4c3e] hover:bg-navigation-hover hover:text-[#dc4c3e] dark:text-[#ff7066] dark:hover:text-[#ff7066] has-[>svg]:px-2"
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
              <Icon className={cn("size-[18px] shrink-0", colorClass)} />
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
          过滤器&标签
        </Button>
      </nav>
      {!![...organization.filters, ...organization.tags].filter(
        (item) => item.favorite,
      ).length && (
        <>
          <p className="mt-6 mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">
            收藏
          </p>
          <nav aria-label="收藏" className="space-y-0.5">
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
          aria-label="管理项目"
          aria-current={organizationPage && projectsPage ? "page" : undefined}
          className="h-7 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-navigation-hover hover:text-foreground aria-[current=page]:bg-navigation-selected aria-[current=page]:text-foreground"
        >
          我的项目
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="添加项目"
          disabled={busy || organizationSaving}
          onClick={onAddProject}
          className="size-7 text-muted-foreground hover:bg-navigation-hover hover:text-foreground"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <nav aria-label="项目" className="flex-1 space-y-0.5">
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
                稍后 · {laterProjects.length}
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
            新建项目
          </Button>
        )}
      </nav>
      {timingUnavailable && (
        <div
          role="status"
          className="mt-6 space-y-1 px-2.5 text-xs leading-5 text-muted-foreground"
        >
          <p>计时数据不可用</p>
          <p>暂时无法计算精力值。</p>
          <Button
            variant="link"
            size="sm"
            onClick={onRetryTiming}
            disabled={busy}
            className="h-7 px-0 text-xs"
          >
            重试
          </Button>
        </div>
      )}
      {energy && (
        <div className="mt-6 space-y-1.5 px-2.5" aria-label="每日精力">
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
            aria-label="剩余每日精力"
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
              恢复 +30 精力
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
