import { Action, ActionPanel, Color, Detail } from "@raycast/api";
import type { TaskwarriorTask } from "../../../core/tasks/model.ts";
import { formatDuration } from "../../../core/workspace/energy.ts";
import {
    itemColor,
    type Organization,
} from "../../../core/workspace/organization.ts";

function markdownText(value: string): string {
    return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function priorityText(priority: string): string {
    if (priority === "H") return "P1 · High";
    if (priority === "M") return "P2 · Medium";
    if (priority === "L") return "P3 · Low";
    return priority;
}

function priorityColor(priority: string): Color {
    if (priority === "H") return Color.Red;
    if (priority === "M") return Color.Orange;
    if (priority === "L") return Color.Blue;
    return Color.SecondaryText;
}

export function TaskDetail({
    task,
    description,
    parentTask,
    subtasks = [],
    trackedSeconds,
    projectDescription,
    columnName,
    organization,
}: {
    task: TaskwarriorTask;
    description?: string;
    parentTask?: TaskwarriorTask;
    subtasks?: TaskwarriorTask[];
    trackedSeconds?: number;
    projectDescription?: string;
    columnName?: string;
    organization?: Organization;
}) {
    const sections: string[] = [`# ${markdownText(task.description)}`];
    if (parentTask) {
        sections.push(
            `> Subtask of **${markdownText(parentTask.description)}**`,
        );
    }
    if (description?.trim()) {
        sections.push(`## Description\n\n${description.trim()}`);
    }
    if (subtasks.length) {
        const done = subtasks.filter(
            (item) => item.status === "completed",
        ).length;
        const list = subtasks
            .map(
                (item) =>
                    `- [${item.status === "completed" ? "x" : " "}] ${markdownText(item.description)}`,
            )
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

    return (
        <Detail
            navigationTitle="Task Details"
            markdown={sections.join("\n\n")}
            metadata={
                <Detail.Metadata>
                    {task.id ? (
                        <Detail.Metadata.Label
                            title="ID"
                            text={String(task.id)}
                        />
                    ) : null}
                    <Detail.Metadata.Label title="Status" text={task.status} />
                    {task.status === "completed" && task.end ? (
                        <Detail.Metadata.Label
                            title="Completed"
                            text={task.end.toLocaleString()}
                        />
                    ) : null}
                    {task.project ? (
                        <Detail.Metadata.Label
                            title="Project"
                            text={task.project}
                        />
                    ) : null}
                    {columnName ? (
                        <Detail.Metadata.Label
                            title="Column"
                            text={columnName}
                        />
                    ) : null}
                    {task.priority ? (
                        <Detail.Metadata.TagList title="Priority">
                            <Detail.Metadata.TagList.Item
                                text={priorityText(task.priority)}
                                color={priorityColor(task.priority)}
                            />
                        </Detail.Metadata.TagList>
                    ) : null}
                    {task.due ? (
                        <Detail.Metadata.Label
                            title="Due"
                            text={task.due.toLocaleString()}
                        />
                    ) : null}
                    {task.start && task.status !== "completed" ? (
                        <Detail.Metadata.Label
                            title="Active Timer"
                            text={`Running (${formatDuration(
                                Math.max(
                                    0,
                                    Math.floor(
                                        (Date.now() - task.start.getTime()) /
                                            1000,
                                    ),
                                ),
                            )})`}
                        />
                    ) : null}
                    {trackedSeconds && trackedSeconds > 0 ? (
                        <Detail.Metadata.Label
                            title="Tracked Today"
                            text={formatDuration(trackedSeconds)}
                        />
                    ) : null}
                    {task.scheduled ? (
                        <Detail.Metadata.Label
                            title="Scheduled"
                            text={task.scheduled.toLocaleString()}
                        />
                    ) : null}
                    {task.wait ? (
                        <Detail.Metadata.Label
                            title="Wait Until"
                            text={task.wait.toLocaleString()}
                        />
                    ) : null}
                    {task.until ? (
                        <Detail.Metadata.Label
                            title="Until"
                            text={task.until.toLocaleString()}
                        />
                    ) : null}
                    {task.recur ? (
                        <Detail.Metadata.Label
                            title="Recurrence"
                            text={task.recur}
                        />
                    ) : null}
                    {task.depends.length ? (
                        <Detail.Metadata.Label
                            title="Dependencies"
                            text={String(task.depends.length)}
                        />
                    ) : null}
                    {task.tags.length ? (
                        <Detail.Metadata.TagList title="Tags">
                            {task.tags.map((tag) => (
                                <Detail.Metadata.TagList.Item
                                    key={tag}
                                    text={tag}
                                    color={itemColor(
                                        organization?.tags.find(
                                            (item) => item.name === tag,
                                        )?.color || "gray",
                                    )}
                                />
                            ))}
                        </Detail.Metadata.TagList>
                    ) : null}
                </Detail.Metadata>
            }
            actions={
                <ActionPanel>
                    <Action.CopyToClipboard
                        title="Copy UUID"
                        content={task.uuid}
                    />
                </ActionPanel>
            }
        />
    );
}
