import type { KeyboardEvent } from "react";

type TaskRowShortcutHandlers = {
  disabled: boolean;
  editingInline: boolean;
  completed: boolean;
  dueDay: string;
  todayStr: string;
  tomorrowStr: string;
  onStartInlineEdit?: () => void;
  onComplete: () => void;
  onToggleStart?: () => void;
  onDueChange?: (due: string) => void;
  onPriorityChange?: (priority: "H" | "M" | "L" | "") => void;
  onDelete?: () => void;
};

const PRIORITY_KEY_MAP: Record<string, "H" | "M" | "L" | ""> = {
  "1": "H",
  "2": "M",
  "3": "L",
  "0": "",
};

/** Handles keyboard navigation and single-key task shortcuts when focus is on a task row. */
export function handleTaskRowShortcut(
  event: KeyboardEvent<HTMLElement>,
  handlers: TaskRowShortcutHandlers,
) {
  const {
    disabled,
    editingInline,
    completed,
    dueDay,
    todayStr,
    tomorrowStr,
    onStartInlineEdit,
    onComplete,
    onToggleStart,
    onDueChange,
    onPriorityChange,
    onDelete,
  } = handlers;

  if (
    disabled ||
    editingInline ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [data-state="open"][data-slot="popover-content"]',
    )
  ) {
    return;
  }

  const key = event.key.toLowerCase();
  if (
    key === "j" ||
    event.key === "ArrowDown" ||
    key === "k" ||
    event.key === "ArrowUp"
  ) {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-task-row] [data-task-drag-surface]:not(:disabled)",
      ),
    );
    const current = event.currentTarget.querySelector<HTMLElement>(
      "[data-task-drag-surface]",
    );
    const index = current ? rows.indexOf(current) : -1;
    if (index === -1) return;
    const nextIndex =
      key === "j" || event.key === "ArrowDown"
        ? Math.min(rows.length - 1, index + 1)
        : Math.max(0, index - 1);
    if (nextIndex !== index) {
      event.preventDefault();
      rows[nextIndex]?.focus();
    }
    return;
  }

  if (key === "e" && !completed && onStartInlineEdit) {
    event.preventDefault();
    onStartInlineEdit();
    return;
  }
  if (key === "x") {
    event.preventDefault();
    onComplete();
    return;
  }
  if (key === "s" && !completed && onToggleStart) {
    event.preventDefault();
    onToggleStart();
    return;
  }
  if (key === "t" && !completed && onDueChange) {
    event.preventDefault();
    onDueChange(dueDay === todayStr ? tomorrowStr : todayStr);
    return;
  }
  if (key in PRIORITY_KEY_MAP && !completed && onPriorityChange) {
    event.preventDefault();
    onPriorityChange(PRIORITY_KEY_MAP[key]);
    return;
  }
  if ((event.key === "Backspace" || event.key === "Delete") && onDelete) {
    event.preventDefault();
    onDelete();
  }
}
