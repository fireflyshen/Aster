import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { taskGroup } from "../../../core/tasks/model.ts";
import { defaultBoard } from "../../../core/workspace/board.ts";
import { loadTaskViewWithCatalog } from "../../../core/workspace/task-views.ts";
import { FocusProjects } from "./focus-projects";
import {
    CommonTaskActions,
    type CommonTaskActionsProps,
    TaskRowActions,
} from "./task-list-actions";
import { TaskViewDropdown } from "./task-list-dropdown";
import {
    buildSubtaskMeta,
    emptyViewCopy,
    GROUP_TITLES,
    GROUPS,
    isCustomFilterView,
    listNavigationTitle,
    orderTasksWithSubtasks,
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
            ...(data || []).flatMap((task) =>
                task.project ? [task.project] : [],
            ),
        ]),
    ].sort();
    const tags = [
        ...new Set([
            ...(organization?.tags || []).map((item) => item.name),
            ...(data || []).flatMap((task) => task.tags),
        ]),
    ].sort();

    const custom = isCustomFilterView(filter);
    const groups = custom
        ? ["all"]
        : filter === "completed"
          ? ["completed"]
          : GROUPS;
    const tasks = data || [];
    const subtaskMeta = buildSubtaskMeta(tasks, organization);
    const subtasksByParent = new Map<string, typeof tasks>();
    for (const [childUuid, parentUuid] of Object.entries(
        subtaskMeta.parentOf,
    )) {
        const child = subtaskMeta.taskByUuid.get(childUuid);
        if (!child) continue;
        const list = subtasksByParent.get(parentUuid) || [];
        list.push(child);
        subtasksByParent.set(parentUuid, list);
    }
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
            {!viewError &&
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
                                    : GROUP_TITLES[
                                          group as keyof typeof GROUP_TITLES
                                      ]
                            }
                            subtitle={String(items.length)}
                        >
                            {orderTasksWithSubtasks(items, subtaskMeta).map(
                                ({ task, depth, parentDescription }) => {
                                    const parentUuid =
                                        subtaskMeta.parentOf[task.uuid];
                                    const parentTask = parentUuid
                                        ? subtaskMeta.taskByUuid.get(parentUuid)
                                        : undefined;
                                    const children =
                                        subtasksByParent.get(task.uuid) || [];
                                    const subtitle = [
                                        task.project,
                                        parentDescription
                                            ? `↳ ${parentDescription}`
                                            : undefined,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ");
                                    return (
                                        <List.Item
                                            key={task.uuid}
                                            id={task.uuid}
                                            icon={taskItemIcon(
                                                task,
                                                group,
                                                taskActions.pendingTask,
                                            )}
                                            title={
                                                depth > 0
                                                    ? `${"  ".repeat(depth)}└ ${task.description}`
                                                    : task.description
                                            }
                                            subtitle={subtitle || undefined}
                                            keywords={[
                                                task.project ?? "",
                                                organization?.descriptions?.[
                                                    task.uuid
                                                ] ?? "",
                                                ...task.tags,
                                                String(task.id ?? ""),
                                            ].filter(Boolean)}
                                            accessories={taskAccessories(
                                                task,
                                                organization,
                                                subtaskMeta,
                                            )}
                                            actions={
                                                taskActions.isMutating ||
                                                taskActions.isTaskUnconfirmed(
                                                    task.uuid,
                                                ) ? (
                                                    <ActionPanel>
                                                        <CommonTaskActions
                                                            {...commonActionProps}
                                                        />
                                                    </ActionPanel>
                                                ) : (
                                                    <TaskRowActions
                                                        task={task}
                                                        parentTask={parentTask}
                                                        subtasks={children}
                                                        service={service}
                                                        client={
                                                            workspace.client
                                                        }
                                                        organization={
                                                            organization
                                                        }
                                                        board={board}
                                                        actions={taskActions}
                                                        commonProps={
                                                            commonActionProps
                                                        }
                                                    />
                                                )
                                            }
                                        />
                                    );
                                },
                            )}
                        </List.Section>
                    ) : null;
                })}
        </List>
    );
}
