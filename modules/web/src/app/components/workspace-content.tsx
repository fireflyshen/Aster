import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { OrganizationManager } from "@/features/organization/organization-manager";
import { ProjectManager } from "@/features/projects/project-manager";
import {
  groupOptionsForContext,
  type TaskGroupBy,
  type TaskGroupContext,
} from "@/features/tasks/task-grouping";
import { useFilterGroupBy } from "../hooks/use-filter-group-by";
import { views } from "../workspace-sidebar";
import { taskDate } from "@core/tasks/quick-task";
import {
  isCompletedFilterExpression,
  isUrgencyBuiltinFilterId,
} from "@core/workspace/builtin-filters";
import { defaultBoard, type BoardChange } from "@core/workspace/board";
import { isHabitProject, type ProjectStatus } from "@core/workspace/focus";
import type {
  Organization,
  OrganizationChange,
  SavedFilter,
  SavedProject,
  SavedTag,
} from "@core/workspace/organization";
import type { Task, TaskInput, View } from "@shared/tasks";
import { Search, X } from "lucide-react";
import { lazy, Suspense, type MutableRefObject } from "react";
import type { TaskRenderFn } from "../hooks/use-task-renderer";
import type { ActiveEntry } from "../hooks/use-workspace-navigation";
import { ProjectInlineMeta } from "./project-inline-meta";
import { WorkspaceHeading } from "./workspace-header";
import {
  HabitsWorkspace,
  type HabitsWorkspaceController,
} from "@/features/habits/habits-workspace";
import {
  TodayHabitsSection,
  type TodayHabitsActions,
} from "@/features/habits/today-habits-section";
import { TimeLedgerWorkspace } from "@/features/time/time-ledger-workspace";
import type { TimePage } from "../hooks/use-workspace-navigation";
import type { TimerSnapshot } from "@core/time/model";
import { snapshotLiveStatus } from "@core/time/snapshot";

const TaskBoard = lazy(() =>
  import("@/features/tasks/task-board").then((module) => ({
    default: module.TaskBoard,
  })),
);

type WorkspaceContentProps = {
  searchOpen: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  layout: "list" | "board";
  onLayoutChange: (layout: "list" | "board") => void;
  completeBehavior?: import("../hooks/use-workspace-navigation").CompleteBehavior;
  onCompleteBehaviorChange?: (
    next: import("../hooks/use-workspace-navigation").CompleteBehavior,
  ) => void;
  boardScroll: MutableRefObject<number>;
  view: View;
  now: Date;
  currentProject: string;
  organizationPage: boolean;
  projectsPage: boolean;
  specialPage: boolean;
  organization: Organization;
  organizationError: string;
  organizationReady: boolean;
  organizationSaving: boolean;
  organizationBlocked: boolean;
  busy: boolean;
  loading: boolean;
  loaded: boolean;
  needsCheck: boolean;
  notice: string;
  boardDisabled: boolean;
  tasks: Task[];
  topLevelVisible: Task[];
  filterProjects: string[];
  activeEntry?: ActiveEntry;
  activeItem?: SavedFilter | SavedTag;
  currentProjectRecord?: SavedProject;
  currentProjectFocus?: SavedProject;
  projectOutcome?: string;
  projectDescription?: string;
  viewCounts: Partial<Record<View, number>>;
  viewMenuOpen: boolean;
  setViewMenuOpen: (open: boolean) => void;
  editingHeaderOutcome: boolean;
  setEditingHeaderOutcome: (open: boolean) => void;
  headerOutcomeDraft: string;
  setHeaderOutcomeDraft: (value: string) => void;
  editingHeaderDesc: boolean;
  setEditingHeaderDesc: (open: boolean) => void;
  headerDescDraft: string;
  setHeaderDescDraft: (value: string) => void;
  onSelectProject: (name: string) => void;
  onSelectView: (view: View) => void;
  onOpenEntry: (entry: ActiveEntry) => void;
  onOpenOrganization: () => void;
  onTransitionProject: (name: string, status: ProjectStatus) => void;
  onAddSubproject: (parentName: string) => void;
  onEditProject: (name: string) => void;
  onDeleteProject: (name: string) => void;
  onChangeOrganization: (change: OrganizationChange) => Promise<boolean>;
  onSaveProjectField: (
    name: string,
    patch: { outcome?: string; nextTask?: string },
  ) => Promise<boolean>;
  onLoadOrganization: () => Promise<Organization | undefined>;
  onClearOrganizationError: () => void;
  onChangeBoard: (change: BoardChange) => Promise<boolean>;
  onReloadBoard: () => Promise<Organization | undefined>;
  onReloadAll: () => Promise<Organization | undefined>;
  onRestoreEnergy: () => Promise<unknown>;
  onRescheduleOverdue: (overdueTasks: Task[], day: string) => Promise<void>;
  onOpenEditor: (
    task?: Task,
    initial?: TaskInput & { habitPreset?: boolean },
  ) => void;
  onMoveTask: (
    task: Task,
    columnId: string,
    beforeUuid?: string | null,
    parentUuid?: string | null,
  ) => Promise<boolean>;
  onCreateTaskInView: (
    input: TaskInput & { taskDescription?: string },
    columnId?: string,
  ) => Promise<boolean>;
  renderTask: TaskRenderFn;
  timePage: TimePage | null;
  isTimeMode: boolean;
  timerSnapshot?: TimerSnapshot | null;
  timerLiveStatus?: ReturnType<typeof snapshotLiveStatus> | null;
  activeActivitySeconds: number | undefined;
  onOpenTimePage: (page: TimePage) => void;
  onRefreshTimerSnapshot: () => Promise<unknown>;
  habitsPage: boolean;
  habitFormOpen: boolean;
  setHabitFormOpen: (open: boolean) => void;
  habitsController: HabitsWorkspaceController;
  todayHabitsActions: TodayHabitsActions;
};

