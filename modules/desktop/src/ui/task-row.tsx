import { ActionPanel, List } from "@raycast/api";
import type { TaskwarriorTask } from "../../../core/tasks/model.ts";
import type { TaskService } from "../../../core/tasks/service.ts";
import {
  type BoardState,
  taskColumnId,
  unsectionedColumn,
} from "../../../core/workspace/board.ts";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import type { Organization } from "../../../core/workspace/organization.ts";
import { TaskListItemDetail } from "./task-detail";
import {
  CommonTaskActions,
  type CommonTaskActionsProps,
  type TaskActionsController,
  TaskRowActions,
} from "./task-list-actions";
import {
  type SubtaskMeta,
  taskAccessories,
  taskItemIcon,
} from "./task-list-model";

interface TaskListRowProps {
  task: TaskwarriorTask;
  group: string;
  parentTask?: TaskwarriorTask;
  subtasks: TaskwarriorTask[];
  showParentBreadcrumb?: boolean;
  showInspector: boolean;
  subtaskMeta: SubtaskMeta;
  currentSubtaskParentUuid?: string;
  service: TaskService;
  client: WorkspaceClient | undefined;
  organization: Organization | undefined;
  board: BoardState;
  actions: TaskActionsController;
  commonProps: CommonTaskActionsProps;
}

/** Clean native Raycast row shared between MyTasks and the drill-down SubtaskList screen. */
export function TaskListRow({
  task,
  group,
  parentTask,
  subtasks,
  showParentBreadcrumb = false,
  showInspector,
  subtaskMeta,
  currentSubtaskParentUuid,
  service,
  client,
  organization,
  board,
  actions,
  commonProps,
}: TaskListRowProps) {
  const description = organization?.descriptions?.[task.uuid];
  const trackedSeconds =
    organization?.energy?.taskSeconds?.[task.uuid.toLowerCase()];
  const columnName = organization
    ? [unsectionedColumn, ...board.columns].find(
        (column) => column.id === taskColumnId(task, board),
      )?.name
    : undefined;
  const projectDescription = organization?.projects?.find(
    (project) => project.name === task.project,
  )?.description;

  const subtitle = showInspector
    ? undefined
    : [
        task.project,
        showParentBreadcrumb && parentTask ? parentTask.description : undefined,
      ]
        .filter(Boolean)
        .join(" · ") || undefined;

  const unconfirmed =
    actions.isMutating || actions.isTaskUnconfirmed(task.uuid);

  return (
    <List.Item
      id={task.uuid}
      icon={taskItemIcon(task, group, actions.pendingTask)}
      title={task.description}
      subtitle={subtitle}
      keywords={[
        task.project ?? "",
        parentTask?.description ?? "",
        description ?? "",
        ...subtasks.map((child) => child.description),
        ...task.tags,
        String(task.id ?? ""),
      ].filter(Boolean)}
      accessories={
        showInspector
          ? undefined
          : taskAccessories(task, organization, subtaskMeta)
      }
      detail={
        showInspector ? (
          <TaskListItemDetail
            task={task}
            description={description}
            parentTask={parentTask}
            subtasks={subtasks}
            trackedSeconds={trackedSeconds}
            projectDescription={projectDescription}
            columnName={columnName}
            organization={organization}
          />
        ) : undefined
      }
      actions={
        unconfirmed ? (
          <ActionPanel>
            <CommonTaskActions {...commonProps} />
          </ActionPanel>
        ) : (
          <TaskRowActions
            task={task}
            parentTask={parentTask}
            subtasks={subtasks}
            currentSubtaskParentUuid={currentSubtaskParentUuid}
            service={service}
            client={client}
            organization={organization}
            board={board}
            actions={actions}
            commonProps={commonProps}
          />
        )
      }
    />
  );
}
