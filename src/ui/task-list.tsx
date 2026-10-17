import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useRef, useState } from "react";
import { TaskExecutionError } from "../connection/errors.ts";
import { formatTaskDate } from "../tasks/date.ts";
import { taskGroup, tasksForView, type TaskView, type TaskwarriorTask } from "../tasks/model.ts";
import CheckConnection from "./connection-check";
import { TaskDetail } from "./task-detail";
import { TaskForm } from "./task-form";
import { useTaskService } from "./use-task-service";

const VIEWS: Array<{ id: TaskView; title: string }> = [
  { id: "pending", title: "Pending" },
  { id: "today", title: "Today & Overdue" },
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
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function taskAccessories(task: TaskwarriorTask): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];
  if (task.priority && task.status !== "completed") {
    accessories.push({ tag: { value: task.priority, color: task.priority === "H" ? Color.Red : Color.SecondaryText } });
  }
  const date = task.status === "completed" ? task.end : taskGroup(task) === "waiting" ? task.wait : task.due;
  if (date)
    accessories.push({ text: displayDate(date), icon: taskGroup(task) === "waiting" ? Icon.Clock : Icon.Calendar });
  return accessories;
}

export default function MyTasks() {
  const service = useTaskService();
  const busy = useRef(false);
  const [isMutating, setIsMutating] = useState(false);
  const [filter, setFilter] = useState("pending");
  const scope = filter === "completed" ? "completed" : "pending";
  const { data, error, isLoading, revalidate } = usePromise(service.loadTasks, [scope], { onError: () => undefined });
  const project = filter.startsWith("project:") ? filter.slice(8) : undefined;
  const tasks = tasksForView(data ?? [], project ? "pending" : (filter as TaskView)).filter(
    (task) => !project || task.project === project,
  );
  const projects = [
    ...new Set([
      ...(data ?? []).flatMap((task) => (task.project ? [task.project] : [])),
      ...(project ? [project] : []),
    ]),
  ].sort();
  const groups = scope === "completed" ? (["completed"] as const) : GROUPS;

  async function refreshTasks() {
    const result = await revalidate();
    // Raycast's usePromise resolves revalidation errors instead of rejecting.
    if (result instanceof Error) throw result;
  }

  async function mutate(task: TaskwarriorTask, title: string, action: () => Promise<string>) {
    if (busy.current) return;
    busy.current = true;
    setIsMutating(true);
    const toast = await showToast({ style: Toast.Style.Animated, title });
    try {
      await action();
      toast.style = Toast.Style.Success;
      toast.message = task.description;
      try {
        await refreshTasks();
      } catch {
        toast.message = "Saved. Refresh to load the latest tasks.";
      }
    } catch (error) {
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
    }
  }

  function commonActions() {
    return (
      <ActionPanel.Section>
        <Action.Push
          title="Add Task"
          icon={Icon.Plus}
          shortcut={Keyboard.Shortcut.Common.New}
          target={<TaskForm service={service} onSaved={refreshTasks} />}
        />
        <Action
          title="Refresh Tasks"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={revalidate}
        />
        <Action.Push title="Check Connection" icon={Icon.Network} target={<CheckConnection service={service} />} />
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
            mutate(task, completed ? "Task reopened" : "Task completed", () =>
              completed ? service.reopenTask(task.uuid) : service.completeTask(task.uuid),
            )
          }
        />
        <Action.Push
          title="Edit Task"
          icon={Icon.Pencil}
          shortcut={Keyboard.Shortcut.Common.Edit}
          target={<TaskForm task={task} service={service} onSaved={refreshTasks} />}
        />
        {!completed ? (
          <ActionPanel.Section>
            <Action
              title={task.start ? "Stop Task" : "Start Task"}
              icon={task.start ? Icon.Stop : Icon.Play}
              onAction={() =>
                mutate(task, task.start ? "Task stopped" : "Task started", () =>
                  task.start ? service.stopTask(task.uuid) : service.startTask(task.uuid),
                )
              }
            />
            <Action.PickDate
              title="Defer Until…"
              type={Action.PickDate.Type.Date}
              onChange={(date) => {
                if (date)
                  void mutate(task, "Task deferred", () => service.setTaskWait(task.uuid, formatTaskDate(date)));
              }}
            />
            {task.wait ? (
              <Action
                title="Clear Waiting Date"
                icon={Icon.Clock}
                onAction={() => mutate(task, "Task available", () => service.setTaskWait(task.uuid, ""))}
              />
            ) : null}
          </ActionPanel.Section>
        ) : null}
        <ActionPanel.Section>
          <Action.Push title="Show Details" icon={Icon.Eye} target={<TaskDetail task={task} />} />
          <Action
            title="Delete Task"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={async () => {
              if (
                await confirmAlert({
                  title: "Delete this task?",
                  message: task.description,
                  primaryAction: { title: "Delete Task", style: Alert.ActionStyle.Destructive },
                })
              ) {
                await mutate(task, "Task deleted", () => service.deleteTask(task.uuid));
              }
            }}
          />
        </ActionPanel.Section>
        {commonActions()}
      </ActionPanel>
    );
  }

  return (
    <List
      isLoading={isLoading || isMutating}
      navigationTitle={`My Tasks · ${service.connection.label}`}
      searchBarPlaceholder="Search description, project or tags"
      searchBarAccessory={
        <List.Dropdown tooltip="View Tasks" value={filter} onChange={setFilter}>
          <List.Dropdown.Section title="Views">
            {VIEWS.map((view) => (
              <List.Dropdown.Item key={view.id} title={view.title} value={view.id} />
            ))}
          </List.Dropdown.Section>
          {projects.length ? (
            <List.Dropdown.Section title="Projects">
              {projects.map((name) => (
                <List.Dropdown.Item key={name} title={name} value={`project:${name}`} />
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
              : scope === "completed"
                ? "No Completed Tasks"
                : "No Tasks in This View"
        }
        description={error?.message}
        actions={<ActionPanel>{commonActions()}</ActionPanel>}
      />
      {!error &&
        groups.map((group) => {
          const items = tasks.filter((task) => group === "completed" || taskGroup(task) === group);
          return items.length ? (
            <List.Section key={group} title={GROUP_TITLES[group]} subtitle={String(items.length)}>
              {items.map((task) => (
                <List.Item
                  key={task.uuid}
                  id={task.uuid}
                  icon={
                    task.status === "completed"
                      ? Icon.CheckCircle
                      : task.start
                        ? Icon.Play
                        : group === "overdue"
                          ? { source: Icon.Circle, tintColor: Color.Red }
                          : Icon.Circle
                  }
                  title={task.description}
                  subtitle={task.project}
                  keywords={[task.project ?? "", ...task.tags, String(task.id ?? "")].filter(Boolean)}
                  accessories={taskAccessories(task)}
                  actions={isMutating ? undefined : actions(task)}
                />
              ))}
            </List.Section>
          ) : null;
        })}
    </List>
  );
}
