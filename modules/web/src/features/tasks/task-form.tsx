import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  HabitNegativeStatusRing,
  TaskHabitExecutionCard,
  type HabitTaskActions,
} from "@/features/habits/habit-task-controls";
import {
  buildBindInputFromDraft,
  createHabitDraftFromItem,
  currentLocalTodayDate,
  isHabitDraftDirty,
  TaskHabitSidebarField,
  type TaskHabitDraft,
} from "@/features/habits/task-habit-field";
import { setTaskBudget } from "@/features/time/time-api";
import type { BindTaskHabitInput, HabitListItem } from "@core/habits/model";
import { taskDate } from "@core/tasks/quick-task";
import {
  DEFAULT_HOURLY_RATE_CENTS,
  type TaskCostSummary,
} from "@core/time/model";
import { localDateOf } from "@core/time/zone";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { AlignLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { FormattedDescription } from "./description-content";
import { TaskCheckbox } from "./task-checkbox";
import {
  createEmptyTaskBudgetDraft,
  NewTaskBudgetSection,
  TaskCostDetailSection,
  type TaskBudgetDraft,
} from "./task-cost-panel";
import { toDueDay } from "./task-date";
import { TaskDetailComments } from "./task-detail-comments";
import { TaskDetailSidebar } from "./task-detail-sidebar";
import { TaskDetailSubtasks } from "./task-detail-subtasks";

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
  timingActive?: boolean;
  timingUnavailable?: boolean;
  onToggleStart?: () => void;
  onClearStartMark?: () => void;
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
  onReload: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onDelete: () => void;
  onEditSeries: (uuid: string) => void;
  onRemoveNote: (entry: string, description: string) => Promise<boolean>;
  onToggleTask?: () => void;
  isTimeMode?: boolean;
  hourlyRateCents?: number;
  costSummary?: TaskCostSummary;
  onRefreshTimeSnapshot?: () => Promise<unknown>;
  habit?: HabitListItem;
  initialHabitPreset?: boolean;
  initialHabitDraft?: TaskHabitDraft;
  habitTodayDate?: string;
  habitActions?: HabitTaskActions;
  onBindTaskHabit?: (input: BindTaskHabitInput) => Promise<unknown>;
  onUnbindTaskHabit?: (taskUuid: string) => Promise<unknown>;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    keepOpen?: boolean,
    taskDescription?: string,
    onCreatedOrUpdated?: (taskUuid?: string) => Promise<void> | void,
  ) => void;
};

