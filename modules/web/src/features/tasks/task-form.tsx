import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { recurrenceLabel } from "@core/tasks/recurrence";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import {
  AlignLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Flag,
  MessageSquare,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { addDays, format } from "date-fns";
import { taskDate } from "@core/tasks/quick-task";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DatePicker } from "./date-picker";
import { LabelsPicker } from "./labels-picker";
import { ProjectPicker } from "./project-picker";
import { RepeatEnd, RepeatSelect } from "./repeat-fields";

type TaskFormProps = {
  draft: TaskInput;
  taskDescription?: string;
  projects: string[];
  due: string;
  tags: string;
  availableLabels: SavedTag[];
  formError: string;
  editing?: Task;
  parentTask?: Task;
  busy: boolean;
  needsCheck: boolean;
  subtasks?: Task[];
  onAddSubtask?: (input: TaskInput) => Promise<boolean>;
  onToggleSubtask?: (subtask: Task, completed: boolean) => void;
  onDeleteSubtask?: (subtaskUuid: string) => void;
  onUnlinkSubtask?: (subtaskUuid: string) => void;
  onNavigateToParent?: () => void;
  onOpenSubtask?: (subtask: Task) => void;
  onDraftChange: (draft: TaskInput) => void;
  onDescriptionChange?: (description: string) => Promise<boolean | void>;
  onAddComment?: (text: string) => Promise<boolean>;
  onDueChange: (due: string) => void;
  onTagsChange: (tags: string) => void;
  onClearError: () => void;
  onCheck: () => void;
  onDelete: () => void;
  onEditSeries: (uuid: string) => void;
  onRemoveNote: (entry: string, description: string) => Promise<boolean>;
  onToggleTask?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function TaskForm({
  draft,
  taskDescription = "",
  projects,
  due,
  tags,
  availableLabels,
  formError,
  editing,
  parentTask,
  busy,
  needsCheck,
  subtasks = [],
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onUnlinkSubtask,
  onNavigateToParent,
  onOpenSubtask,
  onDraftChange,
  onDescriptionChange,
  onAddComment,
  onDueChange,
  onTagsChange,
  onClearError,
  onCheck,
  onDelete,
  onEditSeries,
  onRemoveNote,
  onSubmit,
  onToggleTask,
}: TaskFormProps) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [subtaskInputOpen, setSubtaskInputOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(taskDescription || "");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [savingDescription, setSavingDescription] = useState(false);
  const [commentsExpanded, setCommentsExpanded] = useState(true);
  const [newCommentText, setNewCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  useEffect(() => {
    if (!isEditingDescription) {
      setDescriptionDraft(taskDescription || "");
    }
  }, [taskDescription, isEditingDescription]);

  function formatCommentTime(raw?: string): string {
    if (!raw) return "刚刚";
    try {
      const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
      const date = compact
        ? new Date(
            Date.UTC(
              Number(compact[1]),
              Number(compact[2]) - 1,
              Number(compact[3]),
              Number(compact[4]),
              Number(compact[5]),
              Number(compact[6]),
            ),
          )
        : new Date(raw);
      if (Number.isNaN(date.getTime())) return raw;
      const now = new Date();
      if (format(date, "yyyy-MM-dd") === format(now, "yyyy-MM-dd")) {
        return `今天 ${format(date, "HH:mm")}`;
      }
      if (format(date, "yyyy-MM-dd") === format(addDays(now, -1), "yyyy-MM-dd")) {
        return `昨天 ${format(date, "HH:mm")}`;
      }
      return format(date, "yyyy-MM-dd HH:mm");
    } catch {
      return raw;
    }
  }

  async function handleSaveDescription() {
    if (!onDescriptionChange) {
      setIsEditingDescription(false);
      return;
    }
    setSavingDescription(true);
    try {
      await onDescriptionChange(descriptionDraft.trim());
      setIsEditingDescription(false);
    } finally {
      setSavingDescription(false);
    }
  }

  function handleCancelDescription() {
    setDescriptionDraft(taskDescription || "");
    setIsEditingDescription(false);
  }

  async function handlePostComment() {
    const text = newCommentText.trim();
    if (!text || !onAddComment || postingComment) return;
    setPostingComment(true);
    try {
      const ok = await onAddComment(text);
      if (ok) {
        setNewCommentText("");
      }
    } finally {
      setPostingComment(false);
    }
  }
  const originalDue = editing?.due
    ? format(
        new Date(
          editing.due.replace(
            /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
            "$1-$2-$3T$4:$5:$6Z",
          ),
        ),
        "yyyy-MM-dd",
      )
    : "";
  const changed =
    !editing ||
    draft.description !== editing.description ||
    (draft.project || "") !== (editing.project || "") ||
    (draft.priority || "") !== (editing.priority || "") ||
    (draft.recur || "") !== (editing.recur || "") ||
    (draft.until || "") !==
      (editing.until ? taskDate(new Date(editing.until)) : "") ||
    due !== originalDue ||
    tags !== editing.tags.join(", ") ||
    descriptionDraft.trim() !== (taskDescription || "").trim() ||
    !!draft.note?.trim();

  async function handleCreateSubtask(e?: FormEvent) {
    if (e) e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed || !onAddSubtask) return;
    setAddingSubtask(true);
    try {
      const ok = await onAddSubtask({
        description: trimmed,
        project: draft.project,
        tags: [],
      });
      if (ok) {
        setNewSubtaskTitle("");
      }
    } finally {
      setAddingSubtask(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="task-detail-form flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.nativeEvent.isComposing &&
          event.nativeEvent.keyCode !== 229
        ) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
    >
      <div
        data-editor-body
        className="task-detail-layout min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="task-detail-main">
          {parentTask && onNavigateToParent && (
            <button
              type="button"
              onClick={onNavigateToParent}
              className="group/parent mb-3 -mt-1 inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-border/70 bg-card hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer shadow-2xs"
            >
              <span className="font-normal truncate max-w-[200px]">
                {parentTask.description}
              </span>
              <span className="text-border">|</span>
              <span className="inline-flex items-center gap-1 text-[11px] tabular-nums">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="size-3 opacity-70"
                >
                  <path
                    fillRule="evenodd"
                    d="m8 6.002-.002 4.004a2 2 0 0 0 2 2h8.007a.998.998 0 1 1 0 1.996H9.998a4 4 0 0 1-4-4V6.002a1 1 0 1 1 2 0m2.709 8.293a1 1 0 0 1 0 1.414l-2.002 2.002a1 1 0 1 1-1.414-1.414l2.002-2.002a1 1 0 1 1 1.414 0"
                    clipRule="evenodd"
                  />
                </svg>
                {parentTask.annotations?.length || 1}
              </span>
              <ChevronRight className="size-3 text-muted-foreground/60 transition-transform group-hover/parent:translate-x-0.5" />
            </button>
          )}
          <div className="task-detail-title items-start">
            {editing && onToggleTask && (
              <Checkbox
                aria-label={`${editing.status === "completed" ? "重新打开" : "完成"}: ${editing.description}`}
                checked={editing.status === "completed"}
                disabled={busy || needsCheck}
                onCheckedChange={onToggleTask}
                className={cn(
                  "mt-1 size-[20px] shrink-0 rounded-full shadow-none border-[2px]",
                  editing.priority === "H" && "border-[#d1453b] bg-[#d1453b]/10",
                  editing.priority === "M" && "border-[#eb8909] bg-[#eb8909]/10",
                  editing.priority === "L" && "border-[#246fe0] bg-[#246fe0]/10",
                  !editing.priority && "border-[#666666]",
                )}
              />
            )}
            <div className="flex-1 min-w-0">
              <Label htmlFor="description" className="sr-only">
                任务名称
              </Label>
              <Textarea
                id="description"
                placeholder="任务名称"
                value={draft.description}
                onChange={(event) => {
                  onDraftChange({
                    ...draft,
                    description: event.target.value,
                  });
                  onClearError();
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                disabled={busy || needsCheck}
                required
                maxLength={2000}
                rows={1}
                aria-invalid={formError === "Enter a task name."}
                aria-describedby={formError ? "editor-error" : undefined}
                className="min-h-8 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-lg leading-6 font-semibold shadow-none focus-visible:ring-0 md:text-xl dark:bg-transparent"
              />

              {/* Description field matching Todoist (≡ 描述) */}
              <div className="task-detail-description mt-2">
                {isEditingDescription ? (
                  <div className="rounded-lg border border-white/20 bg-background/50 p-2.5 transition-colors focus-within:border-white/30">
                    <div className="flex items-start gap-2">
                      <AlignLeft className="size-4 shrink-0 text-muted-foreground mt-1" />
                      <Textarea
                        id="task-description-input"
                        autoFocus
                        placeholder="描述"
                        value={descriptionDraft}
                        onChange={(e) => setDescriptionDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            handleCancelDescription();
                          }
                          if (
                            e.key === "Enter" &&
                            (e.metaKey || e.ctrlKey)
                          ) {
                            e.preventDefault();
                            void handleSaveDescription();
                          }
                        }}
                        rows={2}
                        disabled={busy || needsCheck || savingDescription}
                        className="min-h-[50px] resize-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-foreground shadow-none outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 placeholder:text-muted-foreground/60"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy || needsCheck || savingDescription}
                        onClick={handleCancelDescription}
                        className="h-8 px-3.5 text-[13px] font-medium bg-[#363636] hover:bg-[#444444] text-white rounded-md cursor-pointer border-0 shadow-none"
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || needsCheck || savingDescription}
                        onClick={() => void handleSaveDescription()}
                        className="h-8 px-3.5 text-[13px] font-semibold bg-[#de4c4a] hover:bg-[#c93f3d] text-white rounded-md cursor-pointer shadow-none"
                      >
                        {savingDescription ? (
                          <Spinner className="size-3" />
                        ) : (
                          "保存"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setIsEditingDescription(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setIsEditingDescription(true);
                      }
                    }}
                    className="group/desc flex items-start gap-2 py-1 px-1.5 -ml-1.5 rounded-md transition-colors hover:bg-muted/40 cursor-pointer text-left"
                  >
                    <AlignLeft className="size-4 shrink-0 text-muted-foreground/60 group-hover/desc:text-muted-foreground mt-0.5" />
                    {descriptionDraft.trim() ? (
                      <p className="text-sm leading-relaxed text-muted-foreground hover:text-foreground/90 whitespace-pre-wrap break-words flex-1 transition-colors">
                        {descriptionDraft}
                      </p>
                    ) : (
                      <span className="text-sm text-muted-foreground/60 group-hover/desc:text-muted-foreground transition-colors select-none">
                        描述
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {editing && (
            <div className="task-detail-subtasks mt-6 space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-normal text-muted-foreground">
                  子任务{" "}
                  {subtasks && subtasks.length > 0 && (
                    <span className="tabular-nums">
                      ({subtasks.filter((s) => s.status === "completed").length}
                      /{subtasks.length})
                    </span>
                  )}
                </Label>
              </div>
              {subtasks && subtasks.length > 0 && (
                <div className="divide-y border-t border-border/70">
                  {subtasks.map((subtask) => (
                    <div
                      key={subtask.uuid}
                      className="group/subtask flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <Checkbox
                          id={`form-sub-${subtask.uuid}`}
                          aria-label={`${subtask.status === "completed" ? "重新打开" : "完成"}: ${subtask.description}`}
                          checked={subtask.status === "completed"}
                          disabled={busy || needsCheck}
                          onCheckedChange={() =>
                            onToggleSubtask?.(
                              subtask,
                              subtask.status !== "completed",
                            )
                          }
                          className={cn(
                            "size-4 rounded-full shadow-none cursor-pointer",
                            subtask.status !== "completed"
                              ? cn(
                                  "border border-muted-foreground/60 bg-transparent",
                                  subtask.priority === "H" &&
                                    "border-red-500 bg-red-500/10",
                                  subtask.priority === "M" &&
                                    "border-amber-500 bg-amber-500/10",
                                  subtask.priority === "L" &&
                                    "border-blue-500 bg-blue-500/10",
                                )
                              : cn(
                                  "text-white",
                                  subtask.priority === "H" &&
                                    "border-red-500 bg-red-500 data-[state=checked]:border-red-500 data-[state=checked]:bg-red-500 dark:border-red-500 dark:bg-red-500 dark:data-[state=checked]:border-red-500 dark:data-[state=checked]:bg-red-500 dark:data-[state=checked]:text-white",
                                  subtask.priority === "M" &&
                                    "border-amber-500 bg-amber-500 data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-500 dark:border-amber-500 dark:bg-amber-500 dark:data-[state=checked]:border-amber-500 dark:data-[state=checked]:bg-amber-500 dark:data-[state=checked]:text-white",
                                  subtask.priority === "L" &&
                                    "border-blue-500 bg-blue-500 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500 dark:border-blue-500 dark:bg-blue-500 dark:data-[state=checked]:border-blue-500 dark:data-[state=checked]:bg-blue-500 dark:data-[state=checked]:text-white",
                                  !subtask.priority &&
                                    "border-muted-foreground/70 bg-muted-foreground/70 data-[state=checked]:border-muted-foreground/70 data-[state=checked]:bg-muted-foreground/70 dark:border-muted-foreground/70 dark:bg-muted-foreground/70 dark:data-[state=checked]:border-muted-foreground/70 dark:data-[state=checked]:bg-muted-foreground/70 dark:data-[state=checked]:text-white",
                                ),
                          )}
                        />
                        {onOpenSubtask ? (
                          <button
                            type="button"
                            onClick={() => onOpenSubtask(subtask)}
                            className={cn(
                              "text-sm font-normal truncate text-left hover:underline cursor-pointer flex-1",
                              subtask.status === "completed" &&
                                "line-through text-muted-foreground/60",
                            )}
                            title={`打开子任务: ${subtask.description}`}
                          >
                            {subtask.description}
                          </button>
                        ) : (
                          <span
                            className={cn(
                              "text-sm font-normal truncate",
                              subtask.status === "completed" &&
                                "line-through text-muted-foreground/60",
                            )}
                          >
                            {subtask.description}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-80 md:opacity-0 md:group-hover/subtask:opacity-100 transition-opacity">
                        {onUnlinkSubtask && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-7 text-muted-foreground hover:text-foreground"
                            title="转为主任务"
                            aria-label="转为主任务"
                            disabled={busy || needsCheck}
                            onClick={() => onUnlinkSubtask(subtask.uuid)}
                          >
                            <ArrowUpRight className="size-3.5" />
                          </Button>
                        )}
                        {onDeleteSubtask && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            title="删除子任务"
                            aria-label="删除子任务"
                            disabled={busy || needsCheck}
                            onClick={() => onDeleteSubtask(subtask.uuid)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {onAddSubtask && !subtaskInputOpen && (
                <button
                  type="button"
                  onClick={() => setSubtaskInputOpen(true)}
                  disabled={busy || needsCheck}
                  className="task-detail-add flex h-8 items-center gap-1.5 text-[13px] font-medium text-[#de4c4a] hover:text-[#c93f3d] cursor-pointer transition-colors"
                >
                  <Plus className="size-3.5" /> 添加子任务
                </button>
              )}
              {onAddSubtask && subtaskInputOpen && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder="添加子任务…"
                    value={newSubtaskTitle}
                    disabled={busy || needsCheck || addingSubtask}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setSubtaskInputOpen(false);
                      }
                      if (
                        e.key === "Enter" &&
                        !e.nativeEvent.isComposing &&
                        e.nativeEvent.keyCode !== 229
                      ) {
                        e.preventDefault();
                        void handleCreateSubtask();
                      }
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-9 shrink-0 px-3 text-xs"
                    disabled={
                      !newSubtaskTitle.trim() ||
                      busy ||
                      needsCheck ||
                      addingSubtask
                    }
                    onClick={() => void handleCreateSubtask()}
                  >
                    {addingSubtask ? <Spinner className="size-3.5" /> : "添加"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setSubtaskInputOpen(false);
                      setNewSubtaskTitle("");
                    }}
                  >
                    取消
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="task-detail-comments mt-6 pt-4 border-t border-border/70">
            <button
              type="button"
              onClick={() => setCommentsExpanded(!commentsExpanded)}
              className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-muted-foreground transition-colors cursor-pointer select-none mb-3"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-200",
                  !commentsExpanded && "-rotate-90",
                )}
              />
              <span>评论</span>
              {editing?.annotations.length ? (
                <span className="text-muted-foreground font-normal tabular-nums">
                  {editing.annotations.length}
                </span>
              ) : null}
            </button>

            {commentsExpanded && (
              <div className="space-y-3.5">
                {/* Existing comments */}
                {!!editing?.annotations.length && (
                  <div className="space-y-3">
                    {editing.annotations.map((note, index) => (
                      <div
                        key={`${note.entry}-${index}`}
                        className="group/comment flex items-start gap-2.5"
                      >
                        <div className="size-7 rounded-full bg-teal-600/90 text-white flex items-center justify-center font-medium text-xs shrink-0 select-none shadow-2xs">
                          A
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-foreground">
                                Apple用户
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatCommentTime(note.entry)}
                              </span>
                            </div>
                            {note.entry && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                className="size-6 text-muted-foreground hover:text-destructive md:opacity-0 md:group-hover/comment:opacity-100 transition-opacity"
                                aria-label={`删除评论 ${index + 1}`}
                                disabled={busy || needsCheck}
                                onClick={() =>
                                  void onRemoveNote(note.entry!, note.description)
                                }
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            )}
                          </div>
                          <p className="mt-0.5 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap [overflow-wrap:anywhere]">
                            {note.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Comment Composer */}
                <div className="flex items-center gap-2.5 pt-1">
                  <div className="size-7 rounded-full bg-teal-600/90 text-white flex items-center justify-center font-medium text-xs shrink-0 select-none shadow-2xs">
                    A
                  </div>
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="评论"
                      value={newCommentText}
                      disabled={busy || needsCheck || postingComment}
                      onChange={(e) => setNewCommentText(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing &&
                          e.nativeEvent.keyCode !== 229
                        ) {
                          e.preventDefault();
                          void handlePostComment();
                        }
                      }}
                      className="flex h-9 w-full rounded-full border border-input/70 bg-card px-3.5 pr-8 text-sm placeholder:text-muted-foreground/60 transition-colors focus-visible:outline-none focus-visible:border-ring shadow-2xs"
                    />
                    <button
                      type="button"
                      disabled={
                        !newCommentText.trim() ||
                        busy ||
                        needsCheck ||
                        postingComment
                      }
                      onClick={() => void handlePostComment()}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors cursor-pointer"
                      title="发送评论"
                      aria-label="发送评论"
                    >
                      {postingComment ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <Paperclip className="size-3.5 rotate-45" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {formError && (
            <Alert id="editor-error" variant="destructive" className="mt-4">
              <AlertDescription>
                {formError}
                {needsCheck && (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => onCheck()}
                    className="h-auto p-0 text-current"
                  >
                    Close and check tasks
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <aside className="task-detail-aside" aria-label="Task properties">
          <div className="task-detail-properties">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label
                htmlFor="edit-project"
                className="text-xs leading-4 font-normal text-muted-foreground"
              >
                项目
              </Label>
              <ProjectPicker
                compact
                value={draft.project || ""}
                projects={projects}
                onChange={(project) => {
                  onDraftChange({ ...draft, project });
                  onClearError();
                }}
                disabled={busy || needsCheck}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label
                htmlFor="due"
                className="text-xs leading-4 font-normal text-muted-foreground"
              >
                日期
              </Label>
              <DatePicker
                value={due}
                onChange={(value) => {
                  onDueChange(value);
                  onClearError();
                }}
                disabled={busy || needsCheck}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label
                htmlFor="tags"
                className="text-xs leading-4 font-normal text-muted-foreground"
              >
                标签
              </Label>
              <LabelsPicker
                value={tags
                  .split(/[,，]/)
                  .map((tag) => tag.trim())
                  .filter(Boolean)}
                choices={availableLabels}
                disabled={busy || needsCheck}
                onChange={(tags) => {
                  onTagsChange(tags.join(", "));
                  onClearError();
                }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label
                htmlFor="priority"
                className="text-xs leading-4 font-normal text-muted-foreground"
              >
                优先级
              </Label>
              <Select
                disabled={busy || needsCheck}
                value={draft.priority || "none"}
                onValueChange={(value) => {
                  onDraftChange({
                    ...draft,
                    priority: value === "none" ? "" : value,
                  });
                  onClearError();
                }}
              >
                <SelectTrigger
                  id="priority"
                  className="h-11 min-h-11 w-full text-base data-[size=default]:h-11 md:min-h-9 md:text-sm md:data-[size=default]:h-9"
                >
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      <Flag
                        className={cn(
                          "size-4",
                          draft.priority === "H" &&
                            "fill-[#d1453b]/20 text-[#d1453b]",
                          draft.priority === "M" &&
                            "fill-[#eb8909]/20 text-[#eb8909]",
                          draft.priority === "L" &&
                            "fill-[#246fe0]/20 text-[#246fe0]",
                          !draft.priority && "text-[#888888]",
                        )}
                      />
                      <span>
                        {draft.priority === "H"
                          ? "优先级 1"
                          : draft.priority === "M"
                            ? "优先级 2"
                            : draft.priority === "L"
                              ? "优先级 3"
                              : "优先级 4"}
                      </span>
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="H">
                    <span className="flex items-center gap-2">
                      <Flag className="size-3.5 fill-[#d1453b]/20 text-[#d1453b]" />
                      <span>优先级 1</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="M">
                    <span className="flex items-center gap-2">
                      <Flag className="size-3.5 fill-[#eb8909]/20 text-[#eb8909]" />
                      <span>优先级 2</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="L">
                    <span className="flex items-center gap-2">
                      <Flag className="size-3.5 fill-[#246fe0]/20 text-[#246fe0]" />
                      <span>优先级 3</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="none">
                    <span className="flex items-center gap-2">
                      <Flag className="size-3.5 text-[#888888]" />
                      <span>优先级 4</span>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="task-detail-properties">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label
                htmlFor="repeat"
                className="text-xs leading-4 font-normal text-muted-foreground"
              >
                重复
              </Label>
              {editing?.parent ? (
                <div className="flex min-h-11 items-center justify-between gap-2 md:min-h-9">
                  <span className="text-sm text-muted-foreground">
                    {recurrenceLabel(editing.recur || "Repeating")}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-9 px-0 text-xs"
                    disabled={busy || needsCheck}
                    onClick={() => onEditSeries(editing.parent!)}
                  >
                    编辑系列
                  </Button>
                </div>
              ) : (
                <RepeatSelect
                  value={draft.recur || ""}
                  disabled={busy || needsCheck}
                  onChange={(recur) => {
                    onDraftChange({
                      ...draft,
                      recur,
                      until: recur ? draft.until : "",
                    });
                    onClearError();
                  }}
                />
              )}
            </div>
            {!!draft.recur && !editing?.parent && (
              <RepeatEnd
                value={draft.until || ""}
                disabled={busy || needsCheck}
                onChange={(until) => {
                  onDraftChange({ ...draft, until });
                  onClearError();
                }}
              />
            )}
          </div>
          {editing && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Task actions"
                  className="task-detail-more"
                >
                  <Ellipsis className="size-4" /> 更多
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                {editing && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || needsCheck}
                    onClick={() => onDelete()}
                    className="-ml-2.5 h-9 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    删除任务
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          )}
        </aside>
      </div>
      {(changed || busy || !!formError) && (
        <div
          data-editor-actions
          className="flex shrink-0 items-center justify-between gap-4 border-t border-border/70 px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] md:py-3.5"
        >
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onCheck()}
              className="h-9"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || needsCheck}
              className="h-9 min-w-20"
            >
              {busy ? <Spinner className="size-4" /> : "保存"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
