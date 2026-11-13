import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  showToast,
  Toast,
} from "@raycast/api";
import type { TaskwarriorTask } from "../../../core/tasks/model.ts";
import type { TaskService } from "../../../core/tasks/service.ts";
import {
  type BoardState,
  taskColumnId,
  unsectionedColumn,
} from "../../../core/workspace/board.ts";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import type { Organization } from "../../../core/workspace/organization.ts";
import CheckConnection from "./connection-check";
import { FilterForm } from "./filter-form";
import { FocusProjects } from "./focus-projects";
import { MoveTask } from "./move-task";
import { QuickCapture } from "./quick-capture";
import { TaskDetail } from "./task-detail";
import { NotesList, RecoveryListView, SeriesForm } from "./task-extras";
import { TaskForm } from "./task-form";
import type { useTaskListActions } from "./use-task-list-actions";

type TaskActionsController = ReturnType<typeof useTaskListActions>;

export interface CommonTaskActionsProps {
  service: TaskService;
  client: WorkspaceClient | undefined;
  workspaceError: Error | undefined;
  organization: Organization | undefined;
  expression: string;
  undoTask: TaskwarriorTask | undefined;
  onApplyExpression: (value: string) => void;
  onRefreshAll: () => Promise<unknown>;
  onUndo: () => Promise<void>;
  onRestoreElixir: () => Promise<void>;
}

/** Shared workspace-level actions included at the bottom of task action panels and empty views. */
export function CommonTaskActions({
  service,
  client,
  workspaceError,
  organization,
  expression,
  undoTask,
  onApplyExpression,
  onRefreshAll,
  onUndo,
  onRestoreElixir,
}: CommonTaskActionsProps) {
  return (
    <ActionPanel.Section>
      <Action.Push
        title="Quick Add Task"
        icon={Icon.Plus}
        shortcut={Keyboard.Shortcut.Common.New}
        target={<QuickCapture service={service} onSaved={onRefreshAll} />}
      />
      {client ? (
        <Action.Push
          title="Data & Recovery"
          icon={Icon.Trash}
          target={<RecoveryListView workspace={client} onSaved={onRefreshAll} />}
        />
      ) : null}
      <Action
        title="Refresh Tasks"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={onRefreshAll}
      />
      <Action.Push
        title="Filter by Expression…"
        icon={Icon.Filter}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "f" },
          Windows: { modifiers: ["ctrl", "shift"], key: "f" },
        }}
        target={
          <FilterForm expression={expression} onApply={onApplyExpression} />
        }
      />
      {undoTask ? (
        <Action
          title="Undo Last Completion"
          icon={Icon.ArrowCounterClockwise}
          shortcut={{
            macOS: { modifiers: ["cmd"], key: "z" },
            Windows: { modifiers: ["ctrl"], key: "z" },
          }}
          onAction={onUndo}
        />
      ) : null}
      {client && organization ? (
        <Action.Push
          title="Manage Focus Projects"
          icon={Icon.BullsEye}
          target={
            <FocusProjects
              workspace={client}
              initial={organization}
              service={service}
              onSaved={onRefreshAll}
            />
          }
        />
      ) : null}
      {client && organization?.energy && organization.energy.remaining <= 25 ? (
        <Action
          title="Restore +30 Energy (Elixir)"
          icon={Icon.Bolt}
          onAction={onRestoreElixir}
        />
      ) : null}
      {client ? (
        <Action.OpenInBrowser
          title="Open Aster Web"
          icon={Icon.Globe}
          url={client.url}
          shortcut={Keyboard.Shortcut.Common.OpenWith}
        />
      ) : null}
      {workspaceError ? (
        <Action
          title="Web Workspace Status"
          icon={Icon.Warning}
          onAction={() =>
            showToast({
              style: Toast.Style.Failure,
              title: "Web Workspace Unavailable",
              message: workspaceError.message,
            })
          }
        />
      ) : null}
      <Action.Push
        title="Check Connection"
        icon={Icon.Network}
        target={<CheckConnection service={service} />}
      />
    </ActionPanel.Section>
  );
}

