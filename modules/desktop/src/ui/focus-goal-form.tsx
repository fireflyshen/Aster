import {
  Action,
  ActionPanel,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import type { TaskService } from "../../../core/tasks/service.ts";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import { queryWorkspaceTasks } from "../../../core/workspace/task-views.ts";
import {
  FOCUS_LIMIT,
  inProject,
  projectStatus,
  type ProjectStatus,
} from "../../../core/workspace/focus.ts";
import {
  colors,
  type Color,
  type Organization,
  type OrganizationChange,
  type SavedProject,
} from "../../../core/workspace/organization.ts";
import {
  projectLeaf,
  projectParent,
  projectPath,
  projectTree,
  validateProjectName,
} from "../../../core/workspace/projects.ts";

export interface GoalFormProps {
  project: SavedProject;
  projects?: SavedProject[];
  parent?: string;
  revision: number;
  active: SavedProject[];
  service: TaskService;
  workspace?: WorkspaceClient;
  status?: ProjectStatus;
  onSave: (change: OrganizationChange) => Promise<boolean>;
  onReload: () => Promise<Organization>;
}

/** Raycast form for creating/editing a project or pausing/activating a Focus goal. */
export function GoalForm({
  project,
  projects = [],
  parent: initialParent,
  revision,
  active,
  service,
  workspace,
  status,
  onSave,
  onReload,
}: GoalFormProps) {
  const { pop } = useNavigation();
  const [draftRevision, setDraftRevision] = useState(revision);
  const [currentActive, setCurrentActive] = useState(active);
  const [name, setName] = useState(projectLeaf(project.name));
  const [parent, setParent] = useState(
    initialParent ?? projectParent(project.name),
  );
  const [color, setColor] = useState<Color>(project.color || "gray");
  const [description, setDescription] = useState(project.description);
  const [outcome, setOutcome] = useState(project.outcome || "");
  const [nextTask, setNextTask] = useState(project.nextTask || "");
  const [replacement, setReplacement] = useState("");
  const [saving, setSaving] = useState(false);
  const tasks = usePromise(
    queryWorkspaceTasks,
    [service, { scope: "pending" }, workspace],
    { onError: () => undefined },
  );
  const choices = (tasks.data || []).filter((task) =>
    inProject(task.project, project.name),
  );
  const replacing =
    status === "active" &&
    currentActive.filter((p) => p.name !== project.name).length >= FOCUS_LIMIT;

  async function handleSubmit() {
    if (saving) return;
    if (
      (status === "active" || projectStatus(project) === "active") &&
      !outcome.trim()
    ) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Define a finish line",
      });
      return;
    }
    if (replacing && !replacement) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Choose a project to pause",
      });
      return;
    }
    const path = parent ? `${parent}.${name.trim()}` : name.trim();
    if (!status) {
      try {
        validateProjectName(path);
        if (name.includes("."))
          throw new Error(
            "Choose Parent Project instead of putting dots in the name.",
          );
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: (error as Error).message,
        });
        return;
      }
    }
    setSaving(true);
    try {
      const saved = await onSave(
        status
          ? {
              revision: draftRevision,
              kind: "project",
              action: "status",
              name: project.name,
              status,
              ...(status === "active"
                ? {
                    outcome,
                    ...(replacement ? { replaceProject: replacement } : {}),
                  }
                : {}),
            }
          : {
              revision: draftRevision,
              kind: "project",
              action: "save",
              originalName: project.name,
              item: {
                ...project,
                name: path,
                description,
                color,
                outcome,
                nextTask,
              },
            },
      );
      if (saved) pop();
    } finally {
      setSaving(false);
    }
  }

  async function handleReloadDraft() {
    if (saving) return;
    setSaving(true);
    try {
      const latest = await onReload();
      setDraftRevision(latest.revision);
      setCurrentActive(
        (latest.projects || []).filter((p) => projectStatus(p) === "active"),
      );
      setReplacement("");
      await tasks.revalidate();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Reload Focus",
        message: (error as Error).message,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Form
      isLoading={saving || tasks.isLoading}
      navigationTitle={`${status === "later" ? "Pause" : status === "active" ? "Activate" : "Edit"} · ${project.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={replacing ? "Pause and Activate" : "Save"}
            onSubmit={handleSubmit}
          />
          <Action
            title="Reload and Keep Draft"
            icon={Icon.ArrowClockwise}
            onAction={handleReloadDraft}
          />
        </ActionPanel>
      }
    >
      {status === "later" ? (
        <Form.Description text="Tasks and board positions stay in Later. No tasks will be marked complete." />
      ) : (
        <>
          {!status && (
            <>
              <Form.TextField
                id="name"
                title="Name"
                value={name}
                onChange={setName}
              />
              <Form.Dropdown
                id="color"
                title="Color"
                value={color}
                onChange={(value) => setColor(value as Color)}
              >
                {colors.map((item) => (
                  <Form.Dropdown.Item
                    key={item.id}
                    value={item.id}
                    title={item.name}
                    icon={{
                      source: Icon.CircleFilled,
                      tintColor: item.value,
                    }}
                  />
                ))}
              </Form.Dropdown>
              <Form.Dropdown
                id="parent"
                title="Parent Project"
                value={parent}
                onChange={setParent}
              >
                <Form.Dropdown.Item value="" title="No parent" />
                {projectTree(
                  projects
                    .map((p) => p.name)
                    .filter(
                      (path) => !project.name || !inProject(path, project.name),
                    ),
                ).map((row) => (
                  <Form.Dropdown.Item
                    key={row.name}
                    value={row.name}
                    title={projectPath(row.name)}
                  />
                ))}
              </Form.Dropdown>
              <Form.TextArea
                id="description"
                title="Description"
                value={description}
                onChange={setDescription}
              />
            </>
          )}
          <Form.TextArea
            id="outcome"
            title="Finish Line"
            value={outcome}
            onChange={setOutcome}
            placeholder="What result would make this project complete?"
          />
          {replacing && (
            <Form.Dropdown
              id="replacement"
              title="Pause Project"
              value={replacement}
              onChange={setReplacement}
            >
              <Form.Dropdown.Item value="" title="Choose one active project" />
              {active
                .filter((p) => p.name !== project.name)
                .map((p) => (
                  <Form.Dropdown.Item
                    key={p.name}
                    value={p.name}
                    title={p.name}
                  />
                ))}
            </Form.Dropdown>
          )}
          {!status && (
            <Form.Dropdown
              id="nextTask"
              title="Next Step"
              value={nextTask}
              onChange={setNextTask}
            >
              <Form.Dropdown.Item value="" title="Choose later" />
              {nextTask && !choices.some((task) => task.uuid === nextTask) && (
                <Form.Dropdown.Item
                  value={nextTask}
                  title="Previous task (completed or unavailable)"
                />
              )}
              {choices.map((task) => (
                <Form.Dropdown.Item
                  key={task.uuid}
                  value={task.uuid}
                  title={task.description}
                />
              ))}
            </Form.Dropdown>
          )}
        </>
      )}
    </Form>
  );
}
