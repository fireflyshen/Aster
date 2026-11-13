import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import { ChevronDown, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatCommentTime } from "./task-date";

type TaskDetailCommentsProps = {
  annotations?: Task["annotations"];
  disabled: boolean;
  onAddComment?: (text: string) => Promise<boolean>;
  onRemoveNote: (entry: string, description: string) => Promise<boolean>;
};

/** Expandable task activity comments with a Todoist-style bordered comment box. */
export function TaskDetailComments({
  annotations = [],
  disabled,
  onAddComment,
  onRemoveNote,
}: TaskDetailCommentsProps) {
  const [expanded, setExpanded] = useState(true);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  async function postComment() {
    const trimmed = text.trim();
    if (!trimmed || !onAddComment || posting) return;
    setPosting(true);
    try {
      const ok = await onAddComment(trimmed);
      if (ok) {
        setText("");
        setFocused(false);
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="task-detail-comments mt-6 border-t border-border/70 pt-4">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="mb-3 flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-foreground transition-colors hover:text-muted-foreground"
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform duration-200",
            !expanded && "-rotate-90",
          )}
        />
        <span>评论</span>
        {annotations.length > 0 && (
          <span className="font-normal tabular-nums text-muted-foreground">
            {annotations.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-3.5">
          {annotations.length > 0 && (
            <div className="space-y-3">
              {annotations.map((note, index) => (
                <div
                  key={`${note.entry ?? "note"}-${index}`}
                  className="group/comment flex items-start gap-2.5"
                >
                  <div className="flex size-7 shrink-0 select-none items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
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
                          className="size-6 text-muted-foreground transition-opacity hover:text-destructive md:opacity-0 md:group-hover/comment:opacity-100"
                          aria-label={`删除评论 ${index + 1}`}
                          disabled={disabled}
                          onClick={() =>
                            void onRemoveNote(note.entry!, note.description)
                          }
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      )}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
                      {note.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {onAddComment && (
            <div className="flex items-start gap-2.5 pt-1">
              <div className="mt-1 flex size-7 shrink-0 select-none items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                A
              </div>
              <div className="flex-1 rounded-[10px] border border-border bg-transparent p-2.5 transition-colors focus-within:border-foreground/35">
                <textarea
                  rows={focused || text ? 2 : 1}
                  placeholder="评论"
                  value={text}
                  disabled={disabled || posting}
                  onFocus={() => setFocused(true)}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.metaKey || event.ctrlKey) &&
                      !event.nativeEvent.isComposing &&
                      event.nativeEvent.keyCode !== 229
                    ) {
                      event.preventDefault();
                      void postComment();
                    }
                    if (event.key === "Escape" && !text.trim()) {
                      event.preventDefault();
                      setFocused(false);
                      event.currentTarget.blur();
                    }
                  }}
                  className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
                />
                {(focused || text.trim()) && (
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={posting}
                      onClick={() => {
                        setText("");
                        setFocused(false);
                      }}
                      className="h-7 rounded-[6px] px-3 text-xs text-muted-foreground hover:text-foreground"
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!text.trim() || disabled || posting}
                      onClick={() => void postComment()}
                      className="h-7 rounded-[6px] px-3 text-xs font-semibold shadow-none"
                    >
                      {posting ? <Spinner className="size-3.5" /> : "评论"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
