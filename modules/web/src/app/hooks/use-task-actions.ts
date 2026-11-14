import { api } from "@/lib/api";
import type { EnergySummary } from "@core/workspace/energy";
import type {
    Organization,
    OrganizationChange,
} from "@core/workspace/organization";
import type { Task, TaskInput, View } from "@shared/tasks";
import { useCallback, type MutableRefObject } from "react";
import { taskEditPayload, withViewDefaults } from "../lib/task-view";
import { useBoardMoves } from "./use-board-moves";
import { useTaskCompletion, type UndoState } from "./use-task-completion";
import {
    useTaskEditor,
    type MutateOrigin,
    type TaskMutateFn,
} from "./use-task-editor";
import type { CompleteBehavior } from "./use-workspace-navigation";

export type { UndoState };

type TaskActionsDeps = {
    view: View;
    completeBehavior?: CompleteBehavior;
    currentProject: string;
    activeTagName?: string;
    tasks: Task[];
    setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
    organization: Organization;
    setOrganization: React.Dispatch<React.SetStateAction<Organization>>;
    organizationReady: boolean;
    organizationSaving: boolean;
    organizationBlocked: boolean;
    loading: boolean;
    busy: boolean;
    needsCheck: boolean;
    energy?: EnergySummary;
    writeLock: MutableRefObject<boolean>;
    isSubtask: (uuid: string) => boolean;
    setNotice: (message: string) => void;
    mutate: TaskMutateFn;
    changeOrganization: (change: OrganizationChange) => Promise<boolean>;
    reloadAll: () => Promise<Organization | undefined>;
};

