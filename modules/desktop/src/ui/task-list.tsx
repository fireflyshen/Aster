import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  List,
  LocalStorage,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { taskGroup, type TaskwarriorTask } from "../../../core/tasks/model.ts";
import { defaultBoard } from "../../../core/workspace/board.ts";
import {
  countProjectTasks,
  FOCUS_LIMIT,
  projectStatus,
} from "../../../core/workspace/focus.ts";
import { itemColor } from "../../../core/workspace/organization.ts";
import { projectPath } from "../../../core/workspace/projects.ts";
import { loadTaskViewWithCatalog } from "../../../core/workspace/task-views.ts";
import { FocusProjects } from "./focus-projects";
import { SubtaskList } from "./subtask-list";
import { TaskForm } from "./task-form";
import {
  CommonTaskActions,
  type CommonTaskActionsProps,
} from "./task-list-actions";
import { TaskViewDropdown } from "./task-list-dropdown";
import {
  buildProjectColumnSections,
  buildSubtaskMeta,
  emptyViewCopy,
  GROUP_TITLES,
  GROUPS,
  isCustomFilterView,
  listNavigationTitle,
  partitionFocusTasks,
  selectSectionTasks,
  type TaskSectionEntry,
} from "./task-list-model";
import { TaskListRow } from "./task-row";
import { useTaskListActions } from "./use-task-list-actions";
import { useTaskService } from "./use-task-service";
import { useWorkspace } from "./use-workspace";

const INSPECTOR_STORAGE_KEY = "aster:showInspector";

export interface TaskListScreenProps {
  initialFilter?: string;
  onMutated?: () => Promise<unknown>;
}

/** Main Raycast task list command supporting views, Focus projects, board sections, split inspector, and subtask drill-down. */
export default function MyTasks() {
  return <TaskListScreen />;
}

