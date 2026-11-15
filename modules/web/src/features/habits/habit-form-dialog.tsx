import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LabelsPicker } from "@/features/tasks/labels-picker";
import { ProjectPicker } from "@/features/tasks/project-picker";
import type {
  CreateHabitInput,
  HabitChecklistItem,
  HabitCompletionMode,
  HabitKind,
  HabitListItem,
  HabitPlan,
  HabitSchedule,
  UpdateHabitInput,
} from "@core/habits/model";
import { addLocalDays } from "@core/time/zone";
import type { SavedTag } from "@core/workspace/organization";
import { cn } from "cn";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

const WEEKDAY_CHIPS = [
  { day: 1, label: "一" },
  { day: 2, label: "二" },
  { day: 3, label: "三" },
  { day: 4, label: "四" },
  { day: 5, label: "五" },
  { day: 6, label: "六" },
  { day: 7, label: "日" },
] as const;

function makeItemId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID().slice(0, 8);
  }
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultPlansState(): HabitPlan[] {
  return [
    { id: "A", name: "方案 A", items: [] },
    { id: "B", name: "方案 B", items: [] },
  ];
}

function hydratePlans(habit?: HabitListItem): {
  abEnabled: boolean;
  singleItems: HabitChecklistItem[];
  abPlans: HabitPlan[];
} {
  if (!habit) {
    return {
      abEnabled: false,
      singleItems: [],
      abPlans: defaultPlansState(),
    };
  }
  if (habit.abEnabled && habit.plans.length >= 2) {
    return {
      abEnabled: true,
      singleItems: habit.plans[0]?.items.map((i) => ({ ...i })) ?? [],
      abPlans: [
        {
          id: "A",
          name: habit.plans[0]?.name || "方案 A",
          items: habit.plans[0]?.items.map((i) => ({ ...i })) ?? [],
        },
        {
          id: "B",
          name: habit.plans[1]?.name || "方案 B",
          items: habit.plans[1]?.items.map((i) => ({ ...i })) ?? [],
        },
      ],
    };
  }
  const first = habit.plans[0]?.items.map((i) => ({ ...i })) ?? [];
  return {
    abEnabled: false,
    singleItems: first,
    abPlans: [
      { id: "A", name: "方案 A", items: first.map((i) => ({ ...i })) },
      { id: "B", name: "方案 B", items: [] },
    ],
  };
}

