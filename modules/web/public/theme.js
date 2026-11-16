// Fallback pre-paint initializer; runtime theme & palette are persisted and served by /api/theme.js.
(() => {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = "system";
  document.documentElement.dataset.palette = "aster";
  document.documentElement.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#1c1c1d" : "#faf9f7");
})();
