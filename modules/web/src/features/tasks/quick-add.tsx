import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  QuickAddFooter,
  QuickAddOptionRow,
  QuickAddSuggestions,
} from "@/features/tasks/quick-add-parts";
import {
  findQuickTriggerSuggestions,
  replaceQuickTokenKind,
} from "@/features/tasks/quick-token-helpers";
import { toDueDay } from "@/features/tasks/task-date";
import { parseQuickTask, type QuickToken } from "@core/tasks/quick-task";
import type { SavedTag } from "@core/workspace/organization";
import type { TaskInput } from "@shared/tasks";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

/** Modal quick-add dialog supporting inline natural-language tokens and autocomplete. */
export function QuickAdd({
  open,
  onOpenChange,
  busy,
  blocked,
  error,
  onClearError,
  onCheck,
  onAdd,
  onEdit,
  projects,
  availableLabels = [],
  defaultProject = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  blocked: boolean;
  error: string;
  onClearError: () => void;
  onCheck: () => void;
  onAdd: (task: TaskInput & { taskDescription?: string }) => Promise<boolean>;
  onEdit: (task: TaskInput) => void;
  projects: string[];
  availableLabels?: SavedTag[];
  defaultProject?: string;
}) {
  const [noProject, setNoProject] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [ignored, setIgnored] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const mirror = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const restoreInput = (event: Event) => {
    event.preventDefault();
    input.current?.focus();
  };
  const withProject = (task: TaskInput): TaskInput => ({
    ...task,
    project: task.project || (noProject ? "" : defaultProject),
  });
  const expression = parseQuickTask(text, { ignored });
  const parsed = { ...expression, task: withProject(expression.task) };
  const locked = busy || blocked;
  const validation =
    parsed.errors[0] ||
    (attempted && !parsed.task.description ? "请输入任务名称。" : "");
  const dueToken = parsed.tokens.find((t) => t.kind === "due" && !t.ignored);
  const dueDay = toDueDay(parsed.task.due);

  const {
    triggerKind,
    projectSuggestions,
    labelSuggestions,
    replaceTrailingTrigger,
  } = findQuickTriggerSuggestions(text, projects, availableLabels);

  function change(value: string) {
    setText(value);
    const tokens = parseQuickTask(value).tokens;
    setIgnored((items) =>
      items.filter((id) => tokens.some((t) => t.id === id)),
    );
    setAttempted(false);
    onClearError();
  }

  function applySuggestion(tokenText: string) {
    change(replaceTrailingTrigger(tokenText));
    requestAnimationFrame(() => input.current?.focus());
  }

  function setField(kind: QuickToken["kind"], expressionStr: string) {
    change(replaceQuickTokenKind(text, parsed.tokens, kind, expressionStr));
  }

  function resetState() {
    setNoProject(false);
    setText("");
    setNote("");
    setIgnored([]);
    setAttempted(false);
  }

  function editForm() {
    onEdit(parsed.task);
    resetState();
    onClearError();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    setAttempted(true);
    const result = parseQuickTask(text, { ignored });
    if (!result.task.description || result.errors.length) {
      input.current?.focus();
      return;
    }
    const payload = {
      ...withProject(result.task),
      ...(note.trim() ? { taskDescription: note.trim() } : {}),
    };
    if (await onAdd(payload)) {
      resetState();
      onClearError();
    }
  }

  const highlights: ReactNode[] = [];
  let cursor = 0;
  for (const token of parsed.tokens) {
    highlights.push(text.slice(cursor, token.start));
    highlights.push(
      <span
        key={token.id}
        className={token.ignored ? "" : "rounded-sm bg-primary/20"}
      >
        {token.raw}
      </span>,
    );
    cursor = token.end;
  }
  highlights.push(text.slice(cursor), "\n");

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent
        data-quick-add
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus({ preventScroll: true });
        }}
        overlayClassName="bg-black/25 backdrop-blur-[1px]"
        className="top-[max(4.5rem,14vh)] flex max-h-[calc(100dvh-6rem)] w-[calc(100vw-1.5rem)] max-w-[580px] translate-y-0 flex-col gap-0 overflow-hidden rounded-[12px] border-border bg-popover p-0 shadow-modal duration-150 sm:max-w-[580px]"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">快速添加任务</DialogTitle>
        <DialogDescription className="sr-only">
          输入任务名称、日期、项目、标签和优先级，按回车添加。
        </DialogDescription>
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-col">
          <div className="min-h-0 overflow-y-auto overscroll-contain p-3.5 pb-2.5">
            <div data-quick-input-row className="relative min-w-0">
              <Label htmlFor="quick-expression" className="sr-only">
                任务表达式
              </Label>
              <div
                ref={mirror}
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden text-[15px] leading-6 font-medium whitespace-pre-wrap text-transparent [overflow-wrap:anywhere]"
              >
                {highlights}
              </div>
              <Textarea
                ref={input}
                id="quick-expression"
                value={text}
                rows={1}
                maxLength={4000}
                placeholder="任务名称（支持 #项目, @标签, 今天/明天, p1）"
                disabled={locked}
                aria-describedby={
                  validation || error ? "quick-error" : undefined
                }
                aria-invalid={!!validation || !!error}
                className="relative max-h-[min(10rem,25dvh)] min-h-6 resize-none rounded-none border-0 bg-transparent p-0 text-[15px] leading-6 font-medium shadow-none placeholder:font-normal placeholder:text-muted-foreground/65 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent"
                onScroll={(e) => {
                  if (mirror.current)
                    mirror.current.scrollTop = e.currentTarget.scrollTop;
                }}
                onChange={(e) => change(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Tab" &&
                    !e.shiftKey &&
                    (projectSuggestions.length > 0 ||
                      labelSuggestions.length > 0)
                  ) {
                    e.preventDefault();
                    if (projectSuggestions[0]) {
                      const name = projectSuggestions[0];
                      applySuggestion(
                        /\s/.test(name) ? `#"${name}"` : `#${name}`,
                      );
                    } else if (labelSuggestions[0]) {
                      applySuggestion(`@${labelSuggestions[0].name}`);
                    }
                    return;
                  }
                  if (
                    (e.metaKey || e.ctrlKey) &&
                    e.key.toLowerCase() === "e" &&
                    !locked &&
                    !parsed.errors.length
                  ) {
                    e.preventDefault();
                    editForm();
                    return;
                  }
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.nativeEvent.keyCode !== 229
                  ) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </div>
            <Textarea
              value={note}
              rows={1}
              maxLength={2000}
              disabled={locked}
              aria-label="任务描述"
              placeholder="描述"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.metaKey || e.ctrlKey) &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className="mt-1 max-h-24 min-h-5 resize-none rounded-none border-0 bg-transparent p-0 text-[13px] leading-5 text-muted-foreground shadow-none placeholder:text-muted-foreground/55 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent"
            />

            <QuickAddSuggestions
              triggerKind={triggerKind}
              projectSuggestions={projectSuggestions}
              labelSuggestions={labelSuggestions}
              onApply={applySuggestion}
            />

            <QuickAddOptionRow
              locked={locked}
              dueDay={dueDay}
              dueToken={dueToken}
              priorityValue={parsed.task.priority}
              tags={parsed.task.tags}
              availableLabels={availableLabels}
              hasParseErrors={Boolean(parsed.errors.length)}
              onReturnFocus={() => input.current?.focus()}
              onRestoreInput={restoreInput}
              onSetField={setField}
              onIgnoreDue={(tokenId) =>
                setIgnored((items) => [...items, tokenId])
              }
              onOpenFullEditor={editForm}
            />
          </div>

          <QuickAddFooter
            project={parsed.task.project || ""}
            projects={projects}
            busy={busy}
            locked={locked}
            hasText={Boolean(text.trim())}
            onReturnFocus={() => input.current?.focus()}
            onProjectChange={(value) => {
              setNoProject(!value);
              setField("project", value ? `#"${value}"` : "");
            }}
            onClose={() => onOpenChange(false)}
          />

          {(validation || error) && (
            <Alert
              id="quick-error"
              variant="destructive"
              className="mx-3.5 mb-3 rounded-md p-2.5"
            >
              <AlertDescription className="text-xs">
                {validation || error}
                {blocked && (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs text-current"
                    onClick={onCheck}
                  >
                    关闭并检查任务
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
