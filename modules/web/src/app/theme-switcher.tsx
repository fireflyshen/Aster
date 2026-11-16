import type {
  ThemeMode,
  ThemePalette,
  WorkspacePreferences,
} from "@core/workspace/organization";
import {
  normalizeThemeMode,
  normalizeThemePalette,
  THEME_PALETTES,
} from "@core/workspace/preferences";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

export const themePresets = THEME_PALETTES;

/** Syncs appearance mode and palette with backend-persisted workspace preferences. */
export function useThemePreference(
  preferences?: WorkspacePreferences,
  onUpdatePreferences?: (patch: WorkspacePreferences) => void,
) {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    normalizeThemeMode(
      preferences?.theme ?? document.documentElement.dataset.theme,
    ),
  );
  const [palette, setPalette] = useState<ThemePalette>(() =>
    normalizeThemePalette(
      preferences?.palette ?? document.documentElement.dataset.palette,
    ),
  );
  const [resolvedDark, setResolvedDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    if (preferences?.theme !== undefined) {
      setTheme(normalizeThemeMode(preferences.theme));
    }
  }, [preferences?.theme]);

  useEffect(() => {
    if (preferences?.palette !== undefined) {
      setPalette(normalizeThemePalette(preferences.palette));
    }
  }, [preferences?.palette]);

  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && system.matches);
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle("dark", dark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#1c1c1d" : "#faf9f7");
      setResolvedDark(dark);
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
  }, [palette]);

  return {
    theme,
    palette,
    resolvedDark,
    changeTheme: (next: ThemeMode) => {
      setTheme(next);
      onUpdatePreferences?.({ theme: next });
    },
    changePalette: (next: ThemePalette) => {
      setPalette(next);
      onUpdatePreferences?.({ palette: next });
    },
  };
}

export function ThemePanel({
  preference,
}: {
  preference: ReturnType<typeof useThemePreference>;
}) {
  const { theme, palette, resolvedDark, changeTheme, changePalette } =
    preference;
  return (
    <div className="settings-theme-panel">
      <p className="settings-intro">用喜欢的颜色，让工作区更像你。</p>
      <fieldset>
        <legend>外观</legend>
        <div className="appearance-segments">
          {(
            [
              { value: "light", label: "浅色", Icon: Sun },
              { value: "dark", label: "深色", Icon: Moon },
              { value: "system", label: "系统", Icon: Monitor },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              onClick={() => changeTheme(value)}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>主题颜色</legend>
        <div className="theme-presets">
          {themePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-label={`${preset.name}主题`}
              aria-pressed={palette === preset.id}
              onClick={() => changePalette(preset.id)}
              className="theme-preset"
              style={
                {
                  "--preview-accent": resolvedDark ? preset.dark : preset.light,
                } as CSSProperties
              }
            >
              <span className="theme-preview-nav" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="theme-preview-main" aria-hidden="true">
                <span className="theme-preview-heading">
                  {preset.name}
                  {palette === preset.id && <Check className="size-4" />}
                </span>
                <span className="theme-preview-task">
                  <i />
                  <b />
                </span>
                <span className="theme-preview-line" />
              </span>
              <span className="sr-only">{preset.name}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <p className="settings-theme-hint" role="status">
        已应用 · 自动保存在服务端
      </p>
    </div>
  );
}
