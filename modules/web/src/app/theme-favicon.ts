import { asterFlowerPath } from "@/components/aster-mark-path";
import { THEME_PALETTES, type ThemePalette } from "@core/workspace/preferences";

export function applyThemeFavicon(palette: ThemePalette, dark: boolean) {
  const link = document.querySelector<HTMLLinkElement>("#aster-favicon");
  if (!link) return;

  const preset =
    THEME_PALETTES.find(({ id }) => id === palette) ?? THEME_PALETTES[0];
  const background =
    preset.id === "aster" ? preset.light : dark ? preset.dark : preset.light;
  const flower =
    preset.id === "aster" ? preset.dark : dark ? "#202022" : "#faf9f7";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 28 28"><rect width="28" height="28" rx="8" fill="${background}"/><path d="${asterFlowerPath}" fill="${flower}"/></svg>`;
  const href =
    preset.id === "aster" && !dark
      ? "/icon.svg"
      : `data:image/svg+xml,${encodeURIComponent(svg)}`;

  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}
