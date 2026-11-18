import { useI18n } from "@/app/language";
import type { TimePolicy } from "@core/time/model";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveBackup } from "@/features/recovery/backup-panel";
import { TimeTagPicker } from "./project-tag-fields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { normalizeHourlyRateCents, yuanToHourlyRateCents } from "./time-format";

export function TimeSettingsPage({
  policy,
  availableTags,
  busy,
  runMutation,
}: {
  policy: TimePolicy;
  availableTags: readonly string[];
  busy: boolean;
  runMutation: <T extends TimeReceipt | Record<string, unknown>>(
    label: string,
    fn: () => Promise<T>,
    options?: { undoable?: boolean },
  ) => Promise<T | undefined>;
}) {
  const { t } = useI18n();
  const [timezone, setTimezone] = useState(policy.timezone);
  const [thresholdMins, setThresholdMins] = useState(
    String(Math.max(1, Math.round(policy.longActivityThresholdSeconds / 60))),
  );
  const [sleepEnabled, setSleepEnabled] = useState(
    policy.sleepTemplate.enabled && Boolean(policy.sleepTemplate.tag),
  );
  const [sleepTag, setSleepTag] = useState(policy.sleepTemplate.tag ?? "");
  const [zeroRateTags, setZeroRateTags] = useState(policy.zeroRateTags ?? []);
  const [sleepStart, setSleepStart] = useState(policy.sleepTemplate.startTime);
  const [sleepEnd, setSleepEnd] = useState(policy.sleepTemplate.endTime);
  const [hourlyRateYuan, setHourlyRateYuan] = useState(
    String(normalizeHourlyRateCents(policy.hourlyRateCents) / 100),
  );
  const [taskListHighlightCost, setTaskListHighlightCost] = useState(
    policy.taskListHighlightCost ?? true,
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
    setSleepEnabled(
      policy.sleepTemplate.enabled && Boolean(policy.sleepTemplate.tag),
    );
    setSleepTag(policy.sleepTemplate.tag ?? "");
    setZeroRateTags(policy.zeroRateTags ?? []);
    setSleepStart(policy.sleepTemplate.startTime);
    setSleepEnd(policy.sleepTemplate.endTime);
    setHourlyRateYuan(
      String(normalizeHourlyRateCents(policy.hourlyRateCents) / 100),
    );
    setTaskListHighlightCost(policy.taskListHighlightCost ?? true);
  }, [policy]);

  const parsedYuan = Number(hourlyRateYuan);
  const previewRateCents =
    Number.isFinite(parsedYuan) && parsedYuan >= 0
      ? yuanToHourlyRateCents(parsedYuan)
      : normalizeHourlyRateCents(policy.hourlyRateCents);

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (sleepEnabled && !sleepTag) return;
    const parsedThreshold = Number(thresholdMins);
    await runMutation(t("已保存时间与单价设置"), () =>
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
            tag: sleepTag,
            startTime: sleepStart,
            endTime: sleepEnd,
            version: policy.sleepTemplate.version,
          },
          hourlyRateCents: previewRateCents,
          zeroRateTags,
          taskListHighlightCost,
        },
      }),
    );
  }

  async function handlePreviewImport() {
    setImportBusy(true);
    setImportError("");
    try {
      const preview = await previewTimewarriorImport({
        clipOpenToCutover,
      });
      setImportPreview(preview);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t("预览导入失败"));
    } finally {
      setImportBusy(false);
    }
  }

  async function handleApplyImport() {
    setImportBusy(true);
    setImportError("");
    try {
      const res = await runMutation(t("已完成 Timewarrior 历史快照导入"), () =>
        applyTimewarriorImport({ clipOpenToCutover }),
      );
      if (res) setImportPreview(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t("导入失败"));
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
      setBackupError(err instanceof Error ? err.message : t("导出失败"));
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
        throw new Error(t("所选文件不是有效的 Aster Time 备份文件。"));
      }
      const preview = await previewTimeBackupRestore(parsed.sqliteBase64);
      setBackupPreview(preview);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : t("解析备份失败"));
    } finally {
      setBackupBusy(false);
      if (backupInputRef.current) backupInputRef.current.value = "";
    }
  }

  return (
    <div className="ledger-page ledger-settings">
      {/* Main Policy Form: Clean Linear-style setting rows */}
      <form
        onSubmit={(e) => void handleSavePolicy(e)}
        className="ledger-settings-form"
      >
        <section className="ledger-settings-group">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              {t("时间与成本")}
            </h2>
            <span className="text-xs text-muted-foreground/70">
              {t("按后续新增记录生效")}
            </span>
          </div>

          <div className="divide-y divide-border/35">
            <div className="space-y-2 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-foreground">
                    {t("我的时间单价")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("仅影响新记录。")}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">¥</span>
                  <Input
                    id="time-policy-rate"
                    aria-label={t("我的时间单价")}
                    type="number"
                    min={0}
                    max={100000}
                    step="1"
                    className="h-8 w-24 text-right text-xs tabular-nums"
                    value={hourlyRateYuan}
                    onChange={(e) => setHourlyRateYuan(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("/ 小时")}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 py-3.5">
              <div>
                <div className="text-sm text-foreground">
                  {t("只计时长的标签")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("新记录按 ¥0/小时。")}
                </p>
                {zeroRateTags.length > 0 && (
                  <p className="mt-1 break-words text-xs">
                    {zeroRateTags.map((tag) => `#${tag}`).join(" · ")}
                  </p>
                )}
              </div>
              <TimeTagPicker
                label={t("选择只计时长的标签")}
                tags={zeroRateTags}
                onChange={setZeroRateTags}
                availableTags={availableTags}
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-3.5">
              <div>
                <div className="text-sm text-foreground">
                  {t("任务列表优先显示金额")}
                </div>
              </div>
              <Switch
                checked={taskListHighlightCost}
                onCheckedChange={setTaskListHighlightCost}
                aria-label={t("任务列表默认突出显示金额")}
              />
            </div>
          </div>
        </section>

        <details className="ledger-section-disclosure">
          <summary>
            <span>{t("计时偏好")}</span>
          </summary>

          <div className="divide-y divide-border/35">
            <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
              <div>
                <div className="text-sm text-foreground">{t("时区")}</div>
              </div>
              <Input
                id="time-policy-tz"
                aria-label={t("IANA 时区")}
                className="h-8 w-44 text-xs"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Asia/Shanghai"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
              <div>
                <div className="text-sm text-foreground">
                  {t("长计时提醒（分钟）")}
                </div>
              </div>
              <Input
                id="time-policy-long"
                aria-label={t("长计时提醒阈值")}
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
                  <div className="text-sm text-foreground">{t("作息模板")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("确认后入账")}
                  </div>
                </div>
                <Switch
                  checked={sleepEnabled}
                  onCheckedChange={setSleepEnabled}
                  aria-label={t("启用作息模板")}
                />
              </div>
              {sleepEnabled && (
                <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-muted-foreground">
                  <Select value={sleepTag} onValueChange={setSleepTag}>
                    <SelectTrigger
                      aria-label={t("作息模板标签")}
                      className="w-36"
                    >
                      <SelectValue placeholder={t("选择已有标签")} />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        ...new Set([
                          ...availableTags,
                          ...(sleepTag ? [sleepTag] : []),
                        ]),
                      ].map((tag) => (
                        <SelectItem key={tag} value={tag}>
                          #{tag}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2">
                    <span>{t("入睡")}</span>
                    <Input
                      id="sleep-start"
                      type="time"
                      className="h-7 w-28 text-xs"
                      value={sleepStart}
                      onChange={(e) => setSleepStart(e.target.value)}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span>{t("起床")}</span>
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
        </details>
        <div className="ledger-settings-save">
          <Button
            type="submit"
            size="sm"
            disabled={busy || (sleepEnabled && !sleepTag)}
          >
            {t("保存设置")}
          </Button>
        </div>
      </form>

      {/* Progressive disclosure: Data & Recovery utilities tucked cleanly inside Collapsibles */}
      <section className="ledger-settings-tools space-y-1">
        <div className="border-b border-border/60 pb-2">
          <h2 className="text-xs font-medium text-muted-foreground">
            {t("数据工具")}
          </h2>
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center justify-between border-b border-border/35 py-3 text-left text-sm text-foreground transition-colors hover:text-foreground/80"
            >
              <span>{t("历史 Timewarrior 快照导入")}</span>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 py-4 text-xs">
            <p className="text-muted-foreground">
              {t(
                "仅导入切换时刻之前的历史区间，保留幂等记录，不干扰当前运行中的计时。",
              )}
            </p>
            <label className="flex items-center gap-2 text-muted-foreground">
              <Checkbox
                checked={clipOpenToCutover}
                onCheckedChange={(v) => setClipOpenToCutover(Boolean(v))}
              />
              {t("裁剪并导入跨越切换点的未闭合记录")}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy || importBusy}
                onClick={() => void handlePreviewImport()}
              >
                {t("预览范围")}
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
                  {t("确认导入（")}
                  {importPreview.importableCount} {t("条）")}
                </Button>
              )}
            </div>
            {importError && <p className="text-destructive">{importError}</p>}
            {importPreview && (
              <p className="text-muted-foreground">
                {t("可导入")} {importPreview.importableCount}{" "}
                {t("条 · 切换后跳过")} {importPreview.skippedAfterCutoverCount}{" "}
                {t("条 · 冲突")} {importPreview.conflictCount} {t("条")}
                {importPreview.alreadyImportedBatchId
                  ? t(
                      "（该快照已导入，批次 {0}）",
                      importPreview.alreadyImportedBatchId.slice(0, 8),
                    )
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
              <span>{t("Time 账本独立备份与恢复")}</span>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 py-4 text-xs">
            <p className="text-muted-foreground">
              {t(
                "单独导出或恢复 `time.sqlite`，不会改写 Taskwarrior 任务状态。",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy || backupBusy}
                onClick={() => void handleExportTimeBackup()}
              >
                {t("导出备份")}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy || backupBusy}
                onClick={() => backupInputRef.current?.click()}
              >
                {t("选择文件预览恢复")}
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
                  {t("校验通过：含")} {backupPreview.candidateCounts.activities}{" "}
                  {t("条活动（代际")} {backupPreview.currentCounts.timeEpoch} →{" "}
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
                    void runMutation(t("已恢复 Time 账本备份"), () =>
                      applyTimeBackupRestore(backupPreview.token),
                    ).then((res) => {
                      if (res) setBackupPreview(null);
                    })
                  }
                >
                  {t("确认恢复")}
                </Button>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  );
}
