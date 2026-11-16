// Runs before styles are painted, including when restoring a saved theme.
(() => {
  let theme = "system";
  let palette = "aster";
  try {
    const saved = localStorage.getItem("aster.theme");
    const savedPalette = localStorage.getItem("aster.palette");
    if (
      [
        "aster",
        "todoist",
        "moonstone",
        "tangerine",
        "kale",
        "blueberry",
        "lavender",
        "raspberry",
      ].includes(savedPalette)
    )
      palette = savedPalette;
    if (["light", "dark", "system"].includes(saved)) theme = saved;
  } catch {
    /* System appearance still works when storage is unavailable. */
  }
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.palette = palette;
  document.documentElement.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#1c1c1d" : "#faf9f7");
})();
