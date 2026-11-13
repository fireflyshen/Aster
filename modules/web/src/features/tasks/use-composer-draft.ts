import { isoDue, toDueDay } from "@/features/tasks/task-date";
import {
  findQuickTriggerSuggestions,
  removeQuickTokenSpan,
  replaceQuickTokenKind,
} from "@/features/tasks/quick-token-helpers";
import {
  parseQuickTask,
  taskDate,
  type QuickToken,
} from "@core/tasks/quick-task";
import type { SavedTag } from "@core/workspace/organization";
import type { TaskInput } from "@shared/tasks";
import { useMemo, useRef, useState } from "react";

type ComposerDraftOptions = {
  mode: "add" | "edit";
  defaultProject: string;
  defaultDue: string;
  initialValue?: TaskInput & { taskDescription?: string };
  initialDescription: string;
  projects: string[];
  availableLabels: SavedTag[];
  onCancel?: () => void;
};

/** Encapsulates inline composer text/note state, token parsing, suggestions, and task payload assembly. */
export function useComposerDraft({
  mode,
  defaultProject,
  defaultDue,
  initialValue,
  initialDescription,
  projects,
  availableLabels,
  onCancel,
}: ComposerDraftOptions) {
  const [editing, setEditing] = useState(mode === "edit");
  const [title, setTitle] = useState(initialValue?.description || "");
  const [note, setNote] = useState(
    initialDescription || initialValue?.taskDescription || "",
  );
  const [manualDue, setManualDue] = useState<string | null | undefined>();
  const [manualPriority, setManualPriority] = useState<
    "H" | "M" | "L" | "" | undefined
  >();
  const [manualProject, setManualProject] = useState<string | undefined>();
  const [manualTags, setManualTags] = useState<string[] | undefined>(
    initialValue?.tags,
  );
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseQuickTask(title), [title]);
  const dueToken = parsed.tokens.find((t) => t.kind === "due" && !t.ignored);
  const priorityToken = parsed.tokens.find(
    (t) => t.kind === "priority" && !t.ignored,
  );
  const projectToken = parsed.tokens.find(
    (t) => t.kind === "project" && !t.ignored,
  );
  const tagTokens = parsed.tokens.filter((t) => t.kind === "tag" && !t.ignored);

  const activeDueDay = useMemo(() => {
    if (dueToken) return toDueDay(dueToken.value);
    if (manualDue !== undefined) return manualDue || "";
    if (initialValue?.due) return toDueDay(initialValue.due);
    if (defaultDue) return toDueDay(defaultDue);
    return "";
  }, [dueToken, manualDue, initialValue?.due, defaultDue]);

  const activePriority: "H" | "M" | "L" | "" = useMemo(() => {
    if (priorityToken)
      return (priorityToken.value as "H" | "M" | "L" | "") || "";
    if (manualPriority !== undefined) return manualPriority;
    return (initialValue?.priority as "H" | "M" | "L" | "") || "";
  }, [priorityToken, manualPriority, initialValue?.priority]);

  const activeProject = useMemo(() => {
    if (projectToken) return projectToken.value;
    if (manualProject !== undefined) return manualProject;
    return initialValue?.project ?? defaultProject ?? "";
  }, [projectToken, manualProject, initialValue?.project, defaultProject]);

  const activeTags = useMemo(() => {
    const base = manualTags ?? initialValue?.tags ?? [];
    return Array.from(new Set([...base, ...tagTokens.map((t) => t.value)]));
  }, [manualTags, initialValue?.tags, tagTokens]);

  const suggestions = useMemo(
    () => findQuickTriggerSuggestions(title, projects, availableLabels),
    [title, projects, availableLabels],
  );

  function applySuggestion(tokenValue: string, kind: "#" | "@") {
    const tokenText = `${kind}${tokenValue.includes(" ") ? `"${tokenValue}"` : tokenValue}`;
    setTitle(suggestions.replaceTrailingTrigger(tokenText));
    if (kind === "#") setManualProject(tokenValue);
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function removeToken(token: QuickToken) {
    setTitle(removeQuickTokenSpan(title, token));
    if (token.kind === "due") setManualDue(null);
    if (token.kind === "priority") setManualPriority("");
    if (token.kind === "project") setManualProject("");
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function setField(kind: QuickToken["kind"], expression: string) {
    setTitle(replaceQuickTokenKind(title, parsed.tokens, kind, expression));
  }

  function clearFields(resetText = false) {
    if (resetText) {
      setTitle("");
      setNote("");
    }
    setManualDue(undefined);
    setManualPriority(undefined);
    setManualProject(undefined);
    setManualTags(undefined);
    setError("");
  }

  function resetOrClose() {
    clearFields(true);
    setEditing(false);
    onCancel?.();
  }

  function buildTaskInput(): {
    task: TaskInput & { taskDescription?: string };
    error?: string;
  } {
    if (parsed.errors.length) {
      return { task: parsed.task, error: parsed.errors[0] };
    }
    const cleanTitle = (
      parsed.tokens.length > 0 ? parsed.task.description : title
    )
      .replace(/[\r\n]+/g, " ")
      .trim();

    if (!cleanTitle) {
      return {
        task: {
          description: "",
          project: activeProject,
          priority: activePriority,
          tags: activeTags,
          due: "",
          note: note.trim(),
        },
        error: "请输入任务名称。",
      };
    }

    let resolvedDue = "";
    if (dueToken) {
      resolvedDue = dueToken.value;
    } else if (activeDueDay) {
      const existingIso = initialValue?.due ? isoDue(initialValue.due) : "";
      const existingDay = existingIso ? toDueDay(existingIso) : "";
      resolvedDue =
        existingDay === activeDueDay && existingIso
          ? taskDate(new Date(existingIso))
          : taskDate(new Date(`${activeDueDay}T00:00:00`));
    }

    return {
      task: {
        description: cleanTitle,
        project: activeProject,
        priority: activePriority,
        tags: activeTags,
        due: resolvedDue,
        recur: initialValue?.recur,
        until: initialValue?.until,
        note: undefined,
        taskDescription: note.trim() || undefined,
      },
    };
  }

  return {
    editing,
    setEditing,
    title,
    setTitle,
    note,
    setNote,
    setManualDue,
    setManualPriority,
    setManualProject,
    setManualTags,
    priorityOpen,
    setPriorityOpen,
    error,
    setError,
    submitting,
    setSubmitting,
    titleRef,
    parsed,
    dueToken,
    activeDueDay,
    activePriority,
    activeProject,
    activeTags,
    projectSuggestions: suggestions.projectSuggestions,
    labelSuggestions: suggestions.labelSuggestions,
    applySuggestion,
    removeToken,
    setField,
    clearFields,
    resetOrClose,
    buildTaskInput,
  };
}
