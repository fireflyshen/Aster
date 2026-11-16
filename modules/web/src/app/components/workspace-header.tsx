import { WorkspaceDisplayOptions } from "./workspace-display-options";
import { Button } from "@/components/ui/button";
import { ProjectIcon } from "@/features/projects/project-icon";
import {
  TASK_GROUP_OPTIONS,
  type TaskGroupBy,
} from "@/features/tasks/task-grouping";
import type { ProjectStatus } from "@core/workspace/focus";
import type {
  SavedFilter,
  SavedProject,
  SavedTag,
} from "@core/workspace/organization";
import {
  projectLeaf,
  projectParent,
  projectPath,
} from "@core/workspace/projects";
import type { View } from "@shared/tasks";
import { cn } from "cn";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { PanelLeft, RotateCw, Search, Target } from "lucide-react";
import type {
  CompleteBehavior,
  TimePage,
} from "../hooks/use-workspace-navigation";
import { views } from "../workspace-sidebar";
import { WorkspaceHeadingMenu } from "./workspace-heading-menu";

type WorkspaceToolbarProps = {
  navOpen: boolean;
  searchOpen: boolean;
  query: string;
  loading: boolean;
  busy: boolean;
  onOpenNav: () => void;
  onOpenCommand: () => void;
  onToggleSearch: () => void;
  onRefresh: () => void;
};

