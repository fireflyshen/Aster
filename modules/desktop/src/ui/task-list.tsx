import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { taskGroup } from "../../../core/tasks/model.ts";
import { defaultBoard } from "../../../core/workspace/board.ts";
import {
  loadTaskCatalog,
  loadTaskView,
} from "../../../core/workspace/task-views.ts";
import { FocusProjects } from "./focus-projects";
import {
  CommonTaskActions,
  type CommonTaskActionsProps,
  TaskRowActions,
} from "./task-list-actions";
import { TaskViewDropdown } from "./task-list-dropdown";
import {
  emptyViewCopy,
  GROUP_TITLES,
  GROUPS,
  isCustomFilterView,
  listNavigationTitle,
  taskAccessories,
  taskItemIcon,
} from "./task-list-model";
import { useTaskListActions } from "./use-task-list-actions";
import { useTaskService } from "./use-task-service";
import { useWorkspace } from "./use-workspace";

/** Main Raycast task list command supporting views, Focus goals, timers, and shared actions. */
export default function MyTasks() {
  const service = useTaskService();
  const [filter, setFilter] = useState("focus");
  const [expression, setExpression] = useState("");
  const workspace = useWorkspace(service.connection);
  const organization = workspace.error ? undefined : workspace.data;
  const board = organization?.board || defaultBoard();

  const { data, error, isLoading, revalidate } = usePromise(
    loadTaskView,
    [service, filter, organization, expression, workspace.client],
    { onError: () => undefined },
  );
  const catalog = usePromise(loadTaskCatalog, [service, workspace.client], {
    onError: () => undefined,
  });

  const taskActions = useTaskListActions({
    service,
    client: workspace.client,
    organization,
    revalidateTasks: revalidate,
    revalidateWorkspace: workspace.revalidate,
    revalidateCatalog: catalog.revalidate,
  });

  const projects = [
    ...new Set([
      ...(catalog.data?.projects || []),
      ...(organization?.projects || []).map((item) => item.name),
      ...(data || []).flatMap((task) => (task.project ? [task.project] : [])),
    ]),
  ].sort();
  const tags = [
    ...new Set([
      ...(catalog.data?.tags || []),
      ...(organization?.tags || []).map((item) => item.name),
    ]),
  ].sort();

  const custom = isCustomFilterView(filter);
  const groups = custom
    ? ["all"]
    : filter === "completed"
      ? ["completed"]
      : GROUPS;
  const tasks = data || [];
  const emptyView = emptyViewCopy(filter, isLoading, error, organization);

  const commonActionProps: CommonTaskActionsProps = {
    service,
    client: workspace.client,
    workspaceError: workspace.error,
    organization,
    expression,
    undoTask: taskActions.undoTask,
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
      isLoading={isLoading || taskActions.isMutating}
      navigationTitle={listNavigationTitle(
        service.connection.label,
        organization,
      )}
      searchBarPlaceholder="Search description, project or tags"
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
        icon={error ? Icon.Warning : Icon.CheckCircle}
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
          subtitle={error?.message || workspace.error?.message}
          icon={Icon.ArrowClockwise}
          actions={
            <ActionPanel>
              <Action
                title="Reconnect and Refresh"
                onAction={taskActions.refreshAll}
              />
            </ActionPanel>
          }
        />
      )}
      {filter === "focus" && workspace.client && organization && (
        <List.Item
          id="manage-focus-projects"
          title="Manage Focus Projects"
          subtitle={`${(organization.projects || []).filter((project) => project.status === "active").length}/3 active · choose projects and next steps`}
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
      {!error &&
        groups.map((group) => {
          const items = tasks.filter(
            (task) =>
              group === "all" ||
              group === "completed" ||
              taskGroup(task) === group,
          );
          return items.length ? (
            <List.Section
              key={group}
              title={
                custom
                  ? undefined
                  : GROUP_TITLES[group as keyof typeof GROUP_TITLES]
              }
              subtitle={String(items.length)}
            >
              {items.map((task) => (
                <List.Item
                  key={task.uuid}
                  id={task.uuid}
                  icon={taskItemIcon(task, group, taskActions.pendingTask)}
                  title={task.description}
                  subtitle={task.project}
                  keywords={[
                    task.project ?? "",
                    ...task.tags,
                    String(task.id ?? ""),
                  ].filter(Boolean)}
                  accessories={taskAccessories(task, organization)}
                  actions={
                    taskActions.isMutating ||
                    taskActions.isTaskUnconfirmed(task.uuid) ? (
                      <ActionPanel>
                        <CommonTaskActions {...commonActionProps} />
                      </ActionPanel>
                    ) : (
                      <TaskRowActions
                        task={task}
                        service={service}
                        client={workspace.client}
                        organization={organization}
                        board={board}
                        actions={taskActions}
                        commonProps={commonActionProps}
                      />
                    )
                  }
                />
              ))}
            </List.Section>
          ) : null;
        })}
    </List>
  );
}