/** Reusable Raycast task list screen supporting top-level views and pushed project views. */
export function TaskListScreen({
  initialFilter = "pending",
  onMutated,
}: TaskListScreenProps) {
  const service = useTaskService();
  const [filter, setFilter] = useState(initialFilter);
  const [expression, setExpression] = useState("");
  const [showInspector, setShowInspector] = useState(false);

  useEffect(() => {
    void LocalStorage.getItem<boolean>(INSPECTOR_STORAGE_KEY).then((saved) => {
      if (typeof saved === "boolean") setShowInspector(saved);
    });
  }, []);

  function toggleInspector() {
    setShowInspector((prev) => {
      const next = !prev;
      void LocalStorage.setItem(INSPECTOR_STORAGE_KEY, next);
      return next;
    });
  }

  const workspace = useWorkspace(service.connection);
  const organization = workspace.error ? undefined : workspace.data;
  const board = organization?.board || defaultBoard();
  const activeProject = filter.startsWith("project:")
    ? filter.slice(8)
    : undefined;
  const needsWorkspace =
    filter === "focus" ||
    filter === "later" ||
    filter.startsWith("filter:") ||
    filter.startsWith("column:");

  const {
    data: viewResult,
    error,
    isLoading,
    revalidate,
  } = usePromise(
    loadTaskViewWithCatalog,
    [service, filter, organization, expression, workspace.client],
    {
      execute:
        !(needsWorkspace && workspace.isLoading) &&
        !(needsWorkspace && workspace.error),
      onError: () => undefined,
    },
  );
  const data = viewResult?.tasks;
  const allTasks = viewResult?.allTasks ?? data ?? [];

  const taskActions = useTaskListActions({
    service,
    client: workspace.client,
    organization,
    revalidateTasks: async () => {
      const [res] = await Promise.all([revalidate(), onMutated?.()]);
      return res;
    },
    revalidateWorkspace: async () => {
      const [res] = await Promise.all([workspace.revalidate(), onMutated?.()]);
      return res;
    },
  });

  const projects = [
    ...new Set([
      ...(activeProject ? [activeProject] : []),
      ...(viewResult?.projects || []),
      ...(organization?.projects || []).map((item) => item.name),
      ...allTasks.flatMap((task) => (task.project ? [task.project] : [])),
    ]),
  ].sort();
  const tags = [
    ...new Set([
      ...(organization?.tags || []).map((item) => item.name),
      ...allTasks.flatMap((task) => task.tags),
    ]),
  ].sort();

  const custom = isCustomFilterView(filter);
  const groups = custom
    ? ["all"]
    : filter === "completed"
      ? ["completed"]
      : GROUPS;
  const tasks = data || [];
  const subtaskMeta = buildSubtaskMeta(allTasks, organization);
  const viewError = error || (needsWorkspace ? workspace.error : undefined);
  const emptyView = emptyViewCopy(
    filter,
    isLoading || (needsWorkspace && workspace.isLoading),
    viewError,
    organization,
  );
  const activeFocusProjects = (organization?.projects || []).filter(
    (project) => projectStatus(project) === "active",
  );
  const focusPartition =
    filter === "focus" ? partitionFocusTasks(tasks, organization) : undefined;
  const columnSections =
    !viewError && activeProject
      ? buildProjectColumnSections(
          tasks,
          allTasks,
          board,
          activeProject,
          subtaskMeta,
          organization,
        )
      : null;

  const renderProjectScreen = (
    projectName: string,
    onProjectMutated?: () => Promise<unknown>,
  ) => (
    <TaskListScreen
      initialFilter={`project:${projectName}`}
      onMutated={async () => {
        await Promise.all([
          revalidate(),
          workspace.revalidate(),
          onProjectMutated?.(),
          onMutated?.(),
        ]);
      }}
    />
  );

  const commonActionProps: CommonTaskActionsProps = {
    service,
    client: workspace.client,
    workspaceError: workspace.error,
    organization,
    knownProjects: projects,
    defaultProject: activeProject,
    currentView: filter,
    expression,
    undoTask: taskActions.undoTask,
    showInspector,
    onToggleInspector: toggleInspector,
    renderSubtaskScreen: (target) => (
      <SubtaskList
        parentUuid={target.uuid}
        initialTask={target}
        initialAllTasks={allTasks}
        initialOrganization={organization}
        knownProjects={projects}
        service={service}
        showInspector={showInspector}
        onToggleInspector={toggleInspector}
        renderProjectScreen={renderProjectScreen}
        onParentRefresh={taskActions.refreshAll}
      />
    ),
    renderProjectScreen,
    onSelectView: setFilter,
    onApplyExpression: (value) => {
      setExpression(value);
      setFilter("expression");
    },
    onRefreshAll: taskActions.refreshAll,
    onUndo: taskActions.undo,
    onRestoreElixir: taskActions.restoreElixir,
  };

  const navSectionTitle = activeProject
    ? projectPath(activeProject)
    : filter === "focus"
      ? "Focus"
      : undefined;

  function renderSectionEntries(
    key: string,
    title: string | undefined,
    entries: TaskSectionEntry[],
    group: string,
  ) {
    if (!entries.length) return null;
    return (
      <List.Section
        key={key}
        title={title}
        subtitle={title ? String(entries.length) : undefined}
      >
        {entries.map(({ task, parentTask, children, orphanedFromParent }) => (
          <TaskListRow
            key={task.uuid}
            task={task}
            group={group}
            parentTask={parentTask}
            subtasks={children}
            showParentBreadcrumb={orphanedFromParent}
            showInspector={showInspector}
            subtaskMeta={subtaskMeta}
            service={service}
            client={workspace.client}
            organization={organization}
            board={board}
            actions={taskActions}
            commonProps={commonActionProps}
          />
        ))}
      </List.Section>
    );
  }

  function renderGroupedTasks(
    taskSubset: TaskwarriorTask[],
    targetGroups: readonly string[],
  ) {
    return targetGroups.map((group) => {
      const items = taskSubset.filter(
        (task) =>
          group === "all" || group === "completed" || taskGroup(task) === group,
      );
      return renderSectionEntries(
        group,
        custom ? undefined : GROUP_TITLES[group as keyof typeof GROUP_TITLES],
        selectSectionTasks(items, subtaskMeta),
        group,
      );
    });
  }

  const manageFocusTarget =
    workspace.client && organization ? (
      <FocusProjects
        workspace={workspace.client}
        initial={organization}
        service={service}
        onSaved={taskActions.refreshAll}
        renderProjectScreen={renderProjectScreen}
      />
    ) : undefined;

  return (
    <List
      isLoading={
        isLoading ||
        (needsWorkspace && workspace.isLoading) ||
        taskActions.isMutating
      }
      isShowingDetail={showInspector}
      navigationTitle={listNavigationTitle(
        service.connection.label,
        organization,
        navSectionTitle,
      )}
      searchBarPlaceholder="Search tasks, subtasks, projects or tags"
      searchBarAccessory={
        <TaskViewDropdown
          filter={filter}
          onChange={setFilter}
          organization={organization}
          board={board}
          tags={tags}
          projects={projects}
        />
      }
    >
      <List.EmptyView
        icon={viewError ? Icon.Warning : Icon.CheckCircle}
        title={emptyView.title}
        description={emptyView.description}
        actions={
          <ActionPanel>
            {needsWorkspace && (
              <Action
                title="View All Pending Tasks"
                icon={Icon.List}
                onAction={() => setFilter("pending")}
              />
            )}
            <CommonTaskActions {...commonActionProps} />
          </ActionPanel>
        }
      />
      {(error || workspace.error) && (
        <List.Item
          id="refresh-focus"
          title="Reconnect and Refresh"
          subtitle={workspace.error?.message || error?.message}
          icon={Icon.ArrowClockwise}
          actions={
            <ActionPanel>
              <Action
                title="Reconnect and Refresh"
                onAction={taskActions.refreshAll}
              />
              {needsWorkspace && (
                <Action
                  title="View All Pending Tasks"
                  icon={Icon.List}
                  onAction={() => setFilter("pending")}
                />
              )}
              <CommonTaskActions {...commonActionProps} />
            </ActionPanel>
          }
        />
      )}
      {filter === "focus" && organization && activeFocusProjects.length > 0 && (
        <List.Section
          title={`Focus Projects · ${activeFocusProjects.length}/${FOCUS_LIMIT}`}
          subtitle={String(activeFocusProjects.length)}
        >
          {activeFocusProjects.map((project) => {
            const count = countProjectTasks(
              organization.projectCounts,
              project.name,
            );
            return (
              <List.Item
                key={`focus-project:${project.name}`}
                id={`focus-project:${project.name}`}
                title={projectPath(project.name)}
                subtitle={
                  showInspector
                    ? undefined
                    : project.outcome || project.description || undefined
                }
                keywords={[
                  project.name,
                  project.outcome || "",
                  project.description || "",
                ]}
                icon={{
                  source: Icon.BullsEye,
                  tintColor: itemColor(project.color || "gray"),
                }}
                accessories={[
                  { tag: `${count} ${count === 1 ? "task" : "tasks"}` },
                ]}
                actions={
                  <ActionPanel>
                    <Action.Push
                      title="Open Project Tasks"
                      icon={Icon.List}
                      target={renderProjectScreen(project.name)}
                    />
                    <Action.Push
                      title="New Task in Project"
                      icon={Icon.Plus}
                      shortcut={Keyboard.Shortcut.Common.New}
                      target={
                        <TaskForm
                          service={service}
                          workspace={workspace.client}
                          labels={organization.tags}
                          knownProjects={projects}
                          initialInput={{
                            description: "",
                            project: project.name,
                            priority: "",
                            tags: [],
                          }}
                          onSaved={taskActions.refreshAll}
                        />
                      }
                    />
                    {manageFocusTarget ? (
                      <Action.Push
                        title="Manage Focus & Projects"
                        icon={Icon.Pencil}
                        shortcut={Keyboard.Shortcut.Common.Edit}
                        target={manageFocusTarget}
                      />
                    ) : null}
                    <CommonTaskActions {...commonActionProps} />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}
      {filter === "focus" &&
        manageFocusTarget &&
        activeFocusProjects.length === 0 && (
          <List.Item
            id="manage-focus-projects"
            title="Choose Focus Projects"
            subtitle={
              showInspector
                ? undefined
                : `0/${FOCUS_LIMIT} active · pick up to three focus projects`
            }
            icon={Icon.BullsEye}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Choose Focus Projects"
                  target={manageFocusTarget}
                />
                <CommonTaskActions {...commonActionProps} />
              </ActionPanel>
            }
          />
        )}
      {!viewError && columnSections
        ? columnSections.map((section) =>
            renderSectionEntries(
              `column:${section.id}`,
              section.title,
              section.entries,
              "pending",
            ),
          )
        : null}
      {!viewError && !columnSections && focusPartition ? (
        <>
          {renderSectionEntries(
            "focus-next-steps",
            "Next Steps",
            selectSectionTasks(focusPartition.nextSteps, subtaskMeta),
            "pending",
          )}
          {renderGroupedTasks(focusPartition.rest, GROUPS)}
        </>
      ) : null}
      {!viewError &&
        !columnSections &&
        !focusPartition &&
        renderGroupedTasks(tasks, groups)}
      {filter === "focus" &&
        manageFocusTarget &&
        activeFocusProjects.length > 0 && (
          <List.Section title="Manage">
            <List.Item
              id="manage-focus-projects"
              title="Manage Focus & Projects"
              subtitle={
                showInspector
                  ? undefined
                  : `${activeFocusProjects.length}/${FOCUS_LIMIT} active · edit goals, next steps, or pause`
              }
              icon={Icon.Gear}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Manage Focus & Projects"
                    target={manageFocusTarget}
                  />
                  <CommonTaskActions {...commonActionProps} />
                </ActionPanel>
              }
            />
          </List.Section>
        )}
    </List>
  );
}
