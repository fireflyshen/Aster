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
import { parseQuickTask, type QuickToken } from "@core/tasks/quick-task";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import type { TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { format } from "date-fns";
import { ArrowUp, CircleHelp, Flag, ListPlus, X } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

const chip =
  "h-9 gap-1.5 md:h-7 rounded-[5px] border-input px-2 py-0 text-[13px] font-normal text-muted-foreground shadow-none has-[>svg]:px-2";
const isoDate = (value: string) =>
  value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6Z",
  );

const PRIORITIES: {
  value: "H" | "M" | "L" | "none";
  label: string;
  short: string;
  iconClass: string;
  chipClass: string;
}[] = [
  {
    value: "H",
    label: "Priority 1",
    short: "P1",
    iconClass: "fill-red-500/20 text-red-600 dark:text-red-400",
    chipClass:
      "border-red-500/35 bg-red-500/8 text-red-600 hover:bg-red-500/14 dark:text-red-400",
  },
  {
    value: "M",
    label: "Priority 2",
    short: "P2",
    iconClass: "fill-amber-500/20 text-amber-600 dark:text-amber-400",
    chipClass:
      "border-amber-500/35 bg-amber-500/8 text-amber-600 hover:bg-amber-500/14 dark:text-amber-400",
  },
  {
    value: "L",
    label: "Priority 3",
    short: "P3",
    iconClass: "fill-blue-500/20 text-blue-600 dark:text-blue-400",
    chipClass:
      "border-blue-500/35 bg-blue-500/8 text-blue-600 hover:bg-blue-500/14 dark:text-blue-400",
  },
  {
    value: "none",
    label: "Priority 4",
    short: "Priority",
    iconClass: "text-muted-foreground",
    chipClass: "border-input text-muted-foreground",
  },
];

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
  onAdd: (task: TaskInput) => Promise<boolean>;
  onEdit: (task: TaskInput) => void;
  projects: string[];
  availableLabels?: SavedTag[];
  defaultProject?: string;
}) {
  const [noProject, setNoProject] = useState(false);
  const [text, setText] = useState("");
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
    (attempted && !parsed.task.description ? "Enter a task name." : "");
  const dueToken = parsed.tokens.find((t) => t.kind === "due" && !t.ignored);
  const dueDay = parsed.task.due
    ? format(new Date(isoDate(parsed.task.due)), "yyyy-MM-dd")
    : "";

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
    const next = text.slice(0, replaceStart) + tokenText + " ";
    change(next);
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
  function setField(kind: QuickToken["kind"], expression: string) {
    const matches = parsed.tokens.filter((t) => t.kind === kind && !t.ignored);
    let value = text;
    for (const token of [...matches].reverse())
      value = value.slice(0, token.start) + value.slice(token.end);
    change((value.trimEnd() + (expression ? " " + expression : "")).trim());
  }
  function editForm() {
    onEdit(parsed.task);
    setNoProject(false);
    change("");
    setIgnored([]);
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
    if (await onAdd(withProject(result.task))) {
      setNoProject(false);
      change("");
      setIgnored([]);
      setAttempted(false);
    }
  }
  const highlights: ReactNode[] = [];
  let cursor = 0;
  for (const token of parsed.tokens) {
    highlights.push(text.slice(cursor, token.start));
    highlights.push(
      <span
        key={token.id}
        className={token.ignored ? "" : "rounded-sm bg-navigation-selected"}
      >
        {token.raw}
      </span>,
    );
    cursor = token.end;
  }
  highlights.push(text.slice(cursor), "\n");
  const more = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={locked}
          aria-label="Quick syntax help"
          className="size-9 shrink-0 p-0 text-muted-foreground md:size-7"
        >
          <CircleHelp className="size-4" strokeWidth={1.5} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="w-72 space-y-3 p-3 text-xs leading-6"
        onCloseAutoFocus={restoreInput}
      >
        <Button
          type="button"
          variant="ghost"
          disabled={locked || !!parsed.errors.length}
          className="h-8 w-full justify-start px-2 text-[13px] font-normal"
          onClick={editForm}
        >
          <ListPlus />
          Open task editor
        </Button>
        <p className="border-t px-2 pt-2 text-muted-foreground">
          Submit report tomorrow #Work @Focus p1
          <br />
          Try tomorrow at 14 or 2026-10-20.
          <br />
          Enter to add · Tab to autocomplete · ⌘E for editor
        </p>
      </PopoverContent>
    </Popover>
  );
  const actions = (
    <div data-quick-actions className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label="Close quick add"
        onClick={() => onOpenChange(false)}
        className="size-9 p-0 text-muted-foreground md:size-8"
      >
        <X className="size-5" strokeWidth={1.5} />
      </Button>
      <Button
        type="submit"
        size="icon-sm"
        disabled={locked}
        aria-label="Add task"
        className="size-9 rounded-[7px] md:size-8 p-0 shadow-none"
      >
        {busy ? (
          <Spinner className="size-4" />
        ) : (
          <ArrowUp className="size-5" strokeWidth={1.8} />
        )}
      </Button>
    </div>
  );
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
        overlayClassName="bg-transparent"
        className="top-[max(4.5rem,15vh)] flex max-h-[calc(100dvh-6rem)] w-[calc(100vw-1.5rem)] max-w-[800px] translate-y-0 flex-col gap-0 overflow-hidden rounded-[14px] border-input p-0 shadow-modal duration-150 sm:max-w-[800px]"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Quick add</DialogTitle>
        <DialogDescription className="sr-only">
          Enter a task, date, project, labels, and priority. Press Enter to add.
        </DialogDescription>
        <form
          noValidate
          onSubmit={submit}
          className="flex min-h-0 flex-col p-4"
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div data-quick-input-row className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Label htmlFor="quick-expression" className="sr-only">
                  Task expression
                </Label>
                <div
                  ref={mirror}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap text-transparent [overflow-wrap:anywhere] text-base leading-6"
                >
                  {highlights}
                </div>
                <Textarea
                  ref={input}
                  id="quick-expression"
                  value={text}
                  rows={1}
                  maxLength={4000}
                  placeholder="Task name… (try #project, @label, tomorrow, p1)"
                  disabled={locked}
                  aria-describedby={
                    validation || error ? "quick-error" : undefined
                  }
                  aria-invalid={!!validation || !!error}
                  className="relative min-h-6 max-h-[min(10rem,25dvh)] resize-none rounded-none border-0 bg-transparent p-0 text-base leading-6 shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0 focus-visible:ring-offset-0 md:text-base dark:bg-transparent"
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
            </div>
            {(projectSuggestions.length > 0 || labelSuggestions.length > 0) && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2">
                <span className="text-[11px] text-muted-foreground">
                  {triggerKind === "#" ? "Projects (Tab):" : "Labels (Tab):"}
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
              className="mt-3 flex min-w-0 items-center gap-2 border-t border-border/60 pt-3"
              data-quick-attributes
            >
              <div
                data-quick-options
                className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
              >
                {more}
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
                <div
                  className={
                    "flex max-w-full" +
                    (dueToken ? " rounded-[5px] border border-input" : "")
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
                      aria-label="Keep date as text"
                      className="h-[34px] w-8 rounded-l-none md:h-[26px] md:w-6 p-0 text-muted-foreground"
                      onClick={() => {
                        setIgnored((items) => [...items, dueToken.id]);
                        input.current?.focus();
                      }}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
                {(() => {
                  const currentPriorityVal = (parsed.task.priority ||
                    "none") as "H" | "M" | "L" | "none";
                  const activePriority =
                    PRIORITIES.find((p) => p.value === currentPriorityVal) ||
                    PRIORITIES[3];
                  return (
                    <Select
                      disabled={locked}
                      value={currentPriorityVal}
                      onValueChange={(v) =>
                        setField(
                          "priority",
                          (
                            {
                              H: "p1",
                              M: "p2",
                              L: "p3",
                              none: "p4",
                            } as Record<string, string>
                          )[v],
                        )
                      }
                    >
                      <SelectTrigger
                        aria-label="Priority"
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
                          <SelectItem key={p.value} value={p.value}>
                            <span className="flex items-center gap-2">
                              <Flag className={cn("size-3.5", p.iconClass)} />
                              <span>{p.label}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
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
                <Button
                  type="button"
                  variant="outline"
                  className={chip}
                  disabled={locked || !!parsed.errors.length}
                  onClick={editForm}
                >
                  <ListPlus className="size-4" />
                  Task editor
                </Button>
              </div>
              {actions}
            </div>
            {(validation || error) && (
              <Alert
                id="quick-error"
                variant="destructive"
                className="mt-3 rounded-md p-3"
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
                      Close and check tasks
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