/** Renders workspace header, active alert notices, search bar, management pages, and unified task view. */
export function WorkspaceContent(props: WorkspaceContentProps) {
  const {
    searchOpen,
    query,
    onQueryChange,
    layout,
    onLayoutChange,
    boardScroll,
    completeBehavior,
    onCompleteBehaviorChange,
    view,
    now,
    currentProject,
    organizationPage,
    projectsPage,
    specialPage,
    organization,
    organizationError,
    organizationReady,
    organizationSaving,
    organizationBlocked,
    busy,
    loading,
    loaded,
    needsCheck,
    notice,
    boardDisabled,
    tasks,
    topLevelVisible,
    filterProjects,
    activeEntry,
    activeItem,
    currentProjectRecord,
    currentProjectFocus,
    projectOutcome,
    projectDescription,
    viewCounts,
    viewMenuOpen,
    setViewMenuOpen,
    editingHeaderOutcome,
    setEditingHeaderOutcome,
    headerOutcomeDraft,
    setHeaderOutcomeDraft,
    editingHeaderDesc,
    setEditingHeaderDesc,
    headerDescDraft,
    setHeaderDescDraft,
    onSelectProject,
    onSelectView,
    onOpenEntry,
    onOpenOrganization,
    onTransitionProject,
    onAddSubproject,
    onEditProject,
    onDeleteProject,
    onChangeOrganization,
    onSaveProjectField,
    onLoadOrganization,
    onClearOrganizationError,
    onChangeBoard,
    onReloadBoard,
    onReloadAll,
    onRestoreEnergy,
    onRescheduleOverdue,
    onOpenEditor,
    onMoveTask,
    onCreateTaskInView,
    renderTask,
    timePage,
    isTimeMode,
    timerSnapshot,
    timerLiveStatus,
    activeActivitySeconds,
    onOpenTimePage,
    onRefreshTimerSnapshot,
    habitsPage,
    habitFormOpen,
    setHabitFormOpen,
    habitsController,
    todayHabitsActions,
  } = props;

  const isCompletedFilter = Boolean(
    activeEntry?.kind === "filter" &&
    activeItem &&
    "expression" in activeItem &&
    isCompletedFilterExpression(activeItem.expression),
  );
  const isProjectOwned =
    !activeEntry && (Boolean(currentProject) || view === "pending");
  const groupContext: TaskGroupContext =
    !activeEntry && !currentProject && view === "today"
      ? "today"
      : isCompletedFilter && !currentProject
        ? "completed"
        : "default";
  const defaultGroupBy: TaskGroupBy =
    groupContext === "today"
      ? "today"
      : groupContext === "completed"
        ? "completed"
        : "none";
  const groupOptions = groupOptionsForContext(groupContext);
  const [groupBy, setGroupBy] = useFilterGroupBy(
    activeEntry
      ? `${activeEntry.kind}:${activeEntry.item.id}`
      : !isProjectOwned
        ? `view:${view}`
        : undefined,
    defaultGroupBy,
    groupOptions,
  );
  const virtualGroupTitle = activeEntry
    ? activeItem && "expression" in activeItem
      ? activeItem.expression
      : activeItem?.name || (activeEntry.kind === "filter" ? "过滤器" : "标签")
    : views[view];

  const activeLayout =
    !organizationPage && !timePage && !habitsPage && layout === "board"
      ? "board"
      : "list";
  const excludedHabitTaskUuids = new Set(
    habitsController.habitByTaskUuid?.keys() || [],
  );
  const taskByUuid = new Map(tasks.map((item) => [item.uuid, item]));
  const todayHabitTasks = (habitsController.todayData?.items || [])
    .map((item) =>
      item.habit.taskUuid ? taskByUuid.get(item.habit.taskUuid) : undefined,
    )
    .filter((item): item is Task => Boolean(item));
  const isDefaultTodayView =
    view === "today" && !currentProject && !activeEntry;
  const visibleTasksForBoard = isDefaultTodayView
    ? topLevelVisible.filter((item) => !excludedHabitTaskUuids.has(item.uuid))
    : topLevelVisible;

  return (
    <main
      className="workspace-frame workspace-content pb-16 pt-2"
      data-layout={activeLayout}
    >
      {searchOpen && (
        <div className="mb-3 max-w-sm">
          <InputGroup>
            <InputGroupAddon>
              <Search className="size-3.5 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              id="task-search"
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="搜索任务..."
              aria-label="搜索任务"
            />
            {query && (
              <InputGroupButton
                size="icon-xs"
                variant="ghost"
                aria-label="清除搜索"
                onClick={() => onQueryChange("")}
              >
                <X className="size-3.5" />
              </InputGroupButton>
            )}
          </InputGroup>
        </div>
      )}

      <Tabs
        value={layout}
        onValueChange={(next) =>
          onLayoutChange(next === "board" ? "board" : "list")
        }
      >
        <WorkspaceHeading
          view={view}
          now={now}
          currentProject={currentProject}
          organizationPage={organizationPage}
          projectsPage={projectsPage}
          timePage={timePage}
          habitsPage={habitsPage}
          specialPage={specialPage}
          organizationReady={organizationReady}
          organizationSaving={organizationSaving}
          busy={busy}
          activeEntry={
            activeEntry
              ? {
                  kind: activeEntry.kind,
                  id: activeEntry.item.id,
                }
              : undefined
          }
          activeItem={activeItem}
          activeCount={topLevelVisible.length}
          groupBy={!isProjectOwned ? groupBy : undefined}
          groupOptions={!isProjectOwned ? groupOptions : undefined}
          onGroupByChange={!isProjectOwned ? setGroupBy : undefined}
          onResetDisplay={() => {
            onLayoutChange("list");
            setGroupBy(defaultGroupBy);
            onCompleteBehaviorChange?.("hide");
          }}
          currentProjectFocus={currentProjectFocus}
          currentProjectIsHabit={Boolean(
            currentProject &&
            isHabitProject(currentProject, organization.projects),
          )}
          projectOutcome={projectOutcome}
          projectDescription={projectDescription}
          viewCounts={viewCounts}
          viewMenuOpen={viewMenuOpen}
          setViewMenuOpen={setViewMenuOpen}
          completeBehavior={completeBehavior}
          onCompleteBehaviorChange={onCompleteBehaviorChange}
          onSelectProject={onSelectProject}
          onSelectView={onSelectView}
          onTransitionProject={onTransitionProject}
          onAddSubproject={onAddSubproject}
          onStartEditDesc={() => {
            setHeaderDescDraft(projectDescription || "");
            setEditingHeaderDesc(true);
          }}
          onStartEditOutcome={() => {
            setHeaderOutcomeDraft(projectOutcome || "");
            setEditingHeaderOutcome(true);
          }}
          onEditProject={onEditProject}
          onDeleteProject={onDeleteProject}
          onManageOrganization={onOpenOrganization}
        />

        {currentProject && !organizationPage && !timePage && (
          <ProjectInlineMeta
            currentProject={currentProject}
            revision={organization.revision}
            currentProjectRecord={currentProjectRecord}
            isFocus={Boolean(currentProjectFocus)}
            disabled={busy || organizationSaving || !organizationReady}
            editingOutcome={editingHeaderOutcome}
            setEditingOutcome={setEditingHeaderOutcome}
            outcomeDraft={headerOutcomeDraft}
            setOutcomeDraft={setHeaderOutcomeDraft}
            editingDesc={editingHeaderDesc}
            setEditingDesc={setEditingHeaderDesc}
            descDraft={headerDescDraft}
            setDescDraft={setHeaderDescDraft}
            onSaveProject={onChangeOrganization}
          />
        )}

        {notice && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>{notice}</span>
              <div className="flex items-center gap-2">
                {organization.timing?.hardEnergyLimit !== false &&
                  organization.timing?.backend !== "time" &&
                  /energy exhausted|精力已耗尽/i.test(notice) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={organizationSaving}
                      onClick={() => void onRestoreEnergy()}
                    >
                      恢复 +30 精力
                    </Button>
                  )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={loading || busy}
                  onClick={() => void onReloadAll()}
                >
                  {needsCheck ? "刷新并检查" : "重试"}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {habitsPage ? (
          <HabitsWorkspace
            controller={habitsController}
            tasks={tasks}
            projects={filterProjects}
            availableLabels={organization.tags}
            formOpen={habitFormOpen}
            onFormOpenChange={setHabitFormOpen}
            onOpenNewHabit={() =>
              onOpenEditor(undefined, {
                description: "",
                tags: [],
                habitPreset: true,
              })
            }
            onOpenEditTask={(task) => onOpenEditor(task)}
          />
        ) : timePage ? (
          <TimeLedgerWorkspace
            page={timePage}
            tasks={tasks}
            projects={filterProjects}
            availableLabels={organization.tags}
            timerSnapshot={timerSnapshot}
            timerLiveStatus={timerLiveStatus}
            activeActivitySeconds={activeActivitySeconds}
            isTimeMode={isTimeMode}
            onOpenPage={onOpenTimePage}
            onTimeMutated={() => {
              void onRefreshTimerSnapshot();
              void onReloadAll();
            }}
          />
        ) : organizationPage ? (
          projectsPage ? (
            <ProjectManager
              data={organization}
              projects={filterProjects}
              error={organizationError}
              loading={loading}
              disabled={boardDisabled}
              onOpen={onSelectProject}
              onAdd={() => onEditProject("")}
              onAddChild={onAddSubproject}
              onEdit={onEditProject}
              onDelete={onDeleteProject}
              onStatus={onTransitionProject}
              onReload={() => void onLoadOrganization()}
            />
          ) : (
            <OrganizationManager
              data={organization}
              error={organizationError}
              busy={organizationSaving}
              loading={loading}
              blocked={organizationBlocked || needsCheck}
              onChange={onChangeOrganization}
              onOpen={onOpenEntry}
              onReload={onLoadOrganization}
            />
          )
        ) : (
          <TabsContent value={layout} className="mt-0 min-w-0">
            {view === "today" &&
              !currentProject &&
              !activeEntry &&
              !(layout === "list" && groupBy === "today") &&
              habitsController.todayData &&
              habitsController.todayData.items.length > 0 && (
                <div className="mb-4">
                  <TodayHabitsSection
                    todayData={habitsController.todayData}
                    todayHabitTasks={todayHabitTasks}
                    renderTask={renderTask}
                    availableLabels={organization.tags}
                    actions={todayHabitsActions}
                    disabled={boardDisabled}
                  />
                </div>
              )}
            <Suspense
              fallback={
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-4" />
                  {layout === "board" ? "加载看板…" : "加载列表…"}
                </div>
              }
            >
              <TaskBoard
                layout={layout}
                initialScrollLeft={boardScroll.current}
                onScrollPositionChange={(position) => {
                  boardScroll.current = position;
                }}
                tasks={visibleTasksForBoard}
                allTasks={tasks}
                board={organization.board || defaultBoard()}
                revision={organization.revision}
                saving={organizationSaving}
                blocked={
                  organizationBlocked || needsCheck || !organizationReady
                }
                error={organizationError}
                onChange={onChangeBoard}
                onReload={onReloadBoard}
                onClearError={onClearOrganizationError}
                loading={loading}
                loaded={loaded}
                disabled={boardDisabled}
                renderTask={renderTask}
                onMove={(task, columnId, beforeUuid, parentUuid) =>
                  onMoveTask(task, columnId, beforeUuid, parentUuid)
                }
                onCreateTask={onCreateTaskInView}
                projects={filterProjects}
                availableLabels={organization.tags}
                project={currentProject}
                defaultProject={currentProject}
                defaultDue={view === "today" ? taskDate(new Date()) : ""}
                todaySplit={
                  layout === "list" &&
                  view === "today" &&
                  !currentProject &&
                  !activeEntry &&
                  groupBy === "today"
                }
                preserveTaskOrder={Boolean(
                  activeEntry?.kind === "filter" &&
                  isUrgencyBuiltinFilterId(activeEntry.item.id) &&
                  !currentProject,
                )}
                virtualGroupBy={!isProjectOwned ? groupBy : undefined}
                virtualGroupTitle={virtualGroupTitle}
                onRescheduleOverdue={
                  view === "today" && !currentProject && !activeEntry
                    ? onRescheduleOverdue
                    : undefined
                }
                canAddTask={
                  !isCompletedFilter &&
                  (!activeEntry || activeEntry.kind === "tag")
                }
                canAddSection={isProjectOwned && !isCompletedFilter}
                hasSearch={Boolean(query.trim())}
                onClearSearch={() => onQueryChange("")}
                onAdd={(nextDraft) => onOpenEditor(undefined, nextDraft)}
                todayHabits={{
                  todayData: habitsController.todayData,
                  todayHabitTasks,
                  excludedTaskUuids: excludedHabitTaskUuids,
                  actions: todayHabitsActions,
                }}
              />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>
    </main>
  );
}
