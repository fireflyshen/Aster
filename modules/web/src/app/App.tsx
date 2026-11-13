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
import { FocusOverview } from "@/features/projects/focus-overview";
import { ProjectColorsProvider } from "@/features/projects/project-icon";
import { ProjectManager } from "@/features/projects/project-manager";
import { toDueDay } from "@/features/tasks/task-date";
import { TaskRow } from "@/features/tasks/task-row";
import { taskDate } from "@core/tasks/quick-task";
import { defaultBoard } from "@core/workspace/board";
import type { SavedFilter, SavedTag } from "@core/workspace/organization";
import { projectNames } from "@core/workspace/projects";
import type { Task, View } from "@shared/tasks";
import { format } from "date-fns";
import { Search, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ProjectInlineMeta } from "./components/project-inline-meta";
import {
  WorkspaceHeading,
  WorkspaceToolbar,
} from "./components/workspace-header";
import { WorkspaceModals } from "./components/workspace-modals";
import { useProjectActions } from "./hooks/use-project-actions";
import { useTaskActions } from "./hooks/use-task-actions";
import { useWorkspaceData } from "./hooks/use-workspace-data";
import { useWorkspaceShortcuts } from "./hooks/use-workspace-shortcuts";
import {
  computeSubtaskHierarchy,
  computeViewCounts,
  filterVisibleTasks,
} from "./lib/task-view";
import { WorkspaceSidebar } from "./workspace-sidebar";

const TaskBoard = lazy(() =>
  import("@/features/tasks/task-board").then((module) => ({
    default: module.TaskBoard,
  })),
);

type ActiveEntry = {
  kind: "filter" | "tag";
  item: SavedFilter | SavedTag;
};

const VALID_VIEWS: readonly View[] = [
  "today",
  "pending",
  "waiting",
  "completed",
];

function readStoredView(): View {
  if (typeof window === "undefined") return "today";
  try {
    const raw = window.localStorage.getItem("aster:view") as View | null;
    return raw && VALID_VIEWS.includes(raw) ? raw : "today";
  } catch {
    return "today";
  }
}

function readStoredLayout(): "list" | "board" {
  if (typeof window === "undefined") return "list";
  try {
    return window.localStorage.getItem("aster:layout") === "board"
      ? "board"
      : "list";
  } catch {
    return "list";
  }
}

function readStoredNav(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem("aster:nav");
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {}
  return window.innerWidth >= 768;
}

