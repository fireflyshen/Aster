import type { SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { Folder, Moon, Plus, Tag, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export const UNASSIGNED_PROJECT_SELECT = "__unassigned_project__";

export function collectProjectOptions(
    projects: readonly string[],
    tasks: readonly Task[],
    extra: readonly (string | undefined)[] = [],
): string[] {
    const seen = new Set<string>();
    const add = (value: string | undefined) => {
        const trimmed = value?.trim();
        if (!trimmed) return;
        seen.add(trimmed);
    };
    for (const p of projects) add(p);
    for (const t of tasks) add(t.project);
    for (const e of extra) add(e);
    return [...seen].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function collectTagOptions(
    savedLabels: readonly (SavedTag | string)[],
    tasks: readonly Task[],
    extra: readonly string[] = [],
): string[] {
    const seen = new Set<string>();
    const add = (value: string | undefined) => {
        const trimmed = value?.trim();
        if (!trimmed) return;
        seen.add(trimmed);
    };
    for (const item of savedLabels) {
        add(typeof item === "string" ? item : item.name);
    }
    for (const t of tasks) {
        for (const tag of t.tags || []) add(tag);
    }
    for (const e of extra) add(e);
    return [...seen].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function ProjectTagFields({
    project,
    onProjectChange,
    tags,
    onTagsChange,
    availableProjects,
    availableTags,
    isSleep,
    onSleepChange,
    compact = false,
    idPrefix = "time-pt",
}: {
    project: string;
    onProjectChange: (nextProject: string) => void;
    tags: string[];
    onTagsChange: (nextTags: string[]) => void;
    availableProjects: readonly string[];
    availableTags: readonly string[];
    isSleep?: boolean;
    onSleepChange?: (sleep: boolean) => void;
    compact?: boolean;
    idPrefix?: string;
}) {
    const [newTagInput, setNewTagInput] = useState("");

    const projectOptions = useMemo(() => {
        if (!project || availableProjects.includes(project)) {
            return availableProjects;
        }
        return [project, ...availableProjects];
    }, [availableProjects, project]);

    const tagOptions = useMemo(() => {
        const merged = new Set<string>(availableTags);
        for (const t of tags) {
            if (t.trim()) merged.add(t.trim());
        }
        return [...merged];
    }, [availableTags, tags]);

    function toggleTag(tag: string) {
        if (tags.includes(tag)) {
            onTagsChange(tags.filter((item) => item !== tag));
        } else {
            onTagsChange([...tags, tag]);
        }
    }

    function addCustomTag() {
        const trimmed = newTagInput.trim().replace(/^#/, "");
        if (!trimmed) return;
        if (!tags.includes(trimmed)) {
            onTagsChange([...tags, trimmed]);
        }
        setNewTagInput("");
    }

    if (compact) {
        return (
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1">
                    <Folder className="size-3 text-muted-foreground" />
                    <Select
                        value={project || UNASSIGNED_PROJECT_SELECT}
                        onValueChange={(v) =>
                            onProjectChange(
                                v === UNASSIGNED_PROJECT_SELECT ? "" : v,
                            )
                        }
                    >
                        <SelectTrigger
                            id={`${idPrefix}-project`}
                            aria-label="关联项目"
                            className="h-7 w-auto min-w-[96px] gap-1 border-0 bg-transparent px-1.5 text-xs text-muted-foreground shadow-none"
                        >
                            <SelectValue placeholder="无项目" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={UNASSIGNED_PROJECT_SELECT}>
                                无项目
                            </SelectItem>
                            {projectOptions.map((item) => (
                                <SelectItem key={item} value={item}>
                                    {item}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                    <Tag className="size-3 text-muted-foreground/75" />
                    {tagOptions.slice(0, 12).map((tag) => {
                        const active = tags.includes(tag);
                        return (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => toggleTag(tag)}
                                className={
                                    active
                                        ? "inline-flex h-6 items-center gap-1 rounded-full bg-foreground px-2 text-[11px] text-background transition-colors"
                                        : "inline-flex h-6 items-center gap-1 rounded-full border border-border/60 px-2 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                                }
                            >
                                <span>#{tag}</span>
                                {active && <X className="size-2.5" />}
                            </button>
                        );
                    })}
                    {tags
                        .filter((tag) => !tagOptions.slice(0, 12).includes(tag))
                        .map((tag) => (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => toggleTag(tag)}
                                className="inline-flex h-6 items-center gap-1 rounded-full bg-foreground px-2 text-[11px] text-background transition-colors"
                            >
                                <span>#{tag}</span>
                                <X className="size-2.5" />
                            </button>
                        ))}
                    <div className="inline-flex items-center gap-0.5 border-b border-border/50 px-1">
                        <input
                            type="text"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    addCustomTag();
                                }
                            }}
                            placeholder="新增标签"
                            className="h-5 w-16 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/55 outline-none"
                        />
                        {newTagInput.trim() && (
                            <button
                                type="button"
                                aria-label="添加标签"
                                onClick={addCustomTag}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                <Plus className="size-3" />
                            </button>
                        )}
                    </div>
                </div>

                {onSleepChange && (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                        <Checkbox
                            checked={Boolean(isSleep)}
                            onCheckedChange={(v) => onSleepChange(Boolean(v))}
                            className="size-3"
                        />
                        <Moon className="size-3" />
                        <span>睡眠（不计成本）</span>
                    </label>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label htmlFor={`${idPrefix}-project`}>
                        关联项目（Taskwarrior）
                    </Label>
                    <Select
                        value={project || UNASSIGNED_PROJECT_SELECT}
                        onValueChange={(v) =>
                            onProjectChange(
                                v === UNASSIGNED_PROJECT_SELECT ? "" : v,
                            )
                        }
                    >
                        <SelectTrigger id={`${idPrefix}-project`}>
                            <SelectValue placeholder="无项目" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={UNASSIGNED_PROJECT_SELECT}>
                                无项目
                            </SelectItem>
                            {projectOptions.map((item) => (
                                <SelectItem key={item} value={item}>
                                    {item}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {onSleepChange && (
                    <div className="flex items-end pb-1.5">
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                            <Checkbox
                                checked={Boolean(isSleep)}
                                onCheckedChange={(v) =>
                                    onSleepChange(Boolean(v))
                                }
                            />
                            <span>睡眠时段（单价 ¥0 且免 6h 提醒）</span>
                        </label>
                    </div>
                )}
            </div>

            <div className="space-y-1.5">
                <Label>标签（可选，多选）</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                    {tagOptions.map((tag) => {
                        const active = tags.includes(tag);
                        return (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => toggleTag(tag)}
                                className={
                                    active
                                        ? "inline-flex h-6 items-center gap-1 rounded-full bg-foreground px-2.5 text-[11px] text-background transition-colors"
                                        : "inline-flex h-6 items-center gap-1 rounded-full border border-border/60 px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                                }
                            >
                                <span>#{tag}</span>
                                {active && <X className="size-2.5" />}
                            </button>
                        );
                    })}
                    <div className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5">
                        <input
                            type="text"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    addCustomTag();
                                }
                            }}
                            placeholder="+ 自定义标签"
                            className="w-20 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/55 outline-none"
                        />
                        {newTagInput.trim() && (
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label="添加标签"
                                className="size-4"
                                onClick={addCustomTag}
                            >
                                <Plus className="size-3" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
