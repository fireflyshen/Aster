import { Action, ActionPanel, Detail, Icon } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import type { TaskService } from "../tasks/service.ts";
import { useTaskService } from "./use-task-service";

export default function CheckConnection({ service: providedService }: { service?: TaskService }) {
  const service = useTaskService(providedService);
  const { connection } = service;
  const { data, error, isLoading, revalidate } = usePromise(service.checkConnection, [], { onError: () => undefined });
  const diagnostics = error
    ? `Connection failed\n${error.message}`
    : [
        connection.label,
        `Task command: ${connection.taskCommand}`,
        connection.taskrc ? `Taskrc: ${connection.taskrc}` : undefined,
        data
          ? `Taskwarrior: ${data.version}\nPending tasks: ${data.pendingTasks}\nElapsed: ${data.elapsedMs} ms`
          : "Checking…",
      ]
        .filter(Boolean)
        .join("\n");
  return (
    <Detail
      navigationTitle={`Task Connection · ${connection.label}`}
      isLoading={isLoading}
      markdown={
        error
          ? `# Connection failed\n\n${error.message}`
          : data
            ? "# Connected\n\nTaskwarrior 3 is available and task data can be read."
            : "# Checking connection…"
      }
      metadata={
        data ? (
          <Detail.Metadata>
            <Detail.Metadata.Label title="Connection" text={connection.label} />
            <Detail.Metadata.Label title="Task Command" text={connection.taskCommand} />
            {connection.taskrc ? <Detail.Metadata.Label title="Taskrc" text={connection.taskrc} /> : null}
            <Detail.Metadata.Label title="Taskwarrior" text={data.version} />
            <Detail.Metadata.Label title="Pending Tasks" text={String(data.pendingTasks)} />
            <Detail.Metadata.Label title="Elapsed" text={`${data.elapsedMs} ms`} />
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          <Action title="Check Again" icon={Icon.ArrowClockwise} onAction={revalidate} />
          <Action.CopyToClipboard title="Copy Diagnostics" content={diagnostics} />
        </ActionPanel>
      }
    />
  );
}
