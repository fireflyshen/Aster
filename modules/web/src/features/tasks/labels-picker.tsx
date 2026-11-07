import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import { tagName } from "@core/tasks/filter";
import { isVirtualTag } from "@core/tasks/options";

export function LabelsPicker({
  value,
  choices,
  onChange,
  disabled,
}: {
  value: string[];
  choices: SavedTag[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const all = [...new Set([...value, ...choices.map((tag) => tag.name)])];
  const filtered = all.filter((tag) =>
    tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const candidate = query.trim().replace(/^[@+]/, "");
  let valid = false;
  try {
    tagName(candidate);
    valid = !isVirtualTag(candidate);
  } catch {
    /* The search may be an incomplete label. */
  }
  const create =
    valid &&
    !all.some(
      (tag) => tag.toLocaleLowerCase() === candidate.toLocaleLowerCase(),
    );
  function toggle(tag: string) {
    onChange(
      value.includes(tag)
        ? value.filter((item) => item !== tag)
        : [...value, tag],
    );
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id="tags"
          role="combobox"
          aria-label="Labels"
          aria-expanded={open}
          variant="outline"
          type="button"
          disabled={disabled}
          className="h-11 w-full min-w-0 justify-between px-3 text-base font-normal md:h-9 md:text-sm"
        >
          <span
            className={`truncate ${value.length ? "" : "text-muted-foreground"}`}
          >
            {value.length ? value.join(", ") : "Choose labels"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            className="text-base md:text-sm"
            aria-label="Search or create a label"
            placeholder="Search or create a label…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-60 overscroll-contain p-1">
            {!filtered.length && !create && (
              <CommandEmpty>
                {query
                  ? "No matching labels"
                  : "Type to create your first label"}
              </CommandEmpty>
            )}
            {filtered.map((tag) => (
              <CommandItem
                key={tag}
                value={tag}
                aria-selected={value.includes(tag)}
                aria-label={`${tag}${value.includes(tag) ? ", selected" : ""}`}
                onSelect={() => toggle(tag)}
                disabled={!value.includes(tag) && value.length >= 30}
                className="min-h-11 gap-2.5 px-2 text-base md:min-h-9 md:text-sm"
              >
                <LabelIcon
                  className="size-4 shrink-0"
                  style={{
                    color: itemColor(
                      choices.find((item) => item.name === tag)?.color ||
                        "gray",
                    ),
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{tag}</span>
                {value.includes(tag) && <Check className="size-4 shrink-0" />}
              </CommandItem>
            ))}
            {create && (
              <CommandItem
                value={`create:${candidate}`}
                disabled={value.length >= 30}
                onSelect={() => {
                  toggle(candidate);
                  setQuery("");
                }}
                className="min-h-11 gap-2.5 px-2 text-base md:min-h-9 md:text-sm"
              >
                <Plus className="size-4" />
                <span className="truncate">Create “{candidate}”</span>
              </CommandItem>
            )}
          </CommandList>
        </Command>
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <span aria-live="polite">{value.length} / 30 selected</span>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 px-2 text-xs md:h-8"
              disabled={!value.length}
              onClick={() => onChange([])}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 px-2 text-xs md:h-8"
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
