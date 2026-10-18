import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUp, Flag, ListPlus, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/features/tasks/date-picker";
import { ProjectPicker } from "@/features/tasks/project-picker";
import { parseQuickTask, type QuickToken } from "@/features/tasks/quick-task";
import type { TaskInput } from "@shared/tasks";

const chip =
  "h-9 gap-1.5 md:h-7 rounded-[5px] border-input px-2 py-0 text-[13px] font-normal text-muted-foreground shadow-none has-[>svg]:px-2";
const isoDate = (value: string) =>
  value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");

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
}) {
  const [text, setText] = useState("");
  const [ignored, setIgnored] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagText, setTagText] = useState("");
  const mirror = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const restoreInput = (event: Event) => {
    event.preventDefault();
    input.current?.focus();
  };
  const parsed = parseQuickTask(text, { ignored });
  const expanded = !!text.trim();
  const locked = busy || blocked;
  const validation = parsed.errors[0] || (attempted && !parsed.task.description ? "Enter a task name." : "");
  const dueToken = parsed.tokens.find((t) => t.kind === "due" && !t.ignored);
  const dueDay = parsed.task.due ? format(new Date(isoDate(parsed.task.due)), "yyyy-MM-dd") : "";

  function change(value: string) {
    setText(value);
    const tokens = parseQuickTask(value).tokens;
    setIgnored((items) => items.filter((id) => tokens.some((t) => t.id === id)));
    setAttempted(false);
    onClearError();
  }
  function setField(kind: QuickToken["kind"], expression: string) {
    const matches = parsed.tokens.filter((t) => t.kind === kind && !t.ignored);
    let value = text;
    for (const token of [...matches].reverse()) value = value.slice(0, token.start) + value.slice(token.end);
    change((value.trimEnd() + (expression ? " " + expression : "")).trim());
  }
  function editForm() {
    onEdit(parsed.task);
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
    if (await onAdd(result.task)) {
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
      <span key={token.id} className={token.ignored ? "" : "rounded-sm bg-navigation-selected"}>
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
          aria-label="More options"
          className={"size-9 shrink-0 p-0 text-muted-foreground " + (expanded ? "md:size-7" : "md:size-8")}
        >
          <Plus className="size-5" strokeWidth={1.5} />
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
          Enter to add · Shift + Enter for a new line
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
        {busy ? <Spinner className="size-4" /> : <ArrowUp className="size-5" strokeWidth={1.8} />}
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
        className="top-[max(4.5rem,15vh)] flex max-h-[calc(100dvh-6rem)] w-[calc(100vw-1.5rem)] max-w-[600px] translate-y-0 flex-col gap-0 overflow-hidden rounded-[14px] border-input p-0 shadow-[0_3px_24px_0_#00000026,0_0_8px_0_#00000012] duration-150 sm:max-w-[600px]"
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
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-col p-4">
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div data-quick-input-row className="flex items-center gap-2">
              {!expanded && more}
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
                  placeholder="Task name"
                  disabled={locked}
                  aria-describedby={validation || error ? "quick-error" : undefined}
                  aria-invalid={!!validation || !!error}
                  className="relative min-h-6 max-h-[min(10rem,25dvh)] resize-none rounded-none border-0 bg-transparent p-0 text-base leading-6 shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 md:text-base dark:bg-transparent"
                  onScroll={(e) => {
                    if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
                  }}
                  onChange={(e) => change(e.target.value)}
                  onKeyDown={(e) => {
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
              {!expanded && actions}
            </div>
            {expanded && (
              <div className="mt-3 flex items-end gap-2" data-quick-attributes>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {more}
                  <ProjectPicker
                    returnFocus={() => input.current?.focus()}
                    id="quick-project"
                    compact
                    value={parsed.task.project || ""}
                    projects={projects}
                    disabled={locked}
                    onChange={(value) => setField("project", value ? `#"${value}"` : "")}
                  />
                  <div className={"flex max-w-full" + (dueToken ? " rounded-[5px] border border-input" : "")}>
                    <DatePicker
                      returnFocus={() => input.current?.focus()}
                      id="quick-due"
                      compact
                      value={dueDay}
                      label={dueToken?.label}
                      disabled={locked}
                      className={dueToken ? "h-[34px] rounded-r-none border-0 md:h-[26px]" : undefined}
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
                  <Select
                    disabled={locked}
                    value={parsed.task.priority || "none"}
                    onValueChange={(v) =>
                      setField("priority", ({ H: "p1", M: "p2", L: "p3", none: "p4" } as Record<string, string>)[v])
                    }
                  >
                    <SelectTrigger
                      aria-label="Priority"
                      className={
                        chip +
                        " w-auto gap-1.5 data-[size=default]:h-9 md:data-[size=default]:h-7 [&>svg:last-child]:hidden"
                      }
                    >
                      <Flag className="size-4" />
                      <SelectValue>
                        {({ H: "Priority 1", M: "Priority 2", L: "Priority 3" } as Record<string, string>)[
                          parsed.task.priority || ""
                        ] || "Priority"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent onCloseAutoFocus={restoreInput}>
                      <SelectItem value="H">Priority 1</SelectItem>
                      <SelectItem value="M">Priority 2</SelectItem>
                      <SelectItem value="L">Priority 3</SelectItem>
                      <SelectItem value="none">No priority</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="h-0 basis-full" />
                  <Popover
                    open={tagsOpen}
                    onOpenChange={(value) => {
                      setTagsOpen(value);
                      if (value) setTagText(parsed.task.tags.join(", "));
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={locked}
                        className={chip + " min-w-0 max-w-full"}
                      >
                        <LabelIcon className="size-4" />
                        <span className="truncate">
                          {parsed.task.tags.length ? parsed.task.tags.join(", ") : "Labels"}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      collisionPadding={12}
                      className="w-64 space-y-3 p-3"
                      onCloseAutoFocus={restoreInput}
                    >
                      <Label htmlFor="quick-tags" className="text-xs font-normal">
                        Labels, separated by commas
                      </Label>
                      <Input
                        id="quick-tags"
                        value={tagText}
                        onChange={(e) => setTagText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            setField(
                              "tag",
                              tagText
                                .split(/[,，]/)
                                .map((t) => t.trim())
                                .filter(Boolean)
                                .map((t) => "@" + t)
                                .join(" "),
                            );
                            setTagsOpen(false);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setField(
                            "tag",
                            tagText
                              .split(/[,，]/)
                              .map((t) => t.trim())
                              .filter(Boolean)
                              .map((t) => "@" + t)
                              .join(" "),
                          );
                          setTagsOpen(false);
                        }}
                      >
                        Apply labels
                      </Button>
                    </PopoverContent>
                  </Popover>
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
            )}
            {(validation || error) && (
              <Alert id="quick-error" variant="destructive" className="mt-3 rounded-md p-3">
                <AlertDescription className="text-xs">
                  {validation || error}
                  {blocked && (
                    <Button type="button" variant="link" className="h-auto p-0 text-xs text-current" onClick={onCheck}>
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
