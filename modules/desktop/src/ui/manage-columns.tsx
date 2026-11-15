import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { FormValidation, useForm } from "@raycast/utils";
import { useState } from "react";
import type { BoardColumn } from "../../../core/workspace/board.ts";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import type { Organization } from "../../../core/workspace/organization.ts";

function ColumnForm({
  column,
  revision,
  workspace,
  onUpdated,
}: {
  column?: BoardColumn;
  revision: number;
  workspace: WorkspaceClient;
  onUpdated: (next: Organization) => Promise<void> | void;
}) {
  const { pop } = useNavigation();
  const [busy, setBusy] = useState(false);
  const { handleSubmit, itemProps } = useForm<{ name: string }>({
    initialValues: { name: column?.name || "" },
    validation: { name: FormValidation.Required },
    async onSubmit(values) {
      if (busy) return;
      setBusy(true);
      try {
        const next = await workspace.change({
          revision,
          kind: "board",
          action: "column.save",
          column: { id: column?.id || "", name: values.name.trim() },
        });
        await onUpdated(next);
        await showToast({
          style: Toast.Style.Success,
          title: column ? "Column renamed" : "Column created",
        });
        pop();
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could Not Save Column",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <Form
      isLoading={busy}
      navigationTitle={column ? "Rename Column" : "New Column"}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        title="Column Name"
        placeholder="e.g. In Review"
        autoFocus
        {...itemProps.name}
      />
    </Form>
  );
}

/** Raycast screen for creating, renaming, reordering, and deleting shared Board Columns. */
export function ManageColumns({
  workspace,
  initial,
  onSaved,
}: {
  workspace: WorkspaceClient;
  initial: Organization;
  onSaved: () => Promise<unknown>;
}) {
  const [org, setOrg] = useState(initial);
  const [busy, setBusy] = useState(false);
  const columns = org.board?.columns || [];

  async function applyUpdated(next: Organization) {
    setOrg(next);
    await onSaved();
  }

  async function moveColumn(column: BoardColumn, direction: "left" | "right") {
    if (busy) return;
    setBusy(true);
    try {
      const next = await workspace.change({
        revision: org.revision,
        kind: "board",
        action: "column.move",
        columnId: column.id,
        direction,
      });
      await applyUpdated(next);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Reorder Column",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteColumn(column: BoardColumn) {
    const confirmed = await confirmAlert({
      title: `Delete column “${column.name}”?`,
      message: "Tasks in this column will move back to No section.",
      primaryAction: {
        title: "Delete",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const next = await workspace.change({
        revision: org.revision,
        kind: "board",
        action: "column.delete",
        columnId: column.id,
      });
      await applyUpdated(next);
      await showToast({
        style: Toast.Style.Success,
        title: "Column deleted",
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Delete Column",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  const newColumnAction = (
    <Action.Push
      title="New Column…"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={
        <ColumnForm
          revision={org.revision}
          workspace={workspace}
          onUpdated={applyUpdated}
        />
      }
    />
  );

  return (
    <List
      isLoading={busy}
      navigationTitle="Manage Board Columns"
      searchBarPlaceholder="Search columns"
    >
      {columns.length === 0 ? (
        <List.EmptyView
          title="No Custom Columns"
          description="Create columns shared between Web Board and TUI Groups."
          actions={<ActionPanel>{newColumnAction}</ActionPanel>}
        />
      ) : (
        columns.map((column, index) => (
          <List.Item
            key={column.id}
            title={column.name}
            subtitle={`Position ${index + 1}`}
            icon={Icon.AppWindowSidebarLeft}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Rename Column"
                  icon={Icon.Pencil}
                  target={
                    <ColumnForm
                      column={column}
                      revision={org.revision}
                      workspace={workspace}
                      onUpdated={applyUpdated}
                    />
                  }
                />
                {index > 0 ? (
                  <Action
                    title="Move Earlier"
                    icon={Icon.ArrowUp}
                    onAction={() => moveColumn(column, "left")}
                  />
                ) : null}
                {index < columns.length - 1 ? (
                  <Action
                    title="Move Later"
                    icon={Icon.ArrowDown}
                    onAction={() => moveColumn(column, "right")}
                  />
                ) : null}
                <Action
                  title="Delete Column"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => deleteColumn(column)}
                />
                <ActionPanel.Section>{newColumnAction}</ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
