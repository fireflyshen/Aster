import type { HabitTaskActions } from "@/features/habits/habit-task-controls";
import { currentLocalTodayDate } from "@/features/habits/task-habit-field";
import type { HabitListItem } from "@core/habits/model";
import { useHabitsWorkspace } from "@/features/habits/use-habits";
import type { OrganizationEntry } from "@/features/organization/organization-types";
import { useEffect, useMemo, useState } from "react";
import { isCompletedFilterExpression } from "@core/tasks/filter";
import { normalizeDoingLimit } from "@core/tasks/state";
import { ProjectColorsProvider } from "@/features/projects/project-icon";
import { WorkspaceContent } from "./components/workspace-content";
import { WorkspaceToolbar } from "./components/workspace-header";
import { WorkspaceModals } from "./components/workspace-modals";
import { FilterGroupByProvider } from "./hooks/use-filter-group-by";
import { useProjectActions } from "./hooks/use-project-actions";
import { useTaskActions } from "./hooks/use-task-actions";
import { useTaskRenderer } from "./hooks/use-task-renderer";
import { useTaskStateActions } from "./hooks/use-task-state-actions";
import {
  DoingLimitDialog,
  WaitingReasonDialog,
} from "@/features/tasks/state-dialogs";
import {
  useModalOpenSync,
  useWorkspaceDerivedState,
  useWorkspaceHierarchy,
} from "./hooks/use-workspace-computed";
import { useWorkspaceData } from "./hooks/use-workspace-data";
import { useWorkspaceNavigation } from "./hooks/use-workspace-navigation";
import { useWorkspaceShortcuts } from "./hooks/use-workspace-shortcuts";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { useSidebarPreferences } from "./sidebar-preferences";
import { useThemePreference } from "./theme-switcher";
import { MobileNavigation } from "./components/mobile-navigation";
import { useVisualViewport } from "./hooks/use-visual-viewport";

