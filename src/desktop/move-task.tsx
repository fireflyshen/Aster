import {
  Action,
  ActionPanel,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useRef, useState } from "react";
import type { TaskwarriorTask } from "../core/tasks/model.ts";
import {
  defaultBoard,
  taskColumnId,
  unsectionedColumn,
} from "../core/workspace/board.ts";
import {
  WorkspaceError,
  type WorkspaceClient,
} from "../core/workspace/client.ts";
import type { Organization } from "../core/workspace/organization.ts";

export function MoveTask({
  task,
  workspace,
  initial,
  onSaved,
}: {
  task: TaskwarriorTask;
  workspace: WorkspaceClient;
  initial: Organization;
  onSaved: () => Promise<unknown>;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const lock = useRef(false);
  const { pop } = useNavigation();
  const board = data.board || defaultBoard();
  const current = taskColumnId(task, board);
  async function reload() {
    try {
      setData(await workspace.load());
      setMustReload(false);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Refresh Workspace",
        message: String(error),
      });
    }
  }
  async function move(columnId: string) {
    if (lock.current || mustReload || columnId === current) return;
    lock.current = true;
    setBusy(true);
    try {
      await workspace.move({
        revision: data.revision,
        kind: "board",
        action: "task.move",
        uuid: task.uuid,
        columnId,
        beforeUuid: null,
      });
      const toast = await showToast({
        style: Toast.Style.Success,
        title: "Task moved",
        message: task.description,
      });
      await onSaved().catch(() => {
        toast.message = "Saved. Refresh to load the latest workspace.";
      });
      pop();
    } catch (error) {
      setMustReload(true);
      await showToast({
        style: Toast.Style.Failure,
        title:
          error instanceof WorkspaceError && error.uncertain
            ? "Move Unconfirmed"
            : "Could Not Move Task",
        message: String(error),
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <List
      navigationTitle="Move to Column"
      searchBarPlaceholder="Choose a column"
      isLoading={busy}
    >
      {[unsectionedColumn, ...board.columns].map((column) => (
        <List.Item
          key={column.id}
          title={column.name}
          icon={Icon.AppWindowGrid3x3}
          subtitle={column.id === current ? "Current column" : undefined}
          accessories={column.id === current ? [{ icon: Icon.Checkmark }] : []}
          actions={
            <ActionPanel>
              {!busy && !mustReload && column.id !== current ? (
                <Action
                  title={`Move to ${column.name}`}
                  icon={Icon.ArrowRight}
                  onAction={() => move(column.id)}
                />
              ) : null}
              <Action
                title="Refresh Workspace"
                icon={Icon.ArrowClockwise}
                onAction={reload}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
