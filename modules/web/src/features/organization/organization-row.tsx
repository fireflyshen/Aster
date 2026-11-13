import { FilterIcon, LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  itemColor,
  type SavedFilter,
  type SavedTag,
} from "@core/workspace/organization";
import { cn } from "cn";
import { Ellipsis, Heart, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { OrganizationEntry } from "./organization-types";

type OrganizationRowProps = {
  entry: OrganizationEntry;
  disabled: boolean;
  onOpen: (entry: OrganizationEntry) => void;
  onEdit: (entry: OrganizationEntry) => void;
  onDelete: (entry: OrganizationEntry) => void;
  onFavorite: (entry: OrganizationEntry) => void;
};

/** Renders a single saved filter or tag row with favorite button and overflow menu. */
export function OrganizationRow({
  entry,
  disabled,
  onOpen,
  onEdit,
  onDelete,
  onFavorite,
}: OrganizationRowProps) {
  const { kind, item } = entry;
  const Icon = kind === "filter" ? FilterIcon : LabelIcon;

  return (
    <div
      data-organization-row
      className="group -mx-2.5 flex min-h-10 items-center px-2.5 md:-mx-3 md:px-3"
    >
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => onOpen(entry)}
        className="h-11 min-w-0 flex-1 justify-start gap-3 rounded-none px-0 font-normal hover:bg-transparent has-[>svg]:px-0 md:h-10"
      >
        <Icon
          className="size-[18px]"
          style={{ color: itemColor(item.color) }}
        />
        <span className="truncate">{item.name}</span>
        {kind === "filter" && (item as SavedFilter).description && (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {(item as SavedFilter).description}
          </span>
        )}
      </Button>
      {kind === "tag" && (
        <span className="ml-3 text-xs tabular-nums text-muted-foreground">
          {(item as SavedTag).count || ""}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={
          item.favorite
            ? `Remove ${item.name} from favorites`
            : `Add ${item.name} to favorites`
        }
        title={item.favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => onFavorite(entry)}
        className={cn(
          "ml-1 size-7 transition-opacity",
          item.favorite
            ? "text-primary opacity-100"
            : "text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        )}
      >
        <Heart className={cn("size-3.5", item.favorite && "fill-current")} />
      </Button>
      <RowMenu
        entry={entry}
        disabled={disabled}
        onEdit={() => onEdit(entry)}
        onDelete={() => onDelete(entry)}
        onFavorite={() => onFavorite(entry)}
      />
    </div>
  );
}

function RowMenu({
  entry,
  disabled,
  onEdit,
  onFavorite,
  onDelete,
}: {
  entry: OrganizationEntry;
  disabled: boolean;
  onEdit: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`操作选项: ${entry.item.name}`}
          className={cn(
            "ml-2 text-muted-foreground md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100 data-[state=open]:opacity-100",
            open && "bg-accent",
          )}
        >
          <Ellipsis className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-40 p-1"
        onCloseAutoFocus={(event) => {
          if (
            document.querySelector(
              '[data-organization-editor][data-state="open"], [role="alertdialog"]',
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        {[
          { label: "编辑", Icon: Pencil, run: onEdit },
          {
            label: entry.item.favorite ? "取消收藏" : "添加到收藏",
            Icon: Heart,
            run: onFavorite,
          },
          { label: "删除", Icon: Trash2, run: onDelete },
        ].map(({ label, Icon, run }) => (
          <Button
            key={label}
            variant="ghost"
            className={cn(
              "h-9 w-full justify-start text-sm font-normal",
              label === "删除" && "text-destructive",
            )}
            onClick={() => {
              setOpen(false);
              run();
            }}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
