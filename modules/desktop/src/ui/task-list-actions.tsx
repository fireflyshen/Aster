import {
    Action,
    ActionPanel,
    Color,
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
import { ManageColumns } from "./manage-columns";
import { ManageFiltersAndTags } from "./manage-filters-tags";
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
    knownProjects?: string[];
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
    knownProjects,
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
                target={
                    <QuickCapture service={service} onSaved={onRefreshAll} />
                }
            />
            <Action.Push
                title="Add Task (Full Form)"
                icon={Icon.NewDocument}
                shortcut={{
                    macOS: { modifiers: ["cmd", "shift"], key: "n" },
                    Windows: { modifiers: ["ctrl", "shift"], key: "n" },
                }}
                target={
                    <TaskForm
                        service={service}
                        workspace={client}
                        labels={organization?.tags}
                        knownProjects={knownProjects}
                        onSaved={onRefreshAll}
                    />
                }
            />
            {client ? (
                <Action.Push
                    title="Data & Recovery"
                    icon={Icon.Trash}
                    target={
                        <RecoveryListView
                            workspace={client}
                            onSaved={onRefreshAll}
                        />
                    }
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
                    <FilterForm
                        expression={expression}
                        onApply={onApplyExpression}
                    />
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
            {client && organization ? (
                <Action.Push
                    title="Manage Filters & Labels"
                    icon={Icon.Tag}
                    target={
                        <ManageFiltersAndTags
                            workspace={client}
                            initial={organization}
                            onSaved={onRefreshAll}
                        />
                    }
                />
            ) : null}
            {client && organization ? (
                <Action.Push
                    title="Manage Board Columns"
                    icon={Icon.AppWindowSidebarLeft}
                    target={
                        <ManageColumns
                            workspace={client}
                            initial={organization}
                            onSaved={onRefreshAll}
                        />
                    }
                />
            ) : null}
            {client &&
            organization?.energy &&
            organization.energy.remaining <= 25 ? (
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

function presetDueDate(
    preset: "today" | "tomorrow" | "weekend" | "nextweek",
): Date {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    if (preset === "today") return new Date(y, m, d, 18, 0, 0, 0);
    if (preset === "tomorrow") return new Date(y, m, d + 1, 9, 0, 0, 0);
    if (preset === "weekend") {
        let delta = (6 - now.getDay() + 7) % 7;
        if (delta === 0 && now.getHours() >= 18) delta = 7;
        return new Date(y, m, d + delta, 18, 0, 0, 0);
    }
    let delta = (8 - now.getDay()) % 7;
    if (delta === 0) delta = 7;
    return new Date(y, m, d + delta, 9, 0, 0, 0);
}

interface TaskRowActionsProps {
    task: TaskwarriorTask;
    parentTask?: TaskwarriorTask;
    subtasks?: TaskwarriorTask[];
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
    parentTask,
    subtasks = [],
    service,
    client,
    organization,
    board,
    actions,
    commonProps,
}: TaskRowActionsProps) {
    const completed = task.status === "completed";
    const taskDescription = organization?.descriptions?.[task.uuid];
    const isSubtask = !!organization?.subtasks?.[task.uuid];
    const trackedSeconds =
        organization?.energy?.taskSeconds?.[task.uuid.toLowerCase()];

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
                        initialDescription={taskDescription}
                        knownProjects={commonProps.knownProjects}
                        service={service}
                        onSaved={actions.refreshAll}
                        workspace={client}
                        labels={organization?.tags}
                    />
                }
            />
            {!completed && client ? (
                <Action.Push
                    title="Add Subtask…"
                    icon={Icon.Plus}
                    shortcut={{
                        macOS: { modifiers: ["cmd", "opt"], key: "s" },
                        Windows: { modifiers: ["ctrl", "alt"], key: "s" },
                    }}
                    target={
                        <TaskForm
                            parentTask={task}
                            knownProjects={commonProps.knownProjects}
                            service={service}
                            onSaved={actions.refreshAll}
                            workspace={client}
                            labels={organization?.tags}
                        />
                    }
                />
            ) : null}
            {isSubtask && client && organization ? (
                <Action
                    title="Unlink from Parent Task"
                    icon={Icon.Link}
                    onAction={() => actions.unlinkSubtask(task)}
                />
            ) : null}
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
                    <ActionPanel.Submenu
                        title="Schedule Due…"
                        icon={Icon.Calendar}
                        shortcut={{
                            macOS: { modifiers: ["cmd", "opt"], key: "d" },
                            Windows: { modifiers: ["ctrl", "alt"], key: "d" },
                        }}
                    >
                        <Action
                            title="Today (18:00)"
                            icon={{
                                source: Icon.Calendar,
                                tintColor: Color.Green,
                            }}
                            onAction={() =>
                                actions.rescheduleDue(
                                    task,
                                    presetDueDate("today"),
                                    true,
                                )
                            }
                        />
                        <Action
                            title="Tomorrow (09:00)"
                            icon={{
                                source: Icon.Calendar,
                                tintColor: Color.Orange,
                            }}
                            onAction={() =>
                                actions.rescheduleDue(
                                    task,
                                    presetDueDate("tomorrow"),
                                    true,
                                )
                            }
                        />
                        <Action
                            title="This Weekend (18:00)"
                            icon={Icon.Calendar}
                            onAction={() =>
                                actions.rescheduleDue(
                                    task,
                                    presetDueDate("weekend"),
                                    true,
                                )
                            }
                        />
                        <Action
                            title="Next Monday (09:00)"
                            icon={Icon.Calendar}
                            onAction={() =>
                                actions.rescheduleDue(
                                    task,
                                    presetDueDate("nextweek"),
                                    true,
                                )
                            }
                        />
                        <Action.PickDate
                            title="Pick Date…"
                            type={Action.PickDate.Type.Date}
                            onChange={(date) => {
                                if (date)
                                    void actions.rescheduleDue(task, date);
                            }}
                        />
                        {task.due ? (
                            <Action
                                title="Clear Due Date"
                                icon={Icon.XMarkCircle}
                                onAction={() =>
                                    actions.rescheduleDue(task, null)
                                }
                            />
                        ) : null}
                    </ActionPanel.Submenu>
                    <ActionPanel.Submenu
                        title="Set Priority…"
                        icon={Icon.Flag}
                        shortcut={{
                            macOS: { modifiers: ["cmd", "shift"], key: "p" },
                            Windows: { modifiers: ["ctrl", "shift"], key: "p" },
                        }}
                    >
                        <Action
                            title="P1 · High"
                            icon={{ source: Icon.Flag, tintColor: Color.Red }}
                            onAction={() => actions.setPriority(task, "H")}
                        />
                        <Action
                            title="P2 · Medium"
                            icon={{
                                source: Icon.Flag,
                                tintColor: Color.Orange,
                            }}
                            onAction={() => actions.setPriority(task, "M")}
                        />
                        <Action
                            title="P3 · Low"
                            icon={{ source: Icon.Flag, tintColor: Color.Blue }}
                            onAction={() => actions.setPriority(task, "L")}
                        />
                        <Action
                            title="None"
                            icon={Icon.Minus}
                            onAction={() => actions.setPriority(task, "")}
                        />
                    </ActionPanel.Submenu>
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
                            description={taskDescription}
                            parentTask={parentTask}
                            subtasks={subtasks}
                            trackedSeconds={trackedSeconds}
                            organization={organization}
                            projectDescription={
                                organization?.projects?.find(
                                    (project) => project.name === task.project,
                                )?.description
                            }
                            columnName={
                                organization &&
                                [unsectionedColumn, ...board.columns].find(
                                    (column) =>
                                        column.id === taskColumnId(task, board),
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
            <Action.CopyToClipboard
                title="Copy Task"
                content={task.description}
            />
            <CommonTaskActions {...commonProps} />
        </ActionPanel>
    );
}