/** Orchestrates the task detail / editing form and right-side properties rail. */
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
  timingActive,
  timingUnavailable = false,
  onToggleStart,
  onClearStartMark,
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
  onReload,
  onDirtyChange,
  onDelete,
  onEditSeries,
  onRemoveNote,
  onSubmit,
  onToggleTask,
  isTimeMode = false,
  hourlyRateCents = DEFAULT_HOURLY_RATE_CENTS,
  costSummary,
  onRefreshTimeSnapshot,
  habit,
  initialHabitPreset = false,
  initialHabitDraft,
  habitTodayDate,
  habitActions,
  onBindTaskHabit,
  onUnbindTaskHabit,
}: TaskFormProps) {
  const effectiveTodayDate = habitTodayDate || currentLocalTodayDate();
  const [descriptionDraft, setDescriptionDraft] = useState(
    taskDescription || "",
  );
  const [editingDescription, setEditingDescription] = useState(false);
  const [savingDescription, setSavingDescription] = useState(false);
  const [savingHabitOnly, setSavingHabitOnly] = useState(false);
  const [descriptionError, setDescriptionError] = useState("");
  const [commentDirty, setCommentDirty] = useState(false);
  const [subtaskDirty, setSubtaskDirty] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<TaskBudgetDraft>(
    createEmptyTaskBudgetDraft,
  );
  const [habitDraft, setHabitDraft] = useState<TaskHabitDraft>(
    () =>
      initialHabitDraft ??
      createHabitDraftFromItem(habit, initialHabitPreset),
  );
  const descriptionLock = useRef(false);
  const initialDraft = useRef(JSON.stringify({ draft, due, tags }));

  useEffect(() => {
    setBudgetDraft(createEmptyTaskBudgetDraft());
  }, [editing?.uuid]);

  useEffect(() => {
    setHabitDraft(
      initialHabitDraft ??
        createHabitDraftFromItem(habit, initialHabitPreset),
    );
  }, [editing?.uuid, habit?.id, initialHabitPreset, initialHabitDraft]);

  useEffect(() => {
    if (editing && !editingDescription) {
      setDescriptionDraft(taskDescription || "");
    }
  }, [taskDescription, editingDescription, editing]);

  async function handleSaveDescription() {
    if (busy || needsCheck || descriptionLock.current) return false;
    if (!onDescriptionChange) {
      setEditingDescription(false);
      return true;
    }
    descriptionLock.current = true;
    setSavingDescription(true);
    setDescriptionError("");
    try {
      const saved = await onDescriptionChange(descriptionDraft.trim());
      if (saved === false) return false;
      setEditingDescription(false);
      return true;
    } catch (error) {
      setDescriptionError(
        error instanceof Error ? error.message : "描述保存失败，请重试。",
      );
      return false;
    } finally {
      descriptionLock.current = false;
      setSavingDescription(false);
    }
  }

  function handleCancelDescription() {
    setDescriptionDraft(taskDescription || "");
    setDescriptionError("");
    setEditingDescription(false);
  }

  const originalDue = editing?.due ? toDueDay(editing.due) : "";
  const taskChanged = editing
    ? draft.description !== editing.description ||
      (draft.project || "") !== (editing.project || "") ||
      (draft.priority || "") !== (editing.priority || "") ||
      (draft.recur || "") !== (editing.recur || "") ||
      (draft.until || "") !==
        (editing.until ? taskDate(new Date(editing.until)) : "") ||
      due !== originalDue ||
      tags !== editing.tags.join(", ") ||
      !!draft.note?.trim()
    : Boolean(draft.description.trim() || draft.note?.trim()) ||
      JSON.stringify({ draft, due, tags }) !== initialDraft.current;
  const descriptionChanged =
    descriptionDraft.trim() !== (taskDescription || "").trim();
  const habitDirty = isHabitDraftDirty(habitDraft, habit);
  const changed = taskChanged || descriptionChanged || habitDirty;
  const dirty = changed || commentDirty || subtaskDirty;

  useLayoutEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const locked = busy || needsCheck || savingDescription || savingHabitOnly;
  const error = descriptionError || formError;
  const habitTimingAllowed = habitDraft.enabled
    ? habitDraft.kind === "positive" && habitDraft.trackTime
    : !habit || Boolean(habit.trackTime);

  async function saveHabitSetting(targetUuid: string) {
    if (!habitDraft.enabled) {
      if (habit && onUnbindTaskHabit) {
        await onUnbindTaskHabit(targetUuid);
      }
      return;
    }
    if (onBindTaskHabit) {
      await onBindTaskHabit(
        buildBindInputFromDraft(
          targetUuid,
          habitDraft,
          effectiveTodayDate,
          habit,
        ),
      );
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || descriptionLock.current) return;
    if (
      editing &&
      draft.description.trim() &&
      descriptionChanged &&
      !(await handleSaveDescription())
    )
      return;

    if (editing && !taskChanged && !descriptionChanged && habitDirty) {
      setSavingHabitOnly(true);
      try {
        await saveHabitSetting(editing.uuid);
        if (!commentDirty && !subtaskDirty) {
          onCheck();
        }
      } catch (err) {
        setDescriptionError(
          err instanceof Error ? err.message : "习惯设置保存失败，请重试。",
        );
      } finally {
        setSavingHabitOnly(false);
      }
      return;
    }

    const minutesNum = Number(budgetDraft.minutes.trim());
    const shouldSaveNewBudget =
      !editing &&
      Boolean(isTimeMode) &&
      Number.isFinite(minutesNum) &&
      minutesNum > 0;
    const budgetPayload = shouldSaveNewBudget
      ? {
          allowanceSeconds: Math.round(minutesNum * 60),
          plannedStartTime: budgetDraft.plannedStartTime.trim() || undefined,
          hardStopTime: budgetDraft.hardStopTime.trim() || undefined,
        }
      : undefined;
    const timeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
    const todayStr = localDateOf(Date.now(), timeZone);
    const shouldSyncHabit = habitDirty || (!editing && habitDraft.enabled);
    const hasPostHook = Boolean(budgetPayload || shouldSyncHabit);
    onSubmit(
      event,
      commentDirty || subtaskDirty,
      editing ? undefined : descriptionDraft.trim(),
      hasPostHook
        ? async (createdUuid) => {
            const targetUuid = editing?.uuid || createdUuid;
            if (!targetUuid) return;
            if (budgetPayload && createdUuid) {
              await setTaskBudget({
                taskUuid: createdUuid,
                mode: "set",
                allowanceSeconds: budgetPayload.allowanceSeconds,
                ...(budgetPayload.plannedStartTime
                  ? {
                      plannedStartDate: todayStr,
                      plannedStartTime: budgetPayload.plannedStartTime,
                    }
                  : {}),
                ...(budgetPayload.hardStopTime
                  ? {
                      hardStopDate: todayStr,
                      hardStopTime: budgetPayload.hardStopTime,
                    }
                  : {}),
              });
              await onRefreshTimeSnapshot?.();
            }
            if (shouldSyncHabit) {
              await saveHabitSetting(targetUuid);
            }
          }
        : undefined,
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="task-detail-form flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.defaultPrevented &&
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
              className="group/parent mb-3 -mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className="max-w-[220px] truncate font-normal">
                {parentTask.description}
              </span>
              <ChevronRight className="size-3 text-muted-foreground/70 transition-transform group-hover/parent:translate-x-0.5" />
            </button>
          )}

          <div className="task-detail-title items-start">
            {editing && habit?.kind === "negative" ? (
              <div className="mt-1 shrink-0">
                <HabitNegativeStatusRing habit={habit} />
              </div>
            ) : editing && (onToggleTask || habit) ? (
              <div className="mt-1 shrink-0">
                <TaskCheckbox
                  id={`detail-complete-${editing.uuid}`}
                  size="lg"
                  checked={
                    habit
                      ? Boolean(habit.todayEvaluation?.achieved)
                      : editing.status === "completed"
                  }
                  completed={
                    habit
                      ? Boolean(habit.todayEvaluation?.achieved)
                      : editing.status === "completed"
                  }
                  priority={editing.priority}
                  description={editing.description}
                  disabled={locked}
                  onComplete={() => {
                    if (habit && habitActions) {
                      void habitActions.togglePositive(
                        habit.id,
                        effectiveTodayDate,
                        !Boolean(habit.todayEvaluation?.achieved),
                      );
                      return;
                    }
                    onToggleTask?.();
                  }}
                />
              </div>
            ) : null}

            <div className="min-w-0 flex-1">
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
                    event.stopPropagation();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                disabled={locked}
                required
                maxLength={2000}
                rows={1}
                aria-invalid={Boolean(formError)}
                aria-describedby={formError ? "editor-error" : undefined}
                className="min-h-8 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-lg leading-6 font-semibold shadow-none focus-visible:ring-0 md:text-xl dark:bg-transparent"
              />

              <div className="task-detail-description mt-2">
                {editingDescription ? (
                  <div className="rounded-[10px] border border-border bg-transparent p-2.5 transition-colors focus-within:border-foreground/35">
                    <div className="flex items-start gap-2">
                      <AlignLeft className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      <Textarea
                        id="task-description-input"
                        aria-label="任务描述"
                        data-editor-local-escape
                        autoFocus
                        placeholder="描述"
                        value={descriptionDraft}
                        onChange={(event) => {
                          setDescriptionDraft(event.target.value);
                          setDescriptionError("");
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.nativeEvent.isComposing ||
                            event.nativeEvent.keyCode === 229
                          )
                            return;
                          if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            handleCancelDescription();
                          }
                          if (
                            event.key === "Enter" &&
                            (event.metaKey || event.ctrlKey)
                          ) {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleSaveDescription();
                          }
                        }}
                        rows={2}
                        disabled={locked || savingDescription}
                        className="min-h-[50px] resize-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-foreground shadow-none outline-none focus:ring-0 focus-visible:ring-0 placeholder:text-muted-foreground/60 dark:bg-transparent"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={locked || savingDescription}
                        onClick={handleCancelDescription}
                        className="h-7 rounded-[6px] border-0 px-3 text-xs font-medium shadow-none"
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={locked || savingDescription}
                        onClick={() => void handleSaveDescription()}
                        className="h-7 rounded-[6px] px-3 text-xs font-semibold shadow-none"
                      >
                        {savingDescription ? (
                          <>
                            <Spinner className="size-3" />
                            <span className="sr-only">保存描述中</span>
                          </>
                        ) : (
                          "保存"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    role="button"
                    aria-label="编辑任务描述"
                    aria-disabled={locked}
                    tabIndex={locked ? -1 : 0}
                    onClick={(event) => {
                      if (
                        !locked &&
                        !(
                          event.target instanceof Element &&
                          event.target.closest("a")
                        )
                      )
                        setEditingDescription(true);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        !locked &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        setEditingDescription(true);
                      }
                    }}
                    className="-ml-1.5 flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring aria-disabled:cursor-default"
                  >
                    <AlignLeft className="mt-0.5 size-4 shrink-0 text-muted-foreground/65" />
                    {descriptionDraft.trim() ? (
                      <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground/85">
                        <FormattedDescription text={descriptionDraft} />
                      </p>
                    ) : (
                      <span className="select-none text-sm text-muted-foreground/60">
                        描述
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {editing && habit && habitActions && (
            <TaskHabitExecutionCard
              habit={habit}
              date={effectiveTodayDate}
              disabled={locked}
              actions={habitActions}
            />
          )}

          {isTimeMode &&
            habitTimingAllowed &&
            (editing ? (
              <TaskCostDetailSection
                task={editing}
                hourlyRateCents={hourlyRateCents}
                initialSummary={costSummary}
                disabled={locked}
                onRefreshTimeSnapshot={onRefreshTimeSnapshot}
              />
            ) : (
              <NewTaskBudgetSection
                draft={budgetDraft}
                onChange={setBudgetDraft}
                hourlyRateCents={hourlyRateCents}
                disabled={locked}
              />
            ))}

          {editing && (
            <TaskDetailSubtasks
              subtasks={subtasks}
              project={draft.project}
              disabled={locked}
              habit={habit}
              habitTodayDate={effectiveTodayDate}
              habitActions={habitActions}
              onAddSubtask={onAddSubtask}
              onToggleSubtask={onToggleSubtask}
              onDeleteSubtask={onDeleteSubtask}
              onUnlinkSubtask={onUnlinkSubtask}
              onOpenSubtask={onOpenSubtask}
              onDirtyChange={setSubtaskDirty}
            />
          )}

          <TaskDetailComments
            annotations={editing?.annotations}
            disabled={locked}
            onAddComment={onAddComment}
            onRemoveNote={onRemoveNote}
            onDirtyChange={setCommentDirty}
          />

          {error && (
            <Alert id="editor-error" variant="destructive" className="mt-4">
              <AlertDescription className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <span className="min-w-0 flex-1 basis-full [overflow-wrap:anywhere] md:basis-auto">
                  {error}
                </span>
                <Button
                  type="button"
                  variant="link"
                  disabled={busy || savingDescription}
                  onClick={onReload}
                  className="h-auto p-0 text-current"
                >
                  刷新核对并保留草稿
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <TaskDetailSidebar
          draft={draft}
          projects={projects}
          due={due}
          tags={tags}
          availableLabels={availableLabels}
          editing={editing}
          disabled={locked}
          timingActive={habitTimingAllowed ? timingActive : false}
          timingUnavailable={timingUnavailable}
          onToggleStart={habitTimingAllowed ? onToggleStart : undefined}
          onClearStartMark={habitTimingAllowed ? onClearStartMark : undefined}
          onDraftChange={onDraftChange}
          onDueChange={onDueChange}
          onTagsChange={onTagsChange}
          onClearError={onClearError}
          onEditSeries={onEditSeries}
          onDelete={onDelete}
          habitSection={
            onBindTaskHabit ? (
              <TaskHabitSidebarField
                value={habitDraft}
                existingHabit={habit}
                disabled={locked}
                hasSubtasks={subtasks.length > 0}
                onChange={setHabitDraft}
                onStatusChange={
                  habit && habitActions?.setStatus
                    ? (status) => void habitActions.setStatus?.(habit.id, status)
                    : undefined
                }
                onOpenDetail={habitActions?.openDetail}
              />
            ) : undefined
          }
        />
      </div>

      {(!editing || changed || busy || Boolean(error)) && (
        <div
          data-editor-actions
          className="flex shrink-0 items-center justify-between gap-4 border-t border-border/70 px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] md:py-3.5"
        >
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || savingDescription}
              onClick={() => onCheck()}
              className="h-8 rounded-[6px]"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={locked}
              className="h-8 min-w-18 rounded-[6px]"
            >
              {busy || savingDescription ? (
                <>
                  <Spinner className="size-4" />
                  <span>保存中</span>
                </>
              ) : (
                "保存"
              )}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