/** Root workspace application coordinating views, sidebar, tasks, and modals. */
export function App() {
  const [navOpen, setNavOpen] = useState<boolean>(readStoredNav);
  const [view, setViewState] = useState<View>(readStoredView);
  const [layout, setLayoutState] = useState<"list" | "board">(readStoredLayout);
  const [currentProject, setCurrentProject] = useState("");
  const [organizationPage, setOrganizationPage] = useState(false);
  const [projectsPage, setProjectsPage] = useState(false);
  const [activeEntry, setActiveEntry] = useState<ActiveEntry | undefined>();
  const [commandOpen, setCommandOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const boardScroll = useRef(0);

  const setNavigation = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      setNavOpen((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        try {
          window.localStorage.setItem("aster:nav", resolved ? "1" : "0");
        } catch {}
        return resolved;
      });
    },
    [],
  );

  const setView = useCallback((next: View) => {
    setViewState(next);
    try {
      window.localStorage.setItem("aster:view", next);
    } catch {}
  }, []);

  const setLayout = useCallback(
    (
      next: "list" | "board" | ((prev: "list" | "board") => "list" | "board"),
    ) => {
      setLayoutState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        try {
          window.localStorage.setItem("aster:layout", resolved);
        } catch {}
        return resolved;
      });
    },
    [],
  );

  const scope =
    view === "completed" && !currentProject && !activeEntry && !organizationPage
      ? "completed"
      : "pending";

  const onProjectRemap = useCallback((updater: (current: string) => string) => {
    setCurrentProject((prev) => updater(prev));
  }, []);

  const data = useWorkspaceData({
    scope,
    isModalOpen: commandOpen || recoveryOpen || subModalOpen,
    onProjectRemap,
  });

  const {
    organization,
    setOrganization,
    organizationError,
    setOrganizationError,
    organizationReady,
    organizationSaving,
    setOrganizationSaving,
    organizationBlocked,
    organizationGeneration,
    tasks,
    setTasks,
    projects,
    loading,
    loaded,
    busy,
    needsCheck,
    setNeedsCheck,
    notice,
    setNotice,
    now,
    energy,
    writeLock,
    connectionLabel,
    taskTrackedSeconds,
    loadOrganization,
    reloadAll,
    mutate,
    changeOrganization,
    rescheduleOverdueToToday,
    restoreEnergy,
  } = data;

  const activeItem = useMemo(() => {
    if (!activeEntry) return undefined;
    if (activeEntry.kind === "filter") {
      return (
        organization.filters?.find((f) => f.id === activeEntry.item.id) ||
        activeEntry.item
      );
    }
    return (
      organization.tags?.find((t) => t.id === activeEntry.item.id) ||
      activeEntry.item
    );
  }, [activeEntry, organization.filters, organization.tags]);

  const activeTagName =
    activeEntry?.kind === "tag" ? activeItem?.name : undefined;

  const { subtasksMap, taskLinks } = useMemo(
    () => computeSubtaskHierarchy(tasks, organization),
    [tasks, organization],
  );

  const isSubtask = useCallback(
    (uuid: string) => Boolean(taskLinks[uuid]),
    [taskLinks],
  );

  const taskActions = useTaskActions({
    view,
    currentProject,
    activeTagName,
    tasks,
    setTasks,
    organization,
    setOrganization,
    organizationReady,
    organizationSaving,
    organizationBlocked,
    loading,
    busy,
    needsCheck,
    energy,
    writeLock,
    isSubtask,
    setNotice,
    mutate,
    changeOrganization,
    reloadAll,
  });

  const projectActions = useProjectActions({
    currentProject,
    organization,
    setOrganizationError,
    setNavOpen: setNavigation,
    changeOrganization,
  });

  const {
    open,
    setOpen,
    seriesUuid,
    setSeriesUuid,
    quickOpen,
    setQuickOpen,
    quickProject,
    setQuickProject,
    quickError,
    setQuickError,
    toastOpen,
    setToastOpen,
    toastVersion,
    undoTask,
    addedProject,
    expandedDrop,
    completion,
    editing,
    setEditing,
    draft,
    setDraft,
    tags,
    setTags,
    due,
    setDue,
    formError,
    setFormError,
    openQuickAdd,
    applyViewDefaults,
    openEditor,
    submitTaskForm,
    toggleTask,
    moveTask,
    changeBoard,
    reloadBoard,
    createTaskInView,
    createSubtask,
    unlinkSubtask,
    toggleStartTask,
    deleteTask,
    saveInlineTask,
    patchTaskFields,
    handleToastAction,
  } = taskActions;

  const {
    focusPickerOpen,
    setFocusPickerOpen,
    transitionProject,
    setTransitionProject,
    editingProject,
    setEditingProject,
    newProjectParent,
    editingHeaderOutcome,
    setEditingHeaderOutcome,
    headerOutcomeDraft,
    setHeaderOutcomeDraft,
    editingHeaderDesc,
    setEditingHeaderDesc,
    headerDescDraft,
    setHeaderDescDraft,
    deletingProject,
    setDeletingProject,
    currentProjectRecord,
    currentProjectFocus,
    editProject,
    addSubproject,
    transition,
    deleteProject,
  } = projectActions;

  useEffect(() => {
    setSubModalOpen(
      open ||
        quickOpen ||
        Boolean(seriesUuid) ||
        Boolean(editingProject) ||
        focusPickerOpen ||
        Boolean(transitionProject) ||
        Boolean(deletingProject),
    );
  }, [
    open,
    quickOpen,
    seriesUuid,
    editingProject,
    focusPickerOpen,
    transitionProject,
    deletingProject,
  ]);

  useWorkspaceShortcuts({
    open,
    commandOpen,
    quickOpen,
    organizationPage,
    busy,
    organizationSaving,
    view,
    searchOpen,
    query,
    setCommandOpen,
    setLayout,
    setNavOpen: setNavigation,
    setOrganizationPage,
    setView,
    setSearchOpen,
    setQuery,
    openQuickAdd,
  });

  const filterProjects = useMemo(
    () =>
      projectNames([
        ...projects,
        ...(organization.projects || []).map((p) => p.name),
      ]),
    [projects, organization.projects],
  );

  const viewCounts = useMemo(() => computeViewCounts(tasks), [tasks]);

  const completingUuid =
    completion?.phase === "leaving" ? completion.uuid : undefined;

  const visibleTasks = useMemo(
    () =>
      filterVisibleTasks({
        tasks,
        view,
        activeItem,
        inbox:
          view === "pending" &&
          !currentProject &&
          !activeEntry &&
          !organizationPage,
        currentProject,
        query,
        completingUuid,
      }),
    [
      tasks,
      view,
      activeItem,
      activeEntry,
      currentProject,
      organizationPage,
      query,
      completingUuid,
    ],
  );

  const topLevelVisible = useMemo(() => {
    const visibleIds = new Set(visibleTasks.map((t) => t.uuid));
    return visibleTasks.filter((t) => {
      const parentUuid = taskLinks[t.uuid];
      return !parentUuid || !visibleIds.has(parentUuid);
    });
  }, [visibleTasks, taskLinks]);

  const editingParent = useMemo(() => {
    if (!editing) return undefined;
    const parentUuid = taskLinks[editing.uuid];
    return parentUuid ? tasks.find((t) => t.uuid === parentUuid) : undefined;
  }, [editing, taskLinks, tasks]);

  function openTaskView() {
    setOrganizationPage(false);
    setProjectsPage(false);
    setActiveEntry(undefined);
  }

  function openEntry(entry: ActiveEntry) {
    setOrganizationPage(false);
    setProjectsPage(false);
    setActiveEntry(entry);
    setCurrentProject("");
    setView("pending");
    setSearchOpen(false);
    setQuery("");
  }

  function selectProject(name: string) {
    openTaskView();
    setCurrentProject(name);
    setView("pending");
    setQuery("");
  }

  function selectView(nextView: View) {
    openTaskView();
    setView(nextView);
    setCurrentProject("");
    setQuery("");
  }

  const todayDayKey = format(now, "yyyy-MM-dd");

  function renderTask(
    task: Task,
    extraActions?: ReactNode,
    variant: "list" | "card" = "list",
    depth = 0,
    renderSubtaskWrapper?: (
      child: Task,
      defaultRender: (child: Task) => ReactNode,
    ) => ReactNode,
  ): ReactNode {
    const subtasks = subtasksMap.get(task.uuid) || [];
    const rowDisabled =
      busy ||
      loading ||
      needsCheck ||
      organizationSaving ||
      organizationBlocked ||
      !organizationReady;
    const dueDay = task.due ? toDueDay(task.due) : "";
    const overdue = Boolean(
      dueDay && task.status !== "completed" && dueDay < todayDayKey,
    );
    const isRowTransition = completion?.uuid === task.uuid;
    const completed =
      task.status === "completed" ||
      Boolean(isRowTransition && completion?.checked);

    const renderPlainChild = (child: Task): ReactNode =>
      renderTask(child, undefined, variant, depth + 1, renderSubtaskWrapper);

    const renderSubtaskNode = (child: Task): ReactNode =>
      renderSubtaskWrapper
        ? renderSubtaskWrapper(child, renderPlainChild)
        : renderPlainChild(child);

    return (
      <TaskRow
        key={task.uuid}
        task={task}
        completed={completed}
        overdue={overdue}
        disabled={rowDisabled}
        onEdit={() => openEditor(task)}
        onComplete={() => void toggleTask(task, !completed)}
        onToggleStart={() => void toggleStartTask(task)}
        onDueChange={(nextDue) => void patchTaskFields(task, { due: nextDue })}
        onPriorityChange={(priority) =>
          void patchTaskFields(task, { priority })
        }
        onSaveInline={(input) => saveInlineTask(task, input)}
        onDelete={() => void deleteTask(task)}
        projects={filterProjects}
        availableLabels={organization.tags || []}
        extraActions={extraActions}
        trackedSeconds={taskTrackedSeconds(task)}
        timingUnavailable={organization.timing?.available === false}
        showProject={!currentProject}
        variant={variant}
        transition={isRowTransition ? completion : undefined}
        subtasks={subtasks}
        isSubtask={Boolean(taskLinks[task.uuid])}
        depth={depth}
        description={organization.descriptions?.[task.uuid]}
        onAddSubtask={(input) => createSubtask(task.uuid, input)}
        onUnlinkSubtask={
          taskLinks[task.uuid] ? () => void unlinkSubtask(task.uuid) : undefined
        }
        onToggleSubtask={(subtask, nextCompleted) =>
          void toggleTask(subtask, nextCompleted)
        }
        onEditSubtask={(subtask) => openEditor(subtask)}
        renderSubtask={renderSubtaskNode}
        expandSubtasks={
          expandedDrop?.uuid === task.uuid ? expandedDrop.version : undefined
        }
      />
    );
  }

  const boardDisabled =
    busy ||
    needsCheck ||
    organizationSaving ||
    loading ||
    organizationBlocked ||
    !organizationReady;

  const projectOutcome =
    currentProjectRecord?.outcome || currentProjectFocus?.outcome;
  const projectDescription = currentProjectRecord?.description;

  const specialPage = Boolean(organizationPage || projectsPage || activeEntry);

  function saveProjectField(
    name: string,
    patch: { outcome?: string; nextTask?: string },
  ) {
    const existing = (organization.projects || []).find(
      (item) => item.name === name,
    );
    return changeOrganization({
      revision: organization.revision,
      kind: "project",
      action: "save",
      item: {
        description: "",
        ...(existing || {}),
        name,
        ...patch,
      },
    });
  }

  return (
    <ProjectColorsProvider projects={organization.projects || []}>
      <WorkspaceSidebar
        onSearch={() => setCommandOpen(true)}
        navOpen={navOpen}
        onOpenChange={setNavigation}
        view={view}
        currentProject={currentProject}
        organizationPage={organizationPage}
        projectsPage={projectsPage}
        organization={organization}
        activeEntry={
          activeEntry
            ? { kind: activeEntry.kind, id: activeEntry.item.id }
            : undefined
        }
        hasActiveItem={Boolean(activeItem)}
        projects={filterProjects}
        viewCounts={viewCounts}
        busy={busy}
        needsCheck={needsCheck}
        organizationSaving={
          organizationSaving ||
          !organizationReady ||
          organizationBlocked ||
          needsCheck
        }
        onRecovery={() => setRecoveryOpen(true)}
        onAddSubproject={addSubproject}
        onAddProject={() => editProject("")}
        onEditProject={editProject}
        onDeleteProject={deleteProject}
        onProjectStatus={transition}
        onProjects={() => {
          setProjectsPage(true);
          setOrganizationPage(true);
          setActiveEntry(undefined);
          setSearchOpen(false);
          setQuery("");
          setCurrentProject("");
        }}
        connectionLabel={connectionLabel}
        energy={energy}
        timingUnavailable={organization.timing?.available === false}
        onRetryTiming={() => void loadOrganization()}
        onElixir={() => void restoreEnergy()}
        onAdd={openQuickAdd}
        onEntry={openEntry}
        onView={selectView}
        onProject={selectProject}
        onOrganization={() => {
          setProjectsPage(false);
          setOrganizationPage(true);
          setActiveEntry(undefined);
          setSearchOpen(false);
          setQuery("");
          setCurrentProject("");
        }}
      />

      <div className="workspace-main min-h-dvh" data-sidebar-open={navOpen}>
        <WorkspaceToolbar
          navOpen={navOpen}
          searchOpen={searchOpen}
          query={query}
          loading={loading}
          busy={busy}
          onOpenNav={() => setNavigation(true)}
          onOpenCommand={() => setCommandOpen(true)}
          onToggleSearch={() => setSearchOpen((prev) => !prev)}
          onRefresh={() => void reloadAll()}
        />

        <main className="workspace-frame pb-16 pt-2">
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
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索任务..."
                  aria-label="搜索任务"
                />
                {query && (
                  <InputGroupButton
                    size="icon-xs"
                    variant="ghost"
                    aria-label="清除搜索"
                    onClick={() => setQuery("")}
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
              setLayout(next === "board" ? "board" : "list")
            }
          >
            <WorkspaceHeading
              view={view}
              now={now}
              currentProject={currentProject}
              organizationPage={organizationPage}
              projectsPage={projectsPage}
              specialPage={specialPage}
              organizationReady={organizationReady}
              organizationSaving={organizationSaving}
              busy={busy}
              activeEntry={
                activeEntry
                  ? { kind: activeEntry.kind, id: activeEntry.item.id }
                  : undefined
              }
              activeItem={activeItem}
              currentProjectFocus={currentProjectFocus}
              projectOutcome={projectOutcome}
              projectDescription={projectDescription}
              viewCounts={viewCounts}
              viewMenuOpen={viewMenuOpen}
              setViewMenuOpen={setViewMenuOpen}
              onSelectProject={selectProject}
              onSelectView={selectView}
              onTransitionProject={transition}
              onAddSubproject={addSubproject}
              onStartEditDesc={() => {
                setHeaderDescDraft(projectDescription || "");
                setEditingHeaderDesc(true);
              }}
              onStartEditOutcome={() => {
                setHeaderOutcomeDraft(projectOutcome || "");
                setEditingHeaderOutcome(true);
              }}
              onEditProject={editProject}
              onDeleteProject={deleteProject}
              onManageOrganization={() => {
                setProjectsPage(false);
                setOrganizationPage(true);
                setActiveEntry(undefined);
                setCurrentProject("");
              }}
            />

            {currentProject && !organizationPage && (
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
                onSaveProject={changeOrganization}
              />
            )}

            {notice && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>{notice}</span>
                  <div className="flex items-center gap-2">
                    {/energy exhausted|精力已耗尽/i.test(notice) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        disabled={organizationSaving}
                        onClick={() => void restoreEnergy()}
                      >
                        恢复 +30 精力
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={loading || busy}
                      onClick={() => void reloadAll()}
                    >
                      {needsCheck ? "刷新并检查" : "重试"}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {organizationPage ? (
              projectsPage ? (
                <div className="space-y-8">
                  <FocusOverview
                    data={organization}
                    tasks={tasks}
                    loading={loading}
                    disabled={boardDisabled}
                    error={organizationError}
                    onChooseProject={() => setFocusPickerOpen(true)}
                    onPause={(name) => transition(name, "later")}
                    onComplete={(name) => transition(name, "completed")}
                    onOpen={selectProject}
                    onEdit={editProject}
                    onAddTask={(name, nextDraft) =>
                      openEditor(undefined, {
                        description: "",
                        tags: [],
                        ...(nextDraft || {}),
                        project: name,
                      })
                    }
                    onCreateTask={(input, name) =>
                      createTaskInView({ ...input, project: name })
                    }
                    onSelectNext={(name, nextUuid) =>
                      void saveProjectField(name, { nextTask: nextUuid })
                    }
                    onUpdateOutcome={(name, outcome) =>
                      saveProjectField(name, { outcome })
                    }
                    renderTask={(task, extraActions) =>
                      renderTask(task, extraActions, "list", 0)
                    }
                  />
                  <ProjectManager
                    data={organization}
                    projects={filterProjects}
                    error={organizationError}
                    loading={loading}
                    disabled={boardDisabled}
                    onOpen={selectProject}
                    onAdd={() => editProject("")}
                    onAddChild={addSubproject}
                    onEdit={editProject}
                    onDelete={deleteProject}
                    onStatus={transition}
                    onReload={() => void loadOrganization()}
                  />
                </div>
              ) : (
                <OrganizationManager
                  data={organization}
                  error={organizationError}
                  busy={organizationSaving}
                  loading={loading}
                  blocked={organizationBlocked || needsCheck}
                  onChange={changeOrganization}
                  onOpen={(entry) => openEntry(entry)}
                  onReload={loadOrganization}
                />
              )
            ) : (
              <>
                <TabsContent value="list" className="mt-0 min-w-0">
                  <Suspense
                    fallback={
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Spinner className="size-4" />
                        加载列表…
                      </div>
                    }
                  >
                    <TaskBoard
                      layout="list"
                      initialScrollLeft={boardScroll.current}
                      onScrollPositionChange={(position) => {
                        boardScroll.current = position;
                      }}
                      tasks={topLevelVisible}
                      allTasks={tasks}
                      board={organization.board || defaultBoard()}
                      revision={organization.revision}
                      saving={organizationSaving}
                      blocked={
                        organizationBlocked || needsCheck || !organizationReady
                      }
                      error={organizationError}
                      onChange={changeBoard}
                      onReload={reloadBoard}
                      onClearError={() => setOrganizationError("")}
                      loading={loading}
                      loaded={loaded}
                      disabled={boardDisabled}
                      renderTask={renderTask}
                      onMove={(task, columnId, beforeUuid, parentUuid) =>
                        moveTask(task, columnId, beforeUuid, true, parentUuid)
                      }
                      onCreateTask={createTaskInView}
                      projects={filterProjects}
                      availableLabels={organization.tags}
                      project={currentProject}
                      defaultProject={currentProject}
                      defaultDue={view === "today" ? taskDate(new Date()) : ""}
                      todaySplit={
                        view === "today" && !currentProject && !activeEntry
                      }
                      onRescheduleOverdue={rescheduleOverdueToToday}
                      canAddTask={
                        view !== "completed" &&
                        (!activeEntry || activeEntry.kind === "tag")
                      }
                      canAddSection={
                        view !== "completed" &&
                        !activeEntry &&
                        !(view === "today" && !currentProject)
                      }
                      hasSearch={Boolean(query.trim())}
                      onClearSearch={() => setQuery("")}
                      onAdd={(nextDraft) => openEditor(undefined, nextDraft)}
                    />
                  </Suspense>
                </TabsContent>

                <TabsContent value="board" className="mt-0 min-w-0">
                  <Suspense
                    fallback={
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Spinner className="size-4" />
                        加载看板…
                      </div>
                    }
                  >
                    <TaskBoard
                      layout="board"
                      initialScrollLeft={boardScroll.current}
                      onScrollPositionChange={(position) => {
                        boardScroll.current = position;
                      }}
                      tasks={topLevelVisible}
                      allTasks={tasks}
                      board={organization.board || defaultBoard()}
                      revision={organization.revision}
                      saving={organizationSaving}
                      blocked={
                        organizationBlocked || needsCheck || !organizationReady
                      }
                      error={organizationError}
                      onChange={changeBoard}
                      onReload={reloadBoard}
                      onClearError={() => setOrganizationError("")}
                      loading={loading}
                      loaded={loaded}
                      disabled={boardDisabled}
                      renderTask={renderTask}
                      onMove={(task, columnId, beforeUuid, parentUuid) =>
                        moveTask(task, columnId, beforeUuid, true, parentUuid)
                      }
                      onCreateTask={createTaskInView}
                      projects={filterProjects}
                      availableLabels={organization.tags}
                      project={currentProject}
                      defaultProject={currentProject}
                      defaultDue={view === "today" ? taskDate(new Date()) : ""}
                      canAddTask={
                        view !== "completed" &&
                        (!activeEntry || activeEntry.kind === "tag")
                      }
                      canAddSection={view !== "completed" && !activeEntry}
                      hasSearch={Boolean(query.trim())}
                      onClearSearch={() => setQuery("")}
                      onAdd={(nextDraft) => openEditor(undefined, nextDraft)}
                    />
                  </Suspense>
                </TabsContent>
              </>
            )}
          </Tabs>
        </main>
      </div>

      <WorkspaceModals
        commandOpen={commandOpen}
        setCommandOpen={setCommandOpen}
        layout={layout}
        currentProject={currentProject}
        organizationPage={organizationPage}
        organization={organization}
        organizationError={organizationError}
        organizationReady={organizationReady}
        organizationSaving={organizationSaving}
        organizationBlocked={organizationBlocked}
        organizationGeneration={organizationGeneration}
        filterProjects={filterProjects}
        tasks={tasks}
        busy={busy}
        loading={loading}
        needsCheck={needsCheck}
        notice={notice}
        setNeedsCheck={setNeedsCheck}
        writeLock={writeLock}
        recoveryOpen={recoveryOpen}
        setRecoveryOpen={setRecoveryOpen}
        quickOpen={quickOpen}
        setQuickOpen={setQuickOpen}
        quickProject={quickProject}
        setQuickProject={setQuickProject}
        quickError={quickError}
        setQuickError={setQuickError}
        openQuickAdd={openQuickAdd}
        toastOpen={toastOpen}
        setToastOpen={setToastOpen}
        toastVersion={toastVersion}
        undoTask={undoTask}
        addedProject={addedProject}
        onToastAction={() => handleToastAction(selectProject)}
        open={open}
        setOpen={setOpen}
        seriesUuid={seriesUuid}
        setSeriesUuid={setSeriesUuid}
        editing={editing}
        setEditing={setEditing}
        editingParent={editingParent}
        subtasksMap={subtasksMap}
        draft={draft}
        setDraft={setDraft}
        due={due}
        setDue={setDue}
        tags={tags}
        setTags={setTags}
        formError={formError}
        setFormError={setFormError}
        editingProject={editingProject}
        setEditingProject={setEditingProject}
        newProjectParent={newProjectParent}
        focusPickerOpen={focusPickerOpen}
        setFocusPickerOpen={setFocusPickerOpen}
        transitionProject={transitionProject}
        setTransitionProject={setTransitionProject}
        deletingProject={deletingProject}
        setDeletingProject={setDeletingProject}
        onToggleLayout={() =>
          setLayout((prev) => (prev === "list" ? "board" : "list"))
        }
        onSelectView={selectView}
        onSelectProject={selectProject}
        onSelectEntry={openEntry}
        onOpenOrganization={() => {
          setProjectsPage(false);
          setOrganizationPage(true);
          setActiveEntry(undefined);
          setSearchOpen(false);
          setQuery("");
          setCurrentProject("");
        }}
        onEditProject={editProject}
        onTransitionProject={transition}
        onOpenEditor={openEditor}
        applyViewDefaults={applyViewDefaults}
        onCreateTaskInView={createTaskInView}
        onCreateSubtask={createSubtask}
        onToggleTask={toggleTask}
        onUnlinkSubtask={unlinkSubtask}
        onDeleteTask={deleteTask}
        onSubmitTaskForm={submitTaskForm}
        onMutate={mutate}
        onChangeOrganization={changeOrganization}
        onSetOrganization={setOrganization}
        onSetOrganizationError={setOrganizationError}
        onSetOrganizationSaving={setOrganizationSaving}
        onLoadOrganization={loadOrganization}
        onReloadAll={reloadAll}
      />
    </ProjectColorsProvider>
  );
}

export default App;
