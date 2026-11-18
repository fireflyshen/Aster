import { FilterIcon, LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CountMenuTrigger } from "@/components/count-menu-trigger";
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
import { Ellipsis, Eye, EyeOff, Heart, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { OrganizationEntry } from "./organization-types";

type OrganizationRowProps = {
  entry: OrganizationEntry;
  disabled: boolean;
  isBuiltin?: boolean;
  isHidden?: boolean;
  onOpen: (entry: OrganizationEntry) => void;
  onEdit?: (entry: OrganizationEntry) => void;
  onDelete?: (entry: OrganizationEntry) => void;
  onFavorite: (entry: OrganizationEntry) => void;
  onToggleHide?: (entry: OrganizationEntry) => void;
};

/** Renders a single saved filter or tag row with favorite button and overflow menu. */
export function OrganizationRow({
  entry,
  disabled,
  isBuiltin = false,
  isHidden = false,
  onOpen,
  onEdit,
  onDelete,
  onFavorite,
  onToggleHide,
}: OrganizationRowProps) {
  const { kind, item } = entry;
  const Icon = kind === "filter" ? FilterIcon : LabelIcon;

  return (
    <div
      data-organization-row
      className="organization-list-row group flex min-h-10 items-center"
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
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={
          item.favorite ? `取消收藏: ${item.name}` : `添加到收藏: ${item.name}`
        }
        title={item.favorite ? "取消收藏" : "添加到收藏"}
        onClick={() => onFavorite(entry)}
        className={cn(
          "organization-row-quick-action ml-1 size-7 transition-opacity",
          item.favorite
            ? "text-primary opacity-100"
            : "text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        )}
      >
        <Heart className={cn("size-3.5", item.favorite && "fill-current")} />
      </Button>
      {onEdit && !isBuiltin && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`编辑: ${item.name}`}
          title="编辑"
          onClick={() => onEdit(entry)}
          className="organization-row-quick-action ml-1 size-7 text-muted-foreground"
        >
          <Pencil className="size-4" />
        </Button>
      )}
      {onToggleHide && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={
            isHidden ? `取消隐藏: ${item.name}` : `隐藏: ${item.name}`
          }
          title={isHidden ? "取消隐藏" : "隐藏"}
          onClick={() => onToggleHide(entry)}
          className={cn(
            "ml-1 size-7 text-muted-foreground transition-opacity",
            isHidden
              ? "opacity-100"
              : "md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
          )}
        >
          {isHidden ? (
            <Eye className="size-3.5" />
          ) : (
            <EyeOff className="size-3.5" />
          )}
        </Button>
      )}
      <RowMenu
        compact
        count={kind === "tag" ? (item as SavedTag).count : undefined}
        entry={entry}
        disabled={disabled}
        isBuiltin={isBuiltin}
        isHidden={isHidden}
        onEdit={onEdit ? () => onEdit(entry) : undefined}
        onDelete={onDelete ? () => onDelete(entry) : undefined}
        onFavorite={() => onFavorite(entry)}
        onToggleHide={onToggleHide ? () => onToggleHide(entry) : undefined}
      />
    </div>
  );
}

export function RowMenu({
  entry,
  disabled,
  isBuiltin,
  isHidden,
  onEdit,
  onFavorite,
  onToggleHide,
  onDelete,
  compact = false,
  count,
}: {
  entry: OrganizationEntry;
  compact?: boolean;
  count?: number;
  disabled: boolean;
  isBuiltin: boolean;
  isHidden: boolean;
  onEdit?: () => void;
  onFavorite: () => void;
  onToggleHide?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const items = [
    ...(onEdit && !isBuiltin
      ? [{ label: "编辑", Icon: Pencil, run: onEdit }]
      : []),
    {
      label: entry.item.favorite ? "取消收藏" : "添加到收藏",
      Icon: Heart,
      run: onFavorite,
    },
    ...(onToggleHide
      ? [
          {
            label: isHidden ? "取消隐藏" : "隐藏",
            Icon: isHidden ? Eye : EyeOff,
            run: onToggleHide,
          },
        ]
      : []),
    ...(onDelete && !isBuiltin
      ? [{ label: "删除", Icon: Trash2, run: onDelete }]
      : []),
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <CountMenuTrigger
            count={count}
            disabled={disabled}
            aria-label={`操作选项: ${entry.item.name}`}
            title={entry.item.name}
          />
        ) : (
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
        )}
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
        {items.map(({ label, Icon, run }) => (
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
