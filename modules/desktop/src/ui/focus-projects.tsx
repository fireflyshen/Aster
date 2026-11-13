import {
  Action,
  ActionPanel,
  confirmAlert,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useRef, useState } from "react";
import type { TaskService } from "../../../core/tasks/service.ts";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import { WorkspaceError } from "../../../core/workspace/client.ts";
import {
  FOCUS_LIMIT,
  inProject,
  projectStatus,
} from "../../../core/workspace/focus.ts";
import {
  itemColor,
  type Organization,
  type OrganizationChange,
  type SavedProject,
} from "../../../core/workspace/organization.ts";
import { projectPath } from "../../../core/workspace/projects.ts";
import { GoalForm } from "./focus-goal-form";

const STATUS_SECTIONS = ["active", "later", "completed"] as const;

/** Raycast list screen for managing up to three active Focus projects, Later projects, and subprojects. */
export function FocusProjects({
  workspace,
  initial,
  service,
  onSaved,
}: {
  workspace: WorkspaceClient;
  initial: Organization;
  service: TaskService;
  onSaved: () => Promise<unknown>;
}) {
  const { data, isLoading, revalidate } = usePromise(workspace.load, [], {
    onError: () => undefined,
  });
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const projects = data?.projects || initial.projects || [];
  const active = projects.filter(
    (project) => projectStatus(project) === "active",
  );
  const revision = data?.revision ?? initial.revision;

  async function save(change: OrganizationChange) {
    if (busy.current || blocked) return false;
    busy.current = true;
    setSaving(true);
    try {
      await workspace.change(change);
      await revalidate();
      await onSaved();
      return true;
    } catch (error) {
      if (error instanceof WorkspaceError && error.uncertain) setBlocked(true);
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Update Focus",
        message: (error as Error).message,
      });
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function reload() {
    const latest = await workspace.load();
    await revalidate();
    setBlocked(false);
    return latest;
  }

  async function completeProject(project: SavedProject) {
    const count = Object.entries(data?.projectCounts || {}).reduce(
      (n, [name, total]) => n + (inProject(name, project.name) ? total : 0),
      0,
    );
    if (
      await confirmAlert({
        title: `Complete ${project.name}?`,
        message: `${count} unfinished tasks will remain in Later. Task status and board positions will be kept.`,
        primaryAction: { title: "Complete Project" },
      })
    ) {
      await save({
        revision,
        kind: "project",
        action: "status",
        name: project.name,
        status: "completed",
        remaining: "keep",
      });
    }
  }

  const actions = (project: SavedProject) => (
    <ActionPanel>
      <Action.Push
        title="Edit Project"
        icon={Icon.Pencil}
        target={
          <GoalForm
            project={project}
            projects={projects}
            revision={revision}
            active={active}
            service={service}
            workspace={workspace}
            onSave={save}
            onReload={reload}
          />
        }
      />
      <Action.Push
        title="Add Subproject"
        icon={Icon.Plus}
        target={
          <GoalForm
            project={{ name: "", description: "" }}
            parent={project.name}
            projects={projects}
            revision={revision}
            active={active}
            service={service}
            workspace={workspace}
            onSave={save}
            onReload={reload}
          />
        }
      />
      <Action.Push
        title={
          projectStatus(project) === "active"
            ? "Pause Project"
            : "Activate Project"
        }
        icon={Icon.Play}
        target={
          <GoalForm
            project={project}
            revision={revision}
            active={active}
            service={service}
            workspace={workspace}
            status={projectStatus(project) === "active" ? "later" : "active"}
            onSave={save}
            onReload={reload}
          />
        }
      />
      {projectStatus(project) !== "completed" && (
        <Action
          title="Complete Project"
          icon={Icon.CheckCircle}
          onAction={() => completeProject(project)}
        />
      )}
      <Action
        title="Refresh Focus"
        icon={Icon.ArrowClockwise}
        onAction={async () => {
          const result = await revalidate();
          if (!(result instanceof Error)) setBlocked(false);
        }}
      />
    </ActionPanel>
  );

  return (
    <List
      isLoading={isLoading || saving}
      navigationTitle={`Focus · ${active.length}/${FOCUS_LIMIT}`}
      searchBarPlaceholder="Find a project"
    >
      <List.EmptyView
        title="No Projects Yet"
        description="Create a project in Aster web. It will start in Later."
        actions={
          <ActionPanel>
            <Action.OpenInBrowser title="Open Aster" url={workspace.url} />
          </ActionPanel>
        }
      />
      <List.Item
        id="add-project"
        title="Add Project"
        icon={Icon.Plus}
        actions={
          <ActionPanel>
            <Action.Push
              title="Add Project"
              target={
                <GoalForm
                  project={{ name: "", description: "" }}
                  projects={projects}
                  revision={revision}
                  active={active}
                  service={service}
                  workspace={workspace}
                  onSave={save}
                  onReload={reload}
                />
              }
            />
          </ActionPanel>
        }
      />
      {STATUS_SECTIONS.map((status) => (
        <List.Section
          key={status}
          title={
            status === "active"
              ? `Focus · ${active.length}/${FOCUS_LIMIT}`
              : status === "later"
                ? "Later"
                : "Completed"
          }
        >
          {projects
            .filter((project) => projectStatus(project) === status)
            .map((project) => (
              <List.Item
                key={project.name}
                title={projectPath(project.name)}
                subtitle={project.outcome || "Define a finish line"}
                icon={{
                  source:
                    status === "active"
                      ? Icon.BullsEye
                      : status === "completed"
                        ? Icon.CheckCircle
                        : Icon.Tray,
                  tintColor: itemColor(project.color || "gray"),
                }}
                actions={actions(project)}
              />
            ))}
        </List.Section>
      ))}
    </List>
  );
}
