import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { Check, Folder, Moon, Plus, Tag, X } from "lucide-react";
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
      return [...new Set([...availableProjects, "睡眠"])];
    }
    return [...new Set([project, ...availableProjects, "睡眠"])];
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
    const query = newTagInput.trim().replace(/^#/, "");
    return (
      <div className="time-meta-fields" data-time-meta>
        <div className="time-meta-project">
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <Select
            value={project || UNASSIGNED_PROJECT_SELECT}
            onValueChange={(v) =>
              onProjectChange(v === UNASSIGNED_PROJECT_SELECT ? "" : v)
            }
          >
            <SelectTrigger
              id={`${idPrefix}-project`}
              aria-label="项目（必填）"
              aria-required="true"
              className="h-8 min-w-0 max-w-40 gap-1 border-0 bg-transparent dark:bg-transparent px-1.5 text-xs text-muted-foreground shadow-none"
            >
              <SelectValue placeholder="选择项目（必填）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED_PROJECT_SELECT} disabled>
                选择项目（必填）
              </SelectItem>
              {projectOptions.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="选择活动标签"
              className="time-meta-tag-trigger"
            >
              <Tag className="size-3.5" />
              标签（可选）
              {tags.length > 0 && (
                <span className="tabular-nums">{tags.length}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-64 max-w-[calc(100vw-24px)] p-2.5"
            aria-label="活动标签"
          >
            <div className="flex items-center gap-2 border-b border-border/60 pb-2">
              <input
                type="text"
                aria-label="搜索或新增标签"
                placeholder="搜索或新增标签"
                className="h-8 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-xs"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    addCustomTag();
                  }
                }}
              />
              {query && !tagOptions.includes(query) && (
                <button
                  type="button"
                  aria-label="添加标签"
                  className="size-8 shrink-0 text-muted-foreground"
                  onClick={addCustomTag}
                >
                  <Plus className="size-4" />
                </button>
              )}
            </div>
            <div className="max-h-52 space-y-0.5 overflow-y-auto pt-2">
              {tagOptions
                .filter((tag) =>
                  tag.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                )
                .map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={tags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                    className="flex min-h-8 w-full items-center justify-between gap-2 rounded px-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <span className="truncate">{tag}</span>
                    {tags.includes(tag) && (
                      <Check className="size-3.5 shrink-0 text-foreground" />
                    )}
                  </button>
                ))}
            </div>
          </PopoverContent>
        </Popover>
        {onSleepChange && (
          <label className="time-meta-sleep" title="睡眠时段不计入成本">
            <Checkbox
              aria-label="睡眠，不计成本"
              checked={Boolean(isSleep)}
              onCheckedChange={(v) =>
                (() => {
                  const sleep = Boolean(v);
                  if (sleep && !project.trim()) onProjectChange("睡眠");
                  else if (!sleep && project === "睡眠") onProjectChange("");
                  onSleepChange(sleep);
                })()
              }
              className="size-3.5 shrink-0"
            />
            <Moon className="size-3.5 shrink-0" />
            <span>睡眠</span>
          </label>
        )}
        {tags.length > 0 && (
          <div className="time-meta-selected">
            {tags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                type="button"
                title={`移除标签 ${tag}`}
                aria-label={`移除标签 ${tag}`}
                onClick={() => toggleTag(tag)}
                className="inline-flex min-h-7 max-w-40 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <span className="truncate">#{tag}</span>
                <X className="size-2.5 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-project`}>项目（必填）</Label>
          <Select
            value={project || UNASSIGNED_PROJECT_SELECT}
            onValueChange={(v) =>
              onProjectChange(v === UNASSIGNED_PROJECT_SELECT ? "" : v)
            }
          >
            <SelectTrigger id={`${idPrefix}-project`}>
              <SelectValue placeholder="选择项目（必填）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED_PROJECT_SELECT} disabled>
                选择项目（必填）
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
                  (() => {
                    const sleep = Boolean(v);
                    if (sleep && !project.trim()) onProjectChange("睡眠");
                    else if (!sleep && project === "睡眠") onProjectChange("");
                    onSleepChange(sleep);
                  })()
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
