import { OrganizationIcon, TodayCalendarIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { EnergySummary } from "@core/workspace/energy";
import type { TimerSnapshot } from "@core/time/model";
import type { snapshotLiveStatus } from "@core/time/snapshot";
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
  Asterisk,
  BarChart3,
  Check,
  ChevronDown,
  Clock,
  DatabaseBackup,
  FolderKanban,
  Inbox,
  PanelLeft,
  Plus,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { useState } from "react";
import type {
  CompleteBehavior,
  TimePage,
} from "./hooks/use-workspace-navigation";
import {
  SidebarEnergyMeter,
  SidebarFavorites,
  SidebarProjectsSection,
} from "./sidebar-sections";
import { WorkspaceNavigation } from "./workspace-navigation";

export const views: Record<View, string> = {
  focus: "Focus",
  pending: "收件箱",
  today: "今天",
};

const viewOrder: View[] = ["focus", "pending", "today"];

const viewMeta: Record<
  View,
  {
    icon: React.ComponentType<{ className?: string }>;
    colorClass: string;
  }
> = {
  focus: {
    icon: Target,
    colorClass: "text-(--due-tomorrow)",
  },
  pending: {
    icon: Inbox,
    colorClass: "text-(--priority-3)",
  },
  today: {
    icon: TodayCalendarIcon,
    colorClass: "text-(--due-today)",
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
  timerSnapshot?: TimerSnapshot;
  timerLiveStatus?: ReturnType<typeof snapshotLiveStatus>;
  activeActivitySeconds?: number;
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
  completeBehavior?: CompleteBehavior;
  onCompleteBehaviorChange?: (next: CompleteBehavior) => void;
  timePage?: TimePage | null;
  onOpenTimePage?: (page: TimePage) => void;
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
  timerSnapshot,
  timerLiveStatus,
  activeActivitySeconds,
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
  completeBehavior = "hide",
  onCompleteBehaviorChange,
  timePage = null,
  onOpenTimePage,
}: WorkspaceSidebarProps) {
  const [laterCollapsed, setLaterCollapsed] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
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
        <Popover open={prefsOpen} onOpenChange={setPrefsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="工作区偏好设置"
              className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-navigation-hover outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Asterisk className="size-[18px]" strokeWidth={1.8} />
              </span>
              <span className="text-sm font-semibold tracking-tight text-foreground">
                Aster
              </span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1.5">
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
              点击完成任务后
            </div>
            <Button
              type="button"
              variant="navigation"
              className="h-8 w-full justify-between px-2 text-xs font-normal"
              onClick={() => {
                onCompleteBehaviorChange?.("hide");
                setPrefsOpen(false);
              }}
            >
              <span>让任务消失</span>
              <Check
                className={cn(
                  "size-3.5",
                  completeBehavior !== "hide" && "invisible",
                )}
              />
            </Button>
            <Button
              type="button"
              variant="navigation"
              className="h-8 w-full justify-between px-2 text-xs font-normal"
              onClick={() => {
                onCompleteBehaviorChange?.("strikethrough");
                setPrefsOpen(false);
              }}
            >
              <span>保留并加删除线</span>
              <Check
                className={cn(
                  "size-3.5",
                  completeBehavior !== "strikethrough" && "invisible",
                )}
              />
            </Button>
          </PopoverContent>
        </Popover>
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
        onClick={() => {
          closeOnMobile();
          onAdd();
        }}
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
        onClick={() => {
          closeOnMobile();
          onSearch();
        }}
        aria-keyshortcuts="Meta+K Control+K"
        className="sidebar-search"
      >
        <Search className="size-[18px]" strokeWidth={1.5} />
        搜索
        <kbd className="ml-auto text-[11px] text-muted-foreground">⌘K</kbd>
      </Button>
      <section className="mt-4" aria-label="核心视图">
        <p className="mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">
          核心视图
        </p>
        <nav aria-label="核心视图" className="space-y-0.5">
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
                  !hasActiveItem &&
                  !timePage
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
        </nav>
      </section>
      {onOpenTimePage && (
        <section className="mt-6" aria-label="时间账本">
          <p className="mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">
            时间账本
          </p>
          <nav className="flex flex-col gap-0.5">
            <Button
              variant="navigation"
              aria-current={timePage === "today" ? "page" : undefined}
              disabled={disabled}
              onClick={() => {
                onOpenTimePage("today");
                closeOnMobile();
              }}
            >
              <Clock className="size-[18px] text-primary" />
              <span className="flex-1 truncate text-left">今日时间线</span>
              {timerSnapshot?.state === "pending_reconcile" && (
                <span
                  aria-label="有待核对的计时"
                  className="size-2 shrink-0 rounded-full bg-amber-500"
                />
              )}
            </Button>
            <Button
              variant="navigation"
              aria-current={timePage === "weekly" ? "page" : undefined}
              disabled={disabled}
              onClick={() => {
                onOpenTimePage("weekly");
                closeOnMobile();
              }}
            >
              <BarChart3 className="size-[18px] text-muted-foreground" />
              本周分布
            </Button>
            <Button
              variant="navigation"
              aria-current={timePage === "reports" ? "page" : undefined}
              disabled={disabled}
              onClick={() => {
                onOpenTimePage("reports");
                closeOnMobile();
              }}
            >
              <ReceiptText className="size-[18px] text-muted-foreground" />
              成本报告
            </Button>
            <Button
              variant="navigation"
              aria-current={timePage === "settings" ? "page" : undefined}
              disabled={disabled}
              onClick={() => {
                onOpenTimePage("settings");
                closeOnMobile();
              }}
            >
              <SlidersHorizontal className="size-[18px] text-muted-foreground" />
              时间设置
            </Button>
          </nav>
        </section>
      )}
      <SidebarFavorites
        organization={organization}
        organizationPage={organizationPage}
        activeEntry={activeEntry}
        disabled={disabled}
        onEntry={(entry) => {
          closeOnMobile();
          onEntry(entry);
        }}
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
        onAddProject={() => {
          closeOnMobile();
          onAddProject();
        }}
        onAddSubproject={(name) => {
          closeOnMobile();
          onAddSubproject(name);
        }}
        onEditProject={(name) => {
          closeOnMobile();
          onEditProject(name);
        }}
        onDeleteProject={(name) => {
          closeOnMobile();
          onDeleteProject(name);
        }}
        onProjectStatus={(name, status) => {
          closeOnMobile();
          onProjectStatus(name, status);
        }}
        onSelectProject={(name) => {
          onProject(name);
          closeOnMobile();
        }}
      />
      <section className="mt-6" aria-label="工具">
        <p className="mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">
          工具
        </p>
        <nav aria-label="工具" className="space-y-0.5">
          <Button
            variant="navigation"
            aria-current={organizationPage && projectsPage ? "page" : undefined}
            disabled={disabled}
            onClick={() => {
              onProjects();
              closeOnMobile();
            }}
          >
            <FolderKanban className="size-[18px]" />
            项目管理
          </Button>
          <Button
            variant="navigation"
            aria-current={
              organizationPage && !projectsPage ? "page" : undefined
            }
            disabled={disabled}
            onClick={() => {
              onOrganization();
              closeOnMobile();
            }}
          >
            <OrganizationIcon className="size-[18px]" />
            过滤器 &amp; 标签
          </Button>
          <Button
            variant="navigation"
            onClick={() => {
              onRecovery();
              closeOnMobile();
            }}
            disabled={disabled}
          >
            <DatabaseBackup className="size-[18px]" />
            数据与恢复
          </Button>
        </nav>
      </section>
      <SidebarEnergyMeter
        energy={energy}
        timing={organization.timing}
        timerSnapshot={timerSnapshot}
        timerLiveStatus={timerLiveStatus}
        activeActivitySeconds={activeActivitySeconds}
        timingUnavailable={timingUnavailable}
        disabled={disabled}
        busy={busy}
        onRetryTiming={onRetryTiming}
        onElixir={onElixir}
      />
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
