import { languages, setLanguage, useI18n, type Language } from "@/app/language";
import { useState } from "react";
import {
  DatabaseBackup,
  Palette,
  PanelLeft,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { RecoveryPanel } from "@/features/recovery/recovery-center";
import { TimeSettingsPanel } from "@/features/time/time-settings-panel";
import {
  DOING_LIMIT,
  MAX_DOING_LIMIT,
  MIN_DOING_LIMIT,
} from "@core/tasks/state";
import type { CompleteBehavior } from "./hooks/use-workspace-navigation";
import { sidebarItems, type SidebarPreferences } from "./sidebar-preferences";
import { ThemePanel, type useThemePreference } from "./theme-switcher";

export type SettingsSection =
  | "general"
  | "theme"
  | "sidebar"
  | "time"
  | "recovery";

const SECTION_TITLES: Record<SettingsSection, string> = {
  general: "常规",
  theme: "主题",
  sidebar: "侧栏",
  time: "时间与预算",
  recovery: "数据与恢复",
};

/** Unified workspace Settings dialog hosting General, Theme, Sidebar, Time & Budget, and Data & Recovery panels. */
export function WorkspaceSettings({
  open,
  onOpenChange,
  section: controlledSection,
  onSectionChange,
  completeBehavior,
  onCompleteBehaviorChange,
  doingLimit = DOING_LIMIT,
  onDoingLimitChange,
  disabled,
  blocked = false,
  notice = "",
  isTimeMode = true,
  timeTags,
  onTimeMutated,
  onRestoreTask,
  onRefreshAll,
  onUnconfirmed,
  themePreference,
  sidebarPreferences,
  onSidebarPreferencesChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
  themePreference: ReturnType<typeof useThemePreference>;
  sidebarPreferences: SidebarPreferences;
  onSidebarPreferencesChange: (next: SidebarPreferences) => void;
  completeBehavior: CompleteBehavior;
  onCompleteBehaviorChange?: (next: CompleteBehavior) => void;
  doingLimit?: number;
  onDoingLimitChange?: (next: number) => void;
  disabled: boolean;
  blocked?: boolean;
  notice?: string;
  isTimeMode?: boolean;
  timeTags: readonly string[];
  onTimeMutated?: () => void;
  onRestoreTask?: (uuid: string) => Promise<boolean>;
  onRefreshAll?: () => Promise<unknown>;
  onUnconfirmed?: () => void;
}) {
  const { t, locale } = useI18n();
  const [internalSection, setInternalSection] =
    useState<SettingsSection>("theme");
  const [recoveryWorking, setRecoveryWorking] = useState(false);

  const section = controlledSection ?? internalSection;
  const selectSection = onSectionChange ?? setInternalSection;
  const preventClose = recoveryWorking;

  const navItems: Array<{
    id: SettingsSection;
    label: string;
    Icon: typeof Settings2;
  }> = [
    { id: "general", label: t("常规"), Icon: Settings2 },
    { id: "theme", label: t("主题"), Icon: Palette },
    { id: "sidebar", label: t("侧栏"), Icon: PanelLeft },
    { id: "time", label: t("时间与预算"), Icon: SlidersHorizontal },
    { id: "recovery", label: t("数据与恢复"), Icon: DatabaseBackup },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && preventClose) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={!preventClose}
        className="workspace-settings gap-0 p-0"
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => {
          if (preventClose) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (preventClose) e.preventDefault();
        }}
      >
        <aside className="settings-sidebar">
          <h2>{t("设置")}</h2>
          <nav aria-label={t("设置分类")}>
            {navItems.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                disabled={preventClose}
                aria-current={section === id ? "page" : undefined}
                onClick={() => selectSection(id)}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </nav>
        </aside>
        <div className="settings-main">
          <header className="settings-header">
            <DialogTitle>
              <span className="sr-only">{t("设置：")}</span>
              {t(SECTION_TITLES[section])}
            </DialogTitle>
          </header>
          <div className="settings-body">
            {section === "theme" ? (
              <ThemePanel preference={themePreference} />
            ) : section === "sidebar" ? (
              <div className="sidebar-preferences-panel">
                <fieldset>
                  <legend>{t("在侧栏显示")}</legend>
                  {sidebarItems.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={!sidebarPreferences.hidden.includes(item.id)}
                        onChange={(event) =>
                          onSidebarPreferencesChange({
                            ...sidebarPreferences,
                            hidden: event.target.checked
                              ? sidebarPreferences.hidden.filter(
                                  (id) => id !== item.id,
                                )
                              : [...sidebarPreferences.hidden, item.id],
                          })
                        }
                      />
                      <span>{t(item.label)}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="sidebar-count-setting">
                  <div>
                    <h3>{t("显示任务数量")}</h3>
                    <p>{t("在视图、项目和收藏右侧显示数量")}</p>
                  </div>
                  <Switch
                    aria-label={t("显示任务数量")}
                    checked={sidebarPreferences.showCounts}
                    onCheckedChange={(showCounts) =>
                      onSidebarPreferencesChange({
                        ...sidebarPreferences,
                        showCounts,
                      })
                    }
                  />
                </div>
                <p className="settings-theme-hint">
                  {t("隐藏的视图仍可通过搜索打开。设置自动保存在服务端。")}
                </p>
              </div>
            ) : section === "time" ? (
              <TimeSettingsPanel
                isTimeMode={isTimeMode}
                availableTags={timeTags}
                onTimeMutated={() => onTimeMutated?.()}
              />
            ) : section === "recovery" ? (
              <RecoveryPanel
                busy={disabled}
                blocked={blocked}
                notice={notice}
                onWorkingChange={setRecoveryWorking}
                onUnconfirmed={() => onUnconfirmed?.()}
                onRestore={(uuid) =>
                  onRestoreTask ? onRestoreTask(uuid) : Promise.resolve(false)
                }
                onRefresh={() =>
                  onRefreshAll ? onRefreshAll() : Promise.resolve()
                }
              />
            ) : (
              <div className="space-y-6">
                <label className="flex flex-wrap items-center justify-between gap-3 text-sm font-medium">
                  <span>{t("语言")}</span>
                  <select
                    className="min-h-10 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground"
                    value={locale}
                    onChange={(event) =>
                      setLanguage(event.currentTarget.value as Language)
                    }
                  >
                    {languages.map(({ id, name }) => (
                      <option key={id} value={id} lang={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="space-y-2.5">
                  <legend className="mb-2.5 text-sm font-medium">
                    {t("完成任务后")}
                  </legend>
                  {(
                    [
                      ["hide", t("收起已完成任务")],
                      ["strikethrough", t("保留任务并显示删除线")],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex min-h-9 cursor-pointer items-center gap-3 text-sm text-muted-foreground"
                    >
                      <input
                        type="radio"
                        name="complete-behavior"
                        value={value}
                        checked={completeBehavior === value}
                        disabled={disabled}
                        onChange={() => onCompleteBehaviorChange?.(value)}
                        className="size-4 accent-(--primary)"
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>

                <fieldset className="space-y-3 border-t border-border/70 pt-5">
                  <legend className="text-sm font-medium">
                    {t("「现在能做」处理中数量上限")}
                  </legend>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "范围 {0}–{1} · 默认 {2}",
                      MIN_DOING_LIMIT,
                      MAX_DOING_LIMIT,
                      DOING_LIMIT,
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <div className="inline-flex items-center rounded-md border border-border bg-background">
                      <button
                        type="button"
                        aria-label={t("减少处理中数量上限")}
                        disabled={disabled || doingLimit <= MIN_DOING_LIMIT}
                        onClick={() =>
                          onDoingLimitChange?.(
                            Math.max(MIN_DOING_LIMIT, doingLimit - 1),
                          )
                        }
                        className="flex h-8 w-8 cursor-pointer items-center justify-center text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        aria-label={t("处理中数量上限")}
                        min={MIN_DOING_LIMIT}
                        max={MAX_DOING_LIMIT}
                        value={doingLimit}
                        disabled={disabled}
                        onChange={(event) => {
                          const parsed = Number.parseInt(
                            event.target.value,
                            10,
                          );
                          if (
                            Number.isInteger(parsed) &&
                            parsed >= MIN_DOING_LIMIT &&
                            parsed <= MAX_DOING_LIMIT
                          ) {
                            onDoingLimitChange?.(parsed);
                          }
                        }}
                        className="h-8 w-12 border-x border-border bg-transparent text-center text-sm font-medium tabular-nums outline-none"
                      />
                      <button
                        type="button"
                        aria-label={t("增加处理中数量上限")}
                        disabled={disabled || doingLimit >= MAX_DOING_LIMIT}
                        onClick={() =>
                          onDoingLimitChange?.(
                            Math.min(MAX_DOING_LIMIT, doingLimit + 1),
                          )
                        }
                        className="flex h-8 w-8 cursor-pointer items-center justify-center text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {[3, 5, 7, 10].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={disabled}
                          aria-pressed={doingLimit === preset}
                          onClick={() => onDoingLimitChange?.(preset)}
                          className={`h-8 cursor-pointer rounded-md border px-2.5 text-xs tabular-nums transition-colors ${
                            doingLimit === preset
                              ? "border-primary bg-primary/10 font-medium text-foreground"
                              : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          }`}
                        >
                          {preset} {t("条")}
                        </button>
                      ))}
                    </div>
                  </div>
                </fieldset>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
