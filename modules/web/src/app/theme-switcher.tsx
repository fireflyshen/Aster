import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";
const validTheme = (value: string | null | undefined): Theme =>
  value === "light" || value === "dark" ? value : "system";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>(() =>
    validTheme(document.documentElement.dataset.theme),
  );
  const [resolvedDark, setResolvedDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && system.matches);
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle("dark", dark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#181818" : "#ffffff");
      setResolvedDark(dark);
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "aster.theme" || event.key === null)
        setTheme(validTheme(event.newValue));
    };
    addEventListener("storage", sync);
    return () => removeEventListener("storage", sync);
  }, []);
  const Icon = resolvedDark ? Moon : Sun;
  return (
    <Select
      value={theme}
      onValueChange={(value) => {
        const next = validTheme(value);
        setTheme(next);
        try {
          localStorage.setItem("aster.theme", next);
        } catch {
          /* Keep the session preference. */
        }
      }}
    >
      <SelectTrigger
        aria-label="Appearance"
        title="Appearance"
        className="size-8 justify-center gap-0 border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent dark:bg-transparent dark:hover:bg-accent [&>svg:last-child]:hidden"
      >
        <Icon className="size-[18px]" strokeWidth={1.5} />
        <span className="sr-only">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-36">
        <SelectItem value="light">
          <Sun className="size-4" />
          Light
        </SelectItem>
        <SelectItem value="dark">
          <Moon className="size-4" />
          Dark
        </SelectItem>
        <SelectItem value="system">
          <Monitor className="size-4" />
          System
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
