import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useRef, useState } from "react";
import { TaskExecutionError } from "../core/connection/errors.ts";
import { formatTaskDate } from "../core/tasks/date.ts";
import {
  taskGroup,
  type TaskView,
  type TaskwarriorTask,
} from "../core/tasks/model.ts";
import {
  defaultBoard,
  taskColumnId,
  unsectionedColumn,
} from "../core/workspace/board.ts";
import { formatDuration } from "../core/workspace/energy.ts";
import { focusProject } from "../core/workspace/focus.ts";
import { itemColor } from "../core/workspace/organization.ts";
import { projectPath, projectTree } from "../core/workspace/projects.ts";
import { loadTaskView } from "../core/workspace/task-views.ts";
import CheckConnection from "./connection-check";
import { FilterForm } from "./filter-form";
import { FocusProjects } from "./focus-projects";
import { MoveTask } from "./move-task";
import { QuickCapture } from "./quick-capture";
import { TaskDetail } from "./task-detail";
import { RecoveryListView, SeriesForm, NotesList } from "./task-extras";
import { TaskForm } from "./task-form";
import { useTaskService } from "./use-task-service";
import { useWorkspace } from "./use-workspace";

const VIEWS: Array<{
  id: TaskView | "focus" | "later" | "inbox" | "active";
  title: string;
}> = [
  { id: "focus", title: "Focus · Next Steps" },
  { id: "later", title: "Later" },
  { id: "pending", title: "All Pending" },
  { id: "today", title: "Today & Overdue" },
  { id: "inbox", title: "Inbox" },
  { id: "active", title: "In Progress" },
  { id: "waiting", title: "Waiting" },
  { id: "completed", title: "Completed" },
];
const GROUPS = ["overdue", "today", "pending", "waiting"] as const;
const GROUP_TITLES = {
  overdue: "Overdue",
  today: "Today",
  pending: "Tasks",
  waiting: "Waiting",
  completed: "Completed",
};

function displayDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function taskAccessories(
  task: TaskwarriorTask,
  trackedSeconds?: number,
): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];
  if (trackedSeconds && trackedSeconds > 0) {
    accessories.push({
      text: formatDuration(trackedSeconds),
      icon: Icon.Stopwatch,
    });
  }
  if (task.priority && task.status !== "completed") {
    accessories.push({
      tag: {
        value: task.priority,
        color: task.priority === "H" ? Color.Red : Color.SecondaryText,
      },
    });
  }
  const date =
    task.status === "completed"
      ? task.end
      : taskGroup(task) === "waiting"
        ? task.wait
        : task.due;
  if (date)
    accessories.push({
      text: displayDate(date),
      icon: taskGroup(task) === "waiting" ? Icon.Clock : Icon.Calendar,
    });
  return accessories;
}

