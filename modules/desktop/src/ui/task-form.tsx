import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Toast,
  popToRoot,
  showToast,
  useNavigation,
} from "@raycast/api";
import { FormValidation, useForm, usePromise } from "@raycast/utils";
import { useRef, useState } from "react";
import { TaskExecutionError } from "../../../core/connection/errors.ts";
import type { TaskInput } from "../../../core/tasks/arguments.ts";
import { formatTaskDate } from "../../../core/tasks/date.ts";
import type { TaskwarriorTask } from "../../../core/tasks/model.ts";
import { parseTaskwarriorDate } from "../../../core/tasks/model.ts";
import { itemColor, type SavedTag } from "../../../core/workspace/organization.ts";
import { recurrenceOptions } from "../../../core/tasks/recurrence.ts";
import { taskDate } from "../../../core/tasks/quick-task.ts";
import {
  WorkspaceError,
  type WorkspaceClient,
} from "../../../core/workspace/client.ts";
import {
  loadTaskCatalog,
  queryWorkspaceTasks,
} from "../../../core/workspace/task-views.ts";
import { uniqueTags } from "../../../core/tasks/options.ts";
import type { TaskService } from "../../../core/tasks/service.ts";
import { useTaskService } from "./use-task-service";

interface TaskFormValues {
  description: string;
  note: string;
  priority: string;
}

interface TaskFormProps {
  task?: TaskwarriorTask;
  service?: TaskService;
  workspace?: WorkspaceClient;
  labels?: SavedTag[];
  onSaved?: () => unknown;
  initialInput?: TaskInput;
  onUnconfirmed?: () => unknown;
  onClose?: () => unknown;
}

