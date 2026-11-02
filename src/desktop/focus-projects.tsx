import {
    Action,
    ActionPanel,
    Form,
    Icon,
    List,
    Toast,
    confirmAlert,
    showToast,
    useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useRef, useState } from "react";
import type { TaskService } from "../core/tasks/service.ts";
import type { WorkspaceClient } from "../core/workspace/client.ts";
import { WorkspaceError } from "../core/workspace/client.ts";
import {
    FOCUS_LIMIT,
    inProject,
    projectStatus,
    type ProjectStatus,
} from "../core/workspace/focus.ts";
import {
    colors,
    itemColor,
    type Color,
    type Organization,
    type OrganizationChange,
    type SavedProject,
} from "../core/workspace/organization.ts";
import {
    projectLeaf,
    projectParent,
    projectPath,
    projectTree,
    validateProjectName,
} from "../core/workspace/projects.ts";

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
            if (error instanceof WorkspaceError && error.uncertain)
                setBlocked(true);
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
    const actions = (project: SavedProject) => (
        <ActionPanel>
            <Action.Push
                title="Edit Project"
                icon={Icon.Pencil}
                target={
                    <GoalForm
                        project={project}
                        projects={projects}
                        revision={data?.revision ?? initial.revision}
                        active={active}
                        service={service}
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
                        revision={data?.revision ?? initial.revision}
                        active={active}
                        service={service}
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
                        revision={data?.revision ?? initial.revision}
                        active={active}
                        service={service}
                        status={
                            projectStatus(project) === "active"
                                ? "later"
                                : "active"
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
                    onAction={async () => {
                        const count = Object.entries(
                            data?.projectCounts || {},
                        ).reduce(
                            (n, [name, total]) =>
                                n + (inProject(name, project.name) ? total : 0),
                            0,
                        );
                        if (
                            await confirmAlert({
                                title: `Complete ${project.name}?`,
                                message: `${count} unfinished tasks will remain in Later. Task status and board positions will be kept.`,
                                primaryAction: { title: "Complete Project" },
                            })
                        )
                            await save({
                                revision: data?.revision ?? initial.revision,
                                kind: "project",
                                action: "status",
                                name: project.name,
                                status: "completed",
                                remaining: "keep",
                            });
                    }}
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
                        <Action.OpenInBrowser
                            title="Open Aster"
                            url={workspace.url}
                        />
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
                                    revision={
                                        data?.revision ?? initial.revision
                                    }
                                    active={active}
                                    service={service}
                                    onSave={save}
                                    onReload={reload}
                                />
                            }
                        />
                    </ActionPanel>
                }
            />
            {(["active", "later", "completed"] as const).map((status) => (
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
                                subtitle={
                                    project.outcome || "Define a finish line"
                                }
                                icon={{
                                    source:
                                        status === "active"
                                            ? Icon.BullsEye
                                            : status === "completed"
                                              ? Icon.CheckCircle
                                              : Icon.Tray,
                                    tintColor: itemColor(
                                        project.color || "gray",
                                    ),
                                }}
                                actions={actions(project)}
                            />
                        ))}
                </List.Section>
            ))}
        </List>
    );
}

function GoalForm({
    project,
    projects = [],
    parent: initialParent,
    revision,
    active,
    service,
    status,
    onSave,
    onReload,
}: {
    project: SavedProject;
    projects?: SavedProject[];
    parent?: string;
    revision: number;
    active: SavedProject[];
    service: TaskService;
    status?: ProjectStatus;
    onSave: (change: OrganizationChange) => Promise<boolean>;
    onReload: () => Promise<Organization>;
}) {
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
    const tasks = usePromise(service.loadTasks, [], {
        onError: () => undefined,
    });
    const choices = (tasks.data || []).filter((task) =>
        inProject(task.project, project.name),
    );
    const replacing =
        status === "active" &&
        currentActive.filter((p) => p.name !== project.name).length >=
            FOCUS_LIMIT;
    return (
        <Form
            isLoading={saving || tasks.isLoading}
            navigationTitle={`${status === "later" ? "Pause" : status === "active" ? "Activate" : "Edit"} · ${project.name}`}
            actions={
                <ActionPanel>
                    <Action.SubmitForm
                        title={replacing ? "Pause and Activate" : "Save"}
                        onSubmit={async () => {
                            if (saving) return;
                            if (
                                (status === "active" ||
                                    projectStatus(project) === "active") &&
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
                            const path = parent
                                ? parent + "." + name.trim()
                                : name.trim();
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
                                                        ...(replacement
                                                            ? {
                                                                  replaceProject:
                                                                      replacement,
                                                              }
                                                            : {}),
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
                        }}
                    />
                    <Action
                        title="Reload and Keep Draft"
                        icon={Icon.ArrowClockwise}
                        onAction={async () => {
                            if (saving) return;
                            setSaving(true);
                            try {
                                const latest = await onReload();
                                setDraftRevision(latest.revision);
                                setCurrentActive(
                                    (latest.projects || []).filter(
                                        (p) => projectStatus(p) === "active",
                                    ),
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
                        }}
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
                                <Form.Dropdown.Item
                                    value=""
                                    title="No parent"
                                />
                                {projectTree(
                                    projects
                                        .map((p) => p.name)
                                        .filter(
                                            (path) =>
                                                !project.name ||
                                                !inProject(path, project.name),
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
                            <Form.Dropdown.Item
                                value=""
                                title="Choose one active project"
                            />
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
                            {nextTask &&
                                !choices.some(
                                    (task) => task.uuid === nextTask,
                                ) && (
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
