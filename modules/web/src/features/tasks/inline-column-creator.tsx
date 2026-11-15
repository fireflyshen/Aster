import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { BoardChange } from "@core/workspace/board";
import { Columns3, Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

type InlineColumnCreatorProps = {
  layout: "list" | "board";
  revision: number;
  project?: string;
  disabled: boolean;
  saving: boolean;
  onSave: (change: BoardChange) => Promise<boolean>;
};

/** Inline trigger and composer for creating a new section or board column. */
export function InlineColumnCreator({
  layout,
  revision,
  project,
  disabled,
  saving,
  onSave,
}: InlineColumnCreatorProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function openCreator() {
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function closeCreator() {
    setEditing(false);
    setName("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      closeCreator();
      return;
    }
    if (disabled || saving) return;
    const ok = await onSave({
      kind: "board",
      action: "column.save",
      revision,
      column: { id: "", name: trimmed, project: project || "" },
    });
    if (ok) {
      closeCreator();
    }
  }

  if (!editing) {
    return (
      <div
        className={
          layout === "list" ? "task-add-section group/add-section my-3" : ""
        }
      >
        {layout === "list" ? (
          <div className="relative flex items-center justify-center py-2.5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/60 transition-colors duration-200 group-hover/add-section:border-primary/60" />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={openCreator}
              className="relative h-7 gap-1.5 rounded bg-background px-3 text-xs font-medium text-muted-foreground opacity-80 transition-all group-hover/add-section:text-primary group-hover/add-section:opacity-100 hover:bg-background hover:text-primary"
            >
              <Plus className="size-3.5" />
              添加分区
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={openCreator}
            className="h-10 w-full justify-start gap-2 self-start rounded-[10px] bg-(--sidebar)/75 px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-(--sidebar) hover:text-foreground"
          >
            <Columns3 className="size-4 text-primary" strokeWidth={1.75} />
            添加版块
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={
        layout === "list"
          ? "my-2 flex max-w-sm items-center gap-1.5 rounded-[10px] border border-border bg-card p-2 shadow-sm"
          : "flex flex-col gap-2 self-start rounded-[10px] border border-border bg-card p-2.5 shadow-sm"
      }
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        maxLength={40}
        disabled={disabled || saving}
        placeholder="为此分区命名"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeCreator();
          }
        }}
        onBlur={(event) => {
          if (
            !name.trim() &&
            !saving &&
            !event.currentTarget.form?.contains(
              event.relatedTarget as Node | null,
            )
          ) {
            setEditing(false);
          }
        }}
        className={
          layout === "list"
            ? "min-w-0 flex-1 bg-transparent px-1 text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
            : "h-8 w-full rounded-md border border-border/70 bg-transparent px-2.5 text-sm font-medium outline-none focus:border-ring placeholder:font-normal placeholder:text-muted-foreground/60"
        }
      />
      <div className="flex items-center gap-1.5">
        <Button
          type="submit"
          size="xs"
          disabled={disabled || saving || !name.trim()}
          className="h-7 rounded-[6px] px-3 text-xs font-medium shadow-none"
        >
          {saving ? <Spinner className="size-3" /> : "添加分区"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={closeCreator}
          className="h-7 rounded-[6px] px-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          取消
        </Button>
      </div>
    </form>
  );
}
