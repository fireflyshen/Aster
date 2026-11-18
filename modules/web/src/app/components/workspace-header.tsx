import { useI18n } from "@/app/language";
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
import { PanelLeft, Plus, RotateCw, Search, X } from "lucide-react";
import type {
  CompleteBehavior,
  TimePage,
} from "../hooks/use-workspace-navigation";
import { views } from "../workspace-sidebar";
import { WorkspaceHeadingMenu } from "./workspace-heading-menu";

type WorkspaceToolbarProps = {
  navOpen: boolean;
  searchOpen: boolean;
  canSearchTasks: boolean;
  loading: boolean;
  busy: boolean;
  addDisabled: boolean;
  onAdd: () => void;
  onOpenNav: () => void;
  onToggleSearch: () => void;
  onRefresh: () => void;
};

export function WorkspaceToolbar({
  navOpen,
  searchOpen,
  canSearchTasks,
  loading,
  busy,
  addDisabled,
  onAdd,
  onOpenNav,
  onToggleSearch,
  onRefresh,
}: WorkspaceToolbarProps) {
  const { t } = useI18n();
  const searchLabel = t(
    canSearchTasks ? (searchOpen ? "关闭搜索" : "搜索任务") : "快速查找",
  );
  const SearchIcon = searchOpen ? X : Search;
  return (
    <header className="workspace-toolbar sticky top-0 z-20 flex h-12 items-center bg-background/90 backdrop-blur">
      <div className="workspace-frame flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {!navOpen && (
            <Button
              variant="ghost"
              size="icon-sm"
              id="sidebar-toggle"
              aria-label={t("打开侧边栏")}
              aria-expanded={false}
              onClick={onOpenNav}
              className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelLeft className="size-[18px]" strokeWidth={1.6} />
            </Button>
          )}
          {!navOpen && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("添加任务")}
              aria-keyshortcuts="Q"
              title={t("添加任务")}
              disabled={addDisabled}
              onClick={onAdd}
              className="hidden text-(--navigation-selected-ink) md:inline-flex"
            >
              <Plus className="size-[18px]" strokeWidth={1.6} />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            id="search-toggle"
            aria-label={searchLabel}
            title={searchLabel}
            aria-expanded={canSearchTasks ? searchOpen : undefined}
            aria-controls={searchOpen ? "task-search" : undefined}
            aria-haspopup={canSearchTasks ? undefined : "dialog"}
            aria-keyshortcuts="/"
            onClick={onToggleSearch}
            className="text-muted-foreground hover:text-foreground"
          >
            <SearchIcon className="size-[18px]" strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("刷新任务")}
            title={t("刷新任务")}
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
  showDisplayOptions: boolean;
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
  weekly: "时间账本",
  reports: "时间账本",
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
  showDisplayOptions,
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
  onTransitionProject,
  onAddSubproject,
  onStartEditDesc,
  onStartEditOutcome,
  onEditProject,
  onDeleteProject,
  onManageOrganization,
}: WorkspaceHeadingProps) {
  const { t, locale } = useI18n();
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
    ? t("习惯")
    : timePage
      ? t(TIME_PAGE_TITLES[timePage])
      : organizationPage
        ? projectsPage
          ? t("项目管理")
          : t("过滤器 & 标签")
        : activeItem?.name ||
          (currentProject ? projectLeaf(currentProject) : t(views[view]));
  const isSavedFilter =
    !timePage &&
    !habitsPage &&
    !organizationPage &&
    activeEntry?.kind === "filter" &&
    activeItem &&
    "expression" in activeItem
      ? activeItem
      : undefined;
  const filterSubtitle = isSavedFilter
    ? isSavedFilter.description === isSavedFilter.expression
      ? undefined
      : isSavedFilter.description
    : undefined;
  const taskCount = showTodayMeta
    ? (viewCounts.today ?? 0)
    : showInboxCount
      ? (viewCounts.pending ?? 0)
      : !timePage && !habitsPage && !organizationPage && activeItem
        ? activeCount
        : undefined;
  const disabled = busy || organizationSaving;

  return (
    <>
      {currentProject && projectParent(currentProject) && (
        <nav
          aria-label={t("父级项目")}
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
        className="mb-4 flex min-h-8 items-start justify-between gap-3"
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
              className="min-w-0 wrap-anywhere font-semibold outline-none"
            >
              {titleText}
            </h1>
          </div>
          <div className="workspace-heading-meta">
            {showTodayMeta && (
              <span>
                {new Intl.DateTimeFormat(locale, {
                  month: "short",
                  day: "numeric",
                  weekday: "short",
                }).format(now)}
              </span>
            )}
            {taskCount !== undefined && (
              <span>
                {t(taskCount === 1 ? "1 个任务" : "{0} 个任务", taskCount)}
              </span>
            )}
            {currentProject &&
              !timePage &&
              !habitsPage &&
              !organizationPage &&
              !activeItem && (
                <span>
                  {currentProjectIsHabit
                    ? t("习惯项目")
                    : currentProjectFocus
                      ? t("焦点项目")
                      : t("稍后")}
                </span>
              )}
          </div>
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

        {showDisplayOptions && (
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

            {(currentProject || activeItem) && (
              <WorkspaceHeadingMenu
                open={viewMenuOpen}
                onOpenChange={setViewMenuOpen}
                currentProject={currentProject}
                organizationReady={organizationReady}
                disabled={disabled}
                activeEntry={activeEntry}
                activeItem={activeItem}
                currentProjectFocus={currentProjectFocus}
                currentProjectIsHabit={currentProjectIsHabit}
                projectOutcome={projectOutcome}
                projectDescription={projectDescription}
                onTransitionProject={onTransitionProject}
                onAddSubproject={onAddSubproject}
                onStartEditDesc={onStartEditDesc}
                onStartEditOutcome={onStartEditOutcome}
                onEditProject={onEditProject}
                onDeleteProject={onDeleteProject}
                onManageOrganization={onManageOrganization}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
