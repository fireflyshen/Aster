import { hasTimeAssignment } from "@core/time/assignment";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { Check, Folder, Tag, X } from "lucide-react";
import { useMemo, useState } from "react";
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
  compact = false,
  idPrefix = "time-pt",
}: {
  project: string;
  onProjectChange: (nextProject: string) => void;
  tags: string[];
  onTagsChange: (nextTags: string[]) => void;
  availableProjects: readonly string[];
  availableTags: readonly string[];
  compact?: boolean;
  idPrefix?: string;
}) {
  const projectOptions = useMemo(() => {
    if (!project || availableProjects.includes(project)) {
      return [...new Set(availableProjects)];
    }
    return [...new Set([project, ...availableProjects])];
  }, [availableProjects, project]);

  return (
    <div className="time-meta-fields" data-time-meta>
      {!compact && <p className="time-assignment-heading">归属</p>}
      {!hasTimeAssignment(project, tags) && (
        <p className="time-assignment-hint">项目或标签至少选一项</p>
      )}
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
            aria-label="项目（可选）"
            className="h-8 min-w-0 max-w-40 gap-1 border-0 bg-transparent dark:bg-transparent px-1.5 text-xs text-muted-foreground shadow-none"
          >
            <SelectValue placeholder="不关联项目" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED_PROJECT_SELECT}>无项目</SelectItem>
            {projectOptions.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <TimeTagPicker
        label="选择活动标签"
        tags={tags}
        onChange={onTagsChange}
        availableTags={availableTags}
      />
      {tags.length > 0 && (
        <div className="time-meta-selected">
          {tags.slice(0, 3).map((tag) => (
            <button
              key={tag}
              type="button"
              title={`移除标签 ${tag}`}
              aria-label={`移除标签 ${tag}`}
              onClick={() => onTagsChange(tags.filter((item) => item !== tag))}
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

export function TimeTagPicker({
  label,
  tags,
  onChange,
  availableTags,
}: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  availableTags: readonly string[];
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().replace(/^#/, "").toLocaleLowerCase();
  const options = [...new Set([...availableTags, ...tags])].filter((tag) =>
    tag.toLocaleLowerCase().includes(query),
  );
  function toggleTag(tag: string) {
    onChange(
      tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag],
    );
  }
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="time-meta-tag-trigger"
        >
          <Tag className="size-3.5" />
          标签
          {tags.length > 0 && (
            <span className="tabular-nums">{tags.length}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 max-w-[calc(100vw-24px)] p-2.5"
        aria-label={label}
      >
        <div className="flex items-center gap-2 border-b border-border/60 pb-2">
          <input
            type="text"
            aria-label="搜索已有标签"
            placeholder="搜索已有标签"
            className="h-8 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                const exact = options.find(
                  (tag) => tag.toLocaleLowerCase() === query,
                );
                if (exact) toggleTag(exact);
                else if (query && options.length === 1) toggleTag(options[0]);
              }
            }}
          />
        </div>
        <div className="max-h-52 space-y-0.5 overflow-y-auto pt-2">
          {options.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">
              {query ? "没有匹配的标签" : "请先在工作区创建标签"}
            </p>
          )}
          {options.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tags.includes(tag)}
              onClick={() => toggleTag(tag)}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
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
  );
}
