import { LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import { cn } from "cn";
import { Heart } from "lucide-react";
import { ColorPicker } from "./color-picker";

type TagInlineFormProps = {
  item: SavedTag;
  busy: boolean;
  locked: boolean;
  error: string;
  onChange: (item: SavedTag) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/** Inline editor row for creating or renaming a saved tag with color and favorite toggles. */
export function TagInlineForm({
  item,
  busy,
  locked,
  error,
  onChange,
  onCancel,
  onSubmit,
}: TagInlineFormProps) {
  return (
    <form
      key={item.id || "new-tag"}
      className="-mx-2.5 my-1 rounded-lg border border-border/80 bg-muted/25 px-3 py-2.5 md:-mx-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={locked}
              aria-label="选择标签颜色"
              title="选择颜色"
              className="size-8 shrink-0 rounded-md"
            >
              <LabelIcon
                className="size-4"
                style={{ color: itemColor(item.color) }}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              标签颜色
            </p>
            <ColorPicker
              id="inline-label-color"
              value={item.color}
              disabled={locked}
              onChange={(color) => onChange({ ...item, color })}
            />
          </PopoverContent>
        </Popover>
        <Input
          id="organization-name"
          autoFocus
          value={item.name}
          placeholder="标签名称…"
          maxLength={60}
          autoComplete="off"
          disabled={locked}
          onChange={(e) => onChange({ ...item, name: e.target.value })}
          className="h-8 min-w-[160px] flex-1 bg-background text-sm shadow-none"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={locked}
          aria-label={item.favorite ? "取消收藏" : "添加到收藏"}
          title={item.favorite ? "已收藏" : "添加到侧边栏收藏"}
          onClick={() => onChange({ ...item, favorite: !item.favorite })}
          className={cn(
            "size-8 shrink-0",
            item.favorite
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Heart className={cn("size-4", item.favorite && "fill-current")} />
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" size="xs" disabled={locked}>
            {busy ? <Spinner className="size-3.5" /> : "Save"}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