/** Sticky top bar with sidebar reopen button, quick find, theme switch, search, and sync trigger. */
export function WorkspaceToolbar({
  navOpen,
  searchOpen,
  query,
  loading,
  busy,
  onOpenNav,
  onOpenCommand,
  onToggleSearch,
  onRefresh,
}: WorkspaceToolbarProps) {
  return (
    <header className="workspace-toolbar sticky top-0 z-20 flex h-12 items-center bg-background/90 backdrop-blur">
      <div className="workspace-frame flex items-center justify-between gap-2">
        <div className="flex items-center">
          {!navOpen && (
            <Button
              variant="ghost"
              size="icon-sm"
              id="sidebar-toggle"
              aria-label="打开侧边栏"
              aria-expanded={false}
              onClick={onOpenNav}
              className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelLeft className="size-[18px]" strokeWidth={1.6} />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!navOpen && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="快速查找 (⌘K)"
              className="hidden sm:inline-flex"
              onClick={onOpenCommand}
            >
              <Search className="size-[18px]" strokeWidth={1.5} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            id="search-toggle"
            aria-label={searchOpen || query ? "关闭搜索" : "搜索任务"}
            aria-expanded={Boolean(searchOpen || query)}
            aria-controls="task-search"
            aria-keyshortcuts="/"
            onClick={onToggleSearch}
            className="text-muted-foreground hover:text-foreground sm:hidden"
          >
            <Search className="size-[18px]" strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="刷新任务"
            disabled={loading || busy}
            onClick={onRefresh}
            className="text-muted-foreground hover:text-foreground"
          >
            <RotateCw
              className={cn("size-[17px]", loading && "animate-spin")}
              strokeWidth={1.5}
            />
          </Button>
        </div>
      </div>
    </header>
  );
}

type WorkspaceHeadingProps = {
  view: View;
  now: Date;
  currentProject: string;
  organizationPage: boolean;
  projectsPage: boolean;
  timePage?: TimePage | null;
  habitsPage?: boolean;
  specialPage: boolean;
  organizationReady: boolean;
  organizationSaving: boolean;
  busy: boolean;
  activeEntry?: { kind: "filter" | "tag"; id: string };
  activeItem?: SavedFilter | SavedTag;
  activeCount?: number;
  groupBy?: TaskGroupBy;
  groupOptions?: readonly { value: TaskGroupBy; label: string }[];
  onGroupByChange?: (next: TaskGroupBy) => void;
  onResetDisplay?: () => void;
  currentProjectFocus?: SavedProject;
  currentProjectIsHabit?: boolean;
  projectOutcome?: string;
  projectDescription?: string;
  viewCounts: Partial<Record<View, number>>;
  viewMenuOpen: boolean;
  setViewMenuOpen: (open: boolean) => void;
  completeBehavior?: CompleteBehavior;
  onCompleteBehaviorChange?: (next: CompleteBehavior) => void;
  onSelectProject: (project: string) => void;
  onSelectView: (view: View) => void;
  onTransitionProject: (name: string, status: ProjectStatus) => void;
  onAddSubproject: (parent: string) => void;
  onStartEditDesc: () => void;
  onStartEditOutcome: () => void;
  onEditProject: (name: string) => void;
  onDeleteProject: (name: string) => void;
  onManageOrganization: () => void;
};

const TIME_PAGE_TITLES: Record<TimePage, string> = {
  today: "时间账本",
  weekly: "本周分布",
  reports: "成本报告",
  settings: "时间与预算",
};

/** View heading bar with breadcrumbs, Todoist count/subtitle, Focus toggle, and layout/options controls. */
export function WorkspaceHeading({
  view,
  now,
  currentProject,
  organizationPage,
  projectsPage,
  timePage = null,
  habitsPage = false,
  specialPage,
  organizationReady,
  organizationSaving,
  busy,
  activeEntry,
  activeItem,
  activeCount,
  groupBy = "none",
  groupOptions = TASK_GROUP_OPTIONS,
  onGroupByChange,
  onResetDisplay,
  currentProjectFocus,
  currentProjectIsHabit = false,
  projectOutcome,
  projectDescription,
  viewCounts,
  viewMenuOpen,
  setViewMenuOpen,
  completeBehavior = "hide",
  onCompleteBehaviorChange,
  onSelectProject,
  onSelectView,
  onTransitionProject,
  onAddSubproject,
  onStartEditDesc,
  onStartEditOutcome,
  onEditProject,
  onDeleteProject,
  onManageOrganization,
}: WorkspaceHeadingProps) {
  const showTodayMeta =
    view === "today" &&
    !currentProject &&
    !organizationPage &&
    !activeItem &&
    !timePage &&
    !habitsPage;
  const showInboxCount =
    view === "pending" &&
    !currentProject &&
    !organizationPage &&
    !activeItem &&
    !timePage &&
    !habitsPage;
  const titleText = habitsPage
    ? "习惯"
    : timePage
      ? TIME_PAGE_TITLES[timePage]
      : organizationPage
        ? projectsPage
          ? "项目管理"
          : "过滤器 & 标签"
        : activeItem?.name ||
          (currentProject ? projectLeaf(currentProject) : views[view]);
  const filterSubtitle =
    !timePage &&
    !habitsPage &&
    !organizationPage &&
    activeEntry?.kind === "filter" &&
    activeItem &&
    "expression" in activeItem
      ? activeItem.description &&
        !activeItem.description.includes(activeItem.expression)
        ? `${activeItem.description} · ${activeItem.expression}`
        : activeItem.description || activeItem.expression
      : undefined;
  const disabled = busy || organizationSaving;

  return (
    <>
      {currentProject && projectParent(currentProject) && (
        <nav
          aria-label="父级项目"
          className="mb-2 flex min-w-0 items-center gap-1 overflow-x-auto text-xs text-muted-foreground"
        >
          {projectParent(currentProject)
            .split(".")
            .map((part, index, parts) => (
              <Button
                key={part}
                variant="ghost"
                className="h-6 shrink-0 px-1 text-xs font-normal"
                onClick={() =>
                  onSelectProject(parts.slice(0, index + 1).join("."))
                }
              >
                {part}
                <span aria-hidden className="ml-1 opacity-50">
                  /
                </span>
              </Button>
            ))}
        </nav>
      )}

      <div
        data-workspace-heading
        className="mb-5 flex min-h-10 items-center justify-between gap-4"
      >
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-2.5">
            {currentProject &&
              !organizationPage &&
              !timePage &&
              !habitsPage &&
              !activeItem && (
                <ProjectIcon
                  name={currentProject}
                  className="size-5 shrink-0"
                />
              )}
            <h1
              title={currentProject ? projectPath(currentProject) : undefined}
              id="view-title"
              tabIndex={-1}
              className="min-w-0 truncate text-2xl leading-8 font-bold tracking-[-0.5px] outline-none"
            >
              {titleText}
            </h1>
            {showTodayMeta && (
              <span className="text-xs font-medium text-muted-foreground/80 tabular-nums">
                {viewCounts.today ?? 0} 个任务
              </span>
            )}
            {showInboxCount && (
              <span className="text-xs font-medium text-muted-foreground/80 tabular-nums">
                {viewCounts.pending ?? 0}
              </span>
            )}
            {!timePage &&
              !habitsPage &&
              !organizationPage &&
              activeItem &&
              activeCount !== undefined && (
                <span className="text-xs font-medium text-muted-foreground/80 tabular-nums">
                  {activeCount}
                </span>
              )}
            {currentProject &&
              !timePage &&
              !habitsPage &&
              !organizationPage &&
              !activeItem &&
              (currentProjectIsHabit ? (
                <span className="h-6 shrink-0 inline-flex items-center rounded-full border border-border/80 bg-muted/60 px-2.5 text-[11px] font-medium text-muted-foreground">
                  习惯项目
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={disabled}
                  onClick={() =>
                    onTransitionProject(
                      currentProjectFocus?.name || currentProject,
                      currentProjectFocus ? "later" : "active",
                    )
                  }
                  className={cn(
                    "h-6 shrink-0 gap-1 rounded-full border px-2.5 text-[11px] font-medium",
                    currentProjectFocus
                      ? "border-primary/25 bg-primary/8 text-foreground hover:bg-primary/14"
                      : "border-border text-muted-foreground hover:bg-(--row-hover) hover:text-foreground",
                  )}
                >
                  {currentProjectFocus ? (
                    <>
                      <Target className="size-3" strokeWidth={1.8} />
                      焦点
                    </>
                  ) : (
                    "稍后"
                  )}
                </Button>
              ))}
          </div>
          {showTodayMeta && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {format(now, "M月d日 · EEEE", { locale: zhCN })}
            </p>
          )}
          {filterSubtitle && (
            <p
              className="mt-0.5 truncate text-xs text-muted-foreground"
              title={
                activeItem && "expression" in activeItem
                  ? activeItem.expression
                  : filterSubtitle
              }
            >
              {filterSubtitle}
            </p>
          )}
        </div>

        {!organizationPage && !specialPage && (
          <div className="workspace-view-controls flex shrink-0 items-center gap-1.5">
            <WorkspaceDisplayOptions
              disabled={disabled}
              groupBy={groupBy}
              groupOptions={groupOptions}
              onGroupByChange={onGroupByChange}
              completeBehavior={completeBehavior}
              onCompleteBehaviorChange={onCompleteBehaviorChange}
              onReset={onResetDisplay}
            />

            <WorkspaceHeadingMenu
              open={viewMenuOpen}
              onOpenChange={setViewMenuOpen}
              view={view}
              currentProject={currentProject}
              organizationReady={organizationReady}
              disabled={disabled}
              activeEntry={activeEntry}
              activeItem={activeItem}
              currentProjectFocus={currentProjectFocus}
              currentProjectIsHabit={currentProjectIsHabit}
              projectOutcome={projectOutcome}
              projectDescription={projectDescription}
              onSelectView={onSelectView}
              onTransitionProject={onTransitionProject}
              onAddSubproject={onAddSubproject}
              onStartEditDesc={onStartEditDesc}
              onStartEditOutcome={onStartEditOutcome}
              onEditProject={onEditProject}
              onDeleteProject={onDeleteProject}
              onManageOrganization={onManageOrganization}
            />
          </div>
        )}
      </div>
    </>
  );
}