interface TaskRowActionsProps {
  task: TaskwarriorTask;
  service: TaskService;
  client: WorkspaceClient | undefined;
  organization: Organization | undefined;
  board: BoardState;
  actions: TaskActionsController;
  commonProps: CommonTaskActionsProps;
}

/** Builds the complete Raycast `ActionPanel` for an individual task row. */
export function TaskRowActions({
  task,
  service,
  client,
  organization,
  board,
  actions,
  commonProps,
}: TaskRowActionsProps) {
  const completed = task.status === "completed";

  return (
    <ActionPanel>
      <Action
        title={completed ? "Reopen Task" : "Complete Task"}
        icon={completed ? Icon.ArrowCounterClockwise : Icon.CheckCircle}
        onAction={() =>
          actions.mutate(
            task,
            completed ? "Task reopened" : "Task completed",
            () =>
              completed
                ? actions.runTaskAction(task, "reopen")
                : actions.runTaskAction(task, "complete"),
            true,
          )
        }
      />
      <Action.Push
        title="Edit Task"
        icon={Icon.Pencil}
        shortcut={Keyboard.Shortcut.Common.Edit}
        target={
          <TaskForm
            task={task}
            service={service}
            onSaved={actions.refreshAll}
            workspace={client}
            labels={organization?.tags}
          />
        }
      />
      {client && organization ? (
        <Action.Push
          title="Move to Column…"
          icon={Icon.ArrowRight}
          shortcut={{
            macOS: { modifiers: ["cmd", "shift"], key: "m" },
            Windows: { modifiers: ["ctrl", "shift"], key: "m" },
          }}
          target={
            <MoveTask
              task={task}
              workspace={client}
              initial={organization}
              onSaved={actions.refreshAll}
            />
          }
        />
      ) : null}
      {!completed && task.project && organization && client ? (
        <Action
          title="Set as Next Step"
          icon={Icon.ArrowRight}
          onAction={() => actions.setTaskNextStep(task)}
        />
      ) : null}
      {!completed ? (
        <ActionPanel.Section>
          <Action
            title={task.start ? "Stop Task" : "Start Task"}
            icon={task.start ? Icon.Stop : Icon.Play}
            onAction={() => actions.startOrStopTask(task)}
          />
          <Action.PickDate
            title="Defer Until…"
            type={Action.PickDate.Type.Date}
            onChange={(date) => actions.deferTask(task, date)}
          />
          {task.wait ? (
            <Action
              title="Clear Waiting Date"
              icon={Icon.Clock}
              onAction={() => actions.clearWaitingDate(task)}
            />
          ) : null}
        </ActionPanel.Section>
      ) : null}
      <ActionPanel.Section>
        <Action.Push
          title="Show Details"
          icon={Icon.Eye}
          shortcut={Keyboard.Shortcut.Common.Open}
          target={
            <TaskDetail
              task={task}
              projectDescription={
                organization?.projects?.find(
                  (project) => project.name === task.project,
                )?.description
              }
              columnName={
                organization &&
                [unsectionedColumn, ...board.columns].find(
                  (column) => column.id === taskColumnId(task, board),
                )?.name
              }
            />
          }
        />
        {task.parent ? (
          <Action.Push
            title="Edit Series"
            icon={Icon.ArrowClockwise}
            target={
              <SeriesForm
                uuid={task.parent}
                service={service}
                workspace={client}
                onSaved={actions.refreshAll}
              />
            }
          />
        ) : null}
        <Action.Push
          title="Manage Notes"
          icon={Icon.Text}
          target={
            <NotesList
              uuid={task.uuid}
              service={service}
              workspace={client}
              onSaved={actions.refreshAll}
            />
          }
        />
        <Action
          title="Delete Task"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          onAction={() => actions.confirmDeleteTask(task)}
        />
      </ActionPanel.Section>
      <Action.CopyToClipboard title="Copy Task" content={task.description} />
      <CommonTaskActions {...commonProps} />
    </ActionPanel>
  );
}
