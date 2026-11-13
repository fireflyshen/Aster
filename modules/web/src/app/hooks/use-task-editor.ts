import { taskDate } from "@core/tasks/quick-task";
import type { Task, TaskInput } from "@shared/tasks";
import {
  useCallback,
  useState,
  type FormEvent,
  type MutableRefObject,
} from "react";
import {
  BLANK_TASK_INPUT,
  formatInitialDue,
  isoDueFromInput,
  taskToDraft,
} from "../lib/task-view";

export type MutateOrigin = "editor" | "quick" | "notes";

export type TaskMutateFn = (
  route: string,
  data: unknown,
  origin?: MutateOrigin,
  beforeApply?: (tasks: Task[]) => Promise<void>,
  callbacks?: {
    onSuccess?: (origin?: MutateOrigin) => void;
    onError?: (message: string, origin?: MutateOrigin) => void;
  },
) => Promise<boolean>;

type TaskEditorDeps = {
  busy: boolean;
  needsCheck: boolean;
  writeLock: MutableRefObject<boolean>;
  mutate: TaskMutateFn;
};

/** Manages full task-editor modal state, quick-add dialog state, and form submission. */
export function useTaskEditor({
  busy,
  needsCheck,
  writeLock,
  mutate,
}: TaskEditorDeps) {
  const [open, setOpen] = useState(false);
  const [seriesUuid, setSeriesUuid] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickProject, setQuickProject] = useState("");
  const [quickError, setQuickError] = useState("");
  const [editing, setEditing] = useState<Task>();
  const [draft, setDraft] = useState<TaskInput>(BLANK_TASK_INPUT);
  const [tags, setTags] = useState("");
  const [due, setDue] = useState("");
  const [formError, setFormError] = useState("");

  const openQuickAdd = useCallback(() => {
    if (writeLock.current || needsCheck || open) return;
    setQuickProject("");
    setQuickError("");
    setQuickOpen(true);
  }, [writeLock, needsCheck, open]);

  const openEditor = useCallback(
    (task?: Task, initial?: TaskInput) => {
      if (busy || needsCheck) return;
      setSeriesUuid("");
      setEditing(task);
      setDraft(taskToDraft(task, initial));
      setTags((task?.tags || initial?.tags)?.join(", ") || "");
      setDue(formatInitialDue(task, initial));
      setFormError("");
      setOpen(true);
    },
    [busy, needsCheck],
  );

  const submitTaskForm = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (writeLock.current || needsCheck) return;
      if (!draft.description.trim()) {
        setFormError("请输入任务名称。");
        document.getElementById("description")?.focus();
        return;
      }
      const existing = isoDueFromInput(editing?.due || draft.due);
      const date = due
        ? existing && existing.slice(0, 10) === due
          ? new Date(existing)
          : new Date(`${due}T00:00:00`)
        : undefined;
      const task: TaskInput = {
        ...draft,
        description: draft.description.replace(/[\r\n]+/g, " ").trim(),
        due: date ? taskDate(date) : "",
        tags: tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      void mutate(
        editing ? "action" : "tasks",
        editing ? { uuid: editing.uuid, action: "edit", task } : task,
        "editor",
        undefined,
        {
          onSuccess: () => setOpen(false),
          onError: (msg) => setFormError(msg),
        },
      );
    },
    [writeLock, needsCheck, draft, editing, due, tags, mutate],
  );

  return {
    open,
    setOpen,
    seriesUuid,
    setSeriesUuid,
    quickOpen,
    setQuickOpen,
    quickProject,
    setQuickProject,
    quickError,
    setQuickError,
    editing,
    setEditing,
    draft,
    setDraft,
    tags,
    setTags,
    due,
    setDue,
    formError,
    setFormError,
    openQuickAdd,
    openEditor,
    submitTaskForm,
  };
}
