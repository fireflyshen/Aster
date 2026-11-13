import { ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { taskGroup, type TaskwarriorTask } from "../../../core/tasks/model.ts";
import type { TaskService } from "../../../core/tasks/service.ts";
import { defaultBoard } from "../../../core/workspace/board.ts";
import type { Organization } from "../../../core/workspace/organization.ts";
import { queryWorkspaceTasksWithCatalog } from "../../../core/workspace/task-views.ts";
import {
  CommonTaskActions,
  type CommonTaskActionsProps,
} from "./task-list-actions";
import { buildSubtaskMeta } from "./task-list-model";
import { TaskListRow } from "./task-row";
import { useTaskListActions } from "./use-task-list-actions";
import { useWorkspace } from "./use-workspace";

export interface SubtaskListProps {
  parentUuid: string;
  initialTask: TaskwarriorTask;
  initialAllTasks: TaskwarriorTask[];
  initialOrganization: Organization | undefined;
  knownProjects: string[];
  service: TaskService;
  showInspector: boolean;
  onToggleInspector: () => void;
  onParentRefresh: () => Promise<unknown>;
}

/** Native Raycast drill-down view displaying a parent task, its pending subtasks, and its completed checklist items. */
export function SubtaskList({
  parentUuid,
  initialTask,
  initialAllTasks,
  initialOrganization,
  knownProjects,
  service,
  showInspector,
  onToggleInspector,
  onParentRefresh,
}: SubtaskListProps) {
  const [inspector, setInspector] = useState(showInspector);
  const [fetchAllScope, setFetchAllScope] = useState(
    initialTask.status === "completed",
  );
  const workspace = useWorkspace(service.connection);
  const organization =
    (workspace.error ? undefined : workspace.data) ?? initialOrganization;
  const board = organization?.board || defaultBoard();

  const { data, isLoading, revalidate } = usePromise(
    (allScope: boolean) =>
      queryWorkspaceTasksWithCatalog(
        service,
        { scope: allScope ? "all" : "pending" },
        workspace.client,
      ),
    [fetchAllScope],
    { onError: () => undefined },
  );

  useEffect(() => {
    if (
      !fetchAllScope &&
      data?.tasks &&
      !data.tasks.some((item) => item.uuid === parentUuid)
    ) {
      setFetchAllScope(true);
    }
  }, [data, fetchAllScope, parentUuid]);

  function handleToggleInspector() {
    setInspector((prev) => !prev);
    onToggleInspector();
  }

  const allTasks = data?.tasks ?? initialAllTasks;
  const subtaskMeta = buildSubtaskMeta(allTasks, organization);
  const parent = subtaskMeta.taskByUuid.get(parentUuid) ?? initialTask;
  const children = subtaskMeta.childrenOf.get(parent.uuid) || [];
  const pendingChildren = children.filter(
    (item) => item.status !== "completed",
  );
  const completedChildren = children.filter(
    (item) => item.status === "completed",
  );

  const actions = useTaskListActions({
    service,
    client: workspace.client,
    organization,
    revalidateTasks: async () => {
      const [res] = await Promise.all([revalidate(), onParentRefresh()]);
      return res;
    },
    revalidateWorkspace: async () => {
      const [res] = await Promise.all([
        workspace.revalidate(),
        onParentRefresh(),
      ]);
      return res;
    },
  });

  const grandParentUuid = subtaskMeta.parentOf[parent.uuid];
  const grandParent = grandParentUuid
    ? subtaskMeta.taskByUuid.get(grandParentUuid)
    : undefined;

  const projects = [
    ...new Set([
      ...knownProjects,
      ...(data?.projects || []),
      ...(organization?.projects || []).map((item) => item.name),
    ]),
  ].sort();

  const renderSubtaskScreen = (target: TaskwarriorTask) => (
    <SubtaskList
      parentUuid={target.uuid}
      initialTask={target}
      initialAllTasks={allTasks}
      initialOrganization={organization}
      knownProjects={projects}
      service={service}
      showInspector={inspector}
      onToggleInspector={handleToggleInspector}
      onParentRefresh={actions.refreshAll}
    />
  );

  const commonProps: CommonTaskActionsProps = {
    service,
    client: workspace.client,
    workspaceError: workspace.error,
    organization,
    knownProjects: projects,
    expression: "",
    undoTask: actions.undoTask,
    showInspector: inspector,
    subtaskParentTask: parent,
    onToggleInspector: handleToggleInspector,
    renderSubtaskScreen,
    onRefreshAll: actions.refreshAll,
    onUndo: actions.undo,
    onRestoreElixir: actions.restoreElixir,
  };

  const doneCount = completedChildren.length;
  const navigationTitle =
    children.length > 0
      ? `${parent.description} (${doneCount}/${children.length})`
      : parent.description;

  return (
    <List
      isLoading={isLoading || actions.isMutating}
      isShowingDetail={inspector}
      navigationTitle={navigationTitle}
      searchBarPlaceholder="Filter subtasks…"
    >
      <List.Section title="Parent Task">
        <TaskListRow
          key={parent.uuid}
          task={parent}
          group={
            parent.status === "completed" ? "completed" : taskGroup(parent)
          }
          parentTask={grandParent}
          subtasks={children}
          showParentBreadcrumb={!!grandParent}
          showInspector={inspector}
          subtaskMeta={subtaskMeta}
          currentSubtaskParentUuid={parent.uuid}
          service={service}
          client={workspace.client}
          organization={organization}
          board={board}
          actions={actions}
          commonProps={commonProps}
        />
      </List.Section>

      {children.length === 0 ? (
        <List.Section title="Subtasks">
          <List.Item
            id={`add-subtask-${parent.uuid}`}
            title="Add First Subtask…"
            subtitle="Break this task into smaller steps"
            icon={Icon.Plus}
            actions={
              <ActionPanel>
                <CommonTaskActions {...commonProps} />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}

      {pendingChildren.length > 0 ? (
        <List.Section
          title="Subtasks"
          subtitle={String(pendingChildren.length)}
        >
          {pendingChildren.map((child) => (
            <TaskListRow
              key={child.uuid}
              task={child}
              group={taskGroup(child)}
              parentTask={parent}
              subtasks={subtaskMeta.childrenOf.get(child.uuid) || []}
              showInspector={inspector}
              subtaskMeta={subtaskMeta}
              currentSubtaskParentUuid={parent.uuid}
              service={service}
              client={workspace.client}
              organization={organization}
              board={board}
              actions={actions}
              commonProps={commonProps}
            />
          ))}
        </List.Section>
      ) : null}

      {completedChildren.length > 0 ? (
        <List.Section
          title="Completed Subtasks"
          subtitle={String(completedChildren.length)}
        >
          {completedChildren.map((child) => (
            <TaskListRow
              key={child.uuid}
              task={child}
              group="completed"
              parentTask={parent}
              subtasks={subtaskMeta.childrenOf.get(child.uuid) || []}
              showInspector={inspector}
              subtaskMeta={subtaskMeta}
              currentSubtaskParentUuid={parent.uuid}
              service={service}
              client={workspace.client}
              organization={organization}
              board={board}
              actions={actions}
              commonProps={commonProps}
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  );
}
