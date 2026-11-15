import { useEffect } from "react";

/** Keep mobile portals inside the visible viewport when the keyboard opens. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Pinch zoom should remain native; it must not rearrange the app.
      if (viewport.scale !== 1) return;
      root.style.setProperty("--visual-height", `${viewport.height}px`);
      root.style.setProperty("--visual-top", `${viewport.offsetTop}px`);
      root.dataset.keyboardOpen = String(
        window.innerHeight - viewport.height > 150,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      root.style.removeProperty("--visual-height");
      root.style.removeProperty("--visual-top");
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
