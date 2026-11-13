import { LabelIcon } from "@/components/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ProjectIcon } from "@/features/projects/project-icon";
import { DatePicker } from "@/features/tasks/date-picker";
import { LabelsPicker } from "@/features/tasks/labels-picker";
import { ProjectPicker } from "@/features/tasks/project-picker";
import {
  PRIORITIES,
  priorityOption,
} from "@/features/tasks/task-constants";
import { toDueDay } from "@/features/tasks/task-date";
import { parseQuickTask, type QuickToken } from "@core/tasks/quick-task";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import type { TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { ArrowUp, CircleHelp, Flag, ListPlus, X } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

const chip =
  "h-9 gap-1.5 md:h-7 rounded-[6px] border-input px-2 py-0 text-[12px] font-normal text-muted-foreground shadow-none has-[>svg]:px-2";

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

  const trailingMatch = text.match(/(?:^|\s)([#@])([^\s#@]*)$/);
  const triggerKind = trailingMatch?.[1] as "#" | "@" | undefined;
  const triggerQuery = (trailingMatch?.[2] || "").toLocaleLowerCase();
  const projectSuggestions =
    triggerKind === "#"
      ? projects
          .filter((p) => p.toLocaleLowerCase().includes(triggerQuery))
          .slice(0, 6)
      : [];
  const labelSuggestions =
    triggerKind === "@"
      ? availableLabels
          .filter((l) => l.name.toLocaleLowerCase().includes(triggerQuery))
          .slice(0, 6)
      : [];

  function applySuggestion(tokenText: string) {
    if (!trailingMatch) return;
    const prefixLen =
      trailingMatch[0].length - (1 + (trailingMatch[2]?.length || 0));
    const replaceStart = text.length - trailingMatch[0].length + prefixLen;
    change(text.slice(0, replaceStart) + tokenText + " ");
    requestAnimationFrame(() => input.current?.focus());
  }

  function change(value: string) {
    setText(value);
    const tokens = parseQuickTask(value).tokens;
    setIgnored((items) =>
      items.filter((id) => tokens.some((t) => t.id === id)),
    );
    setAttempted(false);
    onClearError();
  }
  function setField(kind: QuickToken["kind"], expressionStr: string) {
    const matches = parsed.tokens.filter((t) => t.kind === kind && !t.ignored);
    let value = text;
    for (const token of [...matches].reverse())
      value = value.slice(0, token.start) + value.slice(token.end);
    change((value.trimEnd() + (expressionStr ? " " + expressionStr : "")).trim());
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

  const activePriority = priorityOption(parsed.task.priority);

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
          input.current?.focus();
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
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap text-transparent [overflow-wrap:anywhere] text-[15px] leading-6 font-medium"
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
                className="relative min-h-6 max-h-[min(10rem,25dvh)] resize-none rounded-none border-0 bg-transparent p-0 text-[15px] leading-6 font-medium shadow-none placeholder:font-normal placeholder:text-muted-foreground/65 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent"
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
              className="mt-1 min-h-5 max-h-24 resize-none rounded-none border-0 bg-transparent p-0 text-[13px] leading-5 text-muted-foreground shadow-none placeholder:text-muted-foreground/55 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent"
            />

            {(projectSuggestions.length > 0 || labelSuggestions.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2">
                <span className="text-[11px] text-muted-foreground">
                  {triggerKind === "#" ? "项目 (Tab 补全):" : "标签 (Tab 补全):"}
                </span>
                {projectSuggestions.map((name, idx) => (
                  <Button
                    key={name}
                    type="button"
                    variant={idx === 0 ? "secondary" : "ghost"}
                    size="xs"
                    className="h-6 gap-1 rounded-full px-2 text-xs font-normal"
                    onClick={() =>
                      applySuggestion(
                        /\s/.test(name) ? `#"${name}"` : `#${name}`,
                      )
                    }
                  >
                    <ProjectIcon name={name} className="size-3" />
                    <span>{name}</span>
                  </Button>
                ))}
                {labelSuggestions.map((label, idx) => (
                  <Button
                    key={label.id}
                    type="button"
                    variant={idx === 0 ? "secondary" : "ghost"}
                    size="xs"
                    className="h-6 gap-1 rounded-full px-2 text-xs font-normal"
                    onClick={() => applySuggestion(`@${label.name}`)}
                  >
                    <LabelIcon
                      className="size-3"
                      style={{ color: itemColor(label.color) }}
                    />
                    <span>{label.name}</span>
                  </Button>
                ))}
              </div>
            )}

            <div
              data-quick-options
              className="mt-2.5 flex flex-wrap items-center gap-1.5"
            >
              <div
                className={
                  "flex max-w-full" +
                  (dueToken ? " rounded-[6px] border border-input" : "")
                }
              >
                <DatePicker
                  returnFocus={() => input.current?.focus()}
                  id="quick-due"
                  compact
                  value={dueDay}
                  label={dueToken?.label}
                  disabled={locked}
                  className={
                    dueToken
                      ? "h-[34px] rounded-r-none border-0 md:h-[26px]"
                      : undefined
                  }
                  onChange={(value) => setField("due", value)}
                />
                {dueToken && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={locked}
                    aria-label="保留日期文本"
                    className="h-[34px] w-8 rounded-l-none p-0 text-muted-foreground md:h-[26px] md:w-6"
                    onClick={() => {
                      setIgnored((items) => [...items, dueToken.id]);
                      input.current?.focus();
                    }}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>

              <Select
                disabled={locked}
                value={activePriority.selectValue}
                onValueChange={(v) =>
                  setField("priority", priorityOption(v).quickWord)
                }
              >
                <SelectTrigger
                  aria-label="优先级"
                  className={cn(
                    chip,
                    "w-auto gap-1.5 data-[size=default]:h-9 md:data-[size=default]:h-7 [&>svg:last-child]:hidden",
                    activePriority.chipClass,
                  )}
                >
                  <Flag
                    className={cn("size-3.5", activePriority.iconClass)}
                  />
                  <SelectValue>{activePriority.short}</SelectValue>
                </SelectTrigger>
                <SelectContent onCloseAutoFocus={restoreInput}>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.selectValue} value={p.selectValue}>
                      <span className="flex items-center gap-2">
                        <Flag className={cn("size-3.5", p.iconClass)} />
                        <span>{p.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <LabelsPicker
                compact
                id="quick-tags"
                value={parsed.task.tags}
                choices={availableLabels}
                disabled={locked}
                returnFocus={() => input.current?.focus()}
                onChange={(tags) =>
                  setField("tag", tags.map((t) => "@" + t).join(" "))
                }
              />

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={locked}
                    aria-label="快捷语法帮助"
                    className="size-8 shrink-0 p-0 text-muted-foreground md:size-7"
                  >
                    <CircleHelp className="size-4" strokeWidth={1.5} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  collisionPadding={12}
                  className="w-72 space-y-2.5 p-3 text-xs leading-6"
                  onCloseAutoFocus={restoreInput}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={locked || !!parsed.errors.length}
                    className="h-8 w-full justify-start px-2 text-[13px] font-normal"
                    onClick={editForm}
                  >
                    <ListPlus className="size-4" />
                    打开完整编辑窗口 (⌘E)
                  </Button>
                  <p className="border-t pt-2 text-muted-foreground">
                    示例：提交周报 明天 #Work @Focus p1
                    <br />
                    回车添加 · Tab 自动补全 · ⌘E 完整编辑
                  </p>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div
            data-quick-attributes
            className="flex items-center justify-between gap-2 border-t border-border/70 px-3.5 py-2.5"
          >
            <div className="min-w-0">
              <ProjectPicker
                returnFocus={() => input.current?.focus()}
                id="quick-project"
                compact
                value={parsed.task.project || ""}
                projects={projects}
                disabled={locked}
                onChange={(value) => {
                  setNoProject(!value);
                  setField("project", value ? `#"${value}"` : "");
                }}
              />
            </div>
            <div data-quick-actions className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label="关闭快速添加"
                onClick={() => onOpenChange(false)}
                className="size-8 rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" strokeWidth={1.75} />
              </Button>
              <Button
                type="submit"
                size="icon-sm"
                disabled={locked || !text.trim()}
                aria-label="添加任务"
                className="size-8 rounded-[7px] bg-primary p-0 text-primary-foreground shadow-none hover:bg-primary/90"
              >
                {busy ? (
                  <Spinner className="size-4" />
                ) : (
                  <ArrowUp className="size-4" strokeWidth={2.2} />
                )}
              </Button>
            </div>
          </div>

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
