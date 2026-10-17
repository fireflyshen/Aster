import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Inbox, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "cn";

export function ProjectPicker({
  value,
  projects,
  onChange,
  disabled,
  compact = false,
  id = "edit-project",
  returnFocus,
}: {
  value: string;
  projects: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  id?: string;
  returnFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const name = query.trim();
  const filtered = projects.filter((project) => project.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  const create = !!name && !projects.some((project) => project.toLocaleLowerCase() === name.toLocaleLowerCase());
  function select(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
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
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="项目"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-11 w-full justify-between px-3 text-base font-normal",
            compact &&
              "h-7 w-auto max-w-44 justify-start gap-1.5 rounded-[5px] border-[#e6e6e6] px-2 py-0 text-[13px] font-normal text-[#666] shadow-none has-[>svg]:px-2",
          )}
        >
          {compact && (value ? <Hash className="size-4" /> : <Inbox className="size-4" />)}
          <span className={cn("truncate", !value && !compact && "text-muted-foreground")}>
            {value || (compact ? "收件箱" : "未分类")}
          </span>
          {!compact && <ChevronsUpDown className="size-4 shrink-0 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-64 max-w-[calc(100vw-2rem)] p-0"
        onCloseAutoFocus={
          returnFocus
            ? (event) => {
                event.preventDefault();
                returnFocus();
              }
            : undefined
        }
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="搜索或新建项目"
            placeholder="搜索或新建项目…"
            value={query}
            maxLength={200}
            onValueChange={setQuery}
          />
          <CommandList aria-label="项目建议">
            <CommandEmpty>没有匹配的项目</CommandEmpty>
            <CommandGroup>
              {!name && (
                <CommandItem value="none" onSelect={() => select("")}>
                  <Check className={cn("size-4", value && "opacity-0")} />
                  未分类
                </CommandItem>
              )}
              {filtered.map((project) => (
                <CommandItem key={project} value={`project:${project}`} onSelect={() => select(project)}>
                  <Check className={cn("size-4", value !== project && "opacity-0")} />
                  <span className="break-all">{project}</span>
                </CommandItem>
              ))}
              {create && (
                <CommandItem value={name} onSelect={() => select(name)}>
                  <Plus className="size-4" />
                  <span className="break-all">新建“{name}”</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
