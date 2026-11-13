import {
  Action,
  ActionPanel,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  LocalStorage,
  popToRoot,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { TaskExecutionError } from "../../../core/connection/errors.ts";
import { parseQuickTask } from "../../../core/tasks/quick-task.ts";
import type { TaskService } from "../../../core/tasks/service.ts";
import { useWorkspace } from "./use-workspace";
import { WorkspaceError } from "../../../core/workspace/client.ts";
import { queryWorkspaceTasks } from "../../../core/workspace/task-views.ts";
import { TaskForm } from "./task-form";
import { useTaskService } from "./use-task-service";

export function QuickCapture({
  service: provided,
  onSaved,
  initialExpression = "",
}: {
  service?: TaskService;
  onSaved?: () => unknown;
  initialExpression?: string;
}) {
  const service = useTaskService(provided);
  const workspace = useWorkspace(service.connection);
  const { pop } = useNavigation();
  const key = `capture:${service.connection.key}`;
  const [text, setText] = useState(initialExpression);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const submitting = useRef(false);
  const didSave = useRef(false);
  const edited = useRef(!!initialExpression);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [hydrated, setHydrated] = useState(false);
  const [checked, setChecked] = useState(false);
  function persist(expression: string, uncertain = false) {
    const operation = queue.current
      .catch(() => undefined)
      .then(() =>
        expression
          ? LocalStorage.setItem(key, JSON.stringify({ expression, uncertain }))
          : LocalStorage.removeItem(key),
      );
    queue.current = operation;
    return operation;
  }
  const parsed = parseQuickTask(text);
  const valid = !!parsed.task.description && !parsed.errors.length;
  useEffect(() => {
    let active = true;
    void LocalStorage.getItem<string>(key)
      .then((draft) => {
        if (!active) return;
        if (draft) {
          let stored = { expression: draft, uncertain: false };
          try {
            const candidate = JSON.parse(draft);
            if (typeof candidate.expression === "string") stored = candidate;
          } catch {
            /* Previous versions stored plain text. */
          }
          if (stored.uncertain || !edited.current) setText(stored.expression);
          if (stored.uncertain) setUnconfirmed(true);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [key]);
  function update(value: string) {
    edited.current = true;
    setText(value);
    void persist(value).catch(() => undefined);
  }
  async function markUnconfirmed() {
    setUnconfirmed(true);
    await persist(text, true).catch(() => undefined);
  }
  async function clearDraft() {
    setText("");
    edited.current = true;
    setUnconfirmed(false);
    setChecked(false);
    await persist("").catch(() => undefined);
  }
  async function saved() {
    await clearDraft();
    await onSaved?.();
  }
  async function closeCapture() {
    if (provided) pop();
    else await popToRoot({ clearSearchBar: true });
  }
  async function add() {
    if (
      !hydrated ||
      !valid ||
      submitting.current ||
      didSave.current ||
      unconfirmed
    )
      return;
    submitting.current = true;
    setBusy(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Adding task…",
    });
    try {
      if (workspace.client?.addTask)
        await workspace.client.addTask(parsed.task);
      else await service.addTask(parsed.task);
      didSave.current = true;
      toast.style = Toast.Style.Success;
      toast.title = "Task added";
      toast.message = parsed.task.description;
      await saved().catch(() => {
        toast.message = "Saved. Refresh My Tasks to load the latest tasks.";
      });
      await closeCapture();
    } catch (error) {
      const unknown =
        (error instanceof TaskExecutionError && error.outcome === "unknown") ||
        (error instanceof WorkspaceError && error.uncertain);
      if (unknown) await markUnconfirmed();
      toast.style = didSave.current ? Toast.Style.Success : Toast.Style.Failure;
      toast.title = didSave.current
        ? "Task Saved"
        : unknown
          ? "Result Unconfirmed"
          : "Could Not Add Task";
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const actions = (
    <ActionPanel>
      {hydrated &&
      text.trim() &&
      hydrated &&
      !busy &&
      !didSave.current &&
      !unconfirmed ? (
        <Action
          title="Add Task"
          icon={Icon.Plus}
          onAction={() =>
            valid
              ? add()
              : showToast({
                  style: Toast.Style.Failure,
                  title: "Check Task Expression",
                  message: parsed.errors[0] || "Add a task name.",
                })
          }
        />
      ) : null}
      {hydrated && !busy && !didSave.current && !unconfirmed ? (
        <Action.Push
          title="Edit Fields…"
          icon={Icon.Pencil}
          shortcut={Keyboard.Shortcut.Common.Edit}
          target={
            <TaskForm
              service={service}
              workspace={workspace.client}
              labels={workspace.data?.tags}
              initialInput={
                valid ? parsed.task : { description: text, tags: [] }
              }
              onSaved={saved}
              onUnconfirmed={markUnconfirmed}
              onClose={async () => {
                pop();
                await closeCapture();
              }}
            />
          }
        />
      ) : null}
      {unconfirmed ? (
        <Action
          title="Check Saved Result"
          icon={Icon.ArrowClockwise}
          onAction={async () => {
            try {
              const matches = (
                await queryWorkspaceTasks(
                  service,
                  { scope: "pending" },
                  workspace.client,
                )
              ).filter((task) => task.description === parsed.task.description);
              setChecked(true);
              await showToast({
                title: "Tasks Checked",
                message: `${matches.length} matching task(s). Review My Tasks before adding again.`,
              });
            } catch (error) {
              await showToast({
                style: Toast.Style.Failure,
                title: "Could Not Check Tasks",
                message: String(error),
              });
            }
          }}
        />
      ) : null}
      {unconfirmed && checked ? (
        <Action
          title="Discard Checked Draft…"
          icon={Icon.Trash}
          onAction={async () => {
            if (
              await confirmAlert({
                title: "Discard this draft?",
                message:
                  "A task may already have been saved. Check My Tasks before capturing it again.",
                primaryAction: { title: "Discard Draft" },
              })
            ) {
              await clearDraft();
              await closeCapture();
            }
          }}
        />
      ) : null}
      {hydrated && !busy && !didSave.current && !unconfirmed ? (
        <Action
          title="Discard Draft"
          icon={Icon.Trash}
          shortcut={{
            macOS: { modifiers: ["ctrl"], key: "x" },
            Windows: { modifiers: ["ctrl", "shift"], key: "x" },
          }}
          onAction={async () => {
            await clearDraft();
            await closeCapture();
          }}
        />
      ) : null}
    </ActionPanel>
  );
  return (
    <List
      isLoading={busy || !hydrated}
      navigationTitle="Quick Add"
      searchText={text}
      onSearchTextChange={(value) => {
        if (hydrated && !busy && !didSave.current && !unconfirmed)
          update(value);
      }}
      filtering={false}
      searchBarPlaceholder="Task tomorrow #Project @label p1"
      actions={actions}
    >
      {text.trim() ? (
        <List.Item
          id="preview"
          title={parsed.task.description || "Add a task name"}
          subtitle={
            unconfirmed
              ? "Result unconfirmed — check My Tasks"
              : parsed.errors[0]
          }
          icon={
            unconfirmed || parsed.errors.length ? Icon.Warning : Icon.Circle
          }
          accessories={parsed.tokens
            .filter(
              (t, i, all) =>
                all.findIndex(
                  (x) => x.kind === t.kind && x.value === t.value,
                ) === i,
            )
            .slice(0, 4)
            .map((t) => ({
              tag:
                t.kind === "tag"
                  ? `@${t.value}`
                  : t.kind === "project"
                    ? `#${t.value}`
                    : t.label,
            }))}
          actions={actions}
        />
      ) : (
        <List.EmptyView
          title="Capture a task"
          description="Submit report tomorrow #Work @focus p1"
          icon={Icon.Plus}
          actions={actions}
        />
      )}
    </List>
  );
}
