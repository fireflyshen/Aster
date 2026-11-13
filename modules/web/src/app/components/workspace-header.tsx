import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectIcon } from "@/features/projects/project-icon";
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
import {
  Columns3,
  List,
  PanelLeft,
  RotateCw,
  Search,
  Target,
} from "lucide-react";
import { ThemeSwitcher } from "../theme-switcher";
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
          <ThemeSwitcher />
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
  specialPage: boolean;
  organizationReady: boolean;
  organizationSaving: boolean;
  busy: boolean;
  activeEntry?: { kind: "filter" | "tag"; id: string };
  activeItem?: SavedFilter | SavedTag;
  currentProjectFocus?: SavedProject;
  projectOutcome?: string;
  projectDescription?: string;
  viewCounts: Partial<Record<View, number>>;
  viewMenuOpen: boolean;
  setViewMenuOpen: (open: boolean) => void;
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

/** View heading bar with breadcrumbs, Todoist count/subtitle, Focus toggle, and layout/options controls. */
export function WorkspaceHeading({
  view,
  now,
  currentProject,
  organizationPage,
  projectsPage,
  specialPage,
  organizationReady,
  organizationSaving,
  busy,
  activeEntry,
  activeItem,
  currentProjectFocus,
  projectOutcome,
  projectDescription,
  viewCounts,
  viewMenuOpen,
  setViewMenuOpen,
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
    view === "today" && !currentProject && !organizationPage && !activeItem;
  const showInboxCount =
    view === "pending" && !currentProject && !organizationPage && !activeItem;
  const titleText = organizationPage
    ? projectsPage
      ? "我的项目"
      : "过滤器&标签"
    : activeItem?.name ||
      (currentProject ? projectLeaf(currentProject) : views[view]);
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
            {currentProject && !organizationPage && !activeItem && (
              <ProjectIcon name={currentProject} className="size-5 shrink-0" />
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
            {currentProject && !organizationPage && !activeItem && (
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
            )}
          </div>
          {showTodayMeta && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {format(now, "M月d日 · EEEE", { locale: zhCN })}
            </p>
          )}
        </div>

        {!organizationPage && !specialPage && (
          <div className="workspace-view-controls flex shrink-0 items-center gap-1">
            <TabsList
              aria-label="布局模式"
              className="h-8 group-data-[orientation=horizontal]/tabs:h-8"
            >
              <TabsTrigger
                value="list"
                aria-label="列表视图"
                aria-keyshortcuts="B"
                disabled={disabled}
                className="gap-1.5 px-2 text-xs"
              >
                <List className="size-3.5" />
                <span className="hidden sm:inline">列表</span>
              </TabsTrigger>
              <TabsTrigger
                value="board"
                aria-label="看板视图"
                aria-keyshortcuts="B"
                disabled={disabled}
                className="gap-1.5 px-2 text-xs"
              >
                <Columns3 className="size-3.5" />
                <span className="hidden sm:inline">看板</span>
              </TabsTrigger>
            </TabsList>

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