export default function MyTasks() {
  const service = useTaskService();
  const busy = useRef(false);
  const [isMutating, setIsMutating] = useState(false);
  const [filter, setFilter] = useState("focus");
  const [expression, setExpression] = useState("");
  const workspace = useWorkspace(service.connection);
  const organization = workspace.error ? undefined : workspace.data;
  const board = organization?.board || defaultBoard();
  const { data, error, isLoading, revalidate } = usePromise(
    loadTaskView,
    [service, filter, organization, expression],
    {
      onError: () => undefined,
    },
  );
  const catalog = usePromise(
    async () => {
      const [projects, tags] = await Promise.all([
        service.loadProjects(),
        service.loadTags(),
      ]);
      return { projects, tags };
    },
    [],
    { onError: () => undefined },
  );
  const projects = [
    ...new Set([
      ...(catalog.data?.projects || []),
      ...(organization?.projects || []).map((item) => item.name),
      ...(data || []).flatMap((task) => (task.project ? [task.project] : [])),
    ]),
  ].sort();
  const tags = [
    ...new Set([
      ...(catalog.data?.tags || []),
      ...(organization?.tags || []).map((item) => item.name),
    ]),
  ].sort();
  const custom =
    filter === "focus" ||
    filter === "expression" ||
    filter.startsWith("filter:") ||
    filter.startsWith("column:");
  const groups = custom
    ? ["all"]
    : filter === "completed"
      ? ["completed"]
      : GROUPS;
  const tasks = data || [];
  const [undoTask, setUndoTask] = useState<TaskwarriorTask>();
  const [pendingTask, setPendingTask] = useState<string>();
  const unconfirmed = useRef(new Set<string>());
  async function refreshAll() {
    const [tasks] = await Promise.all([
      revalidate(),
      workspace.revalidate(),
      catalog.revalidate(),
    ]);
    if (tasks instanceof Error) throw tasks;
    unconfirmed.current.clear();
  }
  async function undo() {
    if (!undoTask || busy.current) return;
    const task = undoTask;
    setUndoTask(undefined);
    await mutate(
      task,
      task.status === "completed" ? "Task completed" : "Task reopened",
      async () => {
        const matches = await service.loadTasks(
          task.status === "completed" ? "pending" : "completed",
        );
        if (!matches.some((current) => current.uuid === task.uuid))
          throw new Error("This task has changed. Refresh before undoing.");
        return task.status === "completed"
          ? runTaskAction(task, "complete")
          : runTaskAction(task, "reopen");
      },
    );
  }

  async function refreshTasks() {
    const result = await revalidate();
    // Raycast's usePromise resolves revalidation errors instead of rejecting.
    if (result instanceof Error) throw result;
  }

  async function mutate(
    task: TaskwarriorTask,
    title: string,
    action: () => Promise<unknown>,
    reversible = false,
  ) {
    if (busy.current || unconfirmed.current.has(task.uuid)) return;
    busy.current = true;
    setIsMutating(true);
    setPendingTask(task.uuid);
    setUndoTask(undefined);
    const toast = await showToast({ style: Toast.Style.Animated, title });
    try {
      await action();
      toast.style = Toast.Style.Success;
      toast.message = task.description;
      if (reversible) setUndoTask(task);
      try {
        await Promise.all([refreshTasks(), workspace.revalidate()]);
      } catch {
        toast.message = "Saved. Refresh to load the latest tasks.";
      }
    } catch (error) {
      if (error instanceof TaskExecutionError && error.outcome === "unknown")
        unconfirmed.current.add(task.uuid);
      toast.style = Toast.Style.Failure;
      toast.title =
        error instanceof TaskExecutionError && error.outcome === "unknown"
          ? "Result Unconfirmed"
          : "Could Not Update Task";
      toast.message = error instanceof Error ? error.message : String(error);
      await refreshTasks().catch(() => undefined);
    } finally {
      busy.current = false;
      setIsMutating(false);
      setPendingTask(undefined);
    }
  }

  function runTaskAction(
    task: TaskwarriorTask,
    action: "complete" | "reopen" | "start" | "stop",
  ) {
    if (workspace.client?.taskAction)
      return workspace.client.taskAction({ uuid: task.uuid, action });
    return action === "complete"
      ? service.completeTask(task.uuid)
      : action === "reopen"
        ? service.reopenTask(task.uuid)
        : action === "start"
          ? service.startTask(task.uuid)
          : service.stopTask(task.uuid);
  }
  function commonActions() {
    return (
      <ActionPanel.Section>
        <Action.Push
          title="Quick Add Task"
          icon={Icon.Plus}
          shortcut={Keyboard.Shortcut.Common.New}
          target={<QuickCapture service={service} onSaved={refreshAll} />}
        />
        {workspace.client ? (
          <Action.Push
            title="Data & Recovery"
            icon={Icon.Trash}
            target={
              <RecoveryListView
                workspace={workspace.client}
                onSaved={refreshAll}
              />
            }
          />
        ) : null}
        <Action
          title="Refresh Tasks"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={refreshAll}
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
              onApply={(value) => {
                setExpression(value);
                setFilter("expression");
              }}
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
            onAction={undo}
          />
        ) : null}
        {workspace.client && organization ? (
          <Action.Push
            title="Manage Focus Projects"
            icon={Icon.BullsEye}
            target={
              <FocusProjects
                workspace={workspace.client}
                initial={organization}
                service={service}
                onSaved={refreshAll}
              />
            }
          />
        ) : null}
        {workspace.client &&
        organization?.energy &&
        organization.energy.remaining <= 25 ? (
          <Action
            title="Restore +30 Energy (Elixir)"
            icon={Icon.Bolt}
            onAction={async () => {
              if (!workspace.client) return;
              try {
                await workspace.client.change({
                  revision: organization.revision,
                  kind: "energy",
                  action: "elixir",
                });
                await refreshAll();
                await showToast({
                  style: Toast.Style.Success,
                  title: "Energy Restored (+30)",
                });
              } catch (error) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Could Not Restore Energy",
                  message: (error as Error).message,
                });
              }
            }}
          />
        ) : null}
        {workspace.client ? (
          <Action.OpenInBrowser
            title="Open Aster Web"
            icon={Icon.Globe}
            url={workspace.client.url}
            shortcut={Keyboard.Shortcut.Common.OpenWith}
          />
        ) : null}
        {workspace.error ? (
          <Action
            title="Web Workspace Status"
            icon={Icon.Warning}
            onAction={() =>
              showToast({
                style: Toast.Style.Failure,
                title: "Web Workspace Unavailable",
                message: workspace.error!.message,
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

  function actions(task: TaskwarriorTask) {
    const completed = task.status === "completed";
    return (
      <ActionPanel>
        <Action
          title={completed ? "Reopen Task" : "Complete Task"}
          icon={completed ? Icon.ArrowCounterClockwise : Icon.CheckCircle}
          onAction={() =>
            mutate(
              task,
              completed ? "Task reopened" : "Task completed",
              () =>
                completed
                  ? runTaskAction(task, "reopen")
                  : runTaskAction(task, "complete"),
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
              service={service}
              onSaved={refreshAll}
              workspace={workspace.client}
              labels={organization?.tags}
            />
          }
        />
        {workspace.client && organization ? (
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
                workspace={workspace.client}
                initial={organization}
                onSaved={refreshAll}
              />
            }
          />
        ) : null}
        {!completed && task.project && organization && workspace.client ? (
          <Action
            title="Set as Next Step"
            icon={Icon.ArrowRight}
            onAction={async () => {
              const project =
                focusProject(task.project, organization.projects) ||
                organization.projects?.find((p) => p.name === task.project);
              if (!project || !workspace.client) return;
              try {
                await workspace.client.change({
                  revision: organization.revision,
                  kind: "project",
                  action: "save",
                  originalName: project.name,
                  item: { ...project, nextTask: task.uuid },
                });
                await refreshAll();
                await showToast({
                  style: Toast.Style.Success,
                  title: "Next Step Updated",
                });
              } catch (error) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Could Not Set Next Step",
                  message: (error as Error).message,
                });
              }
            }}
          />
        ) : null}
        {!completed ? (
          <ActionPanel.Section>
            <Action
              title={task.start ? "Stop Task" : "Start Task"}
              icon={task.start ? Icon.Stop : Icon.Play}
              onAction={() => {
                if (!task.start && organization?.timing?.available === false) {
                  void showToast({
                    style: Toast.Style.Failure,
                    title: "Timer Data Unavailable",
                    message:
                      "Refresh before starting. Existing timers can still be stopped.",
                  });
                  return;
                }
                if (
                  !task.start &&
                  organization?.energy &&
                  organization.energy.remaining <= 0
                ) {
                  void showToast({
                    style: Toast.Style.Failure,
                    title: "Daily Energy Exhausted",
                    message: `0/${organization.energy.max} remaining. Restore +30 energy or rest until 06:00.`,
                  });
                  return;
                }
                void mutate(
                  task,
                  task.start ? "Task stopped" : "Task started",
                  () =>
                    task.start
                      ? runTaskAction(task, "stop")
                      : runTaskAction(task, "start"),
                );
              }}
            />
            <Action.PickDate
              title="Defer Until…"
              type={Action.PickDate.Type.Date}
              onChange={(date) => {
                if (date)
                  void mutate(task, "Task deferred", () =>
                    workspace.client?.taskAction
                      ? workspace.client.taskAction({
                          uuid: task.uuid,
                          action: "wait",
                          wait: formatTaskDate(date),
                        })
                      : service.setTaskWait(task.uuid, formatTaskDate(date)),
                  );
              }}
            />
            {task.wait ? (
              <Action
                title="Clear Waiting Date"
                icon={Icon.Clock}
                onAction={() =>
                  mutate(task, "Task available", () =>
                    workspace.client?.taskAction
                      ? workspace.client.taskAction({
                          uuid: task.uuid,
                          action: "wait",
                          wait: "",
                        })
                      : service.setTaskWait(task.uuid, ""),
                  )
                }
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
                projectDescription={
                  organization?.projects?.find(
                    (project) => project.name === task.project,
                  )?.description
                }
                columnName={
                  organization &&
                  [unsectionedColumn, ...board.columns].find(
                    (column) => column.id === taskColumnId(task, board),
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
                  workspace={workspace.client}
                  onSaved={refreshAll}
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
                workspace={workspace.client}
                onSaved={refreshAll}
              />
            }
          />
          <Action
            title="Delete Task"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={async () => {
              if (
                await confirmAlert({
                  title: "Delete this task?",
                  message:
                    task.description +
                    (workspace.client?.taskAction
                      ? "\nYou can restore it in Data & Recovery."
                      : "\nThe shared workspace is disabled; this deletion will not have a recovery snapshot."),
                  primaryAction: {
                    title: "Delete Task",
                    style: Alert.ActionStyle.Destructive,
                  },
                })
              ) {
                await mutate(task, "Task deleted", () =>
                  workspace.client?.taskAction
                    ? workspace.client.taskAction({
                        uuid: task.uuid,
                        action: "delete",
                      })
                    : service.deleteTask(task.uuid),
                );
              }
            }}
          />
        </ActionPanel.Section>
        <Action.CopyToClipboard title="Copy Task" content={task.description} />
        {commonActions()}
      </ActionPanel>
    );
  }

  return (
    <List
      isLoading={isLoading || isMutating}
      navigationTitle={
        organization?.timing?.available === false
          ? `My Tasks · Timer unavailable · ${service.connection.label}`
          : organization?.energy
            ? `My Tasks · ⚡ ${organization.energy.remaining}/${organization.energy.max} · ${service.connection.label}`
            : `My Tasks · ${service.connection.label}`
      }
      searchBarPlaceholder="Search description, project or tags"
      searchBarAccessory={
        <List.Dropdown tooltip="View Tasks" value={filter} onChange={setFilter}>
          <List.Dropdown.Section title="Views">
            {VIEWS.map((view) => (
              <List.Dropdown.Item
                key={view.id}
                title={view.title}
                value={view.id}
              />
            ))}
          </List.Dropdown.Section>
          {filter === "expression" ? (
            <List.Dropdown.Item
              title="Custom Filter"
              value="expression"
              icon={Icon.Filter}
            />
          ) : null}
          {organization?.filters.length ? (
            <List.Dropdown.Section title="Saved Filters">
              {[...organization.filters]
                .sort(
                  (a, b) =>
                    Number(b.favorite) - Number(a.favorite) ||
                    a.name.localeCompare(b.name),
                )
                .map((item) => (
                  <List.Dropdown.Item
                    key={item.id}
                    title={item.name}
                    value={`filter:${item.id}`}
                    icon={{
                      source: Icon.Filter,
                      tintColor: itemColor(item.color),
                    }}
                  />
                ))}
            </List.Dropdown.Section>
          ) : null}
          {organization ? (
            <List.Dropdown.Section title="Board Columns">
              {[unsectionedColumn, ...board.columns].map((column) => (
                <List.Dropdown.Item
                  key={column.id}
                  title={column.name}
                  value={`column:${column.id}`}
                  icon={Icon.AppWindowGrid3x3}
                />
              ))}
            </List.Dropdown.Section>
          ) : null}
          {tags.length ? (
            <List.Dropdown.Section title="Labels">
              {tags.map((tag) => (
                <List.Dropdown.Item
                  key={tag}
                  title={tag}
                  value={`tag:${tag}`}
                  icon={{
                    source: Icon.Tag,
                    tintColor: itemColor(
                      organization?.tags.find((item) => item.name === tag)
                        ?.color || "gray",
                    ),
                  }}
                />
              ))}
            </List.Dropdown.Section>
          ) : null}
          {projects.length ? (
            <List.Dropdown.Section title="Projects">
              {projectTree(projects).map((row) => (
                <List.Dropdown.Item
                  key={row.name}
                  title={projectPath(row.name)}
                  value={`project:${row.name}`}
                  icon={{
                    source: Icon.Hashtag,
                    tintColor: itemColor(
                      organization?.projects?.find(
                        (project) => project.name === row.name,
                      )?.color || "gray",
                    ),
                  }}
                />
              ))}
            </List.Dropdown.Section>
          ) : null}
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={error ? Icon.Warning : Icon.CheckCircle}
        title={
          error
            ? "Could Not Load Tasks"
            : isLoading
              ? "Loading Tasks…"
              : filter === "focus" && organization
                ? "Choose Your Next Step"
                : filter === "completed"
                  ? "No Completed Tasks"
                  : "No Tasks in This View"
        }
        description={
          error?.message ||
          (filter === "focus" && organization
            ? "Use Manage Focus Projects to choose up to three projects and their next tasks."
            : undefined)
        }
        actions={<ActionPanel>{commonActions()}</ActionPanel>}
      />
      {(error || workspace.error) && (
        <List.Item
          id="refresh-focus"
          title="Reconnect and Refresh"
          subtitle={error?.message || workspace.error?.message}
          icon={Icon.ArrowClockwise}
          actions={
            <ActionPanel>
              <Action title="Reconnect and Refresh" onAction={refreshAll} />
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
                    onSaved={refreshAll}
                  />
                }
              />
              {commonActions()}
            </ActionPanel>
          }
        />
      )}
      {!error &&
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
                  : GROUP_TITLES[group as keyof typeof GROUP_TITLES]
              }
              subtitle={String(items.length)}
            >
              {items.map((task) => (
                <List.Item
                  key={task.uuid}
                  id={task.uuid}
                  icon={
                    task.uuid === pendingTask
                      ? Icon.Hourglass
                      : task.status === "completed"
                        ? Icon.CheckCircle
                        : task.start
                          ? Icon.Play
                          : group === "overdue"
                            ? {
                                source: Icon.Circle,
                                tintColor: Color.Red,
                              }
                            : Icon.Circle
                  }
                  title={task.description}
                  subtitle={task.project}
                  keywords={[
                    task.project ?? "",
                    ...task.tags,
                    String(task.id ?? ""),
                  ].filter(Boolean)}
                  accessories={[
                    ...task.tags.slice(0, 2).map((tag) => ({
                      tag: {
                        value: tag,
                        color: itemColor(
                          organization?.tags.find((item) => item.name === tag)
                            ?.color || "gray",
                        ),
                      },
                    })),
                    ...taskAccessories(
                      task,
                      organization?.energy?.taskSeconds?.[
                        task.uuid.toLowerCase()
                      ],
                    ),
                  ]}
                  actions={
                    isMutating || unconfirmed.current.has(task.uuid) ? (
                      <ActionPanel>{commonActions()}</ActionPanel>
                    ) : (
                      actions(task)
                    )
                  }
                />
              ))}
            </List.Section>
          ) : null;
        })}
    </List>
  );
}
