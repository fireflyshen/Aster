import { Action, ActionPanel, Detail } from "@raycast/api";
import type { TaskwarriorTask } from "../core/tasks/model.ts";

function markdownText(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

export function TaskDetail({ task }: { task: TaskwarriorTask }) {
  const annotationText = task.annotations.length
    ? task.annotations.map((item) => `- ${markdownText(item.description)}`).join("\n")
    : "No annotations.";

  return (
    <Detail
      navigationTitle="Task Details"
      markdown={`# ${markdownText(task.description)}\n\n## Annotations\n\n${annotationText}`}
      metadata={
        <Detail.Metadata>
          {task.id ? <Detail.Metadata.Label title="ID" text={String(task.id)} /> : null}
          <Detail.Metadata.Label title="Status" text={task.status} />
          {task.end ? <Detail.Metadata.Label title="Completed" text={task.end.toLocaleString()} /> : null}
          {task.project ? <Detail.Metadata.Label title="Project" text={task.project} /> : null}
          {task.priority ? <Detail.Metadata.Label title="Priority" text={task.priority} /> : null}
          {task.due ? <Detail.Metadata.Label title="Due" text={task.due.toLocaleString()} /> : null}
          {task.scheduled ? <Detail.Metadata.Label title="Scheduled" text={task.scheduled.toLocaleString()} /> : null}
          {task.wait ? <Detail.Metadata.Label title="Wait Until" text={task.wait.toLocaleString()} /> : null}
          {task.until ? <Detail.Metadata.Label title="Until" text={task.until.toLocaleString()} /> : null}
          {task.recur ? <Detail.Metadata.Label title="Recurrence" text={task.recur} /> : null}
          {task.depends.length ? (
            <Detail.Metadata.Label title="Dependencies" text={String(task.depends.length)} />
          ) : null}
          {task.tags.length ? (
            <Detail.Metadata.TagList title="Tags">
              {task.tags.map((tag) => (
                <Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </Detail.Metadata.TagList>
          ) : null}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy UUID" content={task.uuid} />
        </ActionPanel>
      }
    />
  );
}
