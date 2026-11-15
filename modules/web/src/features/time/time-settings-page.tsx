import type {
  ProjectCategoryRule,
  TagCategoryRule,
  TimePolicy,
} from "@core/time/model";
import { Download, History, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    try {
      const preview = await previewTimewarriorImport({ clipOpenToCutover });
      setImportPreview(preview);
    } finally {
      setImportBusy(false);
    }
  }

  async function handleApplyImport() {
    setImportBusy(true);
    try {
      const res = await runMutation("已完成 Timewarrior 历史快照导入", () =>
        applyTimewarriorImport({ clipOpenToCutover }),
      );
      if (res) setImportPreview(null);
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
    <div className="space-y-5">
      {/* Policy Form */}
      <form
        onSubmit={(e) => void handleSavePolicy(e)}
        className="space-y-5 rounded-xl border border-border/70 bg-card/50 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">基础规则与作息模板</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              日/周时间线按所设 IANA 时区划分，精力重置周期为该时区每日 06:00。
            </p>
          </div>
          <Badge variant="outline">策略 v{policy.policyVersion}</Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="time-policy-tz">IANA 时区</Label>
            <Input
              id="time-policy-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Shanghai"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="time-policy-long">长计时提醒阈值（分钟）</Label>
            <Input
              id="time-policy-long"
              type="number"
              min={15}
              max={1440}
              value={thresholdMins}
              onChange={(e) => setThresholdMins(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium">作息候选（睡眠模板）</div>
              <div className="text-[11px] text-muted-foreground">
                每天展示睡眠时段候选，一键“睡眠照常”确认，不填也不会阻塞任何记录。
              </div>
            </div>
            <Switch
              checked={sleepEnabled}
              onCheckedChange={setSleepEnabled}
              aria-label="启用睡眠候选模板"
            />
          </div>
          {sleepEnabled && (
            <div className="grid grid-cols-2 gap-2.5 sm:max-w-xs">
              <div className="space-y-1">
                <Label htmlFor="sleep-start" className="text-[11px]">
                  入睡时间
                </Label>
                <Input
                  id="sleep-start"
                  type="time"
                  value={sleepStart}
                  onChange={(e) => setSleepStart(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sleep-end" className="text-[11px]">
                  起床时间
                </Label>
                <Input
                  id="sleep-end"
                  type="time"
                  value={sleepEnd}
                  onChange={(e) => setSleepEnd(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Auto-classification rules */}
        <div className="space-y-2.5">
          <div>
            <div className="text-xs font-medium">自动分类映射规则</div>
            <div className="text-[11px] text-muted-foreground">
              未显式指定分类时按规则匹配；未命中先记为“未分类”，不打断记录节奏。
            </div>
          </div>
          <div className="space-y-1.5">
            {projectRules.map((rule) => (
              <div
                key={`proj-${rule.pattern}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">项目前缀: {rule.pattern}</Badge>
                  <span>→</span>
                  <Badge variant="secondary">
                    {resolveCategoryLabel(rule.categoryId, policy)}
                  </Badge>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="删除项目规则"
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
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">标签: {rule.tag}</Badge>
                  <span>→</span>
                  <Badge variant="secondary">
                    {resolveCategoryLabel(rule.categoryId, policy)}
                  </Badge>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="删除标签规则"
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

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={newRuleKind}
              onValueChange={(v) =>
                setNewRuleKind(v === "tag" ? "tag" : "project")
              }
            >
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">项目前缀</SelectItem>
                <SelectItem value="tag">任务标签</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="h-8 min-w-[140px] flex-1 text-xs"
              placeholder={
                newRuleKind === "project" ? "例如：Study" : "例如：reading"
              }
              value={newRulePattern}
              onChange={(e) => setNewRulePattern(e.target.value)}
            />
            <Select value={newRuleCategory} onValueChange={setNewRuleCategory}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
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
              variant="outline"
              onClick={handleAddRule}
            >
              <Plus className="size-3.5" />
              添加规则
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy}>
            保存时间设置
          </Button>
        </div>
      </form>

      {/* Timewarrior Snapshot Import */}
      <section className="space-y-3 rounded-xl border border-border/70 bg-card/50 p-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <History className="size-4 text-primary" />
            历史 Timewarrior 快照导入
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            导入采用冻结快照与启用切换点裁剪，保留幂等批次元数据，不会污染正在运行的新计时。
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={clipOpenToCutover}
            onCheckedChange={(v) => setClipOpenToCutover(Boolean(v))}
          />
          将跨越切换点的未闭合 Timewarrior 记录裁剪截止至切换点并导入
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy || importBusy}
            onClick={() => void handlePreviewImport()}
          >
            预览导入范围
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

        {importPreview && (
          <Alert>
            <AlertDescription className="space-y-1 text-xs">
              <div>
                可导入 <strong>{importPreview.importableCount}</strong> 条 ·
                切换后跳过 {importPreview.skippedAfterCutoverCount} 条 · 冲突{" "}
                {importPreview.conflictCount} 条 · 未闭合{" "}
                {importPreview.openAtCutoverCount} 条
              </div>
              {importPreview.alreadyImported && (
                <div className="text-muted-foreground">
                  该快照已导入过，不会重复创建活动。
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </section>

      {/* Time SQLite Backup & Independent Restore */}
      <section className="space-y-3 rounded-xl border border-border/70 bg-card/50 p-4">
        <div>
          <h2 className="text-sm font-medium">Time 独立账本备份与恢复</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            单独备份 `time.sqlite`
            与校验快照；恢复仅作用于时间账本并推进代际屏障，不改写任务状态。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy || backupBusy}
            onClick={() => void handleExportTimeBackup()}
          >
            <Download className="size-3.5" />
            导出 Time 备份
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy || backupBusy}
            onClick={() => backupInputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            选择备份预览恢复
          </Button>
          <input
            ref={backupInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => void handleBackupFileChange(e.target.files?.[0])}
          />
        </div>

        {backupError && (
          <p className="text-xs text-destructive">{backupError}</p>
        )}

        {backupPreview && (
          <Alert>
            <AlertDescription className="space-y-2 text-xs">
              <div>
                校验通过：包含 {backupPreview.activityCount}{" "}
                条活动，恢复后将从代际 {backupPreview.currentTimeEpoch} 推进至{" "}
                {backupPreview.nextTimeEpoch}。
              </div>
              {backupPreview.activeFrozenWarning && (
                <div className="text-amber-600 dark:text-amber-400">
                  {backupPreview.activeFrozenWarning}
                </div>
              )}
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
                确认仅恢复 Time 账本
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </section>
    </div>
  );
}
