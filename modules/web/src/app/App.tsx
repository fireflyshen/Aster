import { ProjectColorsProvider } from "@/features/projects/project-icon";
import { WorkspaceContent } from "./components/workspace-content";
import { WorkspaceToolbar } from "./components/workspace-header";
import { WorkspaceModals } from "./components/workspace-modals";
import { useProjectActions } from "./hooks/use-project-actions";
import { useTaskActions } from "./hooks/use-task-actions";
import { useTaskRenderer } from "./hooks/use-task-renderer";
import {
  useModalOpenSync,
  useWorkspaceDerivedState,
  useWorkspaceHierarchy,
} from "./hooks/use-workspace-computed";
import { useWorkspaceData } from "./hooks/use-workspace-data";
import { useWorkspaceNavigation } from "./hooks/use-workspace-navigation";
import { useWorkspaceShortcuts } from "./hooks/use-workspace-shortcuts";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { MobileNavigation } from "./components/mobile-navigation";
import { useVisualViewport } from "./hooks/use-visual-viewport";

/** Root workspace application coordinating navigation, data hooks, main canvas, and dialogs. */
export function App() {
  useVisualViewport();
  const nav = useWorkspaceNavigation();
  const data = useWorkspaceData({
    scope: nav.scope,
    isModalOpen: nav.commandOpen || nav.recoveryOpen || nav.subModalOpen,
    onProjectRemap: nav.onProjectRemap,
  });

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
  });

  const taskActions = useTaskActions({
    view: nav.view,
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
    writeLock: data.writeLock,
    isSubtask,
    setNotice: data.setNotice,
    mutate: data.mutate,
    changeOrganization: data.changeOrganization,
    reloadAll: data.reloadAll,
  });

  const projectActions = useProjectActions({
    currentProject: nav.currentProject,
    organization: data.organization,
    setOrganizationError: data.setOrganizationError,
    setNavOpen: nav.setNavigation,
    changeOrganization: data.changeOrganization,
  });

  useModalOpenSync(
    [
      taskActions.open,
      taskActions.quickOpen,
      Boolean(taskActions.seriesUuid),
      Boolean(projectActions.editingProject),
      projectActions.focusPickerOpen,
      Boolean(projectActions.transitionProject),
      Boolean(projectActions.deletingProject),
    ],
    nav.setSubModalOpen,
  );

  useWorkspaceShortcuts({
    open: taskActions.open,
    commandOpen: nav.commandOpen,
    quickOpen: taskActions.quickOpen,
    organizationPage: nav.organizationPage,
    busy: data.busy,
    organizationSaving: data.organizationSaving,
    view: nav.view,
    searchOpen: nav.searchOpen,
    query: nav.query,
    setCommandOpen: nav.setCommandOpen,
    setLayout: nav.setLayout,
    setNavOpen: nav.setNavigation,
    setOrganizationPage: nav.setOrganizationPage,
    setView: nav.setView,
    setSearchOpen: nav.setSearchOpen,
    setQuery: nav.setQuery,
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
      changeOrganization: data.changeOrganization,
    });

  const workspaceLocked =
    data.busy ||
    data.needsCheck ||
    data.organizationSaving ||
    data.loading ||
    data.organizationBlocked ||
    !data.organizationReady;

  const renderTask = useTaskRenderer({
    now: data.now,
    currentProject: nav.currentProject,
    organization: data.organization,
    filterProjects,
    subtasksMap,
    taskLinks,
    rowDisabled: workspaceLocked,
    completion: taskActions.completion,
    expandedDrop: taskActions.expandedDrop,
    taskTrackedSeconds: data.taskTrackedSeconds,
    openEditor: taskActions.openEditor,
    toggleTask: taskActions.toggleTask,
    toggleStartTask: taskActions.toggleStartTask,
    patchTaskFields: taskActions.patchTaskFields,
    saveInlineTask: taskActions.saveInlineTask,
    deleteTask: taskActions.deleteTask,
    createSubtask: taskActions.createSubtask,
    unlinkSubtask: taskActions.unlinkSubtask,
    moveTask: (task, columnId) => taskActions.moveTask(task, columnId, null),
  });

  const projectOutcome =
    projectActions.currentProjectRecord?.outcome ||
    projectActions.currentProjectFocus?.outcome;
  const projectDescription = projectActions.currentProjectRecord?.description;

  return (
    <ProjectColorsProvider projects={data.organization.projects || []}>
      <WorkspaceSidebar
        onSearch={() => nav.setCommandOpen(true)}
        navOpen={nav.navOpen}
        onOpenChange={nav.setNavigation}
        view={nav.view}
        currentProject={nav.currentProject}
        organizationPage={nav.organizationPage}
        projectsPage={nav.projectsPage}
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
        needsCheck={data.needsCheck}
        organizationSaving={
          data.organizationSaving ||
          !data.organizationReady ||
          data.organizationBlocked ||
          data.needsCheck
        }
        onRecovery={() => nav.setRecoveryOpen(true)}
        onAddSubproject={projectActions.addSubproject}
        onAddProject={() => projectActions.editProject("")}
        onEditProject={projectActions.editProject}
        onDeleteProject={projectActions.deleteProject}
        onProjectStatus={projectActions.transition}
        onProjects={() => nav.openManagementPage("projects")}
        connectionLabel={data.connectionLabel}
        energy={data.energy}
        timingUnavailable={data.organization.timing?.available === false}
        onRetryTiming={() => void data.loadOrganization()}
        onElixir={() => void data.restoreEnergy()}
        onAdd={taskActions.openQuickAdd}
        onEntry={nav.openEntry}
        onView={nav.selectView}
        onProject={nav.selectProject}
        onOrganization={() => nav.openManagementPage("organization")}
        completeBehavior={nav.completeBehavior}
        onCompleteBehaviorChange={nav.setCompleteBehavior}
      />

      <div className="workspace-main min-h-dvh" data-sidebar-open={nav.navOpen}>
        <WorkspaceToolbar
          navOpen={nav.navOpen}
          searchOpen={nav.searchOpen}
          query={nav.query}
          loading={data.loading}
          busy={data.busy}
          onOpenNav={() => nav.setNavigation(true)}
          onOpenCommand={() => nav.setCommandOpen(true)}
          onToggleSearch={() => {
            if (nav.searchOpen || nav.query) {
              nav.setSearchOpen(false);
              nav.setQuery("");
            } else nav.setSearchOpen(true);
          }}
          onRefresh={() => void data.reloadAll()}
        />

        <WorkspaceContent
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
          specialPage={nav.specialPage}
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
          onOpenFocusPicker={() => projectActions.setFocusPickerOpen(true)}
          onSelectProject={nav.selectProject}
          onSelectView={nav.selectView}
          onOpenEntry={nav.openEntry}
          onOpenOrganization={() =>
            nav.openManagementPage("organization", false)
          }
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
          onRescheduleOverdue={data.rescheduleOverdueToToday}
          onOpenEditor={taskActions.openEditor}
          onMoveTask={(task, columnId, beforeUuid, parentUuid) =>
            taskActions.moveTask(task, columnId, beforeUuid, true, parentUuid)
          }
          onCreateTaskInView={taskActions.createTaskInView}
          renderTask={renderTask}
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
        recoveryOpen={nav.recoveryOpen}
        setRecoveryOpen={nav.setRecoveryOpen}
        editingParent={editingParent}
        subtasksMap={subtasksMap}
        onToastAction={() => taskActions.handleToastAction(nav.selectProject)}
        onToggleLayout={() =>
          nav.setLayout((prev) => (prev === "list" ? "board" : "list"))
        }
        onSelectView={nav.selectView}
        onSelectProject={nav.selectProject}
        onSelectEntry={nav.openEntry}
        onOpenOrganization={() => nav.openManagementPage("organization")}
        onEditProject={projectActions.editProject}
        onTransitionProject={projectActions.transition}
        onOpenEditor={taskActions.openEditor}
        onCreateTaskInView={taskActions.createTaskInView}
        onCreateSubtask={taskActions.createSubtask}
        onToggleTask={taskActions.toggleTask}
        onUnlinkSubtask={taskActions.unlinkSubtask}
        onDeleteTask={taskActions.deleteTask}
        onSubmitTaskForm={taskActions.submitTaskForm}
        onMutate={data.mutate}
        onChangeOrganization={data.changeOrganization}
        onSetOrganization={data.setOrganization}
        onSetOrganizationError={data.setOrganizationError}
        onSetOrganizationSaving={data.setOrganizationSaving}
        onLoadOrganization={data.loadOrganization}
        onReloadAll={data.reloadAll}
      />
    </ProjectColorsProvider>
  );
}

export default App;