/** Modal form for creating or editing a habit (positive/negative, schedule, checklist/A-B plans). */
export function HabitFormDialog({
  open,
  onOpenChange,
  editing,
  todayDate,
  projects,
  availableLabels,
  busy,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: HabitListItem | null;
  todayDate: string;
  projects: string[];
  availableLabels: SavedTag[];
  busy: boolean;
  onCreate: (input: CreateHabitInput) => Promise<unknown>;
  onUpdate: (habitId: string, patch: UpdateHabitInput) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<HabitKind>("positive");
  const [trackTime, setTrackTime] = useState(false);
  const [completionMode, setCompletionMode] =
    useState<HabitCompletionMode>("simple");
  const [scheduleType, setScheduleType] =
    useState<HabitSchedule["type"]>("daily");
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [intervalDays, setIntervalDays] = useState<number>(2);
  const [anchorDate, setAnchorDate] = useState<string>(todayDate);

  const [abEnabled, setAbEnabled] = useState(false);
  const [singleItems, setSingleItems] = useState<HabitChecklistItem[]>([]);
  const [abPlans, setAbPlans] = useState<HabitPlan[]>(defaultPlansState);
  const [activeAbTab, setActiveAbTab] = useState<"A" | "B">("A");
  const [newItemTitle, setNewItemTitle] = useState("");

  const [project, setProject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [extraOpen, setExtraOpen] = useState(false);
  const [effectiveChoice, setEffectiveChoice] = useState<"today" | "tomorrow">(
    "tomorrow",
  );
  const [formError, setFormError] = useState("");

  const tomorrowDate = addLocalDays(todayDate, 1);

  useEffect(() => {
    if (!open) return;
    setFormError("");
    setNewItemTitle("");
    if (editing) {
      setTitle(editing.title);
      setKind(editing.kind);
      setTrackTime(editing.kind === "positive" && Boolean(editing.trackTime));
      setCompletionMode(editing.completionMode);
      setScheduleType(editing.schedule.type);
      if (editing.schedule.type === "weekly") {
        setWeekdays(editing.schedule.weekdays);
      } else {
        setWeekdays([1, 3, 5]);
      }
      if (editing.schedule.type === "interval") {
        setIntervalDays(editing.schedule.intervalDays);
        setAnchorDate(editing.schedule.anchorDate);
      } else {
        setIntervalDays(2);
        setAnchorDate(todayDate);
      }
      const hydrated = hydratePlans(editing);
      setAbEnabled(hydrated.abEnabled);
      setSingleItems(hydrated.singleItems);
      setAbPlans(hydrated.abPlans);
      setActiveAbTab("A");
      setProject(editing.project ?? "");
      setTags(editing.tags);
      setDescription(editing.description);
      setExtraOpen(
        Boolean(
          editing.project || editing.tags.length > 0 || editing.description,
        ),
      );
      setEffectiveChoice(editing.hasLogToday ? "tomorrow" : "today");
    } else {
      setTitle("");
      setKind("positive");
      setTrackTime(false);
      setCompletionMode("simple");
      setScheduleType("daily");
      setWeekdays([1, 3, 5]);
      setIntervalDays(2);
      setAnchorDate(todayDate);
      setAbEnabled(false);
      setSingleItems([]);
      setAbPlans(defaultPlansState());
      setActiveAbTab("A");
      setProject("");
      setTags([]);
      setDescription("");
      setExtraOpen(false);
      setEffectiveChoice("today");
    }
  }, [open, editing, todayDate]);

  const activeItems = abEnabled
    ? (abPlans.find((p) => p.id === activeAbTab)?.items ?? [])
    : singleItems;

  function updateActiveItems(
    updater: (prev: HabitChecklistItem[]) => HabitChecklistItem[],
  ) {
    if (abEnabled) {
      setAbPlans((prev) =>
        prev.map((plan) =>
          plan.id === activeAbTab
            ? { ...plan, items: updater(plan.items) }
            : plan,
        ),
      );
    } else {
      setSingleItems(updater);
    }
  }

  function addChecklistItem() {
    const trimmed = newItemTitle.trim();
    if (!trimmed) return;
    updateActiveItems((prev) => [
      ...prev,
      { id: makeItemId(), title: trimmed, required: true },
    ]);
    setNewItemTitle("");
  }

  function moveItem(index: number, delta: -1 | 1) {
    updateActiveItems((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  function toggleWeekday(day: number) {
    setWeekdays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort((a, b) => a - b),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("请输入习惯名称。");
      return;
    }

    let schedule: HabitSchedule;
    if (scheduleType === "daily") {
      schedule = { type: "daily" };
    } else if (scheduleType === "weekly") {
      if (weekdays.length === 0) {
        setFormError("请至少选择每周执行的一天。");
        return;
      }
      schedule = { type: "weekly", weekdays };
    } else {
      if (!Number.isInteger(intervalDays) || intervalDays < 2) {
        setFormError("间隔天数需为不小于 2 的整数。");
        return;
      }
      schedule = {
        type: "interval",
        intervalDays,
        anchorDate: anchorDate || todayDate,
      };
    }

    const plans: HabitPlan[] | undefined =
      kind === "positive" && completionMode === "checklist"
        ? abEnabled
          ? abPlans
          : [{ id: "default", name: "动作清单", items: singleItems }]
        : undefined;

    if (
      kind === "positive" &&
      completionMode === "checklist" &&
      plans &&
      plans.every((p) => p.items.length === 0)
    ) {
      setFormError("动作清单模式至少需要添加一个动作。");
      return;
    }

    if (editing) {
      const res = await onUpdate(editing.id, {
        title: trimmedTitle,
        description: description.trim(),
        project: project.trim() || null,
        tags,
        completionMode: kind === "positive" ? completionMode : "simple",
        trackTime: kind === "positive" ? trackTime : false,
        abEnabled:
          kind === "positive" && completionMode === "checklist" && abEnabled,
        schedule,
        plans,
        effectiveFromDate:
          effectiveChoice === "tomorrow" ? tomorrowDate : todayDate,
      });
      if (res) onOpenChange(false);
    } else {
      const res = await onCreate({
        title: trimmedTitle,
        kind,
        completionMode: kind === "positive" ? completionMode : "simple",
        trackTime: kind === "positive" ? trackTime : false,
        description: description.trim(),
        project: project.trim() || undefined,
        tags,
        abEnabled:
          kind === "positive" && completionMode === "checklist" && abEnabled,
        schedule,
        plans,
      });
      if (res) onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑习惯" : "新建习惯"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "修改名称、执行频率或动作清单；历史记录按当时规则保留。"
              : "决定叫什么、怎么记、什么时候执行即可开始，其余信息可稍后补充。"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          {/* 1. 叫什么 */}
          <div className="space-y-1.5">
            <Label htmlFor="habit-title">1. 叫什么</Label>
            <Input
              id="habit-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：阅读、力量训练、不喝含糖饮料"
            />
          </div>

          {/* 2. 怎么记 */}
          <div className="space-y-2">
            <Label>2. 怎么记</Label>
            <div
              className="grid gap-2 sm:grid-cols-3"
              role="group"
              aria-label="习惯记录方式"
            >
              {(
                [
                  {
                    kind: "positive",
                    trackTime: false,
                    label: "普通打卡",
                    hint: "只勾选今天是否做到，不计时、不计数",
                  },
                  {
                    kind: "positive",
                    trackTime: true,
                    label: "计时打卡",
                    hint: "打卡之外，记录投入的时长与成本",
                  },
                  {
                    kind: "negative",
                    trackTime: false,
                    label: "反向记次",
                    hint: "只记破例，未发生则在当天结束后达成",
                  },
                ] as const
              ).map((mode) => {
                const selected =
                  kind === mode.kind &&
                  (kind === "negative" || trackTime === mode.trackTime);
                const locked = Boolean(editing) && editing?.kind !== mode.kind;
                return (
                  <button
                    key={mode.label}
                    type="button"
                    disabled={locked}
                    aria-pressed={selected}
                    onClick={() => {
                      setKind(mode.kind);
                      setTrackTime(mode.trackTime);
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-(--habit-accent) bg-(--habit-accent)/8"
                        : "border-border hover:bg-accent/50",
                      locked && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <div className="text-sm font-medium text-foreground">
                      {mode.label}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {mode.hint}
                    </div>
                  </button>
                );
              })}
            </div>

            {kind === "positive" && (
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCompletionMode("simple")}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      completionMode === "simple"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    一键完成
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompletionMode("checklist")}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      completionMode === "checklist"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    逐项完成清单
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Checklist / A-B Editor */}
          {kind === "positive" && completionMode === "checklist" && (
            <div className="space-y-3 rounded-lg border border-border/80 bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-foreground">
                    动作清单
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    必做动作全部勾选后，整次训练自动完成
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <span>A/B 双方案</span>
                  <Switch checked={abEnabled} onCheckedChange={setAbEnabled} />
                </label>
              </div>

              {abEnabled && (
                <div className="flex items-center gap-1.5">
                  {(["A", "B"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveAbTab(id)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        activeAbTab === id
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground",
                      )}
                    >
                      方案 {id}（
                      {abPlans.find((p) => p.id === id)?.items.length ?? 0}）
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                {activeItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1"
                  >
                    <Input
                      value={item.title}
                      onChange={(e) =>
                        updateActiveItems((prev) =>
                          prev.map((it, i) =>
                            i === idx
                              ? {
                                  ...it,
                                  title: e.target.value,
                                }
                              : it,
                          ),
                        )
                      }
                      className="h-7 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateActiveItems((prev) =>
                          prev.map((it, i) =>
                            i === idx
                              ? {
                                  ...it,
                                  required: !it.required,
                                }
                              : it,
                          ),
                        )
                      }
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[11px] transition-colors",
                        item.required
                          ? "bg-(--habit-accent)/14 text-(--habit-accent)"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {item.required ? "必做" : "选做"}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={idx === 0}
                      onClick={() => moveItem(idx, -1)}
                      className="size-6 text-muted-foreground"
                    >
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={idx === activeItems.length - 1}
                      onClick={() => moveItem(idx, 1)}
                      className="size-6 text-muted-foreground"
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() =>
                        updateActiveItems((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      className="size-6 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}

                <div className="flex items-center gap-1.5 pt-0.5">
                  <Input
                    value={newItemTitle}
                    onChange={(e) => setNewItemTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addChecklistItem();
                      }
                    }}
                    placeholder="添加动作（如：俯卧撑、哑铃卧推）"
                    className="h-8 flex-1 text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addChecklistItem}
                    className="h-8 gap-1 px-2.5 text-xs"
                  >
                    <Plus className="size-3.5" />
                    添加
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 3. 什么时候执行 */}
          <div className="space-y-2">
            <Label>3. 什么时候执行</Label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "daily", label: "每天" },
                  { id: "weekly", label: "每周指定几天" },
                  { id: "interval", label: "每隔几天" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setScheduleType(opt.id)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    scheduleType === opt.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {scheduleType === "weekly" && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {WEEKDAY_CHIPS.map((w) => {
                  const active = weekdays.includes(w.day);
                  return (
                    <button
                      key={w.day}
                      type="button"
                      onClick={() => toggleWeekday(w.day)}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                        active
                          ? "border-(--habit-accent) bg-(--habit-accent) text-white"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            )}

            {scheduleType === "interval" && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span>每</span>
                <Input
                  type="number"
                  min={2}
                  max={365}
                  value={intervalDays}
                  onChange={(e) =>
                    setIntervalDays(Math.max(2, Number(e.target.value) || 2))
                  }
                  className="h-8 w-20 text-xs tabular-nums"
                />
                <span>天执行一次，起始日</span>
                <Input
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchorDate(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
              </div>
            )}
          </div>

          {editing && (
            <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">
                频率或清单修改生效时间
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEffectiveChoice("tomorrow")}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[11px]",
                    effectiveChoice === "tomorrow"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  从明天起（{tomorrowDate}，保留今日记录）
                </button>
                <button
                  type="button"
                  onClick={() => setEffectiveChoice("today")}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[11px]",
                    effectiveChoice === "today"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  从今天起（{todayDate}）
                </button>
              </div>
            </div>
          )}

          {/* Optional extra fields: project, tags, description */}
          <div className="border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => setExtraOpen((prev) => !prev)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {extraOpen
                ? "收起补充信息（项目、标签、说明）"
                : "+ 补充项目、标签或原则说明（可选）"}
            </button>

            {extraOpen && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">项目</Label>
                    <ProjectPicker
                      value={project}
                      projects={projects}
                      onChange={setProject}
                      allowCreate
                      emptyLabel="无项目"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">标签</Label>
                    <LabelsPicker
                      value={tags}
                      choices={availableLabels}
                      onChange={setTags}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="habit-description" className="text-xs">
                    说明 / 原则（例如 Thirteen 的品德原则）
                  </Label>
                  <Textarea
                    id="habit-description"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="例如：节制 — 少摄入添加糖，保持头脑清醒"
                    className="text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {formError && (
            <p className="text-xs font-medium text-destructive">{formError}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {editing ? "保存修改" : "创建习惯"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
