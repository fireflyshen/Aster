import { Action, ActionPanel, Detail, List } from "@raycast/api";
import type { ReactNode } from "react";
import type { TaskwarriorTask } from "../../../core/tasks/model.ts";
import { formatDuration } from "../../../core/workspace/energy.ts";
import {
    itemColor,
    type Organization,
} from "../../../core/workspace/organization.ts";
import { toneColor } from "./palette";
import {
    displayDate,
    priorityBadgeLabel,
    priorityTagColor,
    priorityTextLabel,
} from "./task-list-model";

function markdownText(value: string): string {
    return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

export interface TaskDetailDataProps {
    task: TaskwarriorTask;
    description?: string;
    parentTask?: TaskwarriorTask;
    subtasks?: TaskwarriorTask[];
    trackedSeconds?: number;
    projectDescription?: string;
    columnName?: string;
    organization?: Organization;
}

/** Builds clean Markdown sections for both the Split Inspector and the full TaskDetail screen. */
export function buildTaskDetailMarkdown({
    task,
    description,
    parentTask,
    subtasks = [],
    projectDescription,
}: TaskDetailDataProps): string {
    const sections: string[] = [`# ${markdownText(task.description)}`];
    if (parentTask) {
        sections.push(`> Part of **${markdownText(parentTask.description)}**`);
    }
    if (description?.trim()) {
        sections.push(`## Description\n\n${description.trim()}`);
    }
    if (subtasks.length) {
        const done = subtasks.filter(
            (item) => item.status === "completed",
        ).length;
        const list = subtasks
            .map((item) => {
                const meta: string[] = [];
                if (item.priority && item.status !== "completed") {
                    meta.push(priorityBadgeLabel(item.priority));
                }
                if (item.due && item.status !== "completed") {
                    meta.push(displayDate(item.due));
                }
                const suffix = meta.length ? ` · *${meta.join(" · ")}*` : "";
                return `- [${item.status === "completed" ? "x" : " "}] ${markdownText(item.description)}${suffix}`;
            })
            .join("\n");
        sections.push(`## Subtasks (${done}/${subtasks.length})\n\n${list}`);
    }
    if (projectDescription?.trim()) {
        sections.push(`## Project\n\n${markdownText(projectDescription)}`);
    }
    if (task.annotations.length) {
        const annotationText = task.annotations
            .map((item) => `- ${markdownText(item.description)}`)
            .join("\n");
        sections.push(`## Annotations\n\n${annotationText}`);
    }
    return sections.join("\n\n");
}

function renderMetadataRows(
    Metadata: typeof Detail.Metadata,
    {
        task,
        parentTask,
        subtasks = [],
        trackedSeconds,
        columnName,
        organization,
    }: TaskDetailDataProps,
) {
    const runningSeconds =
        task.start && task.status !== "completed"
            ? Math.max(
                  0,
                  Math.floor((Date.now() - task.start.getTime()) / 1000),
              )
            : 0;
    const doneCount = subtasks.filter(
        (item) => item.status === "completed",
    ).length;

    return (
        <Metadata>
            <Metadata.Label
                title="Status"
                text={
                    task.status === "completed"
                        ? "Completed"
                        : runningSeconds > 0
                          ? "In Progress"
                          : task.wait
                            ? "Waiting"
                            : "Pending"
                }
            />
            {parentTask ? (
                <Metadata.Label
                    title="Parent Task"
                    text={parentTask.description}
                />
            ) : null}
            {subtasks.length ? (
                <Metadata.Label
                    title="Subtasks"
                    text={`${doneCount}/${subtasks.length} completed`}
                />
            ) : null}
            {task.project ? (
                <Metadata.Label title="Project" text={task.project} />
            ) : null}
            {columnName ? (
                <Metadata.Label title="Column" text={columnName} />
            ) : null}
            {task.priority ? (
                <Metadata.TagList title="Priority">
                    <Metadata.TagList.Item
                        text={priorityTextLabel(task.priority)}
                        color={priorityTagColor(task.priority)}
                    />
                </Metadata.TagList>
            ) : null}
            {runningSeconds > 0 ? (
                <Metadata.TagList title="Active Timer">
                    <Metadata.TagList.Item
                        text={`Running (${formatDuration(runningSeconds)})`}
                        color={toneColor("timer")}
                    />
                </Metadata.TagList>
            ) : null}
            {trackedSeconds && trackedSeconds > 0 ? (
                <Metadata.Label
                    title="Tracked Today"
                    text={formatDuration(trackedSeconds)}
                />
            ) : null}
            {task.due ? (
                <Metadata.Label title="Due" text={task.due.toLocaleString()} />
            ) : null}
            {task.scheduled ? (
                <Metadata.Label
                    title="Scheduled"
                    text={task.scheduled.toLocaleString()}
                />
            ) : null}
            {task.wait ? (
                <Metadata.Label
                    title="Wait Until"
                    text={task.wait.toLocaleString()}
                />
            ) : null}
            {task.until ? (
                <Metadata.Label
                    title="Until"
                    text={task.until.toLocaleString()}
                />
            ) : null}
            {task.recur ? (
                <Metadata.Label title="Recurrence" text={task.recur} />
            ) : null}
            {task.status === "completed" && task.end ? (
                <Metadata.Label
                    title="Completed"
                    text={task.end.toLocaleString()}
                />
            ) : null}
            {task.tags.length ? (
                <Metadata.TagList title="Labels">
                    {task.tags.map((tag) => (
                        <Metadata.TagList.Item
                            key={tag}
                            text={tag}
                            color={itemColor(
                                organization?.tags.find(
                                    (item) => item.name === tag,
                                )?.color || "gray",
                            )}
                        />
                    ))}
                </Metadata.TagList>
            ) : null}
            {task.depends.length ? (
                <Metadata.Label
                    title="Dependencies"
                    text={String(task.depends.length)}
                />
            ) : null}
            {task.id ? (
                <Metadata.Label title="ID" text={String(task.id)} />
            ) : null}
        </Metadata>
    );
}

/** Inline split-pane detail panel attached to a task row when Inspector mode is active. */
export function TaskListItemDetail(props: TaskDetailDataProps) {
    return (
        <List.Item.Detail
            markdown={buildTaskDetailMarkdown(props)}
            metadata={renderMetadataRows(List.Item.Detail.Metadata, props)}
        />
    );
}

/** Full-screen Raycast Detail view for inspecting a task with interactive actions. */
export function TaskDetail(
    props: TaskDetailDataProps & { actions?: ReactNode },
) {
    const { task, actions } = props;
    return (
        <Detail
            navigationTitle={task.description}
            markdown={buildTaskDetailMarkdown(props)}
            metadata={renderMetadataRows(Detail.Metadata, props)}
            actions={
                actions || (
                    <ActionPanel>
                        <Action.CopyToClipboard
                            title="Copy Task Title"
                            content={task.description}
                        />
                        <Action.CopyToClipboard
                            title="Copy UUID"
                            content={task.uuid}
                        />
                    </ActionPanel>
                )
            }
        />
    );
}
