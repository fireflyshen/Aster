import { useI18n } from "@/app/language";
import {
  type SidebarItemId,
  type SidebarPreferences,
} from "./sidebar-preferences";
import type { SettingsSection } from "./workspace-settings";
import {
  AsterMark,
  AddTaskIcon,
  FocusNavIcon,
  InboxNavIcon,
  TodayNavIcon,
  UpcomingNavIcon,
  HabitsNavIcon,
  LedgerNavIcon,
  SidebarToggleIcon,
  OrganizationIcon,
} from "@/components/icons";
import type { OrganizationEntry } from "@/features/organization/organization-types";
import { Button } from "@/components/ui/button";
import type { EnergySummary } from "@core/workspace/energy";
import type { TimerSnapshot } from "@core/time/model";
import type { snapshotLiveStatus } from "@core/time/snapshot";
import {
  FOCUS_LIMIT,
  isCompletedProject,
  projectStatus,
  type ProjectStatus,
} from "@core/workspace/focus";
import { normalizeDoingLimit } from "@core/tasks/state";
import type {
  Organization,
  OrganizationChange,
  SavedFilter,
  SavedTag,
} from "@core/workspace/organization";
import type { View } from "@shared/tasks";
import { cn } from "cn";
import { isWideWorkspace } from "@/lib/use-desktop";
import { PlayCircle, Search } from "lucide-react";
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
  now: "现在能做",
  focus: "Focus",
  pending: "收件箱",
  today: "今天",
  upcoming: "预览",
};

const viewOrder: View[] = ["now", "focus", "pending", "today", "upcoming"];

const viewMeta: Record<View, React.ComponentType<{ className?: string }>> = {
  now: PlayCircle,
  focus: FocusNavIcon,
  pending: InboxNavIcon,
  upcoming: UpcomingNavIcon,
  today: TodayNavIcon,
};

