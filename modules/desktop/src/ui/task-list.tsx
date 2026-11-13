import { Action, ActionPanel, Icon, List, LocalStorage } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { taskGroup } from "../../../core/tasks/model.ts";
import { defaultBoard } from "../../../core/workspace/board.ts";
import { loadTaskViewWithCatalog } from "../../../core/workspace/task-views.ts";
import { FocusProjects } from "./focus-projects";
import { SubtaskList } from "./subtask-list";
import {
  CommonTaskActions,
  type CommonTaskActionsProps,
} from "./task-list-actions";
import { TaskViewDropdown } from "./task-list-dropdown";
import {
  buildSubtaskMeta,
  emptyViewCopy,
  GROUP_TITLES,
  GROUPS,
  isCustomFilterView,
  listNavigationTitle,
  selectSectionTasks,
} from "./task-list-model";
import { TaskListRow } from "./task-row";
import { useTaskListActions } from "./use-task-list-actions";
import { useTaskService } from "./use-task-service";
import { useWorkspace } from "./use-workspace";

const INSPECTOR_STORAGE_KEY = "aster:showInspector";

/** Main Raycast task list command supporting views, Focus goals, timers, split inspector, and subtask drill-down. */
export default function MyTasks() {
  const service = useTaskService();
  const [filter, setFilter] = useState("focus");
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
    revalidateTasks: revalidate,
    revalidateWorkspace: workspace.revalidate,
  });

  const projects = [
    ...new Set([
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

  const commonActionProps: CommonTaskActionsProps = {
    service,
    client: workspace.client,
    workspaceError: workspace.error,
    organization,
    knownProjects: projects,
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
        onParentRefresh={taskActions.refreshAll}
      />
    ),
    onApplyExpression: (value) => {
      setExpression(value);
      setFilter("expression");
    },
    onRefreshAll: taskActions.refreshAll,
    onUndo: taskActions.undo,
    onRestoreElixir: taskActions.restoreElixir,
  };

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
              <CommonTaskActions {...commonActionProps} />
            </ActionPanel>
          }
        />
      )}
      {filter === "focus" && workspace.client && organization && (
        <List.Item
          id="manage-focus-projects"
          title="Manage Focus Projects"
          subtitle={
            showInspector
              ? undefined
              : `${(organization.projects || []).filter((project) => project.status === "active").length}/3 active · choose projects and next steps`
          }
          icon={Icon.BullsEye}
          actions={
            <ActionPanel>
              <Action.Push
                title="Manage Focus Projects"
                target={
                  <FocusProjects
                    workspace={workspace.client}
                    initial={organization}
                    service={service}
                    onSaved={taskActions.refreshAll}
                  />
                }
              />
              <CommonTaskActions {...commonActionProps} />
            </ActionPanel>
          }
        />
      )}
      {!viewError &&
        groups.map((group) => {
          const items = tasks.filter(
            (task) =>
              group === "all" ||
              group === "completed" ||
              taskGroup(task) === group,
          );
          const sectionEntries = selectSectionTasks(items, subtaskMeta);
          return sectionEntries.length ? (
            <List.Section
              key={group}
              title={
                custom
                  ? undefined
                  : GROUP_TITLES[group as keyof typeof GROUP_TITLES]
              }
              subtitle={String(sectionEntries.length)}
            >
              {sectionEntries.map(
                ({ task, parentTask, children, orphanedFromParent }) => (
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
                ),
              )}
            </List.Section>
          ) : null;
        })}
    </List>
  );
}
