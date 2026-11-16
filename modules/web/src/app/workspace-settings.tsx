import { sidebarItems, type SidebarPreferences } from "./sidebar-preferences";
import { Switch } from "@/components/ui/switch";
import { PanelLeft } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DatabaseBackup,
  SlidersHorizontal,
  Palette,
  Settings2,
} from "lucide-react";
import type { CompleteBehavior } from "./hooks/use-workspace-navigation";
import { ThemePanel, useThemePreference } from "./theme-switcher";

export function WorkspaceSettings({
  open,
  onOpenChange,
  completeBehavior,
  onCompleteBehaviorChange,
  disabled,
  onTimeSettings,
  onRecovery,
  sidebarPreferences,
  onSidebarPreferencesChange,
}: {
  sidebarPreferences: SidebarPreferences;
  onSidebarPreferencesChange: (next: SidebarPreferences) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completeBehavior: CompleteBehavior;
  onCompleteBehaviorChange?: (next: CompleteBehavior) => void;
  disabled: boolean;
  onTimeSettings?: () => void;
  onRecovery: () => void;
}) {
  const preference = useThemePreference();
  const [section, setSection] = useState<"theme" | "general" | "sidebar">(
    "theme",
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="workspace-settings gap-0 p-0"
        aria-describedby={undefined}
      >
        <aside className="settings-sidebar">
          <h2>设置</h2>
          <nav aria-label="设置分类">
            <button
              type="button"
              aria-current={section === "general" ? "page" : undefined}
              onClick={() => setSection("general")}
            >
              <Settings2 className="size-5" />
              常规
            </button>
            <button
              type="button"
              aria-current={section === "theme" ? "page" : undefined}
              onClick={() => setSection("theme")}
            >
              <Palette className="size-5" />
              主题
            </button>
            <button
              type="button"
              aria-current={section === "sidebar" ? "page" : undefined}
              onClick={() => setSection("sidebar")}
            >
              <PanelLeft className="size-5" />
              侧栏
            </button>
            {onTimeSettings && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onOpenChange(false);
                  onTimeSettings();
                }}
              >
                <SlidersHorizontal className="size-5" />
                时间与预算
              </button>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onOpenChange(false);
                onRecovery();
              }}
            >
              <DatabaseBackup className="size-5" />
              数据与恢复
            </button>
          </nav>
        </aside>
        <div className="settings-main">
          <header className="settings-header">
            <DialogTitle>
              <span className="sr-only">设置：</span>
              {section === "theme"
                ? "主题"
                : section === "sidebar"
                  ? "侧栏"
                  : "常规"}
            </DialogTitle>
          </header>
          <div className="settings-body">
            {section === "theme" ? (
              <ThemePanel preference={preference} />
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
                  隐藏的视图仍可通过搜索打开。设置自动保存在此浏览器。
                </p>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
