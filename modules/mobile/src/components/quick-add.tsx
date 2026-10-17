import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUp, Flag, ListPlus, Plus, Tag, X } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/date-picker";
import { ProjectPicker } from "@/components/project-picker";
import { parseQuickTask, type QuickToken } from "@/lib/quick-task";
import type { TaskInput } from "@/lib/api";

const chip =
  "h-7 gap-1.5 rounded-[5px] border-[#e6e6e6] px-2 py-0 text-[13px] font-normal text-[#666] shadow-none has-[>svg]:px-2";
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
  const validation = parsed.errors[0] || (attempted && !parsed.task.description ? "写下要做的事，再按回车。" : "");
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
      <span
        key={token.id}
        className={token.ignored ? "" : token.kind === "due" ? "rounded-sm bg-[#ffebd7]" : "rounded-sm bg-[#edf2ec]"}
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
          aria-label="更多任务选项"
          className="size-7 shrink-0 text-[#808080]"
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
          打开完整表单
        </Button>
        <p className="border-t px-2 pt-2 text-muted-foreground">
          明天 交报告 #工作 @专注 p1
          <br />
          也支持 tomorrow at 14、下周一、2026-10-20。
          <br />
          Enter 添加 · Shift + Enter 换行
        </p>
      </PopoverContent>
    </Popover>
  );
  const actions = (
    <div className="flex shrink-0 items-center gap-2 self-end">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label="关闭快速添加"
        onClick={() => onOpenChange(false)}
        className="size-8 text-[#a3a3a3]"
      >
        <X className="size-6" strokeWidth={1.5} />
      </Button>
      <Button type="submit" disabled={locked} aria-label="添加任务" className="size-8 rounded-[7px] p-0 shadow-none">
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
        className="top-[max(4.5rem,15vh)] flex max-h-[calc(100dvh-6rem)] w-[calc(100vw-1.5rem)] max-w-[600px] translate-y-0 flex-col gap-0 overflow-hidden rounded-[14px] border-[#e4e4e4] p-0 shadow-[0_3px_24px_0_#00000026,0_0_8px_0_#00000012] duration-150 sm:max-w-[600px]"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">快速添加</DialogTitle>
        <DialogDescription className="sr-only">输入任务、日期、项目、标签和优先级，按回车添加任务。</DialogDescription>
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-col p-4">
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div className="flex items-start gap-2">
              {!expanded && more}
              <div className="relative min-w-0 flex-1">
                <Label htmlFor="quick-expression" className="sr-only">
                  任务表达式
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
                  placeholder="任务名称"
                  disabled={locked}
                  aria-describedby={validation || error ? "quick-error" : undefined}
                  aria-invalid={!!validation || !!error}
                  className="relative min-h-6 max-h-[min(10rem,25dvh)] resize-none rounded-none border-0 bg-transparent p-0 text-base leading-6 shadow-none placeholder:text-[#a3a3a3] focus-visible:ring-0 md:text-base dark:bg-transparent"
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
                  <div className={"flex max-w-full" + (dueToken ? " rounded-[5px] border border-[#e6e6e6]" : "")}>
                    <DatePicker
                      returnFocus={() => input.current?.focus()}
                      id="quick-due"
                      compact
                      value={dueDay}
                      label={dueToken?.label}
                      disabled={locked}
                      className={dueToken ? "h-[26px] rounded-r-none border-0" : undefined}
                      onChange={(value) => setField("due", value)}
                    />
                    {dueToken && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={locked}
                        aria-label="保留日期为正文"
                        className="h-[26px] w-5 rounded-l-none p-0 text-[#999]"
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
                      aria-label="优先级"
                      className={chip + " w-auto gap-1.5 data-[size=default]:h-7 [&>svg:last-child]:hidden"}
                    >
                      <Flag className="size-4" />
                      <SelectValue>
                        {({ H: "优先级 1", M: "优先级 2", L: "优先级 3" } as Record<string, string>)[
                          parsed.task.priority || ""
                        ] || "优先级"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent onCloseAutoFocus={restoreInput}>
                      <SelectItem value="H">优先级 1</SelectItem>
                      <SelectItem value="M">优先级 2</SelectItem>
                      <SelectItem value="L">优先级 3</SelectItem>
                      <SelectItem value="none">无优先级</SelectItem>
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
                        <Tag className="size-4" />
                        <span className="truncate">
                          {parsed.task.tags.length ? parsed.task.tags.join(", ") : "标签"}
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
                        标签，用逗号分隔
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
                        应用标签
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
                    完整表单
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
                      关闭并检查列表
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
