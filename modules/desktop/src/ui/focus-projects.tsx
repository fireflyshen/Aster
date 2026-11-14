import {
  Action,
  ActionPanel,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { type ReactNode, useRef, useState } from "react";
import type { TaskService } from "../../../core/tasks/service.ts";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import { WorkspaceError } from "../../../core/workspace/client.ts";
import {
  countProjectTasks,
  FOCUS_LIMIT,
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
import { TaskForm } from "./task-form";

const STATUS_SECTIONS = ["active", "later", "completed"] as const;

export interface FocusProjectsProps {
  workspace?: WorkspaceClient;
  initial?: Organization;
  workspaceError?: Error;
  isWorkspaceLoading?: boolean;
  service: TaskService;
  onSaved: () => Promise<unknown>;
  renderProjectScreen?: (
    projectName: string,
    onMutated?: () => Promise<unknown>,
  ) => ReactNode;
  onOpenAllTasks?: () => ReactNode;
}

/** Raycast list screen for opening project task lists and managing Focus, Later, and subprojects. */
export function FocusProjects({
  workspace,
  initial,
  workspaceError,
  isWorkspaceLoading = false,
  service,
  onSaved,
  renderProjectScreen,
  onOpenAllTasks,
}: FocusProjectsProps) {
  const {
    data,
    error: loadError,
    isLoading,
    revalidate,
  } = usePromise(
    async () => (workspace ? workspace.load() : undefined),
    [],
    {
      execute: !!workspace,
      onError: () => undefined,
    },
  );
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const organization = data ?? initial;
  const effectiveError =
    workspaceError ?? (!organization ? loadError : undefined);
  const projects = organization?.projects || [];
  const active = projects.filter(
    (project) => projectStatus(project) === "active",
  );
  const revision = organization?.revision ?? 0;

  async function save(change: OrganizationChange) {
    if (!workspace || busy.current || blocked) return false;
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
    if (!workspace) {
      throw new Error("Workspace connection unavailable.");
    }
    const latest = await workspace.load();
    await revalidate();
    setBlocked(false);
    return latest;
  }

  async function completeProject(project: SavedProject) {
    const count = countProjectTasks(organization?.projectCounts, project.name);
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

  const newProjectTarget = workspace ? (
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
  ) : undefined;

  const actions = (project: SavedProject) => (
    <ActionPanel>
      {renderProjectScreen ? (
        <Action.Push
          title="Open Project Tasks"
          icon={Icon.List}
          target={renderProjectScreen(project.name, async () => {
            await revalidate();
            await onSaved();
          })}
        />
      ) : null}
      <Action.Push
        title="New Task in Project"
        icon={Icon.Plus}
        shortcut={Keyboard.Shortcut.Common.New}
        target={
          <TaskForm
            service={service}
            workspace={workspace}
            labels={organization?.tags}
            knownProjects={projects.map((item) => item.name)}
            initialInput={{
              description: "",
              project: project.name,
              priority: "",
              tags: [],
            }}
            onSaved={async () => {
              await revalidate();
              await onSaved();
            }}
          />
        }
      />
      {workspace ? (
        <>
          <Action.Push
            title="Edit Project"
            icon={Icon.Pencil}
            shortcut={Keyboard.Shortcut.Common.Edit}
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
                status={
                  projectStatus(project) === "active" ? "later" : "active"
                }
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
        </>
      ) : null}
      <ActionPanel.Section title="Workspace">
        {onOpenAllTasks ? (
          <Action.Push
            title="Open All Tasks"
            icon={Icon.CheckList}
            target={onOpenAllTasks()}
          />
        ) : null}
        {newProjectTarget ? (
          <Action.Push
            title="New Project"
            icon={Icon.Plus}
            target={newProjectTarget}
          />
        ) : null}
        <Action
          title="Refresh Projects"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={async () => {
            const result = await revalidate();
            if (!(result instanceof Error)) setBlocked(false);
            await onSaved();
          }}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );

  return (
    <List
      isLoading={isWorkspaceLoading || isLoading || saving}
      navigationTitle={`Focus & Projects · ${active.length}/${FOCUS_LIMIT}`}
      searchBarPlaceholder="Search projects…"
    >
      <List.EmptyView
        icon={effectiveError ? Icon.Warning : Icon.BullsEye}
        title={
          effectiveError
            ? "Could Not Load Projects"
            : isWorkspaceLoading || isLoading
              ? "Loading Projects…"
              : "No Projects Yet"
        }
        description={
          effectiveError?.message ||
          "Create a project or open All Tasks to see every Taskwarrior task."
        }
        actions={
          <ActionPanel>
            {onOpenAllTasks ? (
              <Action.Push
                title="Open All Tasks"
                icon={Icon.CheckList}
                target={onOpenAllTasks()}
              />
            ) : null}
            {newProjectTarget ? (
              <Action.Push
                title="New Project"
                icon={Icon.Plus}
                target={newProjectTarget}
              />
            ) : null}
            {workspace ? (
              <Action.OpenInBrowser title="Open Aster" url={workspace.url} />
            ) : null}
          </ActionPanel>
        }
      />
      {!effectiveError &&
        STATUS_SECTIONS.map((status) => {
          const items = projects.filter(
            (project) => projectStatus(project) === status,
          );
          return items.length ? (
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
              {items.map((project) => {
                const count = countProjectTasks(
                  organization?.projectCounts,
                  project.name,
                );
                return (
                  <List.Item
                    key={project.name}
                    title={projectPath(project.name)}
                    subtitle={
                      project.outcome || project.description || undefined
                    }
                    keywords={[
                      project.name,
                      project.outcome || "",
                      project.description || "",
                    ]}
                    icon={{
                      source:
                        status === "active"
                          ? Icon.BullsEye
                          : status === "completed"
                            ? Icon.CheckCircle
                            : Icon.Tray,
                      tintColor: itemColor(project.color || "gray"),
                    }}
                    accessories={
                      status !== "completed"
                        ? [
                            {
                              tag: `${count} ${count === 1 ? "task" : "tasks"}`,
                            },
                          ]
                        : undefined
                    }
                    actions={actions(project)}
                  />
                );
              })}
            </List.Section>
          ) : null;
        })}
      {!effectiveError && newProjectTarget ? (
        <List.Section title="Actions">
          <List.Item
            id="add-project"
            title="New Project"
            subtitle="Create a project in Later or promote to Focus"
            icon={Icon.Plus}
            actions={
              <ActionPanel>
                <Action.Push
                  title="New Project"
                  icon={Icon.Plus}
                  target={newProjectTarget}
                />
                {onOpenAllTasks ? (
                  <Action.Push
                    title="Open All Tasks"
                    icon={Icon.CheckList}
                    target={onOpenAllTasks()}
                  />
                ) : null}
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
    </List>
  );
}
