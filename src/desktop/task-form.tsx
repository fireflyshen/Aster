import { Action, ActionPanel, Form, Icon, Toast, popToRoot, showToast, useNavigation } from "@raycast/api";
import { FormValidation, useForm, usePromise } from "@raycast/utils";
import { useRef, useState } from "react";
import { TaskExecutionError } from "../core/connection/errors.ts";
import { formatTaskDate } from "../core/tasks/date.ts";
import type { TaskwarriorTask } from "../core/tasks/model.ts";
import { uniqueTags } from "../core/tasks/options.ts";
import type { TaskService } from "../core/tasks/service.ts";
import { useTaskService } from "./use-task-service";

interface TaskFormValues {
  description: string;
  tags: string;
  priority: string;
}

interface TaskFormProps {
  task?: TaskwarriorTask;
  service?: TaskService;
  onSaved?: () => unknown;
}

export function TaskForm({ task, onSaved, service: providedService }: TaskFormProps) {
  const service = useTaskService(providedService);
  const { pop } = useNavigation();
  const submitting = useRef(false);
  const saved = useRef(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [project, setProject] = useState(task?.project || "");
  const [projectSearch, setProjectSearch] = useState("");
  const [due, setDue] = useState<Date | null>(task?.due || null);
  const {
    data: projects,
    error: projectsError,
    isLoading,
    revalidate,
  } = usePromise(service.loadProjects, [], { onError: () => undefined });
  const projectOptions = [...new Set([...(project ? [project] : []), ...(projects ?? [])])];
  const candidate = projectSearch.trim();
  const canCreate =
    candidate && !projectOptions.some((value) => value.toLocaleLowerCase() === candidate.toLocaleLowerCase());

  const { handleSubmit, itemProps } = useForm<TaskFormValues>({
    initialValues: {
      description: task?.description || "",
      tags: task?.tags.join(", ") || "",
      priority: task?.priority || "",
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
          tags: uniqueTags(values.tags.split(",")),
          due: due ? formatTaskDate(due, task?.due) : undefined,
          priority: values.priority,
        };
        if (task) await service.editTask(task.uuid, input);
        else await service.addTask(input);
        saved.current = true;
        const toast = await showToast({ style: Toast.Style.Success, title: task ? "Task updated" : "Task added" });
        try {
          await onSaved?.();
        } catch {
          toast.message = "Saved. Refresh to load the latest tasks.";
        }
        if (providedService) pop();
        else await popToRoot({ clearSearchBar: true });
      } catch (error) {
        const unknown = error instanceof TaskExecutionError && error.outcome === "unknown";
        if (unknown) setUnconfirmed(true);
        await showToast({
          style: saved.current ? Toast.Style.Success : Toast.Style.Failure,
          title: saved.current ? "Task Saved" : unknown ? "Result Unconfirmed" : "Could Not Save Task",
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
                  const tasks = await service.loadTasks(task?.status === "completed" ? "completed" : "pending");
                  const matches = tasks.filter((value) =>
                    task ? value.uuid === task.uuid : value.description === itemProps.description.value?.trim(),
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
                    message: error instanceof Error ? error.message : String(error),
                  });
                }
              }}
            />
          ) : null}
          <Action title="Reload Projects" icon={Icon.ArrowClockwise} onAction={revalidate} />
        </ActionPanel>
      }
    >
      <Form.TextField title="Task" placeholder="What needs to be done?" autoFocus {...itemProps.description} />
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
          <Form.Dropdown.Item value={`project:${candidate}`} title={`Create “${candidate}”`} icon={Icon.Plus} />
        ) : null}
        {projectOptions.map((name) => (
          <Form.Dropdown.Item key={name} value={`project:${name}`} title={name} icon={Icon.Folder} />
        ))}
      </Form.Dropdown>
      <Form.DatePicker id="due" title="Due" type={Form.DatePicker.Type.Date} value={due} onChange={setDue} />
      <Form.TextField title="Tags" placeholder="work, focus" info="Separate tags with commas." {...itemProps.tags} />
      <Form.Dropdown title="Priority" {...itemProps.priority}>
        <Form.Dropdown.Item value="" title="No Priority" />
        <Form.Dropdown.Item value="H" title="High" />
        <Form.Dropdown.Item value="M" title="Medium" />
        <Form.Dropdown.Item value="L" title="Low" />
      </Form.Dropdown>
      {unconfirmed ? (
        <Form.Description text="The save could not be confirmed. Check My Tasks before submitting again; this form will keep your input." />
      ) : null}
      {projectsError ? (
        <Form.Description text={`Projects unavailable: ${projectsError.message}. You can still create a project.`} />
      ) : null}
    </Form>
  );
}