/** Root workspace application coordinating navigation, data hooks, main canvas, and dialogs. */
export function App() {
  useVisualViewport();
  const [organizationEditRequest, setOrganizationEditRequest] =
    useState<OrganizationEntry>();
  const nav = useWorkspaceNavigation();
  const data = useWorkspaceData({
    scope: nav.scope,
    isModalOpen:
      nav.commandOpen || Boolean(nav.settingsSection) || nav.subModalOpen,
    onProjectRemap: nav.onProjectRemap,
  });
  const sidebar = useSidebarPreferences(
    data.organization.preferences,
    data.updatePreferences,
  );
  const themePreference = useThemePreference(
    data.organization.preferences,
    data.updatePreferences,
  );
  useEffect(() => {
    nav.bindPreferences(data.organization.preferences, data.updatePreferences);
  }, [
    nav.bindPreferences,
    data.organization.preferences,
    data.updatePreferences,
  ]);

  const workspaceSyncKey = useMemo(
    () =>
      `${data.organization.revision}:${data.tasks
        .map(
          (t) =>
            `${t.uuid}:${t.status}:${t.description}:${t.project || ""}:${t.tags.join(",")}`,
        )
        .join("|")}`,
    [data.organization.revision, data.tasks],
  );
  const [habitFormOpen, setHabitFormOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitListItem | null>(null);
  const habits = useHabitsWorkspace({
    habitsPageActive: nav.habitsPage,
    isTodayView: false,
    workspaceSyncKey,
  });
  const habitTaskUuids = useMemo(
    () => new Set(habits.habitByTaskUuid.keys()),
    [habits.habitByTaskUuid],
  );

  const {
    activeItem,
    activeTagName,
    subtasksMap,
    taskLinks,
    isSubtask,
    filterProjects,
    viewCounts,
  } = useWorkspaceHierarchy({
    activeEntry: nav.activeEntry,
    organization: data.organization,
    tasks: data.tasks,
    projects: data.projects,
    habitUuids: habitTaskUuids,
    isPartialScope: nav.scope.startsWith("filter="),
  });

  const completedView = Boolean(
    nav.activeEntry?.kind === "filter" &&
    activeItem &&
    "expression" in activeItem &&
    isCompletedFilterExpression(activeItem.expression),
  );

  const stateActions = useTaskStateActions({
    tasks: data.tasks,
    writeLock: data.writeLock,
    needsCheck: data.needsCheck,
    setNotice: data.setNotice,
    reloadAll: data.reloadAll,
  });

  const taskActions = useTaskActions({
    view: nav.view,
    completedView,
    completeBehavior: nav.completeBehavior,
    currentProject: nav.currentProject,
    activeTagName,
    tasks: data.tasks,
    setTasks: data.setTasks,
    organization: data.organization,
    setOrganization: data.setOrganization,
    organizationReady: data.organizationReady,
    organizationSaving: data.organizationSaving,
    organizationBlocked: data.organizationBlocked,
    loading: data.loading,
    busy: data.busy,
    needsCheck: data.needsCheck,
    energy: data.energy,
    isTimingTask: data.isTimingTask,
    writeLock: data.writeLock,
    isSubtask,
    setNotice: data.setNotice,
    mutate: data.mutate,
    changeOrganization: data.changeOrganization,
    reloadAll: data.reloadAll,
    onDoingLimit: stateActions.openDoingLimitReplace,
  });

  const projectActions = useProjectActions({
    currentProject: nav.currentProject,
    organization: data.organization,
    setOrganizationError: data.setOrganizationError,
    setNavOpen: nav.setNavigation,
    changeOrganization: data.changeOrganization,
  });

  const openEditHabit = (habit: HabitListItem) => {
    if (habit.taskUuid) {
      const linkedTask = data.tasks.find((t) => t.uuid === habit.taskUuid);
      if (linkedTask) {
        taskActions.openEditor(linkedTask);
        return;
      }
    }
    setEditingHabit(habit);
    setHabitFormOpen(true);
  };

  const habitTaskActions = useMemo<HabitTaskActions>(
    () => ({
      togglePositive: habits.togglePositive,
      setChecklistItem: habits.setChecklistItem,
      switchPlan: habits.switchPlan,
      recordNegative: habits.recordNegative,
      undoNegative: habits.undoNegative,
      setDailyNote: habits.setDailyNote,
      setStatus: habits.setHabitStatus,
      assignSubtaskPlan: (parentHabit, subtaskUuid, planKey) =>
        habits.bindTaskHabit({
          taskUuid: parentHabit.taskUuid || parentHabit.id,
          kind: parentHabit.kind,
          trackTime: parentHabit.trackTime,
          schedule: parentHabit.schedule,
          abEnabled: parentHabit.abEnabled,
          subtaskPlans: {
            ...(parentHabit.subtaskPlans || {}),
            [subtaskUuid]: planKey,
          },
        }),
      openDetail: (habitId) => {
        habits.setDetailId(habitId);
      },
    }),
    [habits],
  );

  useModalOpenSync(
    [
      taskActions.open,
      taskActions.quickOpen,
      Boolean(taskActions.seriesUuid),
      Boolean(projectActions.editingProject),
      projectActions.focusPickerOpen,
      Boolean(projectActions.transitionProject),
      Boolean(projectActions.deletingProject),
      habitFormOpen,
      Boolean(habits.detailId),
    ],
    nav.setSubModalOpen,
  );

  useWorkspaceShortcuts({
    open: taskActions.open,
    commandOpen: nav.commandOpen,
    quickOpen: taskActions.quickOpen,
    canChangeLayout: nav.canChangeLayout,
    busy: data.busy,
    organizationSaving: data.organizationSaving,
    searchOpen: nav.searchOpen,
    setCommandOpen: nav.setCommandOpen,
    setLayout: nav.setLayout,
    setNavOpen: nav.setNavigation,
    openSearch: nav.openSearch,
    closeSearch: nav.closeSearch,
    openQuickAdd: taskActions.openQuickAdd,
  });

  const completingUuid =
    taskActions.completion?.phase === "leaving"
      ? taskActions.completion.uuid
      : undefined;

  const { topLevelVisible, editingParent, saveProjectField } =
    useWorkspaceDerivedState({
      tasks: data.tasks,
      view: nav.view,
      completeBehavior: nav.completeBehavior,
      activeItem,
      activeEntry: nav.activeEntry,
      currentProject: nav.currentProject,
      organizationPage: nav.organizationPage,
      query: nav.query,
      completingUuid,
      editing: taskActions.editing,
      taskLinks,
      organization: data.organization,
      habitUuids: habitTaskUuids,
      changeOrganization: data.changeOrganization,
    });

  const workspaceLocked =
    data.busy ||
    data.needsCheck ||
    data.organizationSaving ||
    data.loading ||
    data.organizationBlocked ||
    !data.organizationReady;

  const openTaskUuids = useMemo(
    () =>
      new Set(
        data.tasks
          .filter((t) => t.status === "pending" || t.status === "waiting")
          .map((t) => t.uuid),
      ),
    [data.tasks],
  );

  const renderTask = useTaskRenderer({
    now: data.now,
    currentProject: nav.currentProject,
    showInboxLocation:
      Boolean(nav.activeEntry) ||
      (nav.view !== "pending" && !nav.currentProject),
    organization: data.organization,
    filterProjects,
    subtasksMap,
    taskLinks,
    rowDisabled: workspaceLocked,
    completion: taskActions.completion,
    expandedDrop: taskActions.expandedDrop,
    taskTrackedSeconds: data.taskTrackedSeconds,
    taskCostSummary: data.taskCostSummary,
    taskListHighlightCost: data.taskListHighlightCost,
    isTimingTask: data.isTimingTask,
    isTimeMode: data.isTimeMode,
    openEditor: taskActions.openEditor,
    toggleTask: taskActions.toggleTask,
    toggleStartTask: taskActions.toggleStartTask,
    clearStartMark: taskActions.clearStartMark,
    patchTaskFields: taskActions.patchTaskFields,
    saveInlineTask: taskActions.saveInlineTask,
    deleteTask: taskActions.deleteTask,
    createSubtask: taskActions.createSubtask,
    unlinkSubtask: taskActions.unlinkSubtask,
    moveTask: (task, columnId) => taskActions.moveTask(task, columnId, null),
    habitByTaskUuid: habits.habitByTaskUuid,
    habitActions: habitTaskActions,
    onChangeState: stateActions.changeTaskState,
    openTaskUuids,
    selectedTaskUuid: taskActions.editing?.uuid,
  });

  const projectOutcome =
    projectActions.currentProjectRecord?.outcome ||
    projectActions.currentProjectFocus?.outcome;
  const projectDescription = projectActions.currentProjectRecord?.description;

  return (
    <FilterGroupByProvider
      preferences={data.organization.preferences}
      onUpdatePreferences={data.updatePreferences}
    >
      <ProjectColorsProvider projects={data.organization.projects || []}>
        <WorkspaceSidebar
          onSearch={() => nav.setCommandOpen(true)}
          navOpen={nav.navOpen}
          onOpenChange={nav.setNavigation}
          view={nav.view}
          currentProject={nav.currentProject}
          organizationPage={nav.organizationPage}
          projectsPage={nav.projectsPage}
          habitsPage={nav.habitsPage}
          habitsCount={habits.todayData?.summary.total}
          onOpenHabitsPage={nav.openHabitsPage}
          timePage={nav.timePage}
          onOpenTimePage={nav.openTimePage}
          organization={data.organization}
          activeEntry={
            nav.activeEntry
              ? {
                  kind: nav.activeEntry.kind,
                  id: nav.activeEntry.item.id,
                }
              : undefined
          }
          hasActiveItem={Boolean(activeItem)}
          projects={filterProjects}
          viewCounts={viewCounts}
          busy={data.busy}
          addDisabled={workspaceLocked}
          organizationSaving={
            data.organizationSaving ||
            !data.organizationReady ||
            data.organizationBlocked ||
            data.needsCheck
          }
          onOpenSettings={nav.openSettings}
          sidebarPreferences={sidebar.preferences}
          onAddSubproject={projectActions.addSubproject}
          onAddProject={() => projectActions.editProject("")}
          onEditProject={projectActions.editProject}
          onDeleteProject={projectActions.deleteProject}
          onProjectStatus={projectActions.transition}
          onProjects={() => nav.openManagementPage("projects")}
          connectionLabel={data.connectionLabel}
          energy={data.energy}
          timerSnapshot={data.timerSnapshot}
          timerLiveStatus={data.timerLiveStatus}
          activeActivitySeconds={data.activeActivitySeconds}
          timingUnavailable={data.organization.timing?.available === false}
          onRetryTiming={() =>
            void (data.isTimeMode
              ? Promise.all([
                  data.refreshTimerSnapshot(),
                  data.loadOrganization(),
                ])
              : data.loadOrganization())
          }
          onElixir={() => void data.restoreEnergy()}
          onAdd={taskActions.openQuickAdd}
          onChangeOrganization={data.changeOrganization}
          onEditEntry={(entry) => {
            setOrganizationEditRequest({ ...entry });
            nav.openManagementPage("organization");
          }}
          onEntry={nav.openEntry}
          onView={nav.selectView}
          onProject={nav.selectProject}
          onOrganization={() => nav.openManagementPage("organization")}
        />

        <div
          className="workspace-main min-h-dvh"
          data-sidebar-open={nav.navOpen}
        >
          <WorkspaceToolbar
            navOpen={nav.navOpen}
            searchOpen={nav.searchOpen}
            canSearchTasks={nav.canSearchTasks}
            loading={data.loading}
            busy={data.busy}
            addDisabled={workspaceLocked}
            onAdd={taskActions.openQuickAdd}
            onOpenNav={() => nav.setNavigation(true)}
            onToggleSearch={nav.searchOpen ? nav.closeSearch : nav.openSearch}
            onRefresh={() => void data.reloadAll()}
          />

          <WorkspaceContent
            organizationEditRequest={organizationEditRequest}
            onOrganizationEditConsumed={() =>
              setOrganizationEditRequest(undefined)
            }
            searchOpen={nav.searchOpen}
            query={nav.query}
            onQueryChange={nav.setQuery}
            layout={nav.layout}
            onLayoutChange={nav.setLayout}
            completeBehavior={nav.completeBehavior}
            onCompleteBehaviorChange={nav.setCompleteBehavior}
            boardScroll={nav.boardScroll}
            view={nav.view}
            now={data.now}
            currentProject={nav.currentProject}
            organizationPage={nav.organizationPage}
            projectsPage={nav.projectsPage}
            isNowView={nav.isNowView}
            canChangeLayout={nav.canChangeLayout}
            organization={data.organization}
            organizationError={data.organizationError}
            organizationReady={data.organizationReady}
            organizationSaving={data.organizationSaving}
            organizationBlocked={data.organizationBlocked}
            busy={data.busy}
            loading={data.loading}
            loaded={data.loaded}
            needsCheck={data.needsCheck}
            notice={data.notice}
            boardDisabled={workspaceLocked}
            tasks={data.tasks}
            topLevelVisible={topLevelVisible}
            filterProjects={filterProjects}
            activeEntry={nav.activeEntry}
            activeItem={activeItem}
            currentProjectRecord={projectActions.currentProjectRecord}
            currentProjectFocus={projectActions.currentProjectFocus}
            projectOutcome={projectOutcome}
            projectDescription={projectDescription}
            viewCounts={viewCounts}
            viewMenuOpen={nav.viewMenuOpen}
            setViewMenuOpen={nav.setViewMenuOpen}
            editingHeaderOutcome={projectActions.editingHeaderOutcome}
            setEditingHeaderOutcome={projectActions.setEditingHeaderOutcome}
            headerOutcomeDraft={projectActions.headerOutcomeDraft}
            setHeaderOutcomeDraft={projectActions.setHeaderOutcomeDraft}
            editingHeaderDesc={projectActions.editingHeaderDesc}
            setEditingHeaderDesc={projectActions.setEditingHeaderDesc}
            headerDescDraft={projectActions.headerDescDraft}
            setHeaderDescDraft={projectActions.setHeaderDescDraft}
            onSelectProject={nav.selectProject}
            onOpenEntry={nav.openEntry}
            onOpenOrganization={() => nav.openManagementPage("organization")}
            onTransitionProject={projectActions.transition}
            onAddSubproject={projectActions.addSubproject}
            onEditProject={projectActions.editProject}
            onDeleteProject={projectActions.deleteProject}
            onChangeOrganization={data.changeOrganization}
            onSaveProjectField={saveProjectField}
            onLoadOrganization={data.loadOrganization}
            onClearOrganizationError={() => data.setOrganizationError("")}
            onChangeBoard={taskActions.changeBoard}
            onReloadBoard={taskActions.reloadBoard}
            onReloadAll={data.reloadAll}
            onRestoreEnergy={data.restoreEnergy}
            onRescheduleOverdue={data.rescheduleOverdue}
            onOpenEditor={taskActions.openEditor}
            onMoveTask={(task, columnId, beforeUuid, parentUuid) =>
              taskActions.moveTask(task, columnId, beforeUuid, true, parentUuid)
            }
            onCreateTaskInView={taskActions.createTaskInView}
            renderTask={renderTask}
            timePage={nav.timePage}
            isTimeMode={data.isTimeMode}
            timerSnapshot={data.timerSnapshot}
            timerLiveStatus={data.timerLiveStatus}
            activeActivitySeconds={data.activeActivitySeconds}
            onOpenTimePage={nav.openTimePage}
            onRefreshTimerSnapshot={data.refreshTimerSnapshot}
            habitsPage={nav.habitsPage}
            onEditHabit={openEditHabit}
            habitsController={habits}
            stateSummary={stateActions.summary}
            nowSections={data.organization.preferences?.nowSections}
            onUpdateNowSections={(nowSections) =>
              void data.updatePreferences({ nowSections })
            }
            onChangeState={stateActions.changeTaskState}
          />
        </div>

        <MobileNavigation
          view={!nav.currentProject && !nav.specialPage ? nav.view : undefined}
          projectsPage={nav.projectsPage}
          disabled={workspaceLocked}
          navigationDisabled={data.busy || data.organizationSaving}
          onView={nav.selectView}
          onProjects={() => nav.openManagementPage("projects")}
          onMenu={() => nav.setNavigation(true)}
          onAdd={taskActions.openQuickAdd}
        />

        <WorkspaceModals
          {...taskActions}
          {...projectActions}
          commandOpen={nav.commandOpen}
          setCommandOpen={nav.setCommandOpen}
          layout={nav.layout}
          currentProject={nav.currentProject}
          organizationPage={nav.organizationPage}
          organization={data.organization}
          organizationError={data.organizationError}
          organizationReady={data.organizationReady}
          organizationSaving={data.organizationSaving}
          organizationBlocked={data.organizationBlocked}
          organizationGeneration={data.organizationGeneration}
          filterProjects={filterProjects}
          tasks={data.tasks}
          busy={data.busy}
          loading={data.loading}
          needsCheck={data.needsCheck}
          notice={data.notice}
          setNeedsCheck={data.setNeedsCheck}
          writeLock={data.writeLock}
          settingsSection={nav.settingsSection}
          setSettingsSection={nav.setSettingsSection}
          themePreference={themePreference}
          sidebarPreferences={sidebar.preferences}
          onSidebarPreferencesChange={sidebar.update}
          completeBehavior={nav.completeBehavior}
          onCompleteBehaviorChange={nav.setCompleteBehavior}
          doingLimit={normalizeDoingLimit(
            data.organization.preferences?.doingLimit,
          )}
          onDoingLimitChange={(doingLimit) => {
            void data
              .updatePreferences({ doingLimit })
              .then(() => stateActions.refreshSummary());
          }}
          onTimeMutated={() => {
            void data.refreshTimerSnapshot();
            void data.reloadAll();
          }}
          editingParent={editingParent}
          subtasksMap={subtasksMap}
          onToastAction={() => taskActions.handleToastAction(nav.selectProject)}
          onToggleLayout={
            nav.canChangeLayout
              ? () =>
                  nav.setLayout((prev) => (prev === "list" ? "board" : "list"))
              : undefined
          }
          onSelectView={nav.selectView}
          onSelectProject={nav.selectProject}
          onSelectEntry={nav.openEntry}
          onOpenOrganization={() => nav.openManagementPage("organization")}
          onOpenHabits={nav.openHabitsPage}
          onOpenTime={() => nav.openTimePage("today")}
          onAddHabit={() => {
            taskActions.openEditor(undefined, {
              description: "",
              tags: [],
              habitPreset: true,
            } as never);
          }}
          habitByTaskUuid={habits.habitByTaskUuid}
          habitTodayDate={
            habits.todayData?.todayDate || currentLocalTodayDate()
          }
          habitActions={habitTaskActions}
          onBindTaskHabit={habits.bindTaskHabit}
          onUnbindTaskHabit={habits.unbindTaskHabit}
          onEditProject={projectActions.editProject}
          onTransitionProject={projectActions.transition}
          onOpenEditor={taskActions.openEditor}
          onCreateTaskInView={taskActions.createTaskInView}
          onCreateSubtask={taskActions.createSubtask}
          onToggleTask={taskActions.toggleTask}
          onToggleStart={taskActions.toggleStartTask}
          onClearStartMark={taskActions.clearStartMark}
          isTimingTask={data.isTimingTask}
          onUnlinkSubtask={taskActions.unlinkSubtask}
          onDeleteTask={taskActions.deleteTask}
          onSubmitTaskForm={taskActions.submitTaskForm}
          isTimeMode={data.isTimeMode}
          hourlyRateCents={data.hourlyRateCents}
          taskCostSummary={data.taskCostSummary}
          onRefreshTimeSnapshot={data.refreshTimerSnapshot}
          onMutate={taskActions.mutateWithOrigin}
          onChangeOrganization={data.changeOrganization}
          onSetOrganization={data.setOrganization}
          onSetOrganizationError={data.setOrganizationError}
          onSetOrganizationSaving={data.setOrganizationSaving}
          onLoadOrganization={data.loadOrganization}
          onReloadAll={data.reloadAll}
          habits={habits}
          habitFormOpen={habitFormOpen}
          onHabitFormOpenChange={setHabitFormOpen}
          editingHabit={editingHabit}
          onClearEditingHabit={() => setEditingHabit(null)}
          onEditHabit={openEditHabit}
          onChangeState={stateActions.changeTaskState}
        />

        <WaitingReasonDialog
          task={stateActions.waitingTask}
          busy={stateActions.stateBusy}
          error={stateActions.dialogError}
          onClose={stateActions.closeWaiting}
          onSubmit={stateActions.submitWaiting}
        />

        <DoingLimitDialog
          open={Boolean(stateActions.doingLimitPrompt)}
          targetDescription={stateActions.doingLimitPrompt?.targetDescription}
          limit={
            stateActions.doingLimitPrompt?.limit ??
            stateActions.summary?.limit ??
            normalizeDoingLimit(data.organization.preferences?.doingLimit)
          }
          doing={stateActions.doingLimitPrompt?.doing || []}
          busy={stateActions.stateBusy}
          error={stateActions.dialogError}
          onClose={stateActions.closeDoingLimit}
          onConfirmReplace={stateActions.confirmDoingLimitReplace}
        />
      </ProjectColorsProvider>
    </FilterGroupByProvider>
  );
}

export default App;
