import type {
  ProjectCategoryRule,
  TagCategoryRule,
  TimePolicy,
} from "@core/time/model";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveBackup } from "@/features/recovery/backup-panel";
import {
  applyTimeBackupRestore,
  applyTimewarriorImport,
  exportTimeBackup,
  previewTimeBackupRestore,
  previewTimewarriorImport,
  updateTimePolicy,
  type TimeBackupPreview,
  type TimeReceipt,
  type TimewarriorImportPreview,
} from "./time-api";
import { resolveCategoryLabel } from "./time-format";

export function TimeSettingsPage({
  policy,
  busy,
  runMutation,
}: {
  policy: TimePolicy;
  busy: boolean;
  runMutation: <T extends TimeReceipt | Record<string, unknown>>(
    label: string,
    fn: () => Promise<T>,
    options?: { undoable?: boolean },
  ) => Promise<T | undefined>;
}) {
  const [timezone, setTimezone] = useState(policy.timezone);
  const [thresholdMins, setThresholdMins] = useState(
    String(Math.max(1, Math.round(policy.longActivityThresholdSeconds / 60))),
  );
  const [sleepEnabled, setSleepEnabled] = useState(
    policy.sleepTemplate.enabled,
  );
  const [sleepStart, setSleepStart] = useState(policy.sleepTemplate.startTime);
  const [sleepEnd, setSleepEnd] = useState(policy.sleepTemplate.endTime);
  const [projectRules, setProjectRules] = useState<ProjectCategoryRule[]>(
    policy.projectRules,
  );
  const [tagRules, setTagRules] = useState<TagCategoryRule[]>(policy.tagRules);
  const [newRuleKind, setNewRuleKind] = useState<"project" | "tag">("project");
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleCategory, setNewRuleCategory] = useState(
    policy.categories[0]?.id || "work",
  );

  const [importPreview, setImportPreview] =
    useState<TimewarriorImportPreview | null>(null);
  const [clipOpenToCutover, setClipOpenToCutover] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");

  const backupInputRef = useRef<HTMLInputElement>(null);
  const [backupPreview, setBackupPreview] = useState<TimeBackupPreview | null>(
    null,
  );
  const [backupError, setBackupError] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);

  useEffect(() => {
    setTimezone(policy.timezone);
    setThresholdMins(
      String(Math.max(1, Math.round(policy.longActivityThresholdSeconds / 60))),
    );
    setSleepEnabled(policy.sleepTemplate.enabled);
    setSleepStart(policy.sleepTemplate.startTime);
    setSleepEnd(policy.sleepTemplate.endTime);
    setProjectRules(policy.projectRules);
    setTagRules(policy.tagRules);
  }, [policy]);

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    const parsedThreshold = Number(thresholdMins);
    await runMutation("已保存时间策略与自动分类规则", () =>
      updateTimePolicy({
        expectedPolicyVersion: policy.policyVersion,
        patch: {
          timezone: timezone.trim(),
          longActivityThresholdSeconds:
            Number.isFinite(parsedThreshold) && parsedThreshold > 0
              ? Math.round(parsedThreshold * 60)
              : policy.longActivityThresholdSeconds,
          sleepTemplate: {
            enabled: sleepEnabled,
            startTime: sleepStart,
            endTime: sleepEnd,
            version: policy.sleepTemplate.version,
          },
          projectRules,
          tagRules,
        },
      }),
    );
  }

  function handleAddRule() {
    const pattern = newRulePattern.trim();
    if (!pattern) return;
    if (newRuleKind === "project") {
      setProjectRules((prev) => [
        ...prev.filter((r) => r.pattern !== pattern),
        { pattern, categoryId: newRuleCategory },
      ]);
    } else {
      setTagRules((prev) => [
        ...prev.filter((r) => r.tag !== pattern),
        {
          tag: pattern,
          categoryId: newRuleCategory,
          priority: prev.length + 1,
        },
      ]);
    }
    setNewRulePattern("");
  }

  async function handlePreviewImport() {
    setImportBusy(true);
    setImportError("");
    try {
      const preview = await previewTimewarriorImport({ clipOpenToCutover });
      setImportPreview(preview);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "预览导入失败");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleApplyImport() {
    setImportBusy(true);
    setImportError("");
    try {
      const res = await runMutation("已完成 Timewarrior 历史快照导入", () =>
        applyTimewarriorImport({ clipOpenToCutover }),
      );
      if (res) setImportPreview(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleExportTimeBackup() {
    setBackupBusy(true);
    setBackupError("");
    try {
      const bundle = await exportTimeBackup();
      saveBackup(
        bundle,
        `aster-time-backup-${new Date().toISOString().slice(0, 10)}.json`,
      );
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleBackupFileChange(file: File | undefined) {
    if (!file) return;
    setBackupBusy(true);
    setBackupError("");
    setBackupPreview(null);
    try {
      const parsed = JSON.parse(await file.text()) as {
        sqliteBase64?: string;
      };
      if (!parsed.sqliteBase64) {
        throw new Error("所选文件不是有效的 Aster Time 备份文件。");
      }
      const preview = await previewTimeBackupRestore(parsed.sqliteBase64);
      setBackupPreview(preview);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : "解析备份失败");
    } finally {
      setBackupBusy(false);
      if (backupInputRef.current) backupInputRef.current.value = "";
    }
  }

  return (
    <div className="max-w-2xl space-y-10">
      {/* Main Policy Form: Clean Linear-style setting rows */}
      <form onSubmit={(e) => void handleSavePolicy(e)} className="space-y-10">
        <section>
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              基础偏好
            </h2>
            <span className="text-xs text-muted-foreground/70">
              v{policy.policyVersion}
            </span>
          </div>

          <div className="divide-y divide-border/35">
            <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
              <div>
                <div className="text-sm text-foreground">IANA 时区</div>
                <div className="text-xs text-muted-foreground">
                  按该时区切分日/周时间线与精力重置点
                </div>
              </div>
              <Input
                id="time-policy-tz"
                aria-label="IANA 时区"
                className="h-8 w-44 text-xs"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Asia/Shanghai"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
              <div>
                <div className="text-sm text-foreground">长计时提醒（分钟）</div>
                <div className="text-xs text-muted-foreground">
                  单条计时超出该时长后温和提示是否忘记结束
                </div>
              </div>
              <Input
                id="time-policy-long"
                aria-label="长计时提醒阈值"
                type="number"
                min={15}
                max={1440}
                className="h-8 w-24 text-right text-xs tabular-nums"
                value={thresholdMins}
                onChange={(e) => setThresholdMins(e.target.value)}
              />
            </div>

            <div className="space-y-3 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-foreground">睡眠模板候选</div>
                  <div className="text-xs text-muted-foreground">
                    每日生成一条作息候选，可一键“照常”或跳过
                  </div>
                </div>
                <Switch
                  checked={sleepEnabled}
                  onCheckedChange={setSleepEnabled}
                  aria-label="启用睡眠候选模板"
                />
              </div>
              {sleepEnabled && (
                <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-muted-foreground">
                  <label className="flex items-center gap-2">
                    <span>入睡</span>
                    <Input
                      id="sleep-start"
                      type="time"
                      className="h-7 w-28 text-xs"
                      value={sleepStart}
                      onChange={(e) => setSleepStart(e.target.value)}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span>起床</span>
                    <Input
                      id="sleep-end"
                      type="time"
                      className="h-7 w-28 text-xs"
                      value={sleepEnd}
                      onChange={(e) => setSleepEnd(e.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Auto-classification rules */}
        <section>
          <div className="border-b border-border/60 pb-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              自动分类规则
            </h2>
          </div>

          <div className="divide-y divide-border/35">
            {projectRules.map((rule) => (
              <div
                key={`proj-${rule.pattern}`}
                className="group flex items-center justify-between gap-4 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">项目</span>
                  <span className="text-sm text-foreground">{rule.pattern}</span>
                  <span className="text-muted-foreground/50">→</span>
                  <span className="text-muted-foreground">
                    {resolveCategoryLabel(rule.categoryId, policy)}
                  </span>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="删除项目规则"
                  className="size-6 text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  onClick={() =>
                    setProjectRules((prev) =>
                      prev.filter((r) => r.pattern !== rule.pattern),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            {tagRules.map((rule) => (
              <div
                key={`tag-${rule.tag}`}
                className="group flex items-center justify-between gap-4 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">标签</span>
                  <span className="text-sm text-foreground">{rule.tag}</span>
                  <span className="text-muted-foreground/50">→</span>
                  <span className="text-muted-foreground">
                    {resolveCategoryLabel(rule.categoryId, policy)}
                  </span>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="删除标签规则"
                  className="size-6 text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  onClick={() =>
                    setTagRules((prev) =>
                      prev.filter((r) => r.tag !== rule.tag),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-border/50 pb-2">
            <Select
              value={newRuleKind}
              onValueChange={(v) =>
                setNewRuleKind(v === "tag" ? "tag" : "project")
              }
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-1.5 text-xs text-muted-foreground shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">项目前缀</SelectItem>
                <SelectItem value="tag">任务标签</SelectItem>
              </SelectContent>
            </Select>
            <input
              type="text"
              className="min-w-[120px] flex-1 bg-transparent py-1 text-xs text-foreground placeholder:text-muted-foreground/55 outline-none"
              placeholder={
                newRuleKind === "project" ? "输入项目名如 Study…" : "输入标签如 reading…"
              }
              value={newRulePattern}
              onChange={(e) => setNewRulePattern(e.target.value)}
            />
            <Select value={newRuleCategory} onValueChange={setNewRuleCategory}>
              <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-1.5 text-xs text-muted-foreground shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {policy.categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="gap-1 text-xs"
              disabled={!newRulePattern.trim()}
              onClick={handleAddRule}
            >
              <Plus className="size-3.5" />
              添加
            </Button>
          </div>

          <div className="mt-5 flex justify-end">
            <Button type="submit" size="sm" disabled={busy}>
              保存设置
            </Button>
          </div>
        </section>
      </form>

      {/* Progressive disclosure: Data & Recovery utilities tucked cleanly inside Collapsibles */}
      <section className="space-y-1">
        <div className="border-b border-border/60 pb-2">
          <h2 className="text-xs font-medium text-muted-foreground">
            数据工具
          </h2>
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center justify-between border-b border-border/35 py-3 text-left text-sm text-foreground transition-colors hover:text-foreground/80"
            >
              <span>历史 Timewarrior 快照导入</span>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 py-4 text-xs">
            <p className="text-muted-foreground">
              仅导入切换时刻之前的历史区间，保留幂等记录，不干扰当前运行中的计时。
            </p>
            <label className="flex items-center gap-2 text-muted-foreground">
              <Checkbox
                checked={clipOpenToCutover}
                onCheckedChange={(v) => setClipOpenToCutover(Boolean(v))}
              />
              裁剪并导入跨越切换点的未闭合记录
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy || importBusy}
                onClick={() => void handlePreviewImport()}
              >
                预览范围
              </Button>
              {importPreview && (
                <Button
                  type="button"
                  size="xs"
                  disabled={
                    busy || importBusy || importPreview.importableCount === 0
                  }
                  onClick={() => void handleApplyImport()}
                >
                  确认导入（{importPreview.importableCount} 条）
                </Button>
              )}
            </div>
            {importError && <p className="text-destructive">{importError}</p>}
            {importPreview && (
              <p className="text-muted-foreground">
                可导入 {importPreview.importableCount} 条 · 切换后跳过{" "}
                {importPreview.skippedAfterCutoverCount} 条 · 冲突{" "}
                {importPreview.conflictCount} 条
                {importPreview.alreadyImportedBatchId
                  ? `（该快照已导入，批次 ${importPreview.alreadyImportedBatchId.slice(0, 8)}）`
                  : ""}
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center justify-between border-b border-border/35 py-3 text-left text-sm text-foreground transition-colors hover:text-foreground/80"
            >
              <span>Time 账本独立备份与恢复</span>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 py-4 text-xs">
            <p className="text-muted-foreground">
              单独导出或恢复 `time.sqlite`，不会改写 Taskwarrior 任务状态。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy || backupBusy}
                onClick={() => void handleExportTimeBackup()}
              >
                导出备份
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy || backupBusy}
                onClick={() => backupInputRef.current?.click()}
              >
                选择文件预览恢复
              </Button>
              <input
                ref={backupInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) =>
                  void handleBackupFileChange(e.target.files?.[0])
                }
              />
            </div>
            {backupError && <p className="text-destructive">{backupError}</p>}
            {backupPreview && (
              <div className="space-y-2 border-l-2 border-border pl-3">
                <p className="text-foreground">
                  校验通过：含 {backupPreview.candidateCounts.activities}{" "}
                  条活动（代际 {backupPreview.currentCounts.timeEpoch} →{" "}
                  {backupPreview.currentCounts.timeEpoch + 1}）
                </p>
                {backupPreview.warnings.map((w) => (
                  <p key={w} className="text-amber-600 dark:text-amber-400">
                    {w}
                  </p>
                ))}
                <Button
                  type="button"
                  size="xs"
                  variant="destructive"
                  disabled={busy || backupBusy}
                  onClick={() =>
                    void runMutation("已恢复 Time 账本备份", () =>
                      applyTimeBackupRestore(backupPreview.token),
                    ).then((res) => {
                      if (res) setBackupPreview(null);
                    })
                  }
                >
                  确认恢复
                </Button>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  );
}