/** Composes task editing, completion animations, board drags, and undo toast actions. */
export function useTaskActions(deps: TaskActionsDeps) {
    const {
        view,
        completeBehavior = "hide",
        currentProject,
        activeTagName,
        tasks,
        setTasks,
        organization,
        setOrganization,
        organizationReady,
        organizationSaving,
        organizationBlocked,
        loading,
        busy,
        needsCheck,
        energy,
        writeLock,
        isSubtask,
        setNotice,
        mutate,
        changeOrganization,
        reloadAll,
    } = deps;

    const editor = useTaskEditor({ busy, needsCheck, writeLock, mutate });
    const {
        setOpen,
        setQuickOpen,
        setQuickProject,
        setFormError,
        setQuickError,
    } = editor;

    const mutateWithOrigin = useCallback(
        (
            route: string,
            data: unknown,
            origin?: MutateOrigin,
            beforeApply?: (tasks: Task[]) => Promise<void>,
        ) =>
            mutate(route, data, origin, beforeApply, {
                onSuccess: (src) => {
                    if (src === "editor") setOpen(false);
                    if (src === "quick") setQuickOpen(false);
                },
                onError: (msg, src) => {
                    if (src === "editor" || src === "notes") setFormError(msg);
                    else if (src === "quick") setQuickError(msg);
                },
            }),
        [mutate, setFormError, setOpen, setQuickError, setQuickOpen],
    );

    const completionState = useTaskCompletion({
        view,
        completeBehavior,
        setTasks,
        organization,
        organizationSaving,
        loading,
        needsCheck,
        energy,
        writeLock,
        isSubtask,
        setNotice,
        mutateWithOrigin,
    });
    const {
        undoTask,
        addedProject,
        setToastOpen,
        showToast,
        dismissUndo,
        toggleTask,
    } = completionState;

    const boardMoves = useBoardMoves({
        tasks,
        organization,
        setOrganization,
        organizationReady,
        organizationBlocked,
        loading,
        needsCheck,
        writeLock,
        changeOrganization,
        dismissUndo,
        showToast,
    });
    const { moveTask, persistCreatedMetadata } = boardMoves;

    const applyViewDefaults = useCallback(
        <T extends TaskInput>(input: T) =>
            withViewDefaults(input, { currentProject, view, activeTagName }),
        [currentProject, view, activeTagName],
    );

    const createTaskInView = useCallback(
        async (
            input: TaskInput & { taskDescription?: string },
            columnId?: string,
            origin?: "quick",
        ) => {
            if (writeLock.current || needsCheck) return false;
            const knownUuids = new Set(tasks.map((item) => item.uuid));
            const prepared = applyViewDefaults(input);
            const saved = await mutateWithOrigin(
                "tasks",
                prepared,
                origin,
                async (fresh) => {
                    const created = fresh.find(
                        (item) => !knownUuids.has(item.uuid),
                    );
                    if (created) {
                        await persistCreatedMetadata(
                            created.uuid,
                            input.taskDescription,
                            columnId,
                        );
                    }
                },
            );
            if (saved && origin === "quick") {
                setQuickProject("");
                showToast(undefined, prepared.project || "");
            }
            return Boolean(saved);
        },
        [
            writeLock,
            needsCheck,
            tasks,
            applyViewDefaults,
            mutateWithOrigin,
            persistCreatedMetadata,
            setQuickProject,
            showToast,
        ],
    );

    const createSubtask = useCallback(
        async (parentUuid: string, input: TaskInput) => {
            if (writeLock.current || needsCheck) return false;
            const prepared = applyViewDefaults(input);
            const saved = await mutateWithOrigin("tasks", {
                ...prepared,
                parentUuid,
            });
            return Boolean(saved);
        },
        [writeLock, needsCheck, applyViewDefaults, mutateWithOrigin],
    );

    const deleteTask = useCallback(
        (task: Task, origin?: "editor") =>
            mutateWithOrigin(
                "action",
                { uuid: task.uuid, action: "delete" },
                origin,
            ).then((saved) => {
                if (saved) {
                    showToast({
                        task,
                        wasCompleted: task.status === "completed",
                        wasDeleted: true,
                        message: "已删除任务",
                    });
                }
                return saved;
            }),
        [mutateWithOrigin, showToast],
    );

    const saveInlineTask = useCallback(
        async (
            task: Task,
            nextTask: TaskInput & { taskDescription?: string },
        ) => {
            const saved = await mutateWithOrigin("action", {
                uuid: task.uuid,
                action: "edit",
                task: nextTask,
            });
            if (saved && nextTask.taskDescription !== undefined) {
                try {
                    const latest = await api<Organization>("organization", {
                        revision: organization.revision,
                        kind: "description",
                        action: "set",
                        uuid: task.uuid,
                        description: nextTask.taskDescription,
                    });
                    setOrganization(latest);
                } catch {
                    /* Description syncs on next reload. */
                }
            }
            return Boolean(saved);
        },
        [mutateWithOrigin, organization.revision, setOrganization],
    );

    const patchTaskFields = useCallback(
        (task: Task, overrides: Partial<TaskInput>) =>
            void mutateWithOrigin("action", {
                uuid: task.uuid,
                action: "edit",
                task: taskEditPayload(task, overrides),
            }),
        [mutateWithOrigin],
    );

    const handleToastAction = useCallback(
        (onNavigateToAdded: (project: string) => void) => {
            if (!undoTask) {
                onNavigateToAdded(addedProject);
                return;
            }
            setToastOpen(false);
            if (undoTask.wasDeleted) {
                void mutateWithOrigin("action", {
                    uuid: undoTask.task.uuid,
                    action: "restore",
                });
            } else if (undoTask.board) {
                void moveTask(
                    undoTask.task,
                    undoTask.board.columnId,
                    undoTask.board.beforeUuid,
                    false,
                    undoTask.board.parentUuid,
                );
            } else if (undoTask.wasStarted !== undefined) {
                void mutateWithOrigin("action", {
                    uuid: undoTask.task.uuid,
                    action: undoTask.wasStarted ? "start" : "stop",
                });
            } else {
                void toggleTask(undoTask.task, !undoTask.wasCompleted, false);
            }
        },
        [
            undoTask,
            addedProject,
            setToastOpen,
            mutateWithOrigin,
            moveTask,
            toggleTask,
        ],
    );

    return {
        ...editor,
        ...completionState,
        ...boardMoves,
        mutateWithOrigin,
        applyViewDefaults,
        reloadBoard: reloadAll,
        createTaskInView,
        createSubtask,
        deleteTask,
        saveInlineTask,
        patchTaskFields,
        handleToastAction,
    };
}