export function TaskForm({
  task,
  onSaved,
  service: providedService,
  workspace,
  labels,
  initialInput,
  onUnconfirmed,
  onClose,
}: TaskFormProps) {
  const service = useTaskService(providedService);
  const { pop } = useNavigation();
  const submitting = useRef(false);
  const saved = useRef(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [project, setProject] = useState(
    task?.project || initialInput?.project || "",
  );
  const [projectSearch, setProjectSearch] = useState("");
  const initialDue = task?.due || parseTaskwarriorDate(initialInput?.due);
  const [recur, setRecur] = useState(task?.recur || initialInput?.recur || "");
  const [until, setUntil] = useState<Date | null>(
    task?.until || parseTaskwarriorDate(initialInput?.until) || null,
  );
  const [selectedTags, setSelectedTags] = useState(
    task?.tags || initialInput?.tags || [],
  );
  const [newLabels, setNewLabels] = useState("");
  const [due, setDue] = useState<Date | null>(initialDue || null);
  const {
    data: catalog,
    error: projectsError,
    isLoading,
    revalidate,
  } = usePromise(loadTaskCatalog, [service, workspace], {
    onError: () => undefined,
  });
  const projects = catalog?.projects;
  const projectOptions = [
    ...new Set([...(project ? [project] : []), ...(projects ?? [])]),
  ];
  const candidate = projectSearch.trim();
  const canCreate =
    candidate &&
    !projectOptions.some(
      (value) => value.toLocaleLowerCase() === candidate.toLocaleLowerCase(),
    );

  const { handleSubmit, itemProps } = useForm<TaskFormValues>({
    initialValues: {
      description: task?.description || initialInput?.description || "",
      note: "",
      priority: task?.priority || initialInput?.priority || "",
    },
    validation: { description: FormValidation.Required },
    async onSubmit(values) {
      if (submitting.current || saved.current || unconfirmed) return;
      submitting.current = true;
      setIsSubmitting(true);
      try {
        const input = {
          description: values.description,
          project: project || undefined,
          tags: uniqueTags([...selectedTags, ...newLabels.split(",")]),
          note: values.note,
          recur: task?.parent ? undefined : recur,
          until: task?.parent
            ? undefined
            : until && recur
              ? taskDate(new Date(new Date(until).setHours(23, 59, 59, 0)))
              : "",
          due: due ? formatTaskDate(due, initialDue) : undefined,
          priority: values.priority,
        };
        if (task && workspace?.taskAction)
          await workspace.taskAction({
            uuid: task.uuid,
            action: "edit",
            task: input,
          });
        else if (task) await service.editTask(task.uuid, input);
        else if (workspace?.addTask) await workspace.addTask(input);
        else await service.addTask(input);
        saved.current = true;
        const toast = await showToast({
          style: Toast.Style.Success,
          title: task ? "Task updated" : "Task added",
        });
        try {
          await onSaved?.();
        } catch {
          toast.message = "Saved. Refresh to load the latest tasks.";
        }
        if (onClose) await onClose();
        else if (providedService) pop();
        else await popToRoot({ clearSearchBar: true });
      } catch (error) {
        const unknown =
          (error instanceof TaskExecutionError &&
            error.outcome === "unknown") ||
          (error instanceof WorkspaceError && error.uncertain);
        if (unknown) {
          setUnconfirmed(true);
          await onUnconfirmed?.();
        }
        await showToast({
          style: saved.current ? Toast.Style.Success : Toast.Style.Failure,
          title: saved.current
            ? "Task Saved"
            : unknown
              ? "Result Unconfirmed"
              : "Could Not Save Task",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        submitting.current = false;
        setIsSubmitting(false);
      }
    },
  });

  return (
    <Form
      isLoading={isSubmitting || isLoading}
      navigationTitle={`${task ? "Edit Task" : "Add Task"} · ${service.connection.label}`}
      actions={
        <ActionPanel>
          {!unconfirmed && !isSubmitting && !saved.current ? (
            <Action.SubmitForm
              title={task ? "Save Task" : "Add Task"}
              icon={Icon.CheckCircle}
              onSubmit={handleSubmit}
            />
          ) : null}
          {unconfirmed ? (
            <Action
              title="Check Saved Result"
              icon={Icon.ArrowClockwise}
              onAction={async () => {
                try {
                  const tasks = await queryWorkspaceTasks(
                    service,
                    {
                      scope:
                        task?.status === "completed" ? "completed" : "pending",
                    },
                    workspace,
                  );
                  const matches = tasks.filter((value) =>
                    task
                      ? value.uuid === task.uuid
                      : value.description ===
                        itemProps.description.value?.trim(),
                  );
                  await showToast({
                    style: Toast.Style.Success,
                    title: "Tasks Checked",
                    message: `${matches.length} matching task(s). Review My Tasks, then close and reopen this form.`,
                  });
                } catch (error) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: "Could Not Check Tasks",
                    message:
                      error instanceof Error ? error.message : String(error),
                  });
                }
              }}
            />
          ) : null}
          <Action
            title="Reload Projects"
            icon={Icon.ArrowClockwise}
            onAction={revalidate}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        title="Task"
        placeholder="What needs to be done?"
        autoFocus
        {...itemProps.description}
      />
      <Form.Dropdown
        id="project"
        title="Project"
        value={project ? `project:${project}` : ""}
        placeholder="Search or create a project"
        filtering
        onSearchTextChange={setProjectSearch}
        onChange={(value) => {
          setProject(value ? value.slice(8) : "");
          setProjectSearch("");
        }}
      >
        <Form.Dropdown.Item value="" title="No Project" />
        {canCreate ? (
          <Form.Dropdown.Item
            value={`project:${candidate}`}
            title={`Create “${candidate}”`}
            icon={Icon.Plus}
          />
        ) : null}
        {projectOptions.map((name) => (
          <Form.Dropdown.Item
            key={name}
            value={`project:${name}`}
            title={name}
            icon={Icon.Folder}
          />
        ))}
      </Form.Dropdown>
      <Form.DatePicker
        id="due"
        title="Due"
        type={Form.DatePicker.Type.Date}
        value={due}
        onChange={setDue}
      />
      <Form.TagPicker
        id="labels"
        title="Labels"
        value={selectedTags}
        onChange={setSelectedTags}
      >
        {[
          ...new Set([
            ...selectedTags,
            ...(labels?.map((tag) => tag.name) || catalog?.tags || []),
          ]),
        ].map((tag) => (
          <Form.TagPicker.Item
            key={tag}
            value={tag}
            title={tag}
            icon={{
              source: Icon.Tag,
              tintColor: itemColor(
                labels?.find((item) => item.name === tag)?.color || "gray",
              ),
            }}
          />
        ))}
      </Form.TagPicker>
      <Form.TextField
        id="new-labels"
        title="New Labels"
        placeholder="Optional, separate with commas"
        value={newLabels}
        onChange={setNewLabels}
      />
      <Form.Dropdown title="Priority" {...itemProps.priority}>
        <Form.Dropdown.Item value="" title="No Priority" />
        <Form.Dropdown.Item value="H" title="High" />
        <Form.Dropdown.Item value="M" title="Medium" />
        <Form.Dropdown.Item value="L" title="Low" />
      </Form.Dropdown>
      {task?.parent ? (
        <Form.Description
          title="Repeat"
          text={`${recur}. Use Edit Series in My Tasks to change future occurrences.`}
        />
      ) : (
        <Form.Dropdown
          id="recur"
          title="Repeat"
          value={recur || "none"}
          onChange={(value) => setRecur(value === "none" ? "" : value)}
        >
          <Form.Dropdown.Item value="none" title="Does Not Repeat" />
          {recur &&
          !recurrenceOptions.some((option) => option.value === recur) ? (
            <Form.Dropdown.Item value={recur} title={recur} />
          ) : null}
          {recurrenceOptions.map((option) => (
            <Form.Dropdown.Item
              key={option.value}
              value={option.value}
              title={option.label}
            />
          ))}
        </Form.Dropdown>
      )}
      {recur && !task?.parent ? (
        <Form.DatePicker
          id="until"
          title="Ends"
          value={until}
          onChange={setUntil}
          type={Form.DatePicker.Type.Date}
        />
      ) : null}
      {task?.annotations.length ? (
        <Form.Description
          title="Existing Notes"
          text={task.annotations.map((note) => note.description).join("\n\n")}
        />
      ) : null}
      <Form.TextArea
        title="Add Note"
        placeholder="Optional note"
        {...itemProps.note}
      />
      {unconfirmed ? (
        <Form.Description text="The save could not be confirmed. Check My Tasks before submitting again; this form will keep your input." />
      ) : null}
      {projectsError ? (
        <Form.Description
          text={`Projects unavailable: ${projectsError.message}. You can still create a project.`}
        />
      ) : null}
    </Form>
  );
}
