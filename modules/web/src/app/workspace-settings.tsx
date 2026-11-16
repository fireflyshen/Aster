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
  disabled,
  blocked = false,
  notice = "",
  isTimeMode = true,
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
  disabled: boolean;
  blocked?: boolean;
  notice?: string;
  isTimeMode?: boolean;
  onTimeMutated?: () => void;
  onRestoreTask?: (uuid: string) => Promise<boolean>;
  onRefreshAll?: () => Promise<unknown>;
  onUnconfirmed?: () => void;
}) {
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
    { id: "general", label: "常规", Icon: Settings2 },
    { id: "theme", label: "主题", Icon: Palette },
    { id: "sidebar", label: "侧栏", Icon: PanelLeft },
    { id: "time", label: "时间与预算", Icon: SlidersHorizontal },
    { id: "recovery", label: "数据与恢复", Icon: DatabaseBackup },
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
          <h2>设置</h2>
          <nav aria-label="设置分类">
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
              <span className="sr-only">设置：</span>
              {SECTION_TITLES[section]}
            </DialogTitle>
          </header>
          <div className="settings-body">
            {section === "theme" ? (
              <ThemePanel preference={themePreference} />
            ) : section === "sidebar" ? (
              <div className="sidebar-preferences-panel">
                <fieldset>
                  <legend>在侧栏显示</legend>
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
                      <span>{item.label}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="sidebar-count-setting">
                  <div>
                    <h3>显示任务数量</h3>
                    <p>在视图、项目和收藏右侧显示数量</p>
                  </div>
                  <Switch
                    aria-label="显示任务数量"
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
                  隐藏的视图仍可通过搜索打开。设置自动保存在服务端。
                </p>
              </div>
            ) : section === "time" ? (
              <TimeSettingsPanel
                isTimeMode={isTimeMode}
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
              <fieldset className="space-y-2.5">
                <legend className="mb-2.5 text-sm font-medium">
                  完成任务后
                </legend>
                {(
                  [
                    ["hide", "收起已完成任务"],
                    ["strikethrough", "保留任务并显示删除线"],
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
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