const viewIconColor: Record<View, string> = {
  now: "text-primary",
  focus: "text-(--due-tomorrow)",
  pending: "text-(--priority-3)",
  today: "text-(--due-today)",
  upcoming: "text-(--due-upcoming)",
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
  addDisabled: boolean;
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
  onEditEntry: (entry: OrganizationEntry) => void;
  onChangeOrganization: (change: OrganizationChange) => Promise<boolean>;
  onEntry: (entry: {
    kind: "filter" | "tag";
    item: SavedFilter | SavedTag;
  }) => void;
  onView: (view: View) => void;
  onProject: (project: string) => void;
  onOrganization: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
  sidebarPreferences: SidebarPreferences;
  timePage?: TimePage | null;
  onOpenTimePage?: (page: TimePage) => void;
  habitsPage?: boolean;
  habitsCount?: number;
  onOpenHabitsPage?: () => void;
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
  addDisabled,
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
  onEditEntry,
  onChangeOrganization,
  onView,
  onProject,
  onOrganization,
  onOpenSettings,
  sidebarPreferences,
  timePage = null,
  onOpenTimePage,
  habitsPage = false,
  habitsCount,
  onOpenHabitsPage,
}: WorkspaceSidebarProps) {
  const { t } = useI18n();
  const disabled = busy || organizationSaving;
  const isSidebarVisible = (id: SidebarItemId) =>
    !sidebarPreferences.hidden.includes(id);
  const closeOnMobile = () => {
    if (!isWideWorkspace()) onOpenChange(false);
  };
  const workViews = viewOrder.filter(isSidebarVisible);
  const showHabits = Boolean(onOpenHabitsPage && isSidebarVisible("habits"));
  const showTime = Boolean(onOpenTimePage && isSidebarVisible("time"));
  const showOrganization = isSidebarVisible("organization");
  const activeRoots = (organization.projects || [])
    .filter((p) => projectStatus(p) === "active")
    .map((p) => p.name);
  const visibleProjects = projects.filter(
    (name) => !isCompletedProject(name, organization.projects),
  );
  const doingLimit = normalizeDoingLimit(organization.preferences?.doingLimit);

  return (
    <>
      <WorkspaceNavigation
        open={navOpen}
        onOpenChange={onOpenChange}
        showCounts={sidebarPreferences.showCounts}
      >
        <div className="sidebar-account flex h-14 items-center justify-between px-1">
          <button
            type="button"
            aria-label={t("打开设置")}
            onClick={() => {
              closeOnMobile();
              onOpenSettings("theme");
            }}
            className="sidebar-brand"
          >
            <AsterMark className="size-7" />
            <span>Aster</span>
            <svg
              viewBox="0 0 16 16"
              className="size-3 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
          <Button
            id="sidebar-close"
            variant="ghost"
            size="icon-xs"
            aria-label={t("隐藏侧边栏")}
            title={t("收起侧边栏")}
            className="size-7 text-muted-foreground hover:bg-navigation-hover hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            <SidebarToggleIcon className="size-5" />
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            closeOnMobile();
            onAdd();
          }}
          disabled={addDisabled}
          aria-keyshortcuts="Q"
          className="sidebar-add h-9 w-full justify-start gap-2.5 px-2 font-semibold text-(--navigation-selected-ink) hover:bg-navigation-hover hover:text-(--navigation-selected-ink) has-[>svg]:px-2"
        >
          <AddTaskIcon className="size-5 shrink-0" />
          {t("添加任务")}
          <kbd
            aria-hidden="true"
            className="ml-auto rounded border border-border/80 bg-background/80 px-1.5 py-0.5 font-sans text-[11px] leading-none text-muted-foreground"
          >
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
          {t("搜索")}
          <kbd className="ml-auto text-[11px] text-muted-foreground">⌘K</kbd>
        </Button>
        {workViews.length > 0 && (
          <nav aria-label={t("任务")} className="sidebar-nav-section">
            <p className="sidebar-nav-label">{t("任务")}</p>
            {workViews.map((value) => {
              const label = t(views[value]);
              const Icon = viewMeta[value];
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
                    !timePage &&
                    !habitsPage
                      ? "page"
                      : undefined
                  }
                  onClick={() => {
                    onView(value);
                    closeOnMobile();
                  }}
                >
                  <Icon
                    className={cn("size-[18px] shrink-0", viewIconColor[value])}
                  />
                  <span className="truncate">{label}</span>
                  {value === "now" ? (
                    <span
                      data-sidebar-count
                      className="ml-auto text-xs text-muted-foreground tabular-nums"
                    >
                      {count ?? 0}/{doingLimit}
                    </span>
                  ) : value === "focus" ? (
                    <span
                      data-sidebar-count
                      className="ml-auto text-xs text-muted-foreground tabular-nums"
                    >
                      {activeRoots.length}/{FOCUS_LIMIT}
                    </span>
                  ) : count ? (
                    <span
                      data-sidebar-count
                      className="ml-auto text-xs text-muted-foreground tabular-nums"
                    >
                      {count}
                    </span>
                  ) : null}
                </Button>
              );
            })}
          </nav>
        )}
        {(showHabits || showTime || showOrganization) && (
          <nav aria-label={t("工具")} className="sidebar-nav-section">
            <p className="sidebar-nav-label">{t("工具")}</p>
            {showHabits && onOpenHabitsPage && (
              <Button
                variant="navigation"
                disabled={disabled}
                aria-current={habitsPage ? "page" : undefined}
                onClick={() => {
                  onOpenHabitsPage();
                  closeOnMobile();
                }}
              >
                <HabitsNavIcon className="size-[18px] shrink-0 text-(--habit-accent)" />
                <span className="truncate">{t("习惯")}</span>
                {habitsCount ? (
                  <span
                    data-sidebar-count
                    className="ml-auto text-xs text-muted-foreground tabular-nums"
                  >
                    {habitsCount}
                  </span>
                ) : null}
              </Button>
            )}
            {showTime && onOpenTimePage && (
              <Button
                variant="navigation"
                aria-current={
                  timePage && timePage !== "settings" ? "page" : undefined
                }
                disabled={disabled}
                onClick={() => {
                  onOpenTimePage("today");
                  closeOnMobile();
                }}
              >
                <LedgerNavIcon className="sidebar-ledger-icon size-[18px]" />
                <span className="flex-1 text-left">{t("时间账本")}</span>
                {timerSnapshot?.state === "pending_reconcile" && (
                  <span
                    aria-label={t("有待核对的计时")}
                    className="size-2 shrink-0 rounded-full bg-amber-500"
                  />
                )}
              </Button>
            )}
            {showOrganization && (
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
                <OrganizationIcon className="size-[18px] text-(--priority-2)" />
                {t("过滤器 &amp; 标签")}
              </Button>
            )}
          </nav>
        )}
        <SidebarFavorites
          onEditEntry={(entry) => {
            closeOnMobile();
            onEditEntry(entry);
          }}
          onChange={onChangeOrganization}
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
          projects={visibleProjects}
          disabled={disabled}
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
        {connectionLabel !== "本地已连接" && (
          <p
            className={cn(
              "px-2.5 pb-2 text-xs text-muted-foreground",
              energy ? "mt-3" : "mt-6",
            )}
          >
            {connectionLabel}
          </p>
        )}
      </WorkspaceNavigation>
    </>
  );
}
