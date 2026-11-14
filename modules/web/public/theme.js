// Runs before styles are painted, including when restoring a saved theme.
(() => {
    let theme = "system";
    try {
        const saved = localStorage.getItem("aster.theme");
        if (["light", "dark", "system"].includes(saved)) theme = saved;
    } catch {
        /* System appearance still works when storage is unavailable. */
    }
    const dark =
        theme === "dark" ||
        (theme === "system" &&
            matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", dark);
    document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#1c1c1d" : "#faf9f7");
})();
