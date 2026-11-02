import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { ProjectIcon } from "@/features/projects/project-icon";
import { projectPath, projectTree } from "@core/workspace/projects";
import { cn } from "cn";
import { Check, ChevronsUpDown, Inbox, Plus } from "lucide-react";
import { useState } from "react";

export function ProjectPicker({
    value,
    projects,
    onChange,
    disabled,
    compact = false,
    id = "edit-project",
    returnFocus,
    allowCreate = true,
    emptyLabel = "No project",
    label = "Project",
}: {
    allowCreate?: boolean;
    emptyLabel?: string;
    label?: string;
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
    const filtered = projectTree(projects).filter((project) =>
        project.name.toLocaleLowerCase().includes(name.toLocaleLowerCase()),
    );
    const create =
        allowCreate &&
        !!name &&
        !projects.some(
            (project) =>
                project.toLocaleLowerCase() === name.toLocaleLowerCase(),
        );
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
                    aria-label={label}
                    variant="outline"
                    disabled={disabled}
                    className={cn(
                        "h-11 w-full justify-between px-3 text-base font-normal",
                        compact &&
                            "h-9 w-auto md:h-7 max-w-44 justify-start gap-1.5 rounded-[5px] border-input px-2 py-0 text-[13px] font-normal text-muted-foreground shadow-none has-[>svg]:px-2",
                    )}
                >
                    {compact &&
                        (value ? (
                            <ProjectIcon name={value} className="size-4" />
                        ) : (
                            <Inbox className="size-4" />
                        ))}
                    <span
                        className={cn(
                            "truncate",
                            !value && !compact && "text-muted-foreground",
                        )}
                    >
                        {value
                            ? projectPath(value)
                            : compact
                              ? "Inbox"
                              : emptyLabel}
                    </span>
                    {!compact && (
                        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                    )}
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
                        aria-label={
                            allowCreate
                                ? "Search or create a project"
                                : "Search projects"
                        }
                        placeholder={
                            allowCreate
                                ? "Search or create a project…"
                                : "Search projects…"
                        }
                        value={query}
                        maxLength={200}
                        onValueChange={setQuery}
                    />
                    <CommandList aria-label="Project suggestions">
                        <CommandEmpty>No projects found</CommandEmpty>
                        <CommandGroup>
                            {!name && (
                                <CommandItem
                                    value="none"
                                    onSelect={() => select("")}
                                >
                                    <Check
                                        className={cn(
                                            "size-4",
                                            value && "opacity-0",
                                        )}
                                    />
                                    {emptyLabel}
                                </CommandItem>
                            )}
                            {filtered.map((row) => (
                                <CommandItem
                                    key={row.name}
                                    value={`project:${row.name}`}
                                    onSelect={() => select(row.name)}
                                    title={projectPath(row.name)}
                                >
                                    <Check
                                        className={cn(
                                            "size-4",
                                            value !== row.name && "opacity-0",
                                        )}
                                    />
                                    <span
                                        className="flex min-w-0 items-center gap-2"
                                        style={{
                                            paddingInlineStart:
                                                Math.min(row.depth, 4) * 10,
                                        }}
                                    >
                                        <ProjectIcon name={row.name} />
                                        <span className="min-w-0 break-words">
                                            {name || row.depth > 4
                                                ? projectPath(row.name)
                                                : row.label}
                                        </span>
                                    </span>
                                </CommandItem>
                            ))}
                            {create && (
                                <CommandItem
                                    value={name}
                                    onSelect={() => select(name)}
                                >
                                    <Plus className="size-4" />
                                    <span className="break-all">
                                        Create “{name}”
                                    </span>
                                </CommandItem>
                            )}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
