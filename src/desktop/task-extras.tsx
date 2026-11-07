import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import type { TaskService } from "../core/tasks/service.ts";
import type { WorkspaceClient } from "../core/workspace/client.ts";
import { recurrenceOptions } from "../core/tasks/recurrence.ts";
import { parseTaskwarriorDate } from "../core/tasks/model.ts";
import { taskDate } from "../core/tasks/quick-task.ts";

export function RecoveryListView({
  workspace,
  onSaved,
}: {
  workspace: WorkspaceClient;
  onSaved: () => unknown;
}) {
  const result = usePromise(
    async () => {
      if (!workspace.deleted)
        throw new Error("Update Aster web to use recovery.");
      return workspace.deleted();
    },
    [],
    { onError: () => undefined },
  );
  const [busy, setBusy] = useState(false);
  const web = (
    <Action.OpenInBrowser
      title="Export or Restore Backup"
      url={workspace.url.replace(/\/$/, "") + "/?panel=data"}
    />
  );
  return (
    <List
      isLoading={result.isLoading || busy}
      navigationTitle="Data & Recovery"
      searchBarPlaceholder="Search deleted tasks"
    >
      {result.error ? (
        <List.EmptyView
          title="Recovery Unavailable"
          description={result.error.message}
          actions={
            <ActionPanel>
              <Action
                title="Refresh"
                onAction={result.revalidate}
                icon={Icon.ArrowClockwise}
              />
              {web}
            </ActionPanel>
          }
        />
      ) : !result.data?.tasks.length ? (
        <List.EmptyView
          title="No Deleted Tasks"
          icon={Icon.Trash}
          actions={<ActionPanel>{web}</ActionPanel>}
        />
      ) : (
        result.data.tasks.map((task) => (
          <List.Item
            key={task.uuid}
            title={task.description}
            subtitle={task.project}
            icon={Icon.Trash}
            accessories={[
              {
                text: `Restores as ${task.restoreStatus}`,
                tooltip: task.tracked
                  ? "Original state retained"
                  : "Original status unavailable",
              },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Restore Task"
                  icon={Icon.ArrowCounterClockwise}
                  onAction={async () => {
                    if (busy || !workspace.taskAction) return;
                    setBusy(true);
                    try {
                      await workspace.taskAction({
                        uuid: task.uuid,
                        action: "restore",
                      });
                      await result.revalidate();
                      await onSaved();
                      await showToast({
                        style: Toast.Style.Success,
                        title: "Task Restored",
                      });
                    } catch (error) {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "Check Recovery Before Retrying",
                        message: (error as Error).message,
                      });
                      await result.revalidate();
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                {web}
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
export function SeriesForm({
  uuid,
  service,
  workspace,
  onSaved,
}: {
  uuid: string;
  service: TaskService;
  workspace?: WorkspaceClient;
  onSaved: () => unknown;
}) {
  const { pop } = useNavigation();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [recur, setRecur] = useState<string>();
  const [until, setUntil] = useState<Date | null | undefined>();
  const result = usePromise(
    async (uuid: string) =>
      workspace?.series ? workspace.series(uuid) : service.rawTask(uuid),
    [uuid],
    { onError: () => undefined },
  );
  const frequency = recur ?? String(result.data?.recur || "weekly");
  const end =
    until === undefined
      ? parseTaskwarriorDate(result.data?.until) || null
      : until;
  async function save(stop = false) {
    if (busy || blocked || !result.data) return;
    if (
      stop &&
      !(await confirmAlert({
        title: "Stop this series?",
        message:
          "Existing tasks stay. The series can be restored in Data & Recovery.",
        primaryAction: {
          title: "Stop Series",
          style: Alert.ActionStyle.Destructive,
        },
      }))
    )
      return;
    setBusy(true);
    try {
      if (workspace?.taskAction)
        await workspace.taskAction(
          stop
            ? { uuid, action: "delete" }
            : {
                uuid,
                action: "recurrence.edit",
                recur: frequency,
                until: end
                  ? taskDate(new Date(new Date(end).setHours(23, 59, 59, 0)))
                  : "",
              },
        );
      else if (stop) await service.deleteTask(uuid);
      else
        await service.updateRecurrence(
          uuid,
          frequency,
          end ? taskDate(new Date(new Date(end).setHours(23, 59, 59, 0))) : "",
        );
      await onSaved();
      await showToast({
        style: Toast.Style.Success,
        title: stop ? "Series Stopped" : "Series Updated",
      });
      pop();
    } catch (error) {
      setBlocked(true);
      await showToast({
        style: Toast.Style.Failure,
        title: "Check Series Before Retrying",
        message: (error as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Form
      isLoading={result.isLoading || busy}
      navigationTitle="Edit Series"
      actions={
        <ActionPanel>
          {!blocked && result.data ? (
            <>
              <Action
                title="Save Series"
                icon={Icon.CheckCircle}
                onAction={() => save()}
              />
              <Action
                title="Stop Series"
                style={Action.Style.Destructive}
                icon={Icon.Stop}
                onAction={() => save(true)}
              />
            </>
          ) : null}
          <Action
            title="Refresh Series"
            icon={Icon.ArrowClockwise}
            onAction={async () => {
              await result.revalidate();
              setBlocked(false);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        text={
          result.error?.message ||
          "Changes apply to future occurrences. Existing tasks keep their dates."
        }
      />
      <Form.Description
        title="Task"
        text={String(result.data?.description || "")}
      />
      <Form.Dropdown
        id="repeat"
        title="Repeat"
        value={frequency}
        onChange={setRecur}
      >
        {!recurrenceOptions.some((option) => option.value === frequency) ? (
          <Form.Dropdown.Item value={frequency} title={frequency} />
        ) : null}
        {recurrenceOptions.map((option) => (
          <Form.Dropdown.Item
            key={option.value}
            value={option.value}
            title={option.label}
          />
        ))}
      </Form.Dropdown>
      <Form.DatePicker
        id="until"
        title="Ends"
        type={Form.DatePicker.Type.Date}
        value={end}
        onChange={setUntil}
      />
    </Form>
  );
}
export function NotesList({
  uuid,
  service,
  workspace,
  onSaved,
}: {
  uuid: string;
  service: TaskService;
  workspace?: WorkspaceClient;
  onSaved: () => unknown;
}) {
  const result = usePromise((uuid: string) => service.rawTask(uuid), [uuid], {
    onError: () => undefined,
  });
  const [busy, setBusy] = useState(false);
  return (
    <List
      isLoading={result.isLoading || busy}
      navigationTitle="Task Notes"
      searchBarPlaceholder="Search notes"
    >
      {result.error || !result.data?.annotations?.length ? (
        <List.EmptyView
          title={result.error ? "Notes Unavailable" : "No Notes"}
          description={result.error?.message || "Use Edit Task to add a note."}
        />
      ) : (
        result.data.annotations.map((note, index) => (
          <List.Item
            key={`${note.entry}-${index}`}
            title={note.description.split("\n")[0]}
            subtitle={
              note.description.includes("\n") ? "Multiline note" : undefined
            }
            icon={Icon.Text}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title="Copy Note"
                  content={note.description}
                />
                <Action
                  title="Remove Note"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    if (
                      busy ||
                      !(await confirmAlert({
                        title: "Remove this note?",
                        message: note.description,
                        primaryAction: {
                          title: "Remove Note",
                          style: Alert.ActionStyle.Destructive,
                        },
                      }))
                    )
                      return;
                    setBusy(true);
                    try {
                      if (workspace?.taskAction)
                        await workspace.taskAction({
                          uuid,
                          action: "note.remove",
                          entry: note.entry,
                          description: note.description,
                        });
                      else
                        await service.removeNote(
                          uuid,
                          note.entry,
                          note.description,
                        );
                      await result.revalidate();
                      await onSaved();
                    } catch (error) {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "Check Notes Before Retrying",
                        message: (error as Error).message,
                      });
                      await result.revalidate();
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
